import type { Card, Rng } from './cards';
import { evaluate7 } from './evaluator';

// 蒙特卡洛胜率: 英雄底牌 + 已知公共牌, 对 nOpp 个随机范围对手模拟到河牌。
// 返回 0..1 的赢率(平分按比例计)。
export function monteCarloEquity(
  hole: readonly Card[],
  board: readonly Card[],
  nOpp: number,
  iters: number,
  rng: Rng
): number {
  const used = new Set<Card>([...hole, ...board]);
  const pool: Card[] = [];
  for (let c = 0; c < 52; c++) if (!used.has(c)) pool.push(c);

  const need = nOpp * 2 + (5 - board.length);
  let total = 0;

  for (let it = 0; it < iters; it++) {
    // 部分 Fisher-Yates 抽样
    for (let i = 0; i < need; i++) {
      const j = i + Math.floor(rng() * (pool.length - i));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    let p = 0;
    const fullBoard: Card[] = [...board];
    const oppStart = 5 - board.length;
    for (let i = 0; i < oppStart; i++) fullBoard.push(pool[p++]);

    const heroScore = evaluate7([...hole, ...fullBoard]);
    let winners = 1;
    let heroBest = true;
    for (let o = 0; o < nOpp; o++) {
      const oppScore = evaluate7([pool[p], pool[p + 1], ...fullBoard]);
      p += 2;
      if (oppScore > heroScore) {
        heroBest = false;
        break;
      }
      if (oppScore === heroScore) winners++;
    }
    if (heroBest) total += 1 / winners;
  }
  return total / iters;
}

// 已知所有底牌时的精确胜率(全下摊牌的电视式胜率条)。
// 枚举剩余公共牌的所有组合, 返回每个玩家的赢率(平分按比例)。
export function exactKnownEquity(holes: readonly Card[][], board: readonly Card[]): number[] {
  const used = new Set<Card>(board);
  for (const h of holes) for (const c of h) used.add(c);
  const pool: Card[] = [];
  for (let c = 0; c < 52; c++) if (!used.has(c)) pool.push(c);

  const need = 5 - board.length;
  const wins = new Array(holes.length).fill(0);
  let total = 0;

  const finish = (extra: Card[]) => {
    const full = [...board, ...extra];
    let best = -1;
    let winners: number[] = [];
    for (let i = 0; i < holes.length; i++) {
      const s = evaluate7([...holes[i], ...full]);
      if (s > best) {
        best = s;
        winners = [i];
      } else if (s === best) {
        winners.push(i);
      }
    }
    for (const w of winners) wins[w] += 1 / winners.length;
    total++;
  };

  if (need === 0) {
    finish([]);
  } else if (need === 1) {
    for (const c of pool) finish([c]);
  } else if (need === 2) {
    for (let i = 0; i < pool.length; i++) {
      for (let j = i + 1; j < pool.length; j++) finish([pool[i], pool[j]]);
    }
  } else {
    // 翻前全下: 抽样近似(精确枚举 C(48,5) 过大)
    let seed = 12345;
    const rng = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let it = 0; it < 3000; it++) {
      const idx = new Set<number>();
      while (idx.size < need) idx.add(Math.floor(rng() * pool.length));
      finish([...idx].map((k) => pool[k]));
    }
  }
  return wins.map((w) => (total > 0 ? w / total : 0));
}
