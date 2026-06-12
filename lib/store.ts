'use client';

import { create } from 'zustand';
import { secureRng, type Rng } from './poker/cards';
import {
  createHand,
  applyAction,
  dealNextStreet,
  settleRunout,
  type HandState,
  type PlayerAction,
} from './poker/engine';
import { decideBot, thinkTime } from './poker/ai';
import { PERSONALITIES, PERSONALITY_IDS, BOT_NAMES, type PersonalityId } from './poker/personality';
import { snapshotHand, computeOpponentImages, type HandHistory } from './poker/history';
import {
  HAND_COMMENT_SYSTEM_PROMPT,
  buildHandCommentPrompt,
  imageLine,
  parseHandComment,
  type HandCommentData,
} from './review-prompt';
import {
  computeRabbit,
  detectBanner,
  formatActionZh,
  coachAdvice,
  type Banner,
  type HeroRead,
  type DecisionPoint,
} from './drama';
import { exactKnownEquity } from './poker/equity';
import { computeRanges, equityVsRangeSample, rangeClassSummary } from './poker/range-model';
import { evaluate7, handNameDetailZh } from './poker/evaluator';
import { holeClass, cardsText } from './poker/cards';
import { legalActions, potTotal, STREET_ZH } from './poker/engine';
import { play } from './sound';
import { chatOnce } from './llm';

export interface OpponentConfig {
  name: string;
  personality: PersonalityId | 'random';
}

export interface SessionConfig {
  tableSize: number; // 2 | 6 | 7 | 8 | 9
  showPersonalities: boolean;
  // 每手结束后请求一句话 AI 即时点评
  liveCoach: boolean;
  startingBB: number;
  sb: number;
  bb: number;
  targetHands: number | null;
  opponents: OpponentConfig[];
}

export interface Seat {
  id: string;
  name: string;
  isHero: boolean;
  personality: PersonalityId | null;
  stack: number;
  rebuys: number;
  // 头像池编号(每局随机分配, 与名字不绑定); 英雄为 null
  avatarId: number | null;
}

export type Phase = 'idle' | 'playing' | 'handEnd' | 'over';

// 持久化到 sessionStorage 的复盘数据
export interface SessionRecord {
  config: SessionConfig;
  seats: {
    name: string;
    isHero: boolean;
    personality: PersonalityId | null;
    rebuys: number;
    stack?: number; // 终局后手(旧记录可能缺失)
    avatarId?: number | null;
  }[];
  histories: HandHistory[];
  // 结构化速评; 旧会话记录可能是纯文本
  handComments: Record<number, HandCommentData | string>;
  endedAt: string;
  // 进行中会话(刷新后可还原继续); 旧记录缺失视为已结束
  inProgress?: boolean;
  button?: number;
  handNo?: number;
}

const STORAGE_KEY = 'feltlab-session';

interface GameStore {
  config: SessionConfig | null;
  seats: Seat[];
  button: number;
  handNo: number;
  hand: HandState | null;
  histories: HandHistory[];
  handComments: Record<number, HandCommentData | string>;
  phase: Phase;
  version: number;
  // 暂停中: 机器人定时器全部清除, 英雄操作被拦截
  paused: boolean;
  // 全下摊牌时各玩家的实时胜率
  equities: Record<string, number> | null;
  // 英雄当前成牌与对范围胜率(行动条仪表)
  heroRead: HeroRead | null;
  // 高光时刻横幅
  banner: Banner | null;
  // 兔子洞: 英雄弃牌后的反事实数据
  rabbit: ReturnType<typeof computeRabbit>;
  startSession: (config: SessionConfig) => void;
  heroAct: (action: PlayerAction) => void;
  nextHand: () => void;
  endSession: () => void;
  reset: () => void;
  // 查看兔子洞时暂停自动开下一手
  holdAutoNext: () => void;
  // 暂停 / 继续(进度已持久化, 刷新后可还原)
  pause: () => void;
  resume: () => void;
  // 从浏览器存储还原进行中的会话(刷新恢复), 成功返回 true
  restore: () => boolean;
}

const rng: Rng = secureRng();

// 调度令牌: 状态被新手牌/新会话替换后, 旧定时器全部失效
let pumpToken = 0;
const timers: ReturnType<typeof setTimeout>[] = [];
// 会话序号: 跨会话的迟到网络响应直接丢弃
let sessionSeq = 0;
// 当前手牌的决策快照(英雄行动前抓拍, 行动后补全)
let decisionsThisHand: DecisionPoint[] = [];
let pendingDecision: DecisionPoint | null = null;
let lastCaptureKey = '';

