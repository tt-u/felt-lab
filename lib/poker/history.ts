import { cardsText, RANK_CHARS, SUIT_CHARS, type Card } from './cards';
import { evaluate7, handNameDetailZh } from './evaluator';
import type { HandState, Street } from './engine';
import { STREET_ZH, potTotal } from './engine';
import { positionLabel } from './ranges';
import { PERSONALITIES, type PersonalityId } from './personality';
// 仅类型引用, 运行时无循环依赖
import type { RabbitData, DecisionPoint } from '../drama';

// "A♠ K♦" -> [Card, Card]; 解析失败返回 null
export function parseGlyphCards(s: string): Card[] | null {
  const out: Card[] = [];
  for (const tok of s.split(' ').filter(Boolean)) {
    const r = RANK_CHARS.indexOf(tok[0] as (typeof RANK_CHARS)[number]);
    const su = SUIT_CHARS.indexOf(tok[1] as (typeof SUIT_CHARS)[number]);
    if (r < 0 || su < 0) return null;
    out.push(r * 4 + su);
  }
  return out.length ? out : null;
}

// 一张补牌即可成顺的听牌检测
function hasStraightDraw(mask: number): boolean {
  for (let r = 0; r < 13; r++) {
    if (mask & (1 << r)) continue;
    const m2 = mask | (1 << r);
    for (let hi = 12; hi >= 4; hi--) {
      const need = 0b11111 << (hi - 4);
      if ((m2 & need) === need) return true;
    }
    if ((m2 & 0b1000000001111) === 0b1000000001111) return true;
  }
  return false;
}

// 英雄在某街的真实牌力标注: 成牌 + 听牌(防止 AI 教练自行臆测牌力)
export function heroStreetFacts(hole: Card[], board: Card[]): string {
  const made = handNameDetailZh(evaluate7([...hole, ...board]));
  const parts = [`成牌 ${made}`];
  if (board.length < 5) {
    const suitCnt = [0, 0, 0, 0];
    let mask = 0;
    for (const c of [...hole, ...board]) {
      suitCnt[c & 3]++;
      mask |= 1 << (c >> 2);
    }
    const draws: string[] = [];
    if (suitCnt.some((n) => n === 4)) draws.push('同花听');
    if (hasStraightDraw(mask)) draws.push('顺子听');
    if (draws.length) parts.push(`听牌 ${draws.join('+')}`);
  }
  return parts.join(', ');
}

// 板面客观性质: 帮助 AI 教练判断坚果上限(如四条时不可能被同花/顺子反超)
export function boardTextureFacts(board: Card[]): string {
  if (board.length < 3) return '';
  const suitCnt = [0, 0, 0, 0];
  const rankCnt = new Array(13).fill(0);
  for (const c of board) {
    suitCnt[c & 3]++;
    rankCnt[c >> 2]++;
  }
  const facts: string[] = [];
  const maxSuit = Math.max(...suitCnt);
  if (maxSuit >= 3) facts.push('板面有同花可能');
  else facts.push('板面无同花可能');
  // 顺子可能: 板面任三张能与两张底牌构成顺子 <=> 存在5连区间含>=3张板面牌
  let straightPossible = false;
  const ranks = [...new Set(board.map((c) => c >> 2))];
  for (let hi = 12; hi >= 4 && !straightPossible; hi--) {
    let cnt = 0;
    for (let r = hi - 4; r <= hi; r++) if (ranks.includes(r)) cnt++;
    if (cnt >= 3) straightPossible = true;
  }
  if (!straightPossible) {
    const wheelRanks = [12, 0, 1, 2, 3];
    if (wheelRanks.filter((r) => ranks.includes(r)).length >= 3) straightPossible = true;
  }
  facts.push(straightPossible ? '板面有顺子可能' : '板面无顺子可能');
  if (Math.max(...rankCnt) >= 2) facts.push('板面成对');
  return facts.join(', ');
}

// 结构化行动(供 solver 局面重建; 含盲注)
export interface RawAction {
  street: Street;
  playerId: string;
  type: string; // sb | bb | fold | check | call | bet | raise
  amount: number; // call/bet/raise 为该街行动后的总投入(raise-to 语义)
}

