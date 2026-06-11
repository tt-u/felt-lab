// 戏剧系统: 兔子洞(反事实揭秘) + 高光时刻横幅 + 英雄实时牌力。
// 全部从引擎数据精确推断, 即时反馈, 不依赖 API。

import type { Card } from './poker/cards';
import { cardsText } from './poker/cards';
import { evaluate7, categoryOf, handNameDetailZh } from './poker/evaluator';
import type { HandState } from './poker/engine';
import type { HandHistory } from './poker/history';
import { parseGlyphCards } from './poker/history';

// ---- 兔子洞: 英雄弃牌后, "如果跟到底会怎样" ----

export interface RabbitData {
  // 完整五张公共牌(含尚未发出的)
  fullBoard: string;
  heroHole: string;
  heroHandName: string;
  // 实际赢家
  winnerName: string;
  winnerHole: string;
  winnerHandName: string;
  heroWouldBeat: boolean;
}

// 在手牌刚结束、引擎状态仍在时计算(需要 deck 与各家底牌)
export function computeRabbit(h: HandState): RabbitData | null {
  if (!h.result) return null;
  const hero = h.players.find((p) => p.isHero);
  if (!hero?.hole || !hero.folded) return null; // 只有英雄弃牌时才有"如果"

  // 剩余公共牌按实际会发出的顺序补全(发牌从 deck 末尾 pop)
  const need = 5 - h.board.length;
  if (h.deck.length < need) return null;
  const fullBoard: Card[] = [...h.board];
  for (let i = 0; i < need; i++) fullBoard.push(h.deck[h.deck.length - 1 - i]);

  const winnerId = h.result.awards[0]?.winnerIds[0];
  const winner = h.players.find((p) => p.id === winnerId);
  if (!winner?.hole) return null;

  const heroScore = evaluate7([...hero.hole, ...fullBoard]);
  const winnerScore = evaluate7([...winner.hole, ...fullBoard]);

  return {
    fullBoard: cardsText(fullBoard),
    heroHole: cardsText(hero.hole),
    heroHandName: handNameDetailZh(heroScore),
    winnerName: winner.name,
    winnerHole: cardsText(winner.hole),
    winnerHandName: handNameDetailZh(winnerScore),
    heroWouldBeat: heroScore > winnerScore,
  };
}

// ---- 高光时刻横幅 ----

export interface Banner {
  kind: 'badbeat' | 'herocall' | 'bluffwin' | 'monster' | 'cooler';
  title: string;
  sub: string;
}

export function detectBanner(hh: HandHistory): Banner | null {
  const raw = hh.rawActions ?? [];
  const heroId = hh.players.find((p) => p.isHero)?.id ?? 'hero';
  const won = hh.heroNet > 0;
  const wonBB = hh.heroNet / hh.bb;
  const lostBB = -wonBB;

  const hole = parseGlyphCards(hh.heroHole);
  const board = parseGlyphCards(hh.board);
  const heroCat =
    hole && board && board.length === 5 ? categoryOf(evaluate7([...hole, ...board])) : -1;

  // BAD BEAT: 摊牌输掉, 但英雄成牌是顺子以上
  if (!won && hh.wentToShowdown && heroCat >= 4 && lostBB >= 10) {
    return {
      kind: 'badbeat',
      title: 'BAD BEAT',
      sub: `${handNameDetailZh(evaluate7([...hole!, ...board!]))} 也会输, 这就是扑克`,
    };
  }

  // 抓诈唬: 河牌跟注获胜, 对手亮出高牌
  const riverActs = raw.filter((a) => a.street === 'river');
  const heroRiverCall = riverActs.some((a) => a.playerId === heroId && a.type === 'call');
  const villainBluffShown = hh.results.some(
    (r) => !r.isHero && r.shown && (r.handName?.startsWith('高牌') ?? false)
  );
  if (won && hh.wentToShowdown && heroRiverCall && villainBluffShown) {
    return { kind: 'herocall', title: 'HERO CALL', sub: '你抓住了他的诈唬' };
  }

  // 诈唬得手: 河牌开火无人跟, 自己牌力不超过一对
  const heroRiverAggro = riverActs.some(
    (a) => a.playerId === heroId && (a.type === 'bet' || a.type === 'raise')
  );
  if (won && !hh.wentToShowdown && heroRiverAggro && heroCat >= 0 && heroCat <= 1) {
    return { kind: 'bluffwin', title: '诈唬得手', sub: '故事讲圆了, 底池归你' };
  }

  // 巨锅
  if (won && wonBB >= 40) {
    return { kind: 'monster', title: '巨锅入袋', sub: `+${wonBB.toFixed(1)}BB 一手收下` };
  }

  return null;
}

