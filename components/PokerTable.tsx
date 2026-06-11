'use client';

import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import type { HandState } from '@/lib/poker/engine';
import { potTotal } from '@/lib/poker/engine';
import { Seat } from './Seat';
import { CardView } from './CardView';

// 座位沿椭圆分布, 英雄固定底部 (角度 90°)
function seatAngle(index: number, total: number): number {
  return 90 + (360 * index) / total;
}

function seatPos(index: number, total: number) {
  const a = (seatAngle(index, total) * Math.PI) / 180;
  // clamp 防止窄屏上两侧座位被切出屏幕
  return {
    left: `clamp(58px, ${50 + 44 * Math.cos(a)}%, calc(100% - 58px))`,
    top: `${50 + 42 * Math.sin(a)}%`,
  };
}

function betPos(index: number, total: number) {
  const a = (seatAngle(index, total) * Math.PI) / 180;
  return {
    left: `${50 + 26 * Math.cos(a)}%`,
    top: `${50 + 23 * Math.sin(a)}%`,
  };
}

function buttonPos(index: number, total: number) {
  const a = ((seatAngle(index, total) + 14) * Math.PI) / 180;
  return {
    left: `${50 + 33 * Math.cos(a)}%`,
    top: `${50 + 31 * Math.sin(a)}%`,
  };
}



// 下注额按筹码堆显示: 数量随注额(BB)增长, 从座位方向飞入
function BetChips({ amount, bb, angleDeg }: { amount: number; bb: number; angleDeg: number }) {
  const reduce = useReducedMotion();
  const inBB = amount / bb;
  // 1BB=1枚, 之后按倍数递增, 封顶6枚
  const n = Math.max(1, Math.min(6, 1 + Math.floor(Math.log2(Math.max(1, inBB)))));
  const a = (angleDeg * Math.PI) / 180;
  // 初始位置偏向座位一侧(从玩家手里推出来的感觉)
  const fromX = Math.cos(a) * 46;
  const fromY = Math.sin(a) * 42;
  return (
    <span className="relative inline-block w-[18px]" style={{ height: 18 + (n - 1) * 4 }}>
      {Array.from({ length: n }).map((_, i) => (
        <motion.span
          key={i}
          initial={reduce ? false : { x: fromX, y: fromY, opacity: 0, rotate: 120 }}
          animate={{ x: (i % 2) * 1.5 - 0.75, y: 0, opacity: 1, rotate: 0 }}
          transition={{
            type: 'spring',
            stiffness: 380,
            damping: 26,
            delay: i * 0.05,
          }}
          className="chip absolute left-0 w-[18px] h-[18px]"
          style={{ bottom: `${i * 4}px`, zIndex: i }}
        />
      ))}
    </span>
  );
}

