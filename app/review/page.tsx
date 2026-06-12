'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion, useReducedMotion } from 'motion/react';
import {
  ArrowCounterClockwise,
  ArrowLeft,
  ChatCircleText,
  Play,
  Robot,
} from '@phosphor-icons/react';
import { useGame, loadSessionRecord, type SessionRecord } from '@/lib/store';
import { computeHeroStats, handToText } from '@/lib/poker/history';
import { PERSONALITIES } from '@/lib/poker/personality';
import {
  REVIEW_SYSTEM_PROMPT,
  buildReviewUserPrompt,
  parseStructuredReview,
  type StructuredReview,
} from '@/lib/review-prompt';
import { chatStream } from '@/lib/llm';
import { HandReplayer } from '@/components/HandReplayer';
import { CoachNote } from '@/components/CoachNote';

type AiStatus = 'idle' | 'streaming' | 'done' | 'error';

const SEVERITY_ZH: Record<string, { label: string; cls: string }> = {
  high: { label: '高', cls: 'text-[var(--loss)] border-[var(--loss)]/50' },
  medium: { label: '中', cls: 'text-foreground border-line' },
  low: { label: '低', cls: 'text-muted border-line' },
};

const LOADING_STAGES = [
  '正在重放手牌记录',
  '正在分析翻前范围',
  '正在检查翻后决策',
  '正在定位系统性漏洞',
  '正在撰写训练建议',
];