// 一手牌的可序列化记录(供复盘与 sessionStorage 持久化)
export interface HandHistory {
  handNo: number;
  sb: number;
  bb: number;
  players: {
    id: string;
    name: string;
    isHero: boolean;
    personality: PersonalityId | null;
    position: string;
    startStack: number;
  }[];
  heroHole: string;
  board: string;
  actions: { street: Street; text: string }[];
  // 旧记录可能缺失, 读取时需判空
  rawActions?: RawAction[];
  // 所有玩家的底牌(训练工具特权: 复盘回放时全部可见; 旧记录可能缺失)
  holes?: Record<string, string>;
  // 兔子洞: 英雄弃牌后的反事实(由 store 在结算时填充)
  rabbit?: RabbitData;
  // 逐决策复盘快照(由 store 在英雄行动时填充)
  decisions?: DecisionPoint[];
  results: { name: string; isHero: boolean; net: number; shown: string | null; handName: string | null }[];
  potSize: number;
  heroNet: number;
  wentToShowdown: boolean;
}

export function snapshotHand(h: HandState): HandHistory {
  if (!h.result) throw new Error('手牌尚未结束');
  const hero = h.players.find((p) => p.isHero);
  const n = h.players.length;

  const actions = h.log
    .filter((a) => a.type !== 'sb' && a.type !== 'bb')
    .map((a) => {
      let text: string;
      switch (a.type) {
        case 'fold':
          text = `${a.playerName} 弃牌`;
          break;
        case 'check':
          text = `${a.playerName} 过牌`;
          break;
        case 'call':
          text = `${a.playerName} 跟注到 ${a.amount}${a.allIn ? ' (全下)' : ''}`;
          break;
        case 'bet':
          text = `${a.playerName} 下注 ${a.amount}${a.allIn ? ' (全下)' : ''}`;
          break;
        default:
          text = `${a.playerName} 加注到 ${a.amount}${a.allIn ? ' (全下)' : ''}`;
      }
      return { street: a.street, text };
    });

  const wentToShowdown = Object.keys(h.result.revealed).length > 1;

  return {
    handNo: h.handNo,
    sb: h.sb,
    bb: h.bb,
    players: h.players.map((p) => ({
      id: p.id,
      name: p.name,
      isHero: p.isHero,
      personality: p.personality,
      position: positionLabel(p.seatsFromButton, n),
      startStack: p.startStack,
    })),
    heroHole: hero?.hole ? cardsText(hero.hole) : '',
    board: cardsText(h.board),
    holes: Object.fromEntries(
      h.players.map((p) => [p.id, p.hole ? cardsText(p.hole) : ''])
    ),
    actions,
    rawActions: h.log.map((a) => ({
      street: a.street,
      playerId: a.playerId,
      type: a.type,
      amount: a.amount,
    })),
    results: h.players
      .filter((p) => h.result!.netById[p.id] !== 0 || !p.folded)
      .map((p) => ({
        name: p.name,
        isHero: p.isHero,
        net: h.result!.netById[p.id],
        shown: h.result!.revealed[p.id] ? cardsText(h.result!.revealed[p.id]) : null,
        handName: h.result!.handNames[p.id] ?? null,
      })),
    potSize: potTotal(h),
    heroNet: hero ? h.result.netById[hero.id] : 0,
    wentToShowdown,
  };
}

export interface HeroStats {
  hands: number;
  vpip: number; // %
  pfr: number;
  threeBet: number;
  wtsd: number; // 看到摊牌率(入池后)
  wsd: number; // 摊牌胜率
  afq: number; // 进攻频率 (bet+raise)/(bet+raise+call+fold 翻后)
  netBB: number;
  biggestWin: number; // BB
  biggestLoss: number;
}

