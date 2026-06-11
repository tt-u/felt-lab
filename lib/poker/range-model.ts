// 范围对范围引擎: 这是翻后决策"认真化"的核心。
// 思路: 机器人的翻前策略我们自己定义, 因此可以通过重放公开行动序列,
// 对每个未弃牌玩家维护一个 1326 组合粒度的加权范围, 翻后按
// "行动 -> 牌力区间似然" 做贝叶斯式过滤。胜率改为对范围抽样而非随机两张。
// 这是 solver 的范围思维(range vs range / MDF / 阻断牌)的实时近似,
// 不是逐节点均衡解(均衡解见 solver/ 的离线验证)。

import type { Card, Rng } from './cards';
import { holeClass } from './cards';
import { evaluate7 } from './evaluator';
import type { HandState, Street } from './engine';
import {
  HAND_RANKING,
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
} from './ranges';

// ---- 组合表 ----
export const COMBO_COUNT = 1326;
export const COMBO_CARDS: [Card, Card][] = (() => {
  const out: [Card, Card][] = [];
  for (let a = 0; a < 52; a++) for (let b = a + 1; b < 52; b++) out.push([a, b]);
  return out;
})();
const COMBO_CLASS: string[] = COMBO_CARDS.map(([a, b]) => holeClass(a, b));
const COMBO_PCT: number[] = COMBO_CLASS.map((c) => handPercentile(c));

// ---- 翻后牌力表(每街每板面一份) ----
export interface BoardStrength {
  // 每个组合在该板面的成牌强度百分位 (0=坚果端, 1=最弱); 与板面冲突的组合为 NaN
  rank: Float64Array;
  // 听牌标记: 1=强听(同花听/两头顺), 0.5=弱听, 0=无
  draw: Float64Array;
}

function straightDrawLevel(mask: number): number {
  // 已成顺直接由 rank 体现; 这里检测一张补牌即可成顺的听牌
  let outs = 0;
  for (let r = 0; r < 13; r++) {
    if (mask & (1 << r)) continue;
    const m2 = mask | (1 << r);
    for (let hi = 12; hi >= 4; hi--) {
      const need = 0b11111 << (hi - 4);
      if ((m2 & need) === need) {
        outs++;
        break;
      }
    }
    if (!(mask & (1 << r)) && outs === 0) {
      const wheel = 0b1000000001111;
      if ((m2 & wheel) === wheel) outs++;
    }
  }
  if (outs >= 2) return 1; // 两头/双卡
  if (outs === 1) return 0.5;
  return 0;
}

export function boardStrength(board: Card[]): BoardStrength {
  const rank = new Float64Array(COMBO_COUNT).fill(NaN);
  const draw = new Float64Array(COMBO_COUNT);
  const dead = new Set(board);
  const scores = new Float64Array(COMBO_COUNT).fill(NaN);
  const order: number[] = [];

  for (let k = 0; k < COMBO_COUNT; k++) {
    const [a, b] = COMBO_CARDS[k];
    if (dead.has(a) || dead.has(b)) continue;
    scores[k] = evaluate7([a, b, ...board]);
    order.push(k);

    if (board.length < 5) {
      // 同花听
      const suitCnt = [0, 0, 0, 0];
      suitCnt[a & 3]++;
      suitCnt[b & 3]++;
      for (const c of board) suitCnt[c & 3]++;
      let d = 0;
      if (suitCnt.some((n) => n === 4)) d = 1;
      // 顺子听
      let mask = (1 << (a >> 2)) | (1 << (b >> 2));
      for (const c of board) mask |= 1 << (c >> 2);
      d = Math.max(d, straightDrawLevel(mask));
      draw[k] = d;
    }
  }

  order.sort((x, y) => scores[y] - scores[x]);
  for (let i = 0; i < order.length; i++) {
    rank[order[i]] = i / (order.length - 1);
  }
  return { rank, draw };
}