export default function ReviewPage() {
  const router = useRouter();
  const startSession = useGame((s) => s.startSession);
  const [record, setRecord] = useState<SessionRecord | null>(null);
  const [loaded, setLoaded] = useState(false);

  const [aiStatus, setAiStatus] = useState<AiStatus>('idle');
  const [review, setReview] = useState<StructuredReview | null>(null);
  const [rawText, setRawText] = useState('');
  const [aiError, setAiError] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const startedRef = useRef(false);
  const reduce = useReducedMotion();

  useEffect(() => {
    // sessionStorage 只能在挂载后读取(避免 SSR/水合不一致), 一次性同步是预期行为
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRecord(loadSessionRecord());
    setLoaded(true);
  }, []);

  // 生成期间的计时器(驱动阶段提示)
  useEffect(() => {
    if (aiStatus !== 'streaming') return;
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [aiStatus]);

  const runReview = useCallback(async (rec: SessionRecord) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setAiStatus('streaming');
    setReview(null);
    setRawText('');
    setAiError('');
    setElapsed(0);

    // 流式生成可能因网络抖动中断, 自动重试一次再报错
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const acc = await chatStream(
          {
            system: REVIEW_SYSTEM_PROMPT,
            user: buildReviewUserPrompt(rec),
            json: true,
            maxTokens: 2400,
            signal: ctrl.signal,
          },
          (t) => setRawText(t)
        );
        const parsed = parseStructuredReview(acc);
        if (!parsed) throw new Error('复盘结果解析失败, 请点击重新生成');
        setReview(parsed);
        setAiStatus('done');
        return;
      } catch (e) {
        if (ctrl.signal.aborted) return;
        if (attempt === 0) {
          setRawText('');
          await new Promise((r) => setTimeout(r, 1500));
          continue;
        }
        setAiStatus('error');
        setAiError(e instanceof Error ? e.message : '复盘生成失败, 请重试');
      }
    }
  }, []);

  useEffect(() => {
    if (record && record.histories.length > 0 && !startedRef.current) {
      startedRef.current = true;
      runReview(record);
    }
  }, [record, runReview]);

  useEffect(() => () => abortRef.current?.abort(), []);

  if (!loaded) {
    return (
      <main className="min-h-[100dvh] flex items-center justify-center text-muted text-sm">
        加载中…
      </main>
    );
  }

  if (!record || record.histories.length === 0) {
    return (
      <main className="min-h-[100dvh] flex items-center justify-center px-4">
        <div className="glass rounded-3xl px-10 py-12 flex flex-col items-center gap-4 max-w-sm text-center">
          <span className="font-mono text-sm text-accent tracking-[0.4em]">FELT LAB</span>
          <p className="text-lg font-medium">还没有可复盘的牌局</p>
          <p className="text-sm text-muted leading-relaxed">
            打完一局回来, 这里会有逐手回放、决策判定和行为模式分析。
          </p>
          <Link href="/" className="btn-primary px-8 py-3 text-sm mt-2">
            去开一局
          </Link>
        </div>
      </main>
    );
  }

  const stats = computeHeroStats(record.histories);
  const bots = record.seats.filter((s) => !s.isHero);
  const avatarByName = Object.fromEntries(record.seats.map((s) => [s.name, s.avatarId ?? null]));
  const comments = record.handComments ?? {};
  // 流式途中尽早提取一句话总评, 减少干等感
  const earlyHeadline =
    aiStatus === 'streaming' ? rawText.match(/"headline"\s*:\s*"([^"]{2,})/)?.[1] : null;
  const stageIdx = Math.min(Math.floor(elapsed / 5), LOADING_STAGES.length - 1);

  function again() {
    if (!record) return;
    startSession(record.config);
    router.push('/table');
  }

  const statItems: { label: string; value: string; tone?: 'win' | 'loss' }[] = [
    { label: '手数', value: String(stats.hands) },
    {
      label: '盈亏',
      value: `${stats.netBB >= 0 ? '+' : ''}${stats.netBB.toFixed(1)} BB`,
      tone: stats.netBB >= 0 ? 'win' : 'loss',
    },
    { label: 'VPIP', value: `${stats.vpip.toFixed(1)}%` },
    { label: 'PFR', value: `${stats.pfr.toFixed(1)}%` },
    { label: '3Bet', value: `${stats.threeBet.toFixed(1)}%` },
    { label: 'WTSD', value: `${stats.wtsd.toFixed(1)}%` },
    { label: '摊牌胜率', value: `${stats.wsd.toFixed(1)}%` },
    { label: '进攻频率', value: `${stats.afq.toFixed(1)}%` },
  ];

  return (
    <main className="min-h-[100dvh]">
      <div className="max-w-[860px] mx-auto px-4 sm:px-8 py-10">
        <header className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <Link href="/" className="font-mono text-sm text-accent">
              FELT LAB
            </Link>
            <h1 className="mt-2 text-3xl sm:text-4xl font-semibold tracking-tighter">训练复盘</h1>
          </div>
          <div className="flex gap-2">
            <Link
              href="/"
              className="flex items-center gap-1.5 px-4 py-2 rounded-full border border-line text-sm text-muted hover:text-foreground transition-colors"
            >
              <ArrowLeft size={15} />
              重新设置
            </Link>
            <button
              onClick={again}
              className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-accent text-black text-sm font-semibold hover:brightness-110"
            >
              <Play size={15} weight="fill" />
              同配置再来一局
            </button>
          </div>
        </header>

        {/* 数据画像 */}
        <section className="mt-8 grid grid-cols-2 sm:grid-cols-4 gap-px bg-line rounded-2xl overflow-hidden border border-line">
          {statItems.map((s, i) => (
            <motion.div
              key={s.label}
              initial={reduce ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, delay: i * 0.05, ease: [0.16, 1, 0.3, 1] }}
              className="bg-surface px-4 py-3.5"
            >
              <div className="text-[11px] text-muted">{s.label}</div>
              <div
                className="font-mono text-lg mt-0.5"
                style={
                  s.tone
                    ? { color: s.tone === 'win' ? 'var(--accent)' : 'var(--loss)' }
                    : undefined
                }
              >
                {s.value}
              </div>
            </motion.div>
          ))}
        </section>

        {/* 对手揭晓 */}
        <section className="mt-6 rounded-2xl border border-line bg-surface p-5">
          <h2 className="text-sm font-medium">
            对手风格{record.config.showPersonalities ? '' : ' (盲打模式, 现在揭晓)'}
          </h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {bots.map((b) => {
              const p = b.personality ? PERSONALITIES[b.personality] : null;
              return (
                <span
                  key={b.name}
                  className="text-xs px-3 py-1.5 rounded-full bg-surface-2 border border-line"
                >
                  {b.name} · <span className="text-accent">{p?.nameZh ?? '未知'}</span>
                  {b.rebuys > 0 && <span className="text-muted"> (补码{b.rebuys}次)</span>}
                  {b.out && <span className="text-muted"> (中途下桌)</span>}
                </span>
              );
            })}
          </div>
        </section>

        {/* AI 教练复盘 */}
        <section className="mt-6 rounded-2xl border border-line bg-surface p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-sm font-medium">
              <Robot size={17} className="text-accent" />
              AI 教练复盘
              <span className="text-[10px] text-muted font-mono">DeepSeek</span>
            </h2>
            {(aiStatus === 'done' || aiStatus === 'error') && (
              <button
                onClick={() => runReview(record)}
                className="flex items-center gap-1 text-xs text-muted hover:text-accent transition-colors"
              >
                <ArrowCounterClockwise size={13} />
                重新生成
              </button>
            )}
          </div>

          {/* 生成中 */}
          {aiStatus === 'streaming' && (
            <div className="mt-5 py-4">
              <div className="flex items-center gap-3">
                <span className="w-2 h-2 rounded-full bg-accent animate-pulse shrink-0" />
                <span className="text-sm text-foreground/90">{LOADING_STAGES[stageIdx]}…</span>
                <span className="text-xs text-muted font-mono ml-auto">{elapsed}s</span>
              </div>
              {earlyHeadline && (
                <p className="mt-4 text-base text-foreground/80">「{earlyHeadline}…」</p>
              )}
              <div className="mt-4 space-y-2.5">
                <div className="h-3 w-3/5 rounded bg-surface-2 animate-pulse" />
                <div className="h-3 w-full rounded bg-surface-2 animate-pulse" />
                <div className="h-3 w-4/5 rounded bg-surface-2 animate-pulse" />
              </div>
            </div>
          )}

          {/* 结构化结果 */}
          {aiStatus === 'done' && review && (
            <motion.div
              initial={reduce ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
              className="mt-5 space-y-6"
            >
              {/* 评级 */}
              <div className="flex items-start gap-4">
                <motion.div
                  initial={reduce ? false : { scale: 0.5, opacity: 0, filter: 'blur(6px)' }}
                  animate={{ scale: 1, opacity: 1, filter: 'blur(0px)' }}
                  transition={{ type: 'spring', stiffness: 240, damping: 18, delay: 0.15 }}
                  className="w-16 h-16 shrink-0 rounded-2xl border border-accent/60 bg-accent/10 flex items-center justify-center shadow-[0_0_30px_rgb(61_220_151/0.2)]"
                >
                  <span className="font-mono text-3xl font-bold text-accent">{review.grade}</span>
                </motion.div>
                <div className="min-w-0">
                  <p className="text-lg font-semibold leading-snug">{review.headline}</p>
                  {review.styleRead && (
                    <p className="mt-1 text-xs text-muted leading-relaxed">{review.styleRead}</p>
                  )}
                </div>
              </div>

              {review.summary.length > 0 && (
                <ul className="space-y-1.5">
                  {review.summary.map((s, i) => (
                    <li key={i} className="flex gap-2 text-sm text-foreground/90">
                      <span className="text-accent shrink-0 font-mono">{i + 1}.</span>
                      {s}
                    </li>
                  ))}
                </ul>
              )}

              {/* 行为模式: 跨手牌才能发现的东西 */}
              {review.patterns.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium mb-2.5">行为模式</h3>
                  <div className="space-y-2">
                    {review.patterns.map((p, i) => {
                      const sv = SEVERITY_ZH[p.severity];
                      return (
                        <div key={i} className="rounded-xl border border-line bg-surface-2/50 p-3.5">
                          <div className="flex items-center gap-2">
                            <span
                              className={`shrink-0 w-5 h-5 rounded-full border flex items-center justify-center text-[10px] ${sv.cls}`}
                            >
                              {sv.label}
                            </span>
                            <span className="text-sm font-medium">{p.title}</span>
                          </div>
                          <p className="mt-1.5 text-xs leading-relaxed text-foreground/90">
                            <span className="text-muted">证据: </span>
                            {p.evidence}
                          </p>
                          {p.impact && (
                            <p className="mt-1 text-xs leading-relaxed text-muted">
                              代价: {p.impact}
                            </p>
                          )}
                          {p.fix && (
                            <p className="mt-1 text-xs leading-relaxed text-accent/90">
                              修正: {p.fix}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 状态轨迹 */}
              {review.tilt && (
                <div className="rounded-xl border border-[#cdaa6d]/30 bg-[#cdaa6d]/[0.05] p-3.5 text-xs leading-relaxed">
                  <span className="text-[#cdaa6d] font-medium">状态轨迹: </span>
                  <span className="text-foreground/90">{review.tilt}</span>
                </div>
              )}

              {/* 对手适应 + 训练任务 */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                {review.adaptation.length > 0 && (
                  <div>
                    <h3 className="text-sm font-medium mb-2">对手适应</h3>
                    <ul className="space-y-1.5 text-xs text-foreground/90">
                      {review.adaptation.map((a, i) => (
                        <li key={i} className="leading-relaxed">
                          <span className="text-accent">{a.vs}</span>
                          <span className="text-muted">: </span>
                          {a.assessment}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {review.drills.length > 0 && (
                  <div>
                    <h3 className="text-sm font-medium mb-2">下一步训练</h3>
                    <ul className="space-y-1.5 text-xs text-foreground/90">
                      {review.drills.map((d, i) => (
                        <li key={i} className="flex gap-2 leading-relaxed">
                          <span className="text-accent font-mono shrink-0">{i + 1}.</span>
                          {d}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {/* 出错 */}
          {aiStatus === 'error' && (
            <div className="mt-5 rounded-xl border border-[var(--loss)]/40 bg-[var(--loss)]/5 p-4 text-sm">
              <p style={{ color: 'var(--loss)' }}>{aiError}</p>
              <button
                onClick={() => runReview(record)}
                className="mt-3 px-4 py-1.5 rounded-full border border-line text-xs text-muted hover:text-foreground transition-colors"
              >
                重试
              </button>
            </div>
          )}
        </section>

        {/* 手牌记录 */}
        <section className="mt-6 mb-16">
          <h2 className="text-sm font-medium mb-3 px-1">全部手牌 ({record.histories.length})</h2>
          <div className="rounded-2xl border border-line overflow-hidden divide-y divide-line">
            {record.histories.map((hh) => (
              <details key={hh.handNo} className="bg-surface group">
                <summary className="flex items-center justify-between gap-3 px-4 py-3 cursor-pointer list-none hover:bg-surface-2 transition-colors">
                  <span className="text-xs font-mono text-muted">#{hh.handNo}</span>
                  <span className="text-xs font-mono flex-1">{hh.heroHole}</span>
                  {comments[hh.handNo] && (
                    <ChatCircleText size={13} className="text-accent/70 shrink-0" />
                  )}
                  <span className="text-xs text-muted hidden sm:inline truncate max-w-[200px]">
                    {hh.board || '翻前结束'}
                  </span>
                  <span
                    className="text-xs font-mono"
                    style={{ color: hh.heroNet >= 0 ? 'var(--accent)' : 'var(--loss)' }}
                  >
                    {hh.heroNet >= 0 ? '+' : ''}
                    {(hh.heroNet / hh.bb).toFixed(1)}BB
                  </span>
                </summary>
                {hh.rabbit && (
                  <p className="px-4 pb-2 text-[11px] leading-relaxed">
                    <span className="text-accent">兔子洞:</span>{' '}
                    <span className="text-muted">公共牌会是</span>{' '}
                    <span className="font-mono">{hh.rabbit.fullBoard}</span>
                    <span className="text-muted">, 你会成 {hh.rabbit.heroHandName}, </span>
                    {hh.rabbit.heroWouldBeat ? (
                      <span className="text-accent">能赢过</span>
                    ) : (
                      <span className="text-muted">仍输给</span>
                    )}
                    <span className="text-muted">
                      {' '}
                      {hh.rabbit.winnerName} 的 {hh.rabbit.winnerHandName}
                    </span>
                  </p>
                )}
                {comments[hh.handNo] && (
                  <div className="px-4 pb-2">
                    <div className="rounded-xl border border-accent/20 bg-accent/[0.04] p-3">
                      <CoachNote note={comments[hh.handNo]} />
                    </div>
                  </div>
                )}
                <div className="px-4 pb-4 pt-1">
                  {hh.rawActions?.length ? (
                    <HandReplayer hh={hh} avatars={avatarByName} />
                  ) : (
                    <pre className="text-[11px] leading-relaxed text-muted whitespace-pre-wrap font-mono">
                      {handToText(hh, true)}
                    </pre>
                  )}
                </div>
              </details>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
