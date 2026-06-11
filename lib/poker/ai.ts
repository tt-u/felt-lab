import type { Rng } from './cards';
import { holeClass } from './cards';
import type { HandState, PlayerAction } from './engine';
import { legalActions, potTotal, activePlayers } from './engine';
import type { Personality } from './personality';
import {
  computeRanges,
  boardStrengthCached,
  equityVsRangeSample,
  rankInRange,
  rangeAdvantage,
  blockerScore,
  comboIndexOf,
} from './range-model';
import {
  handPercentile,
  positionLabel,
  OPEN_PCT,
  VS_OPEN_3BET_PCT,
  VS_OPEN_CALL_PCT,
  VS_3BET_4BET_PCT,
  VS_3BET_CALL_PCT,
  HU_OPEN_PCT,
  HU_BB_3BET_PCT,
  HU_BB_CALL_PCT,
  HU_VS_3BET_4BET_PCT,
  HU_VS_3BET_CALL_PCT,
  rfiOrder,
} from './ranges';

// 机器人决策: GTO 近似基线 + 性格偏移 + 频率随机化(混合策略)
export function decideBot(h: HandState, idx: number, prof: Personality, rng: Rng): PlayerAction {
  const la = legalActions(h);
  if (!la) throw new Error('无可用行动');
  const p = h.players[idx];
  const pot = potTotal(h);
  const toCall = la.callAmount;

  if (h.street === 'preflop') {
    return decidePreflop(h, idx, prof, rng);
  }

  // ---- 翻后: 范围对范围决策 ----
  // 重放公开行动得到每个玩家的实时范围, 胜率对范围抽样;
  // MDF 防守 / 阻断牌选诈唬 / 范围优势驱动下注频率(solver 概念的实时近似)
  const ranges = computeRanges(h);
  const opps = activePlayers(h).filter((q) => q.id !== p.id);
  const oppWeights = opps.map((q) => ranges.get(q.id)!);
  const nOpp = Math.max(1, oppWeights.length);
  const bs = boardStrengthCached(h.board);
  const myW = ranges.get(p.id)!;
  const myCombo = comboIndexOf(p.hole![0], p.hole![1]);

  const eq = equityVsRangeSample(p.hole!, h.board, oppWeights, 220, rng);
  const myRank = rankInRange(myCombo, myW, bs); // 在自己范围中的名次(0=顶端)
  const adv = rangeAdvantage(myW, oppWeights, bs); // 范围优势 [-1,1]
  const blocker = blockerScore(p.hole!, oppWeights, bs); // 阻断对手强牌的比例
  const myDraw = Number.isNaN(bs.draw[myCombo]) ? 0 : bs.draw[myCombo];
  const jitter = (rng() - 0.5) * 0.06; // 阈值抖动, 避免可预测

  if (la.canCheck) {
    // 价值下注: 对手范围已收紧, 门槛低于对随机牌; 范围优势越大下注越频繁
    const streetVb = h.street === 'flop' ? 0.52 : h.street === 'turn' ? 0.55 : 0.58;
    const vbThresh = streetVb - adv * 0.06 - (prof.aggression - 1) * 0.08 + jitter;
    if (eq > vbThresh && la.canRaise) {
      return { type: 'raise', to: betSize(h, p.streetBet, prof, rng, eq) };
    }
    // 诈唬: 范围底部的牌, 优先选强听牌或持阻断牌的组合
    if (myRank > 0.55 && la.canRaise) {
      const base = (h.street === 'flop' ? 0.16 : h.street === 'turn' ? 0.13 : 0.1) / nOpp;
      const quality = 0.6 + Math.max(0, adv) * 0.6 + blocker * 0.8 + myDraw * 0.7;
      if (rng() < base * quality * prof.bluff) {
        return { type: 'raise', to: betSize(h, p.streetBet, prof, rng, 0.3) };
      }
    }
    return { type: 'check' };
  }

  // 面对下注
  const potOdds = toCall / (pot + toCall);
  // MDF: 防守频率 = 1 - 下注/(下注+下注前底池), 不足则会被无脑诈唬剥削
  const potBefore = Math.max(1, pot - toCall);
  const mdf = potBefore / (potBefore + toCall);

  const raiseThresh = 0.78 - adv * 0.04 - (prof.aggression - 1) * 0.07 + jitter;
  if (eq > raiseThresh && la.canRaise) {
    if (rng() > 0.25) {
      return { type: 'raise', to: raiseSize(h, prof, rng) };
    }
  }
  // 半诈唬加注: 强听牌, 阻断牌加成, 多人底池频率递减
  if (la.canRaise && myDraw >= 1 && h.street !== 'river') {
    if (rng() < ((0.09 + blocker * 0.08) / nOpp) * prof.bluff * prof.aggression) {
      return { type: 'raise', to: raiseSize(h, prof, rng) };
    }
  }
  // 跟注第一原则: 对范围胜率够本(性格缩放)
  const needed = potOdds / prof.callDown + 0.015;
  if (eq >= needed) return { type: 'call' };
  // MDF 兜底: 胜率略差但牌在自己范围的前 MDF 段, 仍需防守(否则被诈唬打穿)
  // 河牌持阻断牌时抓诈唬范围略放宽
  const catchBonus = h.street === 'river' ? blocker * 0.05 : 0;
  if (eq >= needed - 0.06 - catchBonus && myRank <= mdf * Math.min(1.2, prof.callDown)) {
    if (rng() < 0.65) return { type: 'call' };
  }
  return la.canFold ? { type: 'fold' } : { type: 'check' };
}

