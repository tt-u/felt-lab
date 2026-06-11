import type { Card, Rng } from './cards';
import { freshDeck, shuffle } from './cards';
import { evaluate7, handNameDetailZh } from './evaluator';
import type { PersonalityId } from './personality';

export type Street = 'preflop' | 'flop' | 'turn' | 'river';
export const STREET_ZH: Record<Street, string> = {
  preflop: '翻前',
  flop: '翻牌',
  turn: '转牌',
  river: '河牌',
};

export type ActionType = 'sb' | 'bb' | 'fold' | 'check' | 'call' | 'bet' | 'raise';

export interface ActionRecord {
  street: Street;
  playerId: string;
  playerName: string;
  type: ActionType;
  // bet/raise: 该街总下注额(raise to); call: 跟到的额度; 盲注: 盲注额
  amount: number;
  allIn: boolean;
}

export interface HandPlayer {
  id: string;
  name: string;
  isHero: boolean;
  personality: PersonalityId | null; // null = 人类
  startStack: number;
  stack: number;
  hole: [Card, Card] | null;
  folded: boolean;
  allIn: boolean;
  streetBet: number; // 本街已投入
  committed: number; // 本手牌总投入
  actedThisStreet: boolean;
  actedSinceFullRaise: boolean;
  seatsFromButton: number;
}

export interface PotAward {
  amount: number;
  winnerIds: string[];
  handName: string | null; // null = 无人跟注直接获池
}

export interface HandResult {
  awards: PotAward[];
  // 摊牌时亮牌的玩家
  revealed: Record<string, [Card, Card]>;
  handNames: Record<string, string>;
  netById: Record<string, number>;
  uncalledReturn: { playerId: string; amount: number } | null;
}

export interface HandState {
  handNo: number;
  sb: number;
  bb: number;
  players: HandPlayer[]; // 本手参与者, 顺序即座位顺序
  button: number; // players 索引
  deck: Card[];
  board: Card[];
  street: Street;
  toAct: number | null; // players 索引; null = 本手结束或等待发牌
  currentBet: number;
  lastFullRaiseSize: number;
  raisesThisStreet: number;
  log: ActionRecord[];
  result: HandResult | null;
  // 所有还能行动的人 <=1 且无注可跟时为 true, UI 逐街发完剩余公共牌
  runout: boolean;
}

export interface LegalActions {
  canFold: boolean;
  canCheck: boolean;
  callAmount: number; // 还需投入的筹码(已按筹码量封顶)
  canRaise: boolean;
  isBet: boolean; // true = 本街首注(bet), false = raise
  minRaiseTo: number;
  maxRaiseTo: number; // 全下时的总额
}

export function potTotal(h: HandState): number {
  return h.players.reduce((s, p) => s + p.committed, 0);
}

export function activePlayers(h: HandState): HandPlayer[] {
  return h.players.filter((p) => !p.folded);
}

function canStillAct(p: HandPlayer): boolean {
  return !p.folded && !p.allIn;
}

function nextIndexFrom(h: HandState, from: number, pred: (p: HandPlayer) => boolean): number | null {
  const n = h.players.length;
  for (let step = 1; step <= n; step++) {
    const i = (from + step) % n;
    if (pred(h.players[i])) return i;
  }
  return null;
}

export interface NewHandInput {
  handNo: number;
  sb: number;
  bb: number;
  button: number;
  players: {
    id: string;
    name: string;
    isHero: boolean;
    personality: PersonalityId | null;
    stack: number;
  }[];
  rng: Rng;
}

export function createHand(input: NewHandInput): HandState {
  const n = input.players.length;
  if (n < 2) throw new Error('至少需要两名玩家');
  const deck = shuffle(freshDeck(), input.rng);

  const players: HandPlayer[] = input.players.map((p, i) => ({
    id: p.id,
    name: p.name,
    isHero: p.isHero,
    personality: p.personality,
    startStack: p.stack,
    stack: p.stack,
    hole: null,
    folded: false,
    allIn: false,
    streetBet: 0,
    committed: 0,
    actedThisStreet: false,
    actedSinceFullRaise: false,
    seatsFromButton: (i - input.button + n) % n,
  }));

  const h: HandState = {
    handNo: input.handNo,
    sb: input.sb,
    bb: input.bb,
    players,
    button: input.button,
    deck,
    board: [],
    street: 'preflop',
    toAct: null,
    currentBet: 0,
    lastFullRaiseSize: input.bb,
    raisesThisStreet: 0,
    log: [],
    result: null,
    runout: false,
  };

  // 盲注: 单挑时按钮位是小盲
  const sbIdx = n === 2 ? input.button : (input.button + 1) % n;
  const bbIdx = n === 2 ? (input.button + 1) % n : (input.button + 2) % n;
  postBlind(h, sbIdx, h.sb, 'sb');
  postBlind(h, bbIdx, h.bb, 'bb');
  h.currentBet = h.bb;

  // 发底牌
  for (const p of h.players) {
    p.hole = [h.deck.pop()!, h.deck.pop()!];
  }

  // 翻前首个行动者: 大盲后一位 (单挑即按钮/小盲)
  h.toAct = nextIndexFrom(h, bbIdx, canStillAct);
  if (h.toAct === null) {
    // 所有人盲注即全下
    h.runout = true;
  }
  return h;
}

