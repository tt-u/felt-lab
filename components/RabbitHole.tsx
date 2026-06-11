'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Binoculars, X } from '@phosphor-icons/react';
import type { RabbitData } from '@/lib/drama';
import { parseGlyphCards } from '@/lib/poker/history';
import { CardView } from './CardView';

// 兔子洞: 弃牌后揭示"如果跟到底会怎样"。正式 modal: 遮罩 + 显式关闭。
export function RabbitHole({ rabbit, onReveal }: { rabbit: RabbitData; onReveal: () => void }) {
  const [open, setOpen] = useState(false);
  const boardCards = parseGlyphCards(rabbit.fullBoard) ?? [];
  const winnerCards = parseGlyphCards(rabbit.winnerHole) ?? [];

  return (
    <>
      <button
        onClick={() => {
          setOpen(true);
          onReveal();
        }}
        className="flex items-center gap-1.5 text-xs px-4 py-2 rounded-full glass text-accent hover:shadow-[0_0_0_1px_var(--accent)] transition-all"
      >
        <Binoculars size={15} weight="fill" />
        兔子洞: 如果跟到底会怎样?
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            key="rabbit-modal"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-[2px]"
            onClick={() => setOpen(false)}
          >
            <motion.div
              initial={{ opacity: 0, y: 18, scale: 0.94 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.96 }}
              transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
              className="relative glass rounded-3xl px-7 py-6 flex flex-col items-center gap-3 shadow-[0_24px_80px_rgb(0_0_0/0.7)] mx-4"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={() => setOpen(false)}
                className="absolute top-3 right-3 p-1 rounded-full text-muted hover:text-foreground transition-colors"
                aria-label="关闭"
              >
                <X size={15} />
              </button>
              <div className="text-[11px] text-accent flex items-center gap-1.5">
                <Binoculars size={13} weight="fill" />
                如果你跟到底
              </div>
              <div className="flex gap-1.5">
                {boardCards.map((c, i) => (
                  <CardView key={c} card={c} size="md" delay={i * 0.12} />
                ))}
              </div>
              <div className="text-xs text-center leading-relaxed">
                <span className="text-muted">你会成 </span>
                <span className="font-semibold">{rabbit.heroHandName}</span>
                <span className="text-muted"> · {rabbit.winnerName} 当时拿 </span>
                <span className="font-mono">{rabbit.winnerHole}</span>
                <span className="text-muted"> ({rabbit.winnerHandName})</span>
              </div>
              <div className="flex items-center gap-1.5">
                {winnerCards.map((c, i) => (
                  <CardView key={c} card={c} size="sm" delay={0.3 + i * 0.1} />
                ))}
                <motion.span
                  initial={{ opacity: 0, scale: 0.7 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.55, type: 'spring', stiffness: 300, damping: 16 }}
                  className={`ml-2 text-sm font-bold font-mono px-3 py-1 rounded-full ${
                    rabbit.heroWouldBeat
                      ? 'bg-accent text-black'
                      : 'border border-line text-muted'
                  }`}
                >
                  {rabbit.heroWouldBeat ? '你本来会赢!' : '弃得对, 你会输'}
                </motion.span>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
