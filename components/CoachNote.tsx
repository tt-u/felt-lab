'use client';

import type { HandCommentData } from '@/lib/review-prompt';

export const VERDICT_STYLE: Record<string, { label: string; cls: string }> = {
  good: { label: '漂亮', cls: 'text-accent border-accent/50' },
  ok: { label: '标准', cls: 'text-muted border-line' },
  mistake: { label: '可改进', cls: 'text-[#cdaa6d] border-[#cdaa6d]/50' },
  blunder: { label: '重点改进', cls: 'text-[var(--loss)] border-[var(--loss)]/60' },
};

const ROWS: { key: 'read' | 'math' | 'next'; label: string }[] = [
  { key: 'read', label: '读牌' },
  { key: 'math', label: '数字' },
  { key: 'next', label: '下次' },
];

// 结构化教练详评(兼容旧的纯文本点评)
export function CoachNote({ note }: { note: HandCommentData | string }) {
  if (typeof note === 'string') {
    return <p className="text-xs leading-relaxed text-foreground/90">{note}</p>;
  }
  const v = VERDICT_STYLE[note.verdict] ?? VERDICT_STYLE.ok;
  const streets = note.streets ?? [];
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold">{note.title}</span>
        <span className={`text-[10px] px-2 py-px rounded-full border ${v.cls}`}>{v.label}</span>
      </div>
      {note.situation && (
        <p className="text-xs leading-relaxed text-foreground/90">{note.situation}</p>
      )}
      {streets.length > 0 && (
        <div className="space-y-1 border-l border-accent/30 pl-2.5 py-0.5">
          {streets.map((s, i) => (
            <div key={i} className="flex gap-2 text-xs leading-relaxed">
              <span className="shrink-0 w-7 text-accent/80 font-mono text-[11px]">{s.street}</span>
              <span className="text-foreground/90">{s.note}</span>
            </div>
          ))}
        </div>
      )}
      <div className="space-y-1">
        {ROWS.map(({ key, label }) => {
          const val = note[key];
          if (!val) return null;
          return (
            <div key={key} className="flex gap-2 text-xs leading-relaxed">
              <span className="shrink-0 w-7 text-muted">{label}</span>
              <span className="text-foreground/90">{val}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
