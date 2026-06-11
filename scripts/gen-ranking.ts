// 离线生成 169 个翻前手牌类别的强度排序 (vs1 与 vs3 随机对手胜率加权)。
// 运行: npx tsx scripts/gen-ranking.ts
import { monteCarloEquity } from '../lib/poker/equity';
import { RANK_CHARS } from '../lib/poker/cards';

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const results: { cls: string; strength: number }[] = [];
const rng = mulberry32(20260610);
const ITERS = 30000;

for (let r1 = 12; r1 >= 0; r1--) {
  for (let r2 = r1; r2 >= 0; r2--) {
    if (r1 === r2) {
      const hole = [r1 * 4 + 0, r1 * 4 + 1];
      const eq1 = monteCarloEquity(hole, [], 1, ITERS, rng);
      const eq3 = monteCarloEquity(hole, [], 3, ITERS, rng);
      results.push({ cls: RANK_CHARS[r1] + RANK_CHARS[r2], strength: 0.55 * eq1 + 0.45 * eq3 });
    } else {
      const holeS = [r1 * 4 + 0, r2 * 4 + 0];
      const eq1s = monteCarloEquity(holeS, [], 1, ITERS, rng);
      const eq3s = monteCarloEquity(holeS, [], 3, ITERS, rng);
      results.push({ cls: RANK_CHARS[r1] + RANK_CHARS[r2] + 's', strength: 0.55 * eq1s + 0.45 * eq3s });
      const holeO = [r1 * 4 + 0, r2 * 4 + 1];
      const eq1o = monteCarloEquity(holeO, [], 1, ITERS, rng);
      const eq3o = monteCarloEquity(holeO, [], 3, ITERS, rng);
      results.push({ cls: RANK_CHARS[r1] + RANK_CHARS[r2] + 'o', strength: 0.55 * eq1o + 0.45 * eq3o });
    }
  }
}

results.sort((a, b) => b.strength - a.strength);
const lines: string[] = [];
for (let i = 0; i < results.length; i += 13) {
  lines.push(
    '  ' +
      results
        .slice(i, i + 13)
        .map((r) => `'${r.cls}'`)
        .join(', ') +
      ','
  );
}
console.log('export const HAND_RANKING: string[] = [');
console.log(lines.join('\n'));
console.log('];');
