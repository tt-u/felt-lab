'use client';

import { CheckCircle, Lightbulb } from '@phosphor-icons/react';
import type { DecisionPoint } from '@/lib/drama';

// 兔子洞式逐决策复盘: 局面 / 对手可能的牌 / 数字 / 教练建议 vs 你的选择
export function DecisionReview({ decisions }: { decisions: DecisionPoint[] }) {
  if (!decisions.length) return null;
  return (
    <div className="space-y-2">
      {decisions.map((d, i) => (
        <div key={i} className="rounded-xl bg-background/40 border border-line p-2.5 space-y-1.5">
          <div className="flex items-center gap-2 text-[11px]">
            <span className="font-mono text-accent">{d.street}</span>
            {d.boardText !== '(尚未发牌)' && (
              <span className="font-mono text-foreground/80">{d.boardText}</span>
            )}
            <span className="font-mono text-muted ml-auto">底池 {d.potBB.toFixed(1)}BB</span>
          </div>
          <p className="text-xs text-foreground/90">{d.facingText}</p>
          {d.villainName && d.villainClasses.length > 0 && (
            <p className="text-[11px] leading-relaxed">
              <span className="text-muted">{d.villainName} 可能: </span>
              <span className="font-mono text-foreground/85">{d.villainClasses.join(' ')}</span>
              <span className="text-muted"> (约{d.villainSharePct.toFixed(0)}%起手牌)</span>
            </p>
          )}
          <p className="text-[11px] font-mono text-muted">
            你的胜率 ~{d.heroEquityPct.toFixed(0)}%
            {d.neededPct !== null && <> · 跟注需 {d.neededPct.toFixed(0)}%</>}
          </p>
          <div className="flex items-start gap-1.5 text-[11px] leading-relaxed">
            <Lightbulb size={12} className="text-accent shrink-0 mt-0.5" weight="fill" />
            <span>
              <span className="text-accent">教练: {d.adviceAction}</span>
              <span className="text-muted"> ({d.adviceReason})</span>
            </span>
          </div>
          {d.actualAction && (
            <div className="flex items-center gap-1.5 text-[11px]">
              <span className="text-muted">你的选择: {d.actualAction}</span>
              {d.agree ? (
                <CheckCircle size={13} weight="fill" className="text-accent" />
              ) : (
                <span className="text-[10px] px-1.5 py-px rounded-full border border-[#cdaa6d]/60 text-[#cdaa6d]">
                  与教练不同
                </span>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
