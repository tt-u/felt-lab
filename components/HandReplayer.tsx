'use client';

import { useMemo, useState } from 'react';
import { CaretLeft, CaretRight } from '@phosphor-icons/react';
import type { HandHistory } from '@/lib/poker/history';
import { parseGlyphCards } from '@/lib/poker/history';
import { CardView } from './CardView';
import { Avatar } from './Avatar';

// 手牌回放器: 迷你牌桌 + 可拖动时间轴, 所有人底牌全程可见(复盘特权)

interface Step {
  desc: string;
  boardCount: number;
  pot: number; // 含当前街注
  bets: Record<string, number>;
  folded: string[];
  stacks: Record<string, number>;
  actorId: string | null;
  isResult: boolean;
  // 英雄决策帧: 对应 hh.decisions 的下标(时间轴上打标记并显示正确性)
  decisionIdx?: number;
}

const STREET_LABEL: Record<string, string> = {
  preflop: '翻前',
  flop: '翻牌',
  turn: '转牌',
  river: '河牌',
};
const BOARD_AT: Record<string, number> = { preflop: 0, flop: 3, turn: 4, river: 5 };

function buildSteps(hh: HandHistory): Step[] {
  const raw = hh.rawActions ?? [];
  const bb = hh.bb;
  const nameOf = new Map(hh.players.map((p) => [p.id, p.name]));
  const heroId = hh.players.find((p) => p.isHero)?.id;
  let heroActionCount = 0;
  const steps: Step[] = [];

  let pot = 0;
  let bets: Record<string, number> = {};
  const folded: string[] = [];
  const stacks: Record<string, number> = {};
  for (const p of hh.players) stacks[p.id] = p.startStack;
  let curStreet = 'preflop';
  let boardCount = 0;

  const snap = (desc: string, actorId: string | null, isResult = false): Step => ({
    desc,
    boardCount,
    pot,
    bets: { ...bets },
    folded: [...folded],
    stacks: { ...stacks },
    actorId,
    isResult,
  });

  // 先消费开头的盲注, 构成初始状态
  let i = 0;
  while (i < raw.length && (raw[i].type === 'sb' || raw[i].type === 'bb')) {
    const a = raw[i];
    const pay = a.amount - (bets[a.playerId] ?? 0);
    pot += pay;
    stacks[a.playerId] -= pay;
    bets[a.playerId] = a.amount;
    i++;
  }
  steps.push(snap('盲注就位, 发牌', null));

  for (; i < raw.length; i++) {
    const a = raw[i];
    if (a.street !== curStreet) {
      // 收注进池, 发新街
      bets = {};
      curStreet = a.street;
      boardCount = BOARD_AT[a.street] ?? boardCount;
      const cards = hh.board.split(' ').filter(Boolean).slice(
        a.street === 'flop' ? 0 : boardCount - 1,
        boardCount
      );
      steps.push(snap(`发${STREET_LABEL[a.street]} ${cards.join(' ')}`, null));
    }
    const name = nameOf.get(a.playerId) ?? a.playerId;
    let desc: string;
    if (a.type === 'fold') {
      folded.push(a.playerId);
      desc = `${name} 弃牌`;
    } else if (a.type === 'check') {
      desc = `${name} 过牌`;
    } else {
      const pay = a.amount - (bets[a.playerId] ?? 0);
      pot += pay;
      stacks[a.playerId] -= pay;
      bets[a.playerId] = a.amount;
      desc =
        a.type === 'call'
          ? `${name} 跟注到 ${(a.amount / bb).toFixed(1)}BB`
          : a.type === 'bet'
            ? `${name} 下注 ${(a.amount / bb).toFixed(1)}BB`
            : `${name} 加注到 ${(a.amount / bb).toFixed(1)}BB`;
    }
    const step = snap(desc, a.playerId);
    // 英雄决策帧: 与 decisions 按顺序对应
    if (a.playerId === heroId) {
      if (heroActionCount < (hh.decisions?.length ?? 0)) {
        step.decisionIdx = heroActionCount;
      }
      heroActionCount++;
    }
    steps.push(step);
  }

  // 全下 runout: 行动结束但板面没发完
  const fullBoard = hh.board.split(' ').filter(Boolean).length;
  while (boardCount < fullBoard) {
    boardCount = boardCount === 0 ? 3 : boardCount + 1;
    if (boardCount > fullBoard) break;
    bets = {};
    const label = boardCount === 3 ? '翻牌' : boardCount === 4 ? '转牌' : '河牌';
    steps.push(snap(`发${label}`, null));
  }

  // 结果步
  bets = {};
  const winners = hh.results.filter((r) => r.net > 0);
  for (const r of winners) {
    const p = hh.players.find((x) => x.name === r.name);
    if (p) stacks[p.id] = p.startStack + r.net;
  }
  for (const r of hh.results.filter((x) => x.net < 0)) {
    const p = hh.players.find((x) => x.name === r.name);
    if (p) stacks[p.id] = p.startStack + r.net;
  }
  steps.push({
    desc: `结果: ${winners.map((r) => `${r.name} +${(r.net / hh.bb).toFixed(1)}BB`).join(', ') || '本手结束'}`,
    boardCount: fullBoard,
    pot: hh.potSize,
    bets: {},
    folded,
    stacks: { ...stacks },
    actorId: null,
    isResult: true,
  });
  return steps;
}