export function PokerTable({
  hand,
  showPersonalities,
  equities,
  avatars,
}: {
  hand: HandState;
  showPersonalities: boolean;
  equities?: Record<string, number> | null;
  // playerId -> 头像池编号
  avatars?: Record<string, number | null>;
}) {
  const reduce = useReducedMotion();
  const n = hand.players.length;
  const pot = potTotal(hand);
  const result = hand.result;
  const winnerIds = new Set(result?.awards.flatMap((a) => a.winnerIds) ?? []);
  const showdown = result !== null && Object.keys(result.revealed).length > 0;

  return (
    // 宽度同时受视口高度约束, 保证一屏内完整显示不溢出
    <div className="relative w-full max-w-[min(1020px,calc((100dvh-320px)*1.72))] mx-auto aspect-[16/10] sm:aspect-[16/9]">
      {/* 桌沿与毡面 */}
      <div className="felt-rail absolute inset-[5.5%] rounded-[48%/46%] sm:rounded-[50%/52%]" />
      <div className="felt absolute inset-[7.5%] rounded-[48%/46%] sm:rounded-[50%/52%]">
        <div className="felt-ring inset-[3.5%]" />
      </div>
      <div className="table-light" />
      {/* 毡面水印 */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <span className="font-mono text-[11px] tracking-[0.5em] text-white/[0.07] -translate-y-[92px] sm:-translate-y-[110px] select-none">
          FELT LAB
        </span>
      </div>

      {/* 中央: 底池与公共牌 */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-2.5">
        <div className="flex items-center gap-2 font-mono text-white/60">
          <span className="chip inline-block w-4 h-4" />
          <span className="text-white/95 text-base tracking-wider">{pot}</span>
        </div>
        <div className="flex gap-1.5 min-h-[80px] items-center">
          {hand.board.map((c, i) => (
            <CardView key={c} card={c} size="lg" delay={reduce ? 0 : (i % 3) * 0.12} />
          ))}
          {Array.from({ length: 5 - hand.board.length }).map((_, i) => (
            <div
              key={`empty-${i}`}
              className="w-14 h-20 rounded-[10px] border border-white/[0.08] bg-black/10 shrink-0"
            />
          ))}
        </div>
        <AnimatePresence>
          {result && (
            <motion.div
              initial={reduce ? false : { opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
              className="glass rounded-full px-5 py-1.5 text-xs whitespace-nowrap"
            >
              {result.awards.map((a, i) => {
                const names = a.winnerIds
                  .map((id) => hand.players.find((p) => p.id === id)?.name ?? id)
                  .join('、');
                return (
                  <span key={i}>
                    {i > 0 && <span className="text-muted"> | </span>}
                    <span className="text-accent font-semibold">{names}</span>
                    <span className="text-muted"> 赢得 </span>
                    <span className="font-mono text-white/95">{a.amount}</span>
                    {a.handName && <span className="text-muted"> ({a.handName})</span>}
                  </span>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* 玩家下注 */}
      {hand.players.map((p, i) =>
        p.streetBet > 0 ? (
          <div
            key={`bet-${p.id}-${p.streetBet}`}
            className="absolute -translate-x-1/2 -translate-y-1/2 flex items-end gap-1.5"
            style={betPos(i, n)}
          >
            <BetChips amount={p.streetBet} bb={hand.bb} angleDeg={seatAngle(i, n)} />
            <motion.span
              initial={reduce ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.15 }}
              className="font-mono text-xs text-white/90 pb-0.5"
            >
              {p.streetBet}
            </motion.span>
          </div>
        ) : null
      )}

      {/* 庄家钮 */}
      <div
        className="absolute -translate-x-1/2 -translate-y-1/2 w-[22px] h-[22px] rounded-full text-[10px] font-bold flex items-center justify-center text-black/80"
        style={{
          ...buttonPos(hand.button, n),
          background: 'linear-gradient(180deg, #f2eee2, #cfc8b4)',
          boxShadow: 'inset 0 1px 0 rgb(255 255 255 / 0.9), 0 2px 6px rgb(0 0 0 / 0.55)',
        }}
      >
        D
      </div>

      {/* 赢家收池: 筹码从中央飞向赢家 */}
      {result &&
        hand.players.map((p, i) =>
          winnerIds.has(p.id)
            ? Array.from({ length: 5 }).map((_, c) => (
                <motion.span
                  key={`collect-${p.id}-${c}`}
                  initial={{ left: '50%', top: '46%', opacity: 0 }}
                  animate={{
                    left: seatPos(i, n).left,
                    top: seatPos(i, n).top,
                    opacity: [0, 1, 1, 0],
                  }}
                  transition={{ duration: 0.85, delay: 0.25 + c * 0.08, ease: [0.3, 0.7, 0.4, 1] }}
                  className="chip absolute w-[16px] h-[16px] -translate-x-1/2 -translate-y-1/2 pointer-events-none z-30"
                />
              ))
            : null
        )}

      {/* 座位(移动端整体缩小一档) */}
      {hand.players.map((p, i) => (
        <div
          key={p.id}
          className="absolute -translate-x-1/2 -translate-y-1/2 scale-[0.82] sm:scale-100"
          style={seatPos(i, n)}
        >
          <Seat
            player={p}
            hand={hand}
            isToAct={hand.toAct === i && !result}
            isWinner={winnerIds.has(p.id)}
            winAmount={result && result.netById[p.id] > 0 ? result.netById[p.id] : 0}
            showPersonality={showPersonalities}
            revealedCards={(showdown && !!result?.revealed[p.id]) || (!!equities && hand.runout)}
            handName={result?.handNames[p.id] ?? null}
            equity={!result && equities ? equities[p.id] : undefined}
            angleDeg={seatAngle(i, n)}
            dealIndex={i}
            avatarId={avatars?.[p.id] ?? null}
          />
        </div>
      ))}
    </div>
  );
}
