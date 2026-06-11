// 引擎自检: 机器人互打大量手牌, 校验筹码守恒/边池/非法状态。
// 运行: npx tsx scripts/sim-test.ts
import { createHand, applyAction, dealNextStreet, settleRunout } from '../lib/poker/engine';
import type { HandState } from '../lib/poker/engine';
import { decideBot } from '../lib/poker/ai';
import { PERSONALITIES, PERSONALITY_IDS } from '../lib/poker/personality';
import { evaluate7 } from '../lib/poker/evaluator';
import { snapshotHand, computeHeroStats } from '../lib/poker/history';
import type { HandHistory } from '../lib/poker/history';

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

// 评牌器抽查
function assertEval() {
  const c = (txt: string): number => {
    const ranks = '23456789TJQKA';
    const suits = 'shdc';
    return ranks.indexOf(txt[0]) * 4 + suits.indexOf(txt[1]);
  };
  const royal = evaluate7([c('As'), c('Ks'), c('Qs'), c('Js'), c('Ts'), c('2h'), c('3d')]);
  const quads = evaluate7([c('Ah'), c('Ad'), c('Ac'), c('As'), c('Ks'), c('2h'), c('3d')]);
  const fh = evaluate7([c('Kh'), c('Kd'), c('Kc'), c('2s'), c('2h'), c('9h'), c('3d')]);
  const flush = evaluate7([c('Ah'), c('9h'), c('7h'), c('5h'), c('2h'), c('Ks'), c('Kd')]);
  const straight = evaluate7([c('9s'), c('8h'), c('7d'), c('6c'), c('5s'), c('Ah'), c('Kd')]);
  const wheel = evaluate7([c('As'), c('2h'), c('3d'), c('4c'), c('5s'), c('Kh'), c('Qd')]);
  const trips = evaluate7([c('Qs'), c('Qh'), c('Qd'), c('9c'), c('5s'), c('2h'), c('7d')]);
  const twoPair = evaluate7([c('Qs'), c('Qh'), c('9d'), c('9c'), c('5s'), c('2h'), c('7d')]);
  const pair = evaluate7([c('Qs'), c('Qh'), c('9d'), c('8c'), c('5s'), c('2h'), c('7d')]);
  const high = evaluate7([c('Qs'), c('Jh'), c('9d'), c('8c'), c('5s'), c('2h'), c('7d')]);
  const order = [royal, quads, fh, flush, straight, trips, twoPair, pair, high];
  for (let i = 0; i < order.length - 1; i++) {
    if (order[i] <= order[i + 1]) throw new Error(`评牌排序错误 @${i}: ${order[i]} <= ${order[i + 1]}`);
  }
  if (wheel >> 20 !== 4) throw new Error('轮子顺未识别');
  if (straight <= wheel) throw new Error('9高顺应大于轮子');
  // 平分: 公共牌成牌
  const board = [c('As'), c('Kh'), c('Qd'), c('Jc'), c('Ts')];
  const e1 = evaluate7([c('2h'), c('3d'), ...board]);
  const e2 = evaluate7([c('4h'), c('5d'), ...board]);
  if (e1 !== e2) throw new Error('公共牌成牌应平分');
  console.log('评牌器: 通过');
}

function playHand(h: HandState, rng: () => number) {
  let guard = 0;
  while (!h.result) {
    if (++guard > 500) throw new Error('手牌未在500步内结束');
    if (h.runout) {
      while (h.street !== 'river' && h.board.length < 5) dealNextStreet(h);
      settleRunout(h);
      break;
    }
    if (h.toAct === null) throw new Error('无行动者且非 runout');
    const idx = h.toAct;
    const prof = PERSONALITIES[h.players[idx].personality ?? 'gto'];
    const action = decideBot(h, idx, prof, rng);
    applyAction(h, action);
  }
}

function main() {
  assertEval();
  const rng = mulberry32(42);
  const histories: HandHistory[] = [];

  for (const tableSize of [2, 6, 9]) {
    let totalChips = 0;
    const stacks: number[] = [];
    for (let i = 0; i < tableSize; i++) {
      const s = 100 + Math.floor(rng() * 300); // 不等深度, 触发边池
      stacks.push(s);
      totalChips += s;
    }
    let button = 0;
    let handsDone = 0;
    for (let handNo = 1; handNo <= 2000; handNo++) {
      const inPlay = stacks
        .map((s, i) => ({ s, i }))
        .filter((x) => x.s > 0);
      if (inPlay.length < 2) break;
      const players = inPlay.map((x, k) => ({
        id: `p${x.i}`,
        name: `Bot${x.i}`,
        isHero: k === 0,
        personality: PERSONALITY_IDS[x.i % PERSONALITY_IDS.length],
        stack: x.s,
      }));
      const h = createHand({
        handNo,
        sb: 1,
        bb: 2,
        button: button % players.length,
        players,
        rng,
      });
      playHand(h, rng);
      handsDone++;
      // 筹码守恒
      for (const x of inPlay) {
        const hp = h.players.find((p) => p.id === `p${x.i}`)!;
        stacks[x.i] = hp.stack;
      }
      const nowTotal = stacks.reduce((a, b) => a + b, 0);
      if (nowTotal !== totalChips) {
        throw new Error(`筹码不守恒 @手${handNo}: ${nowTotal} != ${totalChips}`);
      }
      const netSum = Object.values(h.result!.netById).reduce((a, b) => a + b, 0);
      if (netSum !== 0) throw new Error(`净值之和非零 @手${handNo}: ${netSum}`);
      histories.push(snapshotHand(h));
      button++;
    }
    console.log(`桌型${tableSize}人: ${handsDone} 手通过, 筹码守恒`);
  }

  const stats = computeHeroStats(histories.slice(0, 500));
  console.log(
    `示例统计: VPIP ${stats.vpip.toFixed(1)}% PFR ${stats.pfr.toFixed(1)}% 3bet ${stats.threeBet.toFixed(1)}% AFq ${stats.afq.toFixed(1)}%`
  );
  console.log('引擎自检: 全部通过');
}

main();
