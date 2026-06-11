'use client';

import { useEffect, useRef } from 'react';
import type { HandState, Street } from '@/lib/poker/engine';
import { STREET_ZH } from '@/lib/poker/engine';

const ACTION_ZH: Record<string, string> = {
  sb: '小盲',
  bb: '大盲',
  fold: '弃牌',
  check: '过牌',
  call: '跟注',
  bet: '下注',
  raise: '加注到',
};

export function ActionLog({ hand, embedded = false }: { hand: HandState; embedded?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [hand.log.length, hand.board.length]);

  return (
    <div
      ref={ref}
      className={`h-full overflow-y-auto p-3 text-xs space-y-1 ${
        embedded ? '' : 'rounded-2xl bg-surface border border-line'
      }`}
    >
      <div className="text-muted mb-2">第 {hand.handNo} 手</div>
      {hand.log.map((a, i) => {
        const prevStreet: Street | null = i > 0 ? hand.log[i - 1].street : null;
        const header =
          a.street !== prevStreet ? (
            <div className="text-muted/70 font-mono uppercase pt-1.5">{STREET_ZH[a.street]}</div>
          ) : null;
        return (
          <div key={i}>
            {header}
            <div className="flex justify-between gap-2">
              <span className="truncate">
                {a.playerName}{' '}
                <span className="text-muted">
                  {ACTION_ZH[a.type]}
                  {a.allIn ? ' (全下)' : ''}
                </span>
              </span>
              {a.amount > 0 && <span className="font-mono text-muted">{a.amount}</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