// 板面强度表缓存(同一手牌内复用)
const strengthCache = new Map<string, BoardStrength>();
export function boardStrengthCached(board: Card[]): BoardStrength {
  const key = board.join(',');
  let v = strengthCache.get(key);
  if (!v) {
    v = boardStrength(board);
    if (strengthCache.size > 40) strengthCache.clear();
    strengthCache.set(key, v);
  }
  return v;
}

// ---- 范围重放 ----

// 把"类别 -> 权重"的判断应用到组合权重上
function applyClassFilter(w: Float64Array, fn: (cls: string, pct: number) => number) {
  for (let k = 0; k < COMBO_COUNT; k++) {
    if (w[k] <= 0) continue;
    w[k] *= fn(COMBO_CLASS[k], COMBO_PCT[k]);
  }
}

// 重放整手牌的公开行动, 返回每个玩家的当前范围权重。
// 对所有玩家(含英雄)都按 GTO 基线建模: 隐藏性格不泄露, 自洽且稳健。
export function computeRanges(h: HandState): Map<string, Float64Array> {
  const ranges = new Map<string, Float64Array>();
  const n = h.players.length;
  for (const p of h.players) {
    ranges.set(p.id, new Float64Array(COMBO_COUNT).fill(1));
  }

  // 翻前状态机
  let raises = 0;
  let streetBoardLen = 0;
  let currentStreet: Street = 'preflop';

  for (const a of h.log) {
    if (a.type === 'sb' || a.type === 'bb') continue;
    if (a.street !== currentStreet) {
      currentStreet = a.street;
      streetBoardLen = currentStreet === 'flop' ? 3 : currentStreet === 'turn' ? 4 : 5;
      raises = 0;
    }
    const w = ranges.get(a.playerId);
    if (!w) continue;
    const player = h.players.find((p) => p.id === a.playerId);
    if (!player) continue;

    if (currentStreet === 'preflop') {
      const pos = positionLabel(player.seatsFromButton, n);
      const isHU = n === 2;
      if (a.type === 'fold') {
        // 范围不再相关
      } else if (a.type === 'raise' || a.type === 'bet') {
        if (raises === 0) {
          // RFI: 用标准图表
          const rfi = !isHU && pos !== 'BB' ? rfiOrder(pos) : null;
          if (rfi) {
            const inSet = new Set(rfi.order.slice(0, rfi.chartSize));
            applyClassFilter(w, (cls) => (inSet.has(cls) ? 1 : 0.05));
          } else {
            const open = isHU ? HU_OPEN_PCT : OPEN_PCT[pos];
            applyClassFilter(w, (_, pct) => (pct <= open ? 1 : 0.05));
          }
        } else {
          // 3bet/4bet: 价值区间 + 少量诈唬残余
          const rr =
            raises >= 2
              ? VS_3BET_4BET_PCT
              : isHU
                ? HU_BB_3BET_PCT
                : VS_OPEN_3BET_PCT[pos];
          applyClassFilter(w, (_, pct) => (pct <= rr ? 1 : pct <= rr + 0.08 ? 0.25 : 0.02));
        }
        raises++;
      } else if (a.type === 'call') {
        if (raises === 0) {
          // 平跟(limp): 中间段
          applyClassFilter(w, (_, pct) => (pct <= 0.55 ? (pct <= 0.06 ? 0.25 : 1) : 0.1));
        } else {
          const rr = raises >= 2 ? VS_3BET_4BET_PCT : isHU ? HU_BB_3BET_PCT : VS_OPEN_3BET_PCT[pos];
          const call = raises >= 2 ? VS_3BET_CALL_PCT : isHU ? HU_BB_CALL_PCT : VS_OPEN_CALL_PCT[pos];
          // 跟注: 主要在 (3bet线, 跟注线] 区间, 顶端少量慢打
          applyClassFilter(w, (_, pct) =>
            pct <= rr ? 0.2 : pct <= rr + call ? 1 : pct <= rr + call + 0.1 ? 0.2 : 0.02
          );
        }
      } else if (a.type === 'check') {
        // BB 免费看翻: 排除会加注的顶端
        applyClassFilter(w, (_, pct) => (pct <= 0.05 ? 0.3 : 1));
      }
    } else {
      // 翻后: 行动 -> 牌力区间似然
      const bs = boardStrengthCached(h.board.slice(0, streetBoardLen));
      const isRaise = a.type === 'raise';
      for (let k = 0; k < COMBO_COUNT; k++) {
        if (w[k] <= 0) continue;
        const r = bs.rank[k];
        if (Number.isNaN(r)) {
          w[k] = 0;
          continue;
        }
        const d = bs.draw[k];
        if (a.type === 'bet' || a.type === 'raise') {
          // 下注/加注: 价值区 + 听牌半诈唬 + 少量纯诈唬
          const valueLine = isRaise ? 0.12 : 0.3;
          w[k] *= r <= valueLine ? 1 : d >= 1 ? 0.5 : d > 0 ? 0.25 : 0.1;
        } else if (a.type === 'call') {
          w[k] *= r <= 0.5 ? 1 : d >= 1 ? 0.8 : r <= 0.65 ? 0.5 : 0.12;
        } else if (a.type === 'check') {
          // 过牌: 顶端略折(会下注), 其余保留
          w[k] *= r <= 0.15 ? 0.5 : 1;
        }
      }
    }
  }
  return ranges;
}

