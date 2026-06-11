'use client';

import { motion, useReducedMotion } from 'motion/react';
import type { Card } from '@/lib/poker/cards';
import { rankOf, suitOf, RANK_CHARS, SUIT_CHARS } from '@/lib/poker/cards';

const SIZES = {
  sm: { box: 'w-8 h-11', idx: 'text-[10px]', pip: 'text-sm' },
  md: { box: 'w-12 h-[68px]', idx: 'text-xs', pip: 'text-xl' },
  lg: { box: 'w-14 h-20', idx: 'text-sm', pip: 'text-2xl' },
  xl: { box: 'w-16 h-[90px]', idx: 'text-base', pip: 'text-[28px]' },
} as const;

export function CardView({
  card,
  hidden = false,
  size = 'md',
  delay = 0,
}: {
  card?: Card;
  hidden?: boolean;
  size?: keyof typeof SIZES;
  delay?: number;
}) {
  const reduce = useReducedMotion();
  const s = SIZES[size];

  if (hidden || card === undefined) {
    return <div className={`card-back ${s.box} shrink-0`} aria-label="背面牌" />;
  }

  const r = rankOf(card);
  const su = suitOf(card);
  const red = su === 1 || su === 2;

  // 小尺寸: 只显示居中的"数字+花色"一组, 避免拥挤
  if (size === 'sm') {
    return (
      <motion.div
        initial={reduce ? false : { opacity: 0, y: 10, rotateY: 70, scale: 0.92 }}
        animate={{ opacity: 1, y: 0, rotateY: 0, scale: 1 }}
        transition={{ duration: 0.42, delay, ease: [0.16, 1, 0.3, 1] }}
        className={`playing-card ${s.box} shrink-0 flex flex-col items-center justify-center font-mono font-bold leading-none select-none`}
        style={{ color: red ? 'var(--card-red)' : 'var(--card-black)' }}
        aria-label={RANK_CHARS[r] + SUIT_CHARS[su]}
      >
        <span className="text-xs">{RANK_CHARS[r]}</span>
        <span className="text-xs mt-0.5">{SUIT_CHARS[su]}</span>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 10, rotateY: 70, scale: 0.92 }}
      animate={{ opacity: 1, y: 0, rotateY: 0, scale: 1 }}
      transition={{ duration: 0.42, delay, ease: [0.16, 1, 0.3, 1] }}
      className={`playing-card ${s.box} shrink-0 relative select-none`}
      style={{ color: red ? 'var(--card-red)' : 'var(--card-black)' }}
      aria-label={RANK_CHARS[r] + SUIT_CHARS[su]}
    >
      <span
        className={`absolute top-1 left-1.5 font-mono font-bold leading-none ${s.idx} flex flex-col items-center`}
      >
        {RANK_CHARS[r]}
        <span className="mt-px">{SUIT_CHARS[su]}</span>
      </span>
      <span
        className={`absolute inset-0 flex items-center justify-center ${s.pip} translate-y-1`}
      >
        {SUIT_CHARS[su]}
      </span>
    </motion.div>
  );
}