// ---- 英雄实时牌力(显示在行动条) ----

export interface HeroRead {
  madeName: string; // 当前成牌
  equity: number; // 对范围胜率 0..1
}

// ---- 决策点复盘: 兔子洞式逐决策拆解 ----
// 在英雄每次行动前由 store 抓拍: 局面 / 对手可能范围 / 胜率 / 教练建议,
// 行动后补上"你的实际选择", 全部本地实时计算。

export interface DecisionPoint {
  street: string; // 翻前/翻牌/转牌/河牌
  boardText: string;
  potBB: number;
  facingText: string; // "阿Ken 下注 4.5BB (约2/3池)" 或 "无人下注, 轮到你"
  toCallBB: number;
  neededPct: number | null; // 所需胜率
  villainName: string | null;
  villainClasses: string[]; // 对手可能的牌(类别清单)
  villainSharePct: number; // 该范围占全部起手牌的比例
  heroEquityPct: number;
  adviceAction: string; // 教练建议的动作(展示文本)
  adviceType: string; // 建议动作类型(fold/check/call/raise, 用于一致性比对)
  adviceReason: string;
  actualAction: string; // 你的实际动作(行动后补全)
  agree: boolean;
}

export function formatActionZh(a: { type: string; to?: number }, bb: number): string {
  switch (a.type) {
    case 'fold':
      return '弃牌';
    case 'check':
      return '过牌';
    case 'call':
      return '跟注';
    case 'raise':
      return a.to !== undefined ? `加注到 ${(a.to / bb).toFixed(1)}BB` : '加注';
    default:
      return a.type;
  }
}

// ---- 确定性教练建议 ----
// 不用带混合策略随机性的机器人决策做建议(会与展示的数字矛盾),
// 而是用透明的规则: 翻前查标准范围表, 翻后按胜率/赔率阈值, 理由直接由数字生成。

import { holeClass } from './poker/cards';
import type { LegalActions } from './poker/engine';
import { potTotal } from './poker/engine';
import {
  handPercentile,
  positionLabel,
  rfiOrder,
  OPEN_PCT,
  VS_OPEN_3BET_PCT,
  VS_OPEN_CALL_PCT,
  VS_3BET_4BET_PCT,
  VS_3BET_CALL_PCT,
  HU_OPEN_PCT,
  HU_BB_3BET_PCT,
  HU_BB_CALL_PCT,
} from './poker/ranges';

export interface CoachAdvice {
  type: 'fold' | 'check' | 'call' | 'raise';
  to?: number;
  reason: string;
}