// ---- 对范围的蒙特卡洛胜率 ----
export function equityVsRangeSample(
  hole: readonly Card[],
  board: readonly Card[],
  oppWeights: Float64Array[],
  iters: number,
  rng: Rng
): number {
  // 预构建每个对手的累积分布(排除英雄牌与公共牌)
  const dead = new Set<Card>([...hole, ...board]);
  const dists: { idx: Int32Array; cum: Float64Array; total: number }[] = [];
  for (const w of oppWeights) {
    const idx: number[] = [];
    const cum: number[] = [];
    let acc = 0;
    for (let k = 0; k < COMBO_COUNT; k++) {
      if (w[k] <= 0) continue;
      const [a, b] = COMBO_CARDS[k];
      if (dead.has(a) || dead.has(b)) continue;
      acc += w[k];
      idx.push(k);
      cum.push(acc);
    }
    if (!idx.length || acc <= 0) return 0.5; // 退化: 无信息
    dists.push({ idx: Int32Array.from(idx), cum: Float64Array.from(cum), total: acc });
  }

  const pool: Card[] = [];
  for (let c = 0; c < 52; c++) if (!dead.has(c)) pool.push(c);
  const boardNeed = 5 - board.length;

  let total = 0;
  let valid = 0;

  for (let it = 0; it < iters; it++) {
    // 按权重抽每个对手的组合, 冲突则重抽(上限后跳过本次)
    const taken: Card[] = [];
    const oppHoles: [Card, Card][] = [];
    let ok = true;
    for (const dist of dists) {
      let found = false;
      for (let t = 0; t < 12; t++) {
        const x = rng() * dist.total;
        // 二分查找
        let lo = 0;
        let hi = dist.cum.length - 1;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (dist.cum[mid] < x) lo = mid + 1;
          else hi = mid;
        }
        const k = dist.idx[lo];
        const [a, b] = COMBO_CARDS[k];
        if (!taken.includes(a) && !taken.includes(b)) {
          taken.push(a, b);
          oppHoles.push([a, b]);
          found = true;
          break;
        }
      }
      if (!found) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    valid++;

    // 补完公共牌(从池中排除已抽走的)
    const fullBoard = [...board];
    if (boardNeed > 0) {
      let added = 0;
      let guard = 0;
      while (added < boardNeed && guard++ < 200) {
        const c = pool[Math.floor(rng() * pool.length)];
        if (!taken.includes(c) && !fullBoard.includes(c)) {
          fullBoard.push(c);
          added++;
        }
      }
      if (added < boardNeed) continue;
    }

    const heroScore = evaluate7([...hole, ...fullBoard]);
    let winners = 1;
    let best = true;
    for (const [a, b] of oppHoles) {
      const s = evaluate7([a, b, ...fullBoard]);
      if (s > heroScore) {
        best = false;
        break;
      }
      if (s === heroScore) winners++;
    }
    if (best) total += 1 / winners;
  }
  return valid > 0 ? total / valid : 0.5;
}