function postBlind(h: HandState, idx: number, amount: number, type: 'sb' | 'bb') {
  const p = h.players[idx];
  const pay = Math.min(amount, p.stack);
  p.stack -= pay;
  p.streetBet = pay;
  p.committed = pay;
  if (p.stack === 0) p.allIn = true;
  h.log.push({
    street: 'preflop',
    playerId: p.id,
    playerName: p.name,
    type,
    amount: pay,
    allIn: p.allIn,
  });
}

export function legalActions(h: HandState): LegalActions | null {
  if (h.toAct === null || h.result) return null;
  const p = h.players[h.toAct];
  const toCall = Math.min(h.currentBet - p.streetBet, p.stack);
  const canCheck = toCall === 0;
  const maxTo = p.streetBet + p.stack;
  // 已在最近一次完整加注后行动过的玩家, 面对短全下不能再加注
  const reopenOk = !p.actedSinceFullRaise;
  const hasExtra = p.stack > toCall;
  const isBet = h.currentBet === 0;
  let minRaiseTo = isBet ? h.bb : h.currentBet + h.lastFullRaiseSize;
  minRaiseTo = Math.min(minRaiseTo, maxTo);
  const canRaise = hasExtra && reopenOk && maxTo > h.currentBet;
  return {
    canFold: !canCheck,
    canCheck,
    callAmount: canCheck ? 0 : toCall,
    canRaise,
    isBet,
    minRaiseTo,
    maxRaiseTo: maxTo,
  };
}

export type PlayerAction =
  | { type: 'fold' }
  | { type: 'check' }
  | { type: 'call' }
  | { type: 'raise'; to: number }; // bet 与 raise 统一为 raise-to 语义

export function applyAction(h: HandState, action: PlayerAction): void {
  if (h.toAct === null || h.result) throw new Error('当前无人行动');
  const idx = h.toAct;
  const p = h.players[idx];
  const la = legalActions(h)!;

  switch (action.type) {
    case 'fold': {
      if (!la.canFold) throw new Error('无注可弃, 不能弃牌');
      p.folded = true;
      p.actedThisStreet = true;
      h.log.push(rec(h, p, 'fold', 0, false));
      break;
    }
    case 'check': {
      if (!la.canCheck) throw new Error('面对下注不能过牌');
      p.actedThisStreet = true;
      p.actedSinceFullRaise = true;
      h.log.push(rec(h, p, 'check', 0, false));
      break;
    }
    case 'call': {
      const pay = la.callAmount;
      if (pay <= 0) throw new Error('无注可跟');
      p.stack -= pay;
      p.streetBet += pay;
      p.committed += pay;
      if (p.stack === 0) p.allIn = true;
      p.actedThisStreet = true;
      p.actedSinceFullRaise = true;
      h.log.push(rec(h, p, 'call', p.streetBet, p.allIn));
      break;
    }
    case 'raise': {
      if (!la.canRaise) throw new Error('不能加注');
      let to = Math.floor(action.to);
      to = Math.max(to, la.minRaiseTo);
      to = Math.min(to, la.maxRaiseTo);
      if (to <= h.currentBet) throw new Error('加注额必须大于当前注');
      const pay = to - p.streetBet;
      const raiseSize = to - h.currentBet;
      p.stack -= pay;
      p.streetBet = to;
      p.committed += pay;
      if (p.stack === 0) p.allIn = true;
      p.actedThisStreet = true;
      p.actedSinceFullRaise = true;

      const isFullRaise = h.currentBet === 0 || raiseSize >= h.lastFullRaiseSize;
      if (isFullRaise) {
        h.lastFullRaiseSize = raiseSize;
        for (const q of h.players) {
          if (q !== p) q.actedSinceFullRaise = false;
        }
      }
      const type: ActionType = h.currentBet === 0 ? 'bet' : 'raise';
      h.currentBet = to;
      h.raisesThisStreet++;
      h.log.push(rec(h, p, type, to, p.allIn));
      break;
    }
  }

  advance(h, idx);
}

function rec(h: HandState, p: HandPlayer, type: ActionType, amount: number, allIn: boolean): ActionRecord {
  return { street: h.street, playerId: p.id, playerName: p.name, type, amount, allIn };
}

function advance(h: HandState, lastActor: number): void {
  const alive = activePlayers(h);
  if (alive.length === 1) {
    finishByFold(h, alive[0]);
    return;
  }

  // 找下一个需要行动的玩家
  const next = nextIndexFrom(h, lastActor, (p) => {
    if (!canStillAct(p)) return false;
    return p.streetBet < h.currentBet || !p.actedThisStreet;
  });

  if (next !== null) {
    h.toAct = next;
    return;
  }

  // 本街下注轮结束
  closeStreet(h);
}