function decidePreflop(h: HandState, idx: number, prof: Personality, rng: Rng): PlayerAction {
  const la = legalActions(h)!;
  const p = h.players[idx];
  const n = h.players.length;
  const pos = positionLabel(p.seatsFromButton, n);
  const cls = holeClass(p.hole![0], p.hole![1]);
  const pct = handPercentile(cls);
  const pot = potTotal(h);
  const toCall = la.callAmount;
  const jitter = (rng() - 0.5) * 0.04;
  const loose = prof.looseness;

  const raised = h.raisesThisStreet > 0;
  const limpers = !raised
    ? h.log.filter((a) => a.street === 'preflop' && a.type === 'call').length
    : 0;

  const isHU = n === 2;

  if (!raised) {
    // 无人加注。
    // 满桌用标准 solver 衍生 RFI 图表(GTO 基线即图表本身, 性格松紧在图表序列上伸缩);
    // 单挑按胜率排序取前段(HU 开池本质上由胜率驱动, 范围远宽于满桌)
    const isBB = pos === 'BB';
    const rfi = !isHU && !isBB ? rfiOrder(pos) : null;
    let inOpenRange: boolean;
    let openThresh: number;
    if (rfi) {
      const idx = rfi.order.indexOf(cls);
      const limit = Math.min(169 * 0.92, rfi.chartSize * loose + jitter * 169);
      inOpenRange = idx >= 0 && idx < limit;
      openThresh = limit / 169;
    } else {
      const baseOpen = isHU && pos === 'BTN' ? HU_OPEN_PCT : OPEN_PCT[pos];
      openThresh = Math.min(0.92, baseOpen * loose) + jitter;
      inOpenRange = pct <= openThresh;
    }
    if (inOpenRange) {
      // 被动型玩家一部分范围平跟
      if (rng() < prof.limp && toCall > 0 && pct > openThresh * 0.35) {
        return { type: 'call' };
      }
      if (la.canRaise) {
        // 单挑标准开池更小 (2-2.5BB)
        const mult = isHU ? 2 + rng() * 0.5 : 2.3 + rng() * 0.8 + limpers;
        return { type: 'raise', to: Math.round(h.bb * mult * prof.sizing) };
      }
      return toCall > 0 ? { type: 'call' } : { type: 'check' };
    }
    // 范围外: 大盲免费看牌; 松型玩家补点小注也看
    if (la.canCheck) return { type: 'check' };
    if (isBB || pos === 'SB') {
      const defendThresh = Math.min(0.95, 0.45 * loose * prof.callDown);
      if (toCall <= h.bb && pct <= defendThresh) return { type: 'call' };
    }
    if (prof.limp > 0.5 && toCall <= h.bb && pct <= Math.min(0.9, 0.6 * loose)) {
      return { type: 'call' };
    }
    return la.canFold ? { type: 'fold' } : { type: 'check' };
  }

  // 面对加注
  const facing3betPlus = h.raisesThisStreet >= 2;
  // 加注尺寸越大要求越紧
  const sizeFactor = Math.sqrt(Math.min(1.6, (3 * h.bb) / Math.max(h.currentBet, h.bb)));
  // 已冷跟注的人数: 多人入池时跟注与挤压都要收紧
  const coldCallers = Math.max(
    0,
    h.players.filter((q) => !q.folded && q.id !== p.id && q.streetBet >= h.currentBet).length - 1
  );

  let rrThresh: number;
  let callThresh: number;
  if (facing3betPlus) {
    const fourBetBase = isHU ? HU_VS_3BET_4BET_PCT : VS_3BET_4BET_PCT;
    const callBase = isHU ? HU_VS_3BET_CALL_PCT : VS_3BET_CALL_PCT;
    rrThresh = fourBetBase * prof.aggression * Math.sqrt(loose);
    callThresh = callBase * loose * prof.callDown;
  } else if (isHU) {
    // 单挑大盲防守: 对小尺寸加注有折扣, 防守范围极宽
    rrThresh = HU_BB_3BET_PCT * prof.aggression * Math.sqrt(loose) * sizeFactor;
    callThresh = HU_BB_CALL_PCT * loose * prof.callDown * sizeFactor;
  } else {
    rrThresh = VS_OPEN_3BET_PCT[pos] * prof.aggression * Math.sqrt(loose) * sizeFactor;
    callThresh = VS_OPEN_CALL_PCT[pos] * loose * prof.callDown * sizeFactor;
  }
  rrThresh *= Math.pow(0.92, coldCallers);
  callThresh *= Math.pow(0.85, coldCallers);
  rrThresh += jitter * 0.3;

  // 价值再加注
  if (pct <= rrThresh && la.canRaise) {
    return { type: 'raise', to: reraiseTo(h, prof, rng) };
  }
  // 诈唬再加注: 取跟注范围边缘之外一小段
  if (
    la.canRaise &&
    !facing3betPlus &&
    pct > callThresh &&
    pct < callThresh + 0.08 &&
    rng() < 0.12 * prof.bluff
  ) {
    return { type: 'raise', to: reraiseTo(h, prof, rng) };
  }
  if (pct <= rrThresh + callThresh) {
    // 跟注前检查赔率: 太贵且边缘则弃牌
    const potOdds = toCall / (pot + toCall);
    if (potOdds > 0.45 && pct > rrThresh + callThresh * 0.5 && rng() < 0.7) {
      return la.canFold ? { type: 'fold' } : { type: 'check' };
    }
    return toCall > 0 ? { type: 'call' } : { type: 'check' };
  }
  if (la.canCheck) return { type: 'check' };
  return { type: 'fold' };
}