// ---- 范围统计工具 ----

// 我的具体手牌在自己当前范围中的强度名次 (0=范围顶端) — 用于 MDF 防守
export function rankInRange(
  comboIdx: number,
  myWeights: Float64Array,
  bs: BoardStrength
): number {
  const my = bs.rank[comboIdx];
  if (Number.isNaN(my)) return 1;
  let better = 0;
  let totalW = 0;
  for (let k = 0; k < COMBO_COUNT; k++) {
    const w = myWeights[k];
    if (w <= 0 || Number.isNaN(bs.rank[k])) continue;
    totalW += w;
    if (bs.rank[k] < my) better += w;
  }
  return totalW > 0 ? better / totalW : 1;
}

// 范围均势对比: 返回 [-1,1], 正值表示我的范围整体更强(范围优势)
export function rangeAdvantage(
  myWeights: Float64Array,
  oppWeights: Float64Array[],
  bs: BoardStrength
): number {
  const avg = (w: Float64Array) => {
    let s = 0;
    let t = 0;
    for (let k = 0; k < COMBO_COUNT; k++) {
      if (w[k] <= 0 || Number.isNaN(bs.rank[k])) continue;
      s += w[k] * bs.rank[k];
      t += w[k];
    }
    return t > 0 ? s / t : 0.5;
  };
  const mine = avg(myWeights);
  let worstOpp = 1;
  for (const w of oppWeights) worstOpp = Math.min(worstOpp, avg(w));
  // rank 越小越强, 故对手均值 - 我的均值
  return Math.max(-1, Math.min(1, (worstOpp - mine) * 2));
}

// 阻断牌评分: 我的手牌移除了对手范围中多少强牌(0..1, 越高越适合诈唬)
export function blockerScore(
  hole: readonly Card[],
  oppWeights: Float64Array[],
  bs: BoardStrength
): number {
  let blocked = 0;
  let strong = 0;
  for (const w of oppWeights) {
    for (let k = 0; k < COMBO_COUNT; k++) {
      if (w[k] <= 0 || Number.isNaN(bs.rank[k]) || bs.rank[k] > 0.2) continue;
      strong += w[k];
      const [a, b] = COMBO_CARDS[k];
      if (hole.includes(a) || hole.includes(b)) blocked += w[k];
    }
  }
  return strong > 0 ? blocked / strong : 0;
}

export function comboIndexOf(a: Card, b: Card): number {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  // k = sum_{i<lo}(51-i) + (hi-lo-1)
  return (lo * (103 - lo)) / 2 + (hi - lo - 1);
}

// 把组合权重汇总成人类可读的类别清单(给决策复盘展示"他可能拿什么")
export function rangeClassSummary(
  w: Float64Array,
  topN = 9
): { classes: string[]; sharePct: number } {
  const byClass = new Map<string, { sum: number; combos: number }>();
  let totalW = 0;
  for (let k = 0; k < COMBO_COUNT; k++) {
    if (w[k] <= 0) continue;
    totalW += w[k];
    const cls = COMBO_CLASS[k];
    const e = byClass.get(cls) ?? { sum: 0, combos: 0 };
    e.sum += w[k];
    e.combos++;
    byClass.set(cls, e);
  }
  // 类别"在场强度" = 权重和 / 该类满配组合数
  const present: { cls: string; presence: number }[] = [];
  for (const [cls, e] of byClass) {
    const full = cls.length === 2 ? 6 : cls.endsWith('s') ? 4 : 12;
    const presence = e.sum / full;
    if (presence >= 0.4) present.push({ cls, presence });
  }
  const orderIdx = new Map(HAND_RANKING.map((c, i) => [c, i]));
  present.sort((a, b) => (orderIdx.get(a.cls) ?? 999) - (orderIdx.get(b.cls) ?? 999));
  return {
    classes: present.slice(0, topN).map((p) => p.cls),
    sharePct: (totalW / COMBO_COUNT) * 100,
  };
}