function clearTimers() {
  pumpToken++;
  while (timers.length) clearTimeout(timers.pop()!);
}

function later(ms: number, fn: () => void) {
  const token = pumpToken;
  const t = setTimeout(() => {
    if (token === pumpToken) fn();
  }, ms);
  timers.push(t);
}

export const useGame = create<GameStore>((set, get) => {
  function bump() {
    set((s) => ({ version: s.version + 1 }));
  }

  function persist() {
    const { config, seats, histories, handComments, phase, button, handNo } = get();
    if (!config || typeof window === 'undefined') return;
    const record: SessionRecord = {
      config,
      seats: seats.map((s) => ({
        name: s.name,
        isHero: s.isHero,
        personality: s.personality,
        rebuys: s.rebuys,
        stack: s.stack,
        avatarId: s.avatarId,
      })),
      histories,
      handComments,
      endedAt: new Date().toISOString(),
      inProgress: phase !== 'over',
      button,
      handNo,
    };
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(record));
    } catch {
      // 存储满时静默忽略, 复盘页会回退到内存数据
    }
  }

  function beginHand() {
    const { config, seats, button } = get();
    if (!config) return;
    // 机器人自动补码; 英雄破产则结束
    for (const s of seats) {
      if (!s.isHero && s.stack < config.bb) {
        s.stack = config.startingBB * config.bb;
        s.rebuys++;
      }
    }
    const hero = seats.find((s) => s.isHero)!;
    if (hero.stack < config.bb) {
      get().endSession();
      return;
    }
    const handNo = get().handNo + 1;
    const hand = createHand({
      handNo,
      sb: config.sb,
      bb: config.bb,
      button,
      players: seats.map((s) => ({
        id: s.id,
        name: s.name,
        isHero: s.isHero,
        personality: s.personality,
        stack: s.stack,
      })),
      rng,
    });
    decisionsThisHand = [];
    pendingDecision = null;
    lastCaptureKey = '';
    set({
      hand,
      handNo,
      phase: 'playing',
      equities: null,
      banner: null,
      rabbit: null,
      heroRead: null,
    });
    play('deal');
    updateHeroRead(hand);
    // 每手开局即存档: 中途刷新可从本手重新开始(筹码为上手结束状态)
    persist();
    bump();
    pump();
  }

  // 英雄行动前抓拍决策点: 局面 / 对手范围 / 胜率 / 教练建议
  function captureDecision(h: HandState) {
    const key = `${h.handNo}:${h.log.length}`;
    if (lastCaptureKey === key) return;
    lastCaptureKey = key;
    const heroIdx = h.players.findIndex((p) => p.isHero);
    const hero = h.players[heroIdx];
    if (!hero?.hole) return;
    const la = legalActions(h);
    if (!la) return;
    const bb = h.bb;
    const pot = potTotal(h);
    const toCall = la.callAmount;

    // 面对什么
    let facingText = '无人下注, 轮到你说话';
    let villain = h.players.find((p) => !p.folded && !p.isHero) ?? null;
    if (toCall > 0) {
      const streetLog = h.log.filter(
        (a) => a.street === h.street && (a.type === 'bet' || a.type === 'raise')
      );
      const last = streetLog[streetLog.length - 1];
      if (last) {
        const aggressor = h.players.find((p) => p.id === last.playerId);
        if (aggressor && !aggressor.isHero) villain = aggressor;
        const potBefore = Math.max(1, pot - toCall);
        const r = toCall / potBefore;
        const sizeLabel =
          r >= 1.15 ? '超池' : r >= 0.8 ? '满池' : r >= 0.55 ? '约2/3池' : r >= 0.4 ? '约半池' : r >= 0.25 ? '约1/3池' : '小注';
        facingText = `${last.playerName} ${last.type === 'bet' ? '下注' : '加注到'} ${(last.amount / bb).toFixed(1)}BB (${sizeLabel}${last.allIn ? ', 全下' : ''})`;
      } else {
        facingText = `面对 ${(toCall / bb).toFixed(1)}BB 的注`;
      }
    }

    const ranges = computeRanges(h);
    const opps = h.players.filter((p) => !p.folded && !p.isHero);
    const equity = opps.length
      ? equityVsRangeSample(hero.hole, h.board, opps.map((p) => ranges.get(p.id)!), 220, rng)
      : 1;

    let villainClasses: string[] = [];
    let villainSharePct = 0;
    if (villain) {
      const sum = rangeClassSummary(ranges.get(villain.id)!, 9);
      villainClasses = sum.classes;
      villainSharePct = sum.sharePct;
    }

    // 教练建议: 确定性规则(翻前查范围表/翻后按数字), 理由与数据必然一致
    const advice = coachAdvice(h, heroIdx, equity, la);
    const neededPct = toCall > 0 ? (toCall / (pot + toCall)) * 100 : null;
    const eqPct = equity * 100;

    pendingDecision = {
      street: STREET_ZH[h.street],
      boardText: h.board.length ? cardsText(h.board) : '(尚未发牌)',
      potBB: pot / bb,
      facingText,
      toCallBB: toCall / bb,
      neededPct,
      villainName: villain?.name ?? null,
      villainClasses,
      villainSharePct,
      heroEquityPct: eqPct,
      adviceAction: formatActionZh(advice, bb),
      adviceType: advice.type,
      adviceReason: advice.reason,
      actualAction: '',
      agree: false,
    };
    // 顺带刷新仪表(同一份计算)
    const madeName =
      h.board.length >= 3
        ? handNameDetailZh(evaluate7([...hero.hole, ...h.board]))
        : `底牌 ${holeClass(hero.hole[0], hero.hole[1])}`;
    set({ heroRead: { madeName, equity } });
  }

  // 英雄实时牌力仪表: 当前成牌 + 对范围胜率
  function updateHeroRead(h: HandState) {
    const hero = h.players.find((p) => p.isHero);
    if (!hero?.hole || hero.folded || h.result) {
      set({ heroRead: null });
      return;
    }
    const madeName =
      h.board.length >= 3
        ? handNameDetailZh(evaluate7([...hero.hole, ...h.board]))
        : `底牌 ${holeClass(hero.hole[0], hero.hole[1])}`;
    const opps = h.players.filter((p) => !p.folded && !p.isHero);
    if (!opps.length) {
      set({ heroRead: { madeName, equity: 1 } });
      return;
    }
    const ranges = computeRanges(h);
    const equity = equityVsRangeSample(
      hero.hole,
      h.board,
      opps.map((p) => ranges.get(p.id)!),
      200,
      rng
    );
    set({ heroRead: { madeName, equity } });
  }

  // 异步请求单手即时点评, 失败静默(增益功能不阻塞牌局)
  async function requestHandComment(hh: HandHistory) {
    const cfg = get().config;
    if (!cfg?.liveCoach) return;
    const seq = sessionSeq;
    // 实时上下文: 双方后手 / 本局进度 / 观察出的对手形象
    const { seats, histories } = get();
    const stackLine = seats
      .map((s) => `${s.name}${s.isHero ? '(你)' : ''} 后手 ${(s.stack / cfg.bb).toFixed(0)}BB`)
      .join(', ');
    const netBB = histories.reduce((sum, x) => sum + x.heroNet / x.bb, 0);
    const sessionLine = `本局已打 ${histories.length} 手, 你目前 ${netBB >= 0 ? '+' : ''}${netBB.toFixed(1)}BB`;
    const imageLines = computeOpponentImages(histories).map(imageLine);
    try {
      const content = (
        await chatOnce({
          system: HAND_COMMENT_SYSTEM_PROMPT,
          // 风格隐藏模式下, 即时点评也不能剧透对手风格(形象只来自可观察行动)
          user: buildHandCommentPrompt(hh, cfg.showPersonalities, {
            stackLine,
            imageLines,
            sessionLine,
          }),
          json: true,
          maxTokens: 700,
        })
      ).trim();
      if (!content || seq !== sessionSeq) return;
      // 解析失败时退回纯文本展示
      const note = parseHandComment(content) ?? content;
      set((s) => ({
        handComments: { ...s.handComments, [hh.handNo]: note },
        version: s.version + 1,
      }));
      persist();
    } catch {
      // 网络异常忽略
    }
  }

  function finishHand() {
    const { hand, seats, config, histories } = get();
    if (!hand?.result || !config) return;
    // 回写筹码
    for (const p of hand.players) {
      const seat = seats.find((s) => s.id === p.id);
      if (seat) seat.stack = p.stack;
    }
    const hh = snapshotHand(hand);
    // 兔子洞与逐决策复盘随手牌记录存档
    const rabbit = computeRabbit(hand) ?? undefined;
    hh.rabbit = rabbit;
    hh.decisions = decisionsThisHand.length ? [...decisionsThisHand] : undefined;
    decisionsThisHand = [];
    const newHistories = [...histories, hh];
    set({ histories: newHistories, phase: 'handEnd', rabbit: rabbit ?? null, heroRead: null });

    // 高光时刻
    if (hh.heroNet > 0) play('win');
    const banner = detectBanner(hh);
    if (banner) {
      set({ banner });
      play(banner.kind === 'badbeat' ? 'allin' : 'achieve');
      later(3400, () => set({ banner: null }));
    }

    persist();
    bump();
    void requestHandComment(hh);

    const reachedTarget = config.targetHands !== null && newHistories.length >= config.targetHands;
    const heroBust = seats.find((s) => s.isHero)!.stack < config.bb;
    if (reachedTarget || heroBust) {
      later(3600, () => get().endSession());
      return;
    }
    // 自动开下一手; 有兔子洞可看时多留时间
    later(rabbit ? 6500 : 4200, () => {
      if (get().phase === 'handEnd') get().nextHand();
    });
  }

  // 全下摊牌: 电视式实时胜率
  function updateEquities(h: HandState) {
    const alive = h.players.filter((p) => !p.folded && p.hole);
    if (alive.length < 2) return;
    const eqs = exactKnownEquity(
      alive.map((p) => p.hole as [number, number]),
      h.board
    );
    const map: Record<string, number> = {};
    alive.forEach((p, i) => {
      map[p.id] = eqs[i];
    });
    if (!get().equities) play('allin');
    set({ equities: map });
  }

  // 驱动机器人行动与发牌
  function pump() {
    const { hand } = get();
    if (!hand || get().phase !== 'playing' || get().paused) return;

    if (hand.result) {
      finishHand();
      return;
    }

    if (hand.runout) {
      updateEquities(hand);
      if (hand.board.length < 5) {
        later(1400, () => {
          const h = get().hand;
          if (!h || !h.runout) return;
          dealNextStreet(h);
          play('deal');
          bump();
          pump();
        });
      } else {
        later(1400, () => {
          const h = get().hand;
          if (!h) return;
          settleRunout(h);
          bump();
          pump();
        });
      }
      return;
    }

    if (hand.toAct === null) return;
    const actor = hand.players[hand.toAct];
    if (actor.isHero) {
      // 抓拍决策点(供本手结束后的兔子洞式复盘)
      captureDecision(hand);
      bump();
      return; // 等待人类操作
    }

    const delay = thinkTime(hand, rng);
    later(delay, () => {
      const h = get().hand;
      if (!h || h.toAct === null || h.result) return;
      const idx = h.toAct;
      const p = h.players[idx];
      if (p.isHero) return;
      const prof = PERSONALITIES[p.personality ?? 'gto'];

      const boardBefore = h.board.length;
      let action: PlayerAction;
      try {
        action = decideBot(h, idx, prof, rng);
        applyAction(h, action);
      } catch {
        // 兜底: 决策异常时执行最保守合法动作
        action = { type: 'check' };
        try {
          applyAction(h, { type: 'check' });
        } catch {
          action = { type: 'fold' };
          applyAction(h, { type: 'fold' });
        }
      }
      playActionSound(action, h.board.length > boardBefore);
      updateHeroRead(h);
      bump();
      pump();
    });
  }

  function playActionSound(action: PlayerAction, streetDealt: boolean) {
    if (action.type === 'fold') play('fold');
    else if (action.type === 'check') play('click');
    else play('chip');
    if (streetDealt) play('deal');
  }

  return {
    config: null,
    seats: [],
    button: 0,
    handNo: 0,
    hand: null,
    histories: [],
    handComments: {},
    phase: 'idle',
    version: 0,
    paused: false,
    equities: null,
    heroRead: null,
    banner: null,
    rabbit: null,

    startSession(config) {
      clearTimers();
      sessionSeq++;
      const names = [...BOT_NAMES];
      // 洗名字
      for (let i = names.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [names[i], names[j]] = [names[j], names[i]];
      }
      // 头像池随机分配(不与名字绑定)
      const pool = Array.from({ length: 24 }, (_, i) => i);
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      const seats: Seat[] = [
        {
          id: 'hero',
          name: '你',
          isHero: true,
          personality: null,
          stack: config.startingBB * config.bb,
          rebuys: 0,
          avatarId: null,
        },
        ...config.opponents.map((o, i) => ({
          id: `bot-${i}`,
          name: o.name || names[i],
          isHero: false,
          personality:
            o.personality === 'random'
              ? PERSONALITY_IDS[Math.floor(rng() * PERSONALITY_IDS.length)]
              : o.personality,
          stack: config.startingBB * config.bb,
          rebuys: 0,
          avatarId: pool[i % pool.length],
        })),
      ];
      set({
        config,
        seats,
        button: Math.floor(rng() * seats.length),
        handNo: 0,
        hand: null,
        histories: [],
        handComments: {},
        phase: 'playing',
        version: 0,
        paused: false,
        equities: null,
        heroRead: null,
        banner: null,
        rabbit: null,
      });
      beginHand();
    },

    heroAct(action) {
      const { hand, phase } = get();
      if (!hand || phase !== 'playing' || get().paused || hand.toAct === null) return;
      if (!hand.players[hand.toAct].isHero) return;
      const boardBefore = hand.board.length;
      try {
        applyAction(hand, action);
      } catch {
        return; // 非法操作直接忽略(UI 已做约束, 双保险)
      }
      // 补全决策快照
      if (pendingDecision) {
        pendingDecision.actualAction = formatActionZh(action, hand.bb);
        pendingDecision.agree = action.type === pendingDecision.adviceType;
        decisionsThisHand.push(pendingDecision);
        pendingDecision = null;
      }
      playActionSound(action, hand.board.length > boardBefore);
      updateHeroRead(hand);
      bump();
      pump();
    },

    nextHand() {
      if (get().phase !== 'handEnd' || get().paused) return;
      const next = get().button + 1;
      set({ button: next % get().seats.length });
      clearTimers();
      beginHand();
    },

    endSession() {
      clearTimers();
      // 先置 over 再存档, 使 inProgress 正确落为 false
      set({ phase: 'over', hand: null, paused: false });
      persist();
    },

    reset() {
      clearTimers();
      sessionSeq++;
      // 主动放弃的会话不再提供"继续"
      try {
        const raw = sessionStorage.getItem(STORAGE_KEY);
        if (raw) {
          const j = JSON.parse(raw);
          j.inProgress = false;
          sessionStorage.setItem(STORAGE_KEY, JSON.stringify(j));
        }
      } catch {
        // 存储异常忽略
      }
      set({
        config: null,
        seats: [],
        button: 0,
        handNo: 0,
        hand: null,
        histories: [],
        handComments: {},
        phase: 'idle',
        version: 0,
        paused: false,
        equities: null,
        heroRead: null,
        banner: null,
        rabbit: null,
      });
    },

    holdAutoNext() {
      // 查看兔子洞时暂停自动开下一手, 由用户点"下一手"继续
      if (get().phase === 'handEnd') clearTimers();
    },

    pause() {
      const phase = get().phase;
      if ((phase !== 'playing' && phase !== 'handEnd') || get().paused) return;
      clearTimers();
      // 横幅的自动消失定时器已被清掉, 直接收起
      set({ paused: true, banner: null });
      persist();
    },

    resume() {
      if (!get().paused) return;
      set({ paused: false });
      if (get().phase === 'playing') {
        pump();
      } else if (get().phase === 'handEnd') {
        later(2200, () => {
          if (get().phase === 'handEnd') get().nextHand();
        });
      }
    },

    restore() {
      const rec = loadSessionRecord();
      if (!rec?.inProgress || !rec.config || !rec.seats?.length) return false;
      clearTimers();
      sessionSeq++;
      let botIdx = 0;
      const seats: Seat[] = rec.seats.map((s) => ({
        id: s.isHero ? 'hero' : `bot-${botIdx++}`,
        name: s.name,
        isHero: s.isHero,
        personality: s.personality,
        stack: s.stack ?? rec.config.startingBB * rec.config.bb,
        rebuys: s.rebuys,
        avatarId: s.avatarId ?? null,
      }));
      set({
        config: rec.config,
        seats,
        button: rec.button ?? 0,
        // 刷新时未打完的那手作废, 沿用其手号重新开始
        handNo: rec.histories[rec.histories.length - 1]?.handNo ?? 0,
        hand: null,
        histories: rec.histories,
        handComments: rec.handComments ?? {},
        phase: 'playing',
        version: 0,
        paused: false,
        equities: null,
        heroRead: null,
        banner: null,
        rabbit: null,
      });
      beginHand();
      return true;
    },
  };
});

export function loadSessionRecord(): SessionRecord | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as SessionRecord;
  } catch {
    return null;
  }
}