export function computeHeroStats(histories: HandHistory[]): HeroStats {
  let vpip = 0;
  let pfr = 0;
  let threeBet = 0;
  let threeBetOpp = 0;
  let sawFlop = 0;
  let showdowns = 0;
  let showdownWins = 0;
  let aggActs = 0;
  let passActs = 0;
  let netBB = 0;
  let biggestWin = 0;
  let biggestLoss = 0;

  for (const hh of histories) {
    const heroName = hh.players.find((p) => p.isHero)?.name;
    if (!heroName) continue;
    const bb = hh.bb;
    netBB += hh.heroNet / bb;
    biggestWin = Math.max(biggestWin, hh.heroNet / bb);
    biggestLoss = Math.min(biggestLoss, hh.heroNet / bb);

    const pre = hh.actions.filter((a) => a.street === 'preflop');
    const heroPre = pre.filter((a) => a.text.startsWith(heroName));
    const voluntarily = heroPre.some((a) => a.text.includes('跟注') || a.text.includes('加注') || a.text.includes('下注'));
    if (voluntarily) vpip++;
    if (heroPre.some((a) => a.text.includes('加注'))) pfr++;
    // 3bet 机会: 英雄行动前已有人加注
    let raisesBefore = 0;
    for (const a of pre) {
      if (a.text.startsWith(heroName)) {
        if (raisesBefore === 1) {
          threeBetOpp++;
          if (a.text.includes('加注')) threeBet++;
        }
        break;
      }
      if (a.text.includes('加注')) raisesBefore++;
    }

    const postActs = hh.actions.filter((a) => a.street !== 'preflop' && a.text.startsWith(heroName));
    for (const a of postActs) {
      if (a.text.includes('下注') || a.text.includes('加注')) aggActs++;
      else if (a.text.includes('跟注')) passActs++;
    }

    if (voluntarily && hh.actions.some((a) => a.street !== 'preflop')) sawFlop++;
    if (hh.wentToShowdown && hh.results.some((r) => r.isHero && r.shown)) {
      showdowns++;
      if (hh.heroNet > 0) showdownWins++;
    }
  }

  const hands = histories.length;
  return {
    hands,
    vpip: hands ? (vpip / hands) * 100 : 0,
    pfr: hands ? (pfr / hands) * 100 : 0,
    threeBet: threeBetOpp ? (threeBet / threeBetOpp) * 100 : 0,
    wtsd: sawFlop ? (showdowns / sawFlop) * 100 : 0,
    wsd: showdowns ? (showdownWins / showdowns) * 100 : 0,
    afq: aggActs + passActs ? (aggActs / (aggActs + passActs)) * 100 : 0,
    netBB,
    biggestWin,
    biggestLoss,
  };
}

// 基于本局已发生的行动, 统计每个对手"打出来的形象"(不泄露隐藏性格, 只用可观察信息)
export interface OpponentImage {
  name: string;
  hands: number;
  vpip: number; // %
  pfr: number;
  afq: number; // 翻后进攻频率 %
  recentShowdowns: string[]; // 最近亮过的牌
}

export function computeOpponentImages(histories: HandHistory[]): OpponentImage[] {
  const stats = new Map<
    string,
    { hands: number; vpip: number; pfr: number; agg: number; pass: number; shows: string[] }
  >();
  for (const hh of histories) {
    for (const p of hh.players) {
      if (p.isHero) continue;
      let s = stats.get(p.name);
      if (!s) {
        s = { hands: 0, vpip: 0, pfr: 0, agg: 0, pass: 0, shows: [] };
        stats.set(p.name, s);
      }
      s.hands++;
      const raw = (hh.rawActions ?? []).filter((a) => a.playerId === p.id);
      const pre = raw.filter((a) => a.street === 'preflop');
      if (pre.some((a) => a.type === 'call' || a.type === 'raise' || a.type === 'bet')) s.vpip++;
      if (pre.some((a) => a.type === 'raise' || a.type === 'bet')) s.pfr++;
      for (const a of raw) {
        if (a.street === 'preflop') continue;
        if (a.type === 'bet' || a.type === 'raise') s.agg++;
        else if (a.type === 'call') s.pass++;
      }
      const shown = hh.results.find((r) => r.name === p.name && r.shown);
      if (shown?.shown) {
        s.shows.push(`第${hh.handNo}手亮过 ${shown.shown}${shown.handName ? `(${shown.handName})` : ''}`);
      }
    }
  }
  return [...stats.entries()].map(([name, s]) => ({
    name,
    hands: s.hands,
    vpip: s.hands ? (s.vpip / s.hands) * 100 : 0,
    pfr: s.hands ? (s.pfr / s.hands) * 100 : 0,
    afq: s.agg + s.pass ? (s.agg / (s.agg + s.pass)) * 100 : 0,
    recentShowdowns: s.shows.slice(-2),
  }));
}