// 翻后下注尺寸(返回 raise-to 总额)
function betSize(h: HandState, myStreetBet: number, prof: Personality, rng: Rng, eq: number): number {
  const pot = potTotal(h);
  let frac: number;
  if (h.street === 'flop') frac = 0.4 + rng() * 0.3;
  else if (h.street === 'turn') frac = 0.55 + rng() * 0.25;
  else frac = 0.6 + rng() * 0.3;
  // 超强牌偶尔大注, 疯型玩家偶尔超池
  if (eq > 0.85 && rng() < 0.35) frac += 0.3;
  if (prof.sizing > 1.2 && rng() < 0.25) frac = 1.1 + rng() * 0.4;
  frac *= prof.sizing;
  const to = myStreetBet + Math.max(h.bb, Math.round(pot * frac));
  return to;
}

function raiseSize(h: HandState, prof: Personality, rng: Rng): number {
  const base = h.currentBet * (2.2 + rng() * 0.8) * prof.sizing;
  return Math.round(Math.max(base, h.currentBet + h.lastFullRaiseSize));
}

function reraiseTo(h: HandState, prof: Personality, rng: Rng): number {
  const mult = 2.8 + rng() * 1.0;
  return Math.round(h.currentBet * mult * prof.sizing);
}

// 思考时间(毫秒): 决策越重越久, 加随机
export function thinkTime(h: HandState, rng: Rng): number {
  const base = 500 + rng() * 700;
  const facing = h.toAct !== null && h.currentBet > 0 ? 350 : 0;
  const lateStreet = h.street === 'river' || h.street === 'turn' ? 250 : 0;
  return Math.round(base + facing + lateStreet);
}