function seatAngle(i: number, total: number): number {
  return 90 + (360 * i) / total;
}

// 决策判定三级: 绿=与教练一致, 黄=边缘局面两可, 红=明显偏差
type Verdict = 'good' | 'edge' | 'bad';
function verdictOf(d: NonNullable<HandHistory['decisions']>[number]): Verdict {
  if (d.agree) return 'good';
  // 胜率与所需差距在5个点以内, 或无注可面对的频率型选择 → 两可
  if (d.neededPct === null) return 'edge';
  if (Math.abs(d.heroEquityPct - d.neededPct) <= 5) return 'edge';
  return 'bad';
}
const VERDICT_UI: Record<Verdict, { label: string; color: string; border: string }> = {
  good: { label: '✓ 正确', color: 'var(--accent)', border: 'rgb(61 220 151 / 0.55)' },
  edge: { label: '≈ 边缘可接受', color: '#cdaa6d', border: 'rgb(205 170 109 / 0.55)' },
  bad: { label: '✗ 偏差', color: 'var(--loss)', border: 'rgb(224 99 92 / 0.55)' },
};

export function HandReplayer({
  hh,
  avatars,
}: {
  hh: HandHistory;
  avatars?: Record<string, number | null>;
}) {
  const steps = useMemo(() => buildSteps(hh), [hh]);
  const [idx, setIdx] = useState(steps.length - 1);
  const step = steps[Math.min(idx, steps.length - 1)];
  const board = parseGlyphCards(hh.board) ?? [];
  const bb = hh.bb;
  const n = hh.players.length;

  return (
    <div className="space-y-2.5">
      {/* 迷你牌桌 */}
      <div className="relative w-full max-w-[560px] mx-auto aspect-[16/10]">
        <div className="felt-rail absolute inset-[4%] rounded-[48%/46%]" />
        <div className="felt absolute inset-[6.5%] rounded-[48%/46%]" />

        {/* 中央: 底池 + 公共牌 */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-1.5">
          <span className="font-mono text-[11px] text-white/70">
            底池 {(step.pot / bb).toFixed(1)}BB
          </span>
          <div className="flex gap-1 min-h-[44px] items-center">
            {board.slice(0, step.boardCount).map((c) => (
              <CardView key={`${c}-${step.boardCount}`} card={c} size="sm" />
            ))}
            {Array.from({ length: 5 - step.boardCount }).map((_, i) => (
              <div key={i} className="w-8 h-11 rounded-lg border border-white/[0.08] bg-black/10 shrink-0" />
            ))}
          </div>
        </div>

        {/* 座位: 全员明牌 */}
        {hh.players.map((p, i) => {
          const a = (seatAngle(i, n) * Math.PI) / 180;
          const isFolded = step.folded.includes(p.id);
          const isActor = step.actorId === p.id;
          const holeStr = hh.holes?.[p.id] ?? (p.isHero ? hh.heroHole : '');
          const hole = holeStr ? parseGlyphCards(holeStr) ?? [] : [];
          const bet = step.bets[p.id] ?? 0;
          const won = step.isResult && hh.results.some((r) => r.name === p.name && r.net > 0);
          return (
            <div key={p.id}>
              {/* 下注 */}
              {bet > 0 && (
                <span
                  className="absolute -translate-x-1/2 -translate-y-1/2 font-mono text-[10px] text-white/85 flex items-center gap-1"
                  style={{
                    left: `${50 + 24 * Math.cos(a)}%`,
                    top: `${50 + 19 * Math.sin(a)}%`,
                  }}
                >
                  <span className="chip inline-block w-2.5 h-2.5" />
                  {(bet / bb).toFixed(1)}
                </span>
              )}
              {/* 座位: 牌与名牌完全不重叠 */}
              <div
                className={`absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-0.5 transition-opacity ${
                  isFolded ? 'opacity-30 saturate-50' : ''
                }`}
                style={{
                  left: `clamp(48px, ${50 + 40 * Math.cos(a)}%, calc(100% - 48px))`,
                  top: `${50 + 36 * Math.sin(a)}%`,
                }}
              >
                {hole.length > 0 && (
                  <div className="flex gap-px">
                    {hole.map((c) => (
                      <CardView key={c} card={c} size="sm" />
                    ))}
                  </div>
                )}
                <div
                  className={`glass rounded-xl px-2 py-1 flex items-center gap-1.5 whitespace-nowrap ${
                    isActor
                      ? 'shadow-[0_0_0_1.5px_var(--accent)]'
                      : won
                        ? 'shadow-[0_0_0_1.5px_var(--accent),0_0_18px_rgb(61_220_151/0.35)]'
                        : ''
                  }`}
                >
                  <Avatar name={p.name} avatarId={avatars?.[p.name] ?? null} isHero={p.isHero} size={14} />
                  <span
                    className={`text-[10px] whitespace-nowrap ${p.isHero ? 'text-accent font-medium' : ''}`}
                  >
                    {p.name}
                  </span>
                  <span className="font-mono text-[10px] text-muted">
                    {((step.stacks[p.id] ?? 0) / bb).toFixed(0)}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* 时间轴: 你的决策帧带标记(绿=与教练一致, 金=不同), 点标记直达 */}
      <div className="max-w-[560px] mx-auto px-1">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIdx((v) => Math.max(0, v - 1))}
            className="p-1 rounded-full border border-line text-muted hover:text-foreground disabled:opacity-40"
            disabled={idx === 0}
            aria-label="上一步"
          >
            <CaretLeft size={12} />
          </button>
          <div className="relative flex-1 pb-3">
            <input
              type="range"
              min={0}
              max={steps.length - 1}
              value={idx}
              onChange={(e) => setIdx(Number(e.target.value))}
              className="bet-slider w-full"
              style={{ ['--fill' as never]: `${(idx / Math.max(1, steps.length - 1)) * 100}%` }}
              aria-label="回放进度"
            />
            {/* 决策帧标记: 绿/黄/红 */}
            {steps.map((s, i) =>
              s.decisionIdx !== undefined ? (
                <button
                  key={i}
                  onClick={() => setIdx(i)}
                  className="absolute -bottom-1 -translate-x-1/2 w-5 h-5 flex items-center justify-center cursor-pointer"
                  style={{ left: `${(i / Math.max(1, steps.length - 1)) * 100}%` }}
                  aria-label={`你的决策 ${s.decisionIdx + 1}`}
                  title={s.desc}
                >
                  <span
                    className="rounded-full border transition-transform"
                    style={{
                      width: i === idx ? 10 : 8,
                      height: i === idx ? 10 : 8,
                      background: VERDICT_UI[verdictOf(hh.decisions![s.decisionIdx])].color,
                      borderColor: 'rgba(0,0,0,0.5)',
                      opacity: i === idx ? 1 : 0.8,
                    }}
                  />
                </button>
              ) : null
            )}
          </div>
          <button
            onClick={() => setIdx((v) => Math.min(steps.length - 1, v + 1))}
            className="p-1 rounded-full border border-line text-muted hover:text-foreground disabled:opacity-40"
            disabled={idx === steps.length - 1}
            aria-label="下一步"
          >
            <CaretRight size={12} />
          </button>
        </div>
        <p className="mt-1 text-center text-[11px] text-foreground/90">
          <span className="font-mono text-muted mr-2">
            {idx + 1}/{steps.length}
          </span>
          {step.desc}
        </p>
        {/* 决策帧: 正确性判定与完整决策信息(替代原先单独的决策卡片) */}
        {step.decisionIdx !== undefined && hh.decisions?.[step.decisionIdx] && (
          <div className="mt-2">
            {(() => {
              const d = hh.decisions[step.decisionIdx];
              const v = VERDICT_UI[verdictOf(d)];
              return (
                <div
                  className="rounded-xl border bg-background/40 px-3 py-2.5 space-y-1"
                  style={{ borderColor: v.border }}
                >
                  <div className="flex items-center gap-2 text-[11px]">
                    <span className="font-semibold" style={{ color: v.color }}>
                      {v.label}
                    </span>
                    <span className="text-muted">{d.facingText}</span>
                  </div>
                  {d.villainName && d.villainClasses.length > 0 && (
                    <p className="text-[11px] leading-relaxed">
                      <span className="text-muted">{d.villainName} 可能: </span>
                      <span className="font-mono text-foreground/85">
                        {d.villainClasses.join(' ')}
                      </span>
                      <span className="text-muted"> (约{d.villainSharePct.toFixed(0)}%起手牌)</span>
                    </p>
                  )}
                  <p className="text-[11px] font-mono text-muted">
                    你的胜率 ~{d.heroEquityPct.toFixed(0)}%
                    {d.neededPct !== null && <> · 跟注需 {d.neededPct.toFixed(0)}%</>}
                  </p>
                  <p className="text-[11px] leading-relaxed">
                    <span style={{ color: v.color }}>教练: {d.adviceAction}</span>
                    <span className="text-muted"> ({d.adviceReason})</span>
                    <span className="text-muted"> · 你: {d.actualAction || '未行动'}</span>
                  </p>
                </div>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
}