// 将一手牌渲染为给 AI 教练的紧凑文本
export function handToText(hh: HandHistory, revealPersonalities: boolean): string {
  const hero = hh.players.find((p) => p.isHero);
  const lines: string[] = [];
  const playerDesc = hh.players
    .map((p) => {
      const tag =
        revealPersonalities && p.personality ? `[${PERSONALITIES[p.personality].nameZh}]` : '';
      return `${p.name}${p.isHero ? '(学员)' : ''}${tag} ${p.position} ${Math.round(p.startStack / hh.bb)}BB`;
    })
    .join(', ');
  lines.push(`### 第${hh.handNo}手 | 盲注 ${hh.sb}/${hh.bb} | ${playerDesc}`);
  lines.push(`学员底牌: ${hh.heroHole} (${hero?.position})`);

  const streets: Street[] = ['preflop', 'flop', 'turn', 'river'];
  const boardCards = hh.board.split(' ').filter(Boolean);
  const holeCards = parseGlyphCards(hh.heroHole);
  const fullBoard = parseGlyphCards(hh.board) ?? [];
  for (const st of streets) {
    const acts = hh.actions.filter((a) => a.street === st);
    if (!acts.length) continue;
    const n = st === 'flop' ? 3 : st === 'turn' ? 4 : st === 'river' ? 5 : 0;
    let boardStr = '';
    let facts = '';
    if (n > 0) {
      boardStr = ` (${boardCards.slice(0, n).join(' ')})`;
      // 客观牌力标注: AI 教练必须以此为准, 不得自行推断
      if (holeCards && fullBoard.length >= n) {
        const streetBoard = fullBoard.slice(0, n);
        facts = ` [学员此时: ${heroStreetFacts(holeCards, streetBoard)} | ${boardTextureFacts(streetBoard)}]`;
      }
    }
    lines.push(`${STREET_ZH[st]}${boardStr}${facts}: ${acts.map((a) => a.text).join('; ')}`);
  }

  const resultStrs = hh.results
    .filter((r) => r.net !== 0 || r.shown)
    .map((r) => {
      const cards = r.shown ? ` 亮牌 ${r.shown}${r.handName ? `(${r.handName})` : ''}` : '';
      const sign = r.net > 0 ? '+' : '';
      return `${r.name}${cards} ${sign}${(r.net / hh.bb).toFixed(1)}BB`;
    });
  lines.push(`结果: 底池 ${(hh.potSize / hh.bb).toFixed(1)}BB | ${resultStrs.join(', ')}`);
  // 摊牌对比标注: 程序直接给出胜负关系, 杜绝"谁赢谁输"类臆测
  const heroR = hh.results.find((r) => r.isHero && r.shown);
  if (heroR?.handName) {
    const oppShown = hh.results.filter((r) => !r.isHero && r.shown && r.handName);
    if (oppShown.length) {
      const rel = heroR.net > 0 ? '击败' : heroR.net < 0 ? '不敌' : '平分于';
      const cmp = oppShown
        .map((o) => `你的${heroR.handName}${rel}${o.name}的${o.handName}`)
        .join('; ');
      lines.push(`[摊牌对比(程序判定): ${cmp}]`);
    }
  }
  return lines.join('\n');
}

// 选择关键手牌, 控制提示词长度
export function selectKeyHands(histories: HandHistory[], maxHands = 30): HandHistory[] {
  if (histories.length <= maxHands) return histories;
  const scored = histories.map((hh) => ({
    hh,
    score:
      Math.abs(hh.heroNet) / hh.bb +
      (hh.wentToShowdown ? 8 : 0) +
      hh.potSize / hh.bb / 2 +
      (hh.actions.some((a) => a.street === 'river') ? 4 : 0),
  }));
  scored.sort((a, b) => b.score - a.score);
  const picked = scored.slice(0, maxHands).map((s) => s.hh);
  picked.sort((a, b) => a.handNo - b.handNo);
  return picked;
}