export function coachAdvice(
  h: HandState,
  heroIdx: number,
  equity: number,
  la: LegalActions
): CoachAdvice {
  const hero = h.players[heroIdx];
  const bb = h.bb;
  const pot = potTotal(h);
  const toCall = la.callAmount;
  const eqPct = equity * 100;

  if (h.street === 'preflop') {
    const n = h.players.length;
    const pos = positionLabel(hero.seatsFromButton, n);
    const cls = holeClass(hero.hole![0], hero.hole![1]);
    const pct = handPercentile(cls);
    const isHU = n === 2;

    if (h.raisesThisStreet === 0) {
      // 无人加注: 查标准开池范围
      let inRange: boolean;
      let rangeDesc: string;
      const rfi = !isHU && pos !== 'BB' ? rfiOrder(pos) : null;
      if (rfi) {
        inRange = rfi.order.slice(0, rfi.chartSize).includes(cls);
        rangeDesc = `${pos} 标准开池表`;
      } else {
        const open = isHU && pos === 'BTN' ? HU_OPEN_PCT : OPEN_PCT[pos];
        inRange = pct <= open;
        rangeDesc = `${pos} 开池范围(前${Math.round(open * 100)}%)`;
      }
      if (inRange && la.canRaise) {
        return {
          type: 'raise',
          to: Math.round(bb * 2.3),
          reason: `${cls} 在${rangeDesc}内, 加注进场`,
        };
      }
      if (la.canCheck) return { type: 'check', reason: `${cls} 不在开池范围, 免费看翻牌` };
      return { type: 'fold', reason: `${cls} 不在${rangeDesc}内` };
    }

    // 面对加注: 3bet / 防守 / 弃牌
    const facing3bet = h.raisesThisStreet >= 2;
    const rr = facing3bet ? VS_3BET_4BET_PCT : isHU ? HU_BB_3BET_PCT : VS_OPEN_3BET_PCT[pos];
    const call = facing3bet ? VS_3BET_CALL_PCT : isHU ? HU_BB_CALL_PCT : VS_OPEN_CALL_PCT[pos];
    if (pct <= rr && la.canRaise) {
      return {
        type: 'raise',
        to: Math.round(h.currentBet * 3),
        reason: `${cls} 在再加注价值范围(前${(rr * 100).toFixed(1)}%)`,
      };
    }
    if (pct <= rr + call) {
      return { type: 'call', reason: `${cls} 在标准防守范围内(前${Math.round((rr + call) * 100)}%)` };
    }
    if (la.canCheck) return { type: 'check', reason: `${cls} 超出防守范围, 免费看牌` };
    return { type: 'fold', reason: `${cls} 超出${pos}防守范围(前${Math.round((rr + call) * 100)}%)` };
  }

  // 翻后: 纯数字规则, 理由与展示数据必然一致
  if (toCall > 0) {
    const neededPct = (toCall / (pot + toCall)) * 100;
    if (equity >= 0.7 && la.canRaise) {
      return {
        type: 'raise',
        to: Math.min(la.maxRaiseTo, Math.max(la.minRaiseTo, Math.round(h.currentBet * 2.6))),
        reason: `胜率约 ${eqPct.toFixed(0)}%, 强牌加注取价值`,
      };
    }
    if (eqPct >= neededPct) {
      return {
        type: 'call',
        reason: `胜率约 ${eqPct.toFixed(0)}% ≥ 所需 ${neededPct.toFixed(0)}%, 赔率够本`,
      };
    }
    if (eqPct >= neededPct - 5) {
      return {
        type: 'fold',
        reason: `胜率约 ${eqPct.toFixed(0)}% 略低于所需 ${neededPct.toFixed(0)}%, 临界局面偏弃(对高频诈唬对手可防守)`,
      };
    }
    return {
      type: 'fold',
      reason: `胜率约 ${eqPct.toFixed(0)}% < 所需 ${neededPct.toFixed(0)}%, 弃牌止损`,
    };
  }
  if (equity >= 0.6 && la.canRaise) {
    const myBet = hero.streetBet;
    return {
      type: 'raise',
      to: Math.min(la.maxRaiseTo, Math.max(la.minRaiseTo, myBet + Math.round(pot * 0.66))),
      reason: `胜率约 ${eqPct.toFixed(0)}%, 价值下注约 2/3 池`,
    };
  }
  return {
    type: 'check',
    reason:
      equity >= 0.4
        ? `胜率约 ${eqPct.toFixed(0)}%, 过牌控池`
        : `胜率约 ${eqPct.toFixed(0)}%, 无下注价值, 过牌观望`,
  };
}
