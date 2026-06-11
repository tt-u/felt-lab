'use client';

import { motion, useReducedMotion } from 'motion/react';
import type { HandPlayer, HandState } from '@/lib/poker/engine';
import { positionLabel } from '@/lib/poker/ranges';
import { PERSONALITIES, PERSONALITY_HUES } from '@/lib/poker/personality';
import { CardView } from './CardView';
import { Avatar } from './Avatar';

function ThinkingDots() {
  return (
    <span className="inline-flex gap-0.5 items-center" aria-label="思考中">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="w-1 h-1 rounded-full bg-accent"
          animate={{ opacity: [0.25, 1, 0.25] }}
          transition={{ duration: 1.1, repeat: Infinity, delay: i * 0.18 }}
        />
      ))}
    </span>
  );
}

export function Seat({
  player,
  hand,
  isToAct,
  isWinner,
  winAmount = 0,
  showPersonality,
  revealedCards,
  handName,
  equity,
  angleDeg = 90,
  dealIndex = 0,
  avatarId = null,
}: {
  player: HandPlayer;
  hand: HandState;
  isToAct: boolean;
  isWinner: boolean;
  winAmount?: number;
  showPersonality: boolean;
  revealedCards: boolean;
  handName: string | null;
  // 全下摊牌时的实时胜率(0..1)
  equity?: number;
  // 座位在椭圆上的角度与发牌顺序(发牌/摊牌动画用)
  angleDeg?: number;
  dealIndex?: number;
  avatarId?: number | null;
}) {
  const reduce = useReducedMotion();
  const pos = positionLabel(player.seatsFromButton, hand.players.length);
  const folded = player.folded;
  const profile = player.personality ? PERSONALITIES[player.personality] : null;
  const showFace = player.isHero || revealedCards;
  // 英雄弃牌后仍能看到自己弃了什么
  const showCards = player.hole && (!folded || player.isHero);

  return (
    <div
      className={`relative flex flex-col items-center gap-1 transition-all duration-300 ${
        folded ? (player.isHero ? 'opacity-60' : 'opacity-30 saturate-50') : ''
      }`}
    >
      {/* 全下摊牌实时胜率 */}
      {equity !== undefined && !folded && (
        <motion.div
          key={`eq-${equity.toFixed(2)}`}
          initial={reduce ? false : { scale: 1.35, opacity: 0.5 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 320, damping: 18 }}
          className={`absolute -top-9 left-1/2 -translate-x-1/2 z-20 font-mono text-sm font-bold px-2.5 py-0.5 rounded-full glass ${
            equity >= 0.5 ? 'text-accent border-accent/50' : 'text-foreground/90'
          }`}
        >
          {(equity * 100).toFixed(0)}%
        </motion.div>
      )}

      {/* 赢得金额漂浮 */}
      {isWinner && winAmount > 0 && (
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: [0, 1, 1, 0], y: -26 }}
          transition={{ duration: 2.2, times: [0, 0.15, 0.75, 1], ease: 'easeOut' }}
          className="absolute -top-10 left-1/2 -translate-x-1/2 font-mono text-lg font-bold text-accent drop-shadow-[0_2px_12px_rgb(61_220_151/0.6)] pointer-events-none z-20"
        >
          +{winAmount}
        </motion.div>
      )}

      {/* 手牌: 开局从牌桌中央发到座位; 摊牌时逐家翻开 */}
      {showCards && player.hole && (
        <motion.div
          key={`deal-${hand.handNo}`}
          initial={
            reduce
              ? false
              : {
                  x: -Math.cos((angleDeg * Math.PI) / 180) * 180,
                  y: -Math.sin((angleDeg * Math.PI) / 180) * 150,
                  opacity: 0,
                  scale: 0.6,
                }
          }
          animate={{ x: 0, y: 0, opacity: 1, scale: 1 }}
          transition={{ type: 'spring', stiffness: 300, damping: 26, delay: dealIndex * 0.1 }}
          className={`flex -mb-3.5 z-10 ${player.isHero ? 'gap-1' : 'gap-0.5'} ${
            folded ? 'grayscale opacity-80' : ''
          }`}
        >
          <CardView
            card={player.hole[0]}
            hidden={!showFace}
            size={player.isHero ? 'md' : 'sm'}
            delay={!player.isHero && revealedCards ? 0.2 + dealIndex * 0.3 : 0}
          />
          <CardView
            card={player.hole[1]}
            hidden={!showFace}
            size={player.isHero ? 'md' : 'sm'}
            delay={!player.isHero && revealedCards ? 0.3 + dealIndex * 0.3 : 0.07}
          />
        </motion.div>
      )}

      {/* 信息牌 */}
      <motion.div
        animate={isWinner && !reduce ? { scale: [1, 1.07, 1] } : { scale: 1 }}
        transition={{ duration: 0.55, repeat: isWinner ? 2 : 0 }}
        className={`glass relative rounded-2xl px-3 py-1.5 min-w-[122px] text-center transition-shadow duration-300 ${
          isToAct
            ? 'shadow-[0_0_0_1.5px_var(--accent),0_0_26px_rgb(61_220_151/0.3)]'
            : isWinner
              ? 'shadow-[0_0_0_1.5px_var(--accent),0_0_34px_rgb(61_220_151/0.4)]'
              : ''
        }`}
      >
        <div className="flex items-center justify-center gap-1.5">
          <Avatar name={player.name} avatarId={avatarId} isHero={player.isHero} size={20} />
          <span className="text-xs font-medium truncate max-w-[80px]">{player.name}</span>
          {folded && <span className="text-[9px] text-muted">弃</span>}
        </div>
        {/* 第二行: 筹码 + 位置 + 性格标签(放牌面下方, 不会被牌盖住) */}
        <div className="flex items-center justify-center gap-1.5 mt-0.5">
          <span className="font-mono text-sm tracking-wide">
            {player.allIn && player.stack === 0 ? (
              <span style={{ color: 'var(--loss)' }}>全下</span>
            ) : (
              player.stack
            )}
          </span>
          <span className="text-[9px] text-muted font-mono">{pos}</span>
          {profile && showPersonality && (
            <span
              className="text-[9px] px-1.5 py-px rounded-full border whitespace-nowrap font-medium"
              style={{
                color: `hsl(${PERSONALITY_HUES[profile.id]} 65% 68%)`,
                borderColor: `hsl(${PERSONALITY_HUES[profile.id]} 55% 50% / 0.55)`,
              }}
            >
              {profile.tagZh}
            </span>
          )}
          {isToAct && <ThinkingDots />}
        </div>
        {handName && revealedCards && !folded && (
          <div className="absolute -bottom-2.5 left-1/2 -translate-x-1/2 text-[9px] px-2 py-0.5 rounded-full bg-accent text-black font-semibold whitespace-nowrap shadow-[0_2px_10px_rgb(61_220_151/0.4)]">
            {handName}
          </div>
        )}
      </motion.div>
    </div>
  );
}