function closeStreet(h: HandState): void {
  for (const p of h.players) {
    p.streetBet = 0;
    p.actedThisStreet = false;
    p.actedSinceFullRaise = false;
  }
  h.currentBet = 0;
  h.lastFullRaiseSize = h.bb;
  h.raisesThisStreet = 0;
  h.toAct = null;

  const actors = h.players.filter(canStillAct);
  if (h.street === 'river') {
    showdown(h);
    return;
  }
  if (actors.length <= 1) {
    // 全下摊牌: 由 UI 调 dealNextStreet 逐街发完
    h.runout = true;
    return;
  }
  dealNextStreet(h);
  // 翻后首个行动者: 按钮后第一个可行动玩家
  h.toAct = nextIndexFrom(h, h.button, canStillAct);
}

// 发下一条街。runout 模式下由外部循环调用直至河牌, 然后调用 settleRunout。
export function dealNextStreet(h: HandState): void {
  if (h.street === 'preflop') {
    h.board.push(h.deck.pop()!, h.deck.pop()!, h.deck.pop()!);
    h.street = 'flop';
  } else if (h.street === 'flop') {
    h.board.push(h.deck.pop()!);
    h.street = 'turn';
  } else if (h.street === 'turn') {
    h.board.push(h.deck.pop()!);
    h.street = 'river';
  }
}

export function settleRunout(h: HandState): void {
  if (h.result) return;
  showdown(h);
}

function uncalledRefund(h: HandState): HandResult['uncalledReturn'] {
  // 把超出第二大投入的部分退还给最大投入者
  let maxC = -1;
  let maxP: HandPlayer | null = null;
  for (const p of h.players) {
    if (p.committed > maxC) {
      maxC = p.committed;
      maxP = p;
    }
  }
  if (!maxP) return null;
  let second = 0;
  for (const p of h.players) {
    if (p !== maxP && p.committed > second) second = p.committed;
  }
  const refund = maxC - second;
  if (refund > 0) {
    maxP.committed -= refund;
    maxP.stack += refund;
    if (maxP.stack > 0) maxP.allIn = false;
    return { playerId: maxP.id, amount: refund };
  }
  return null;
}

function finishByFold(h: HandState, winner: HandPlayer): void {
  const uncalled = uncalledRefund(h);
  const pot = potTotal(h);
  winner.stack += pot;
  const netById: Record<string, number> = {};
  for (const p of h.players) {
    netById[p.id] = (p.id === winner.id ? pot : 0) - p.committed;
  }
  h.result = {
    awards: [{ amount: pot, winnerIds: [winner.id], handName: null }],
    revealed: {},
    handNames: {},
    netById,
    uncalledReturn: uncalled,
  };
  h.toAct = null;
  h.runout = false;
}

function showdown(h: HandState): void {
  const uncalled = uncalledRefund(h);
  const contenders = activePlayers(h);

  // 评牌
  const scores = new Map<string, number>();
  const revealed: Record<string, [Card, Card]> = {};
  const handNames: Record<string, string> = {};
  for (const p of contenders) {
    const score = evaluate7([...p.hole!, ...h.board]);
    scores.set(p.id, score);
    revealed[p.id] = p.hole!;
    handNames[p.id] = handNameDetailZh(score);
  }

  // 边池: 按投入档位切分
  const levels = [...new Set(contenders.map((p) => p.committed))].sort((a, b) => a - b);
  const awards: PotAward[] = [];
  const won: Record<string, number> = {};
  let prev = 0;
  for (const level of levels) {
    let amount = 0;
    for (const p of h.players) {
      amount += Math.max(0, Math.min(p.committed, level) - prev);
    }
    if (amount <= 0) {
      prev = level;
      continue;
    }
    const eligible = contenders.filter((p) => p.committed >= level);
    let best = -1;
    for (const p of eligible) best = Math.max(best, scores.get(p.id)!);
    const winners = eligible.filter((p) => scores.get(p.id)! === best);
    const share = Math.floor(amount / winners.length);
    let remainder = amount - share * winners.length;
    // 余数给按钮后最先的赢家
    const ordered = [...winners].sort((a, b) => a.seatsFromButton - b.seatsFromButton);
    for (const w of ordered) {
      const extra = remainder > 0 ? 1 : 0;
      remainder -= extra;
      const got = share + extra;
      w.stack += got;
      won[w.id] = (won[w.id] ?? 0) + got;
    }
    awards.push({
      amount,
      winnerIds: winners.map((w) => w.id),
      handName: handNames[winners[0].id],
    });
    prev = level;
  }

  const netById: Record<string, number> = {};
  for (const p of h.players) {
    netById[p.id] = (won[p.id] ?? 0) - p.committed;
  }

  h.result = {
    awards,
    revealed,
    handNames,
    netById,
    uncalledReturn: uncalled,
  };
  h.street = 'river';
  h.toAct = null;
  h.runout = false;
}
