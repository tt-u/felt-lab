'use client';

import { useEffect, useState } from 'react';
import { CaretDown, CaretUp, Crown } from '@phosphor-icons/react';
import { useGame } from '@/lib/store';
import { computeOpponentImages, computeHeroStats } from '@/lib/poker/history';
import { PERSONALITIES } from '@/lib/poker/personality';
import { ActionLog } from './ActionLog';
import { CoachNote } from './CoachNote';
import { DecisionReview } from './DecisionReview';
import { Avatar } from './Avatar';

type Tab = 'review' | 'players' | 'log';

// 右侧统一面板: 复盘 / 玩家看板与排行 / 行动记录
export function SidePanel() {
  const config = useGame((s) => s.config);
  const hand = useGame((s) => s.hand);
  const phase = useGame((s) => s.phase);
  const seats = useGame((s) => s.seats);
  const histories = useGame((s) => s.histories);
  const handComments = useGame((s) => s.handComments);
  const rabbit = useGame((s) => s.rabbit);
  const holdAutoNext = useGame((s) => s.holdAutoNext);
  useGame((s) => s.version);

  const [tab, setTab] = useState<Tab>('players');
  const [coachOpen, setCoachOpen] = useState(false);

  // 手牌结束自动切到复盘页
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (phase === 'handEnd') setTab('review');
  }, [phase]);

  if (!config || !hand) return null;

  const lastHand = histories.length ? histories[histories.length - 1] : null;
  const lastNote = lastHand ? handComments[lastHand.handNo] : undefined;
  const bb = config.bb;

  // 局内排行: 净盈亏 = 当前后手 - 总买入
  const buyin = config.startingBB * bb;
  const board = [...seats]
    .map((s) => ({
      ...s,
      net: s.stack - buyin * (1 + s.rebuys),
    }))
    .sort((a, b) => b.net - a.net);

  const images = computeOpponentImages(histories);
  const heroStats = histories.length ? computeHeroStats(histories) : null;

  const TABS: { key: Tab; label: string }[] = [
    { key: 'review', label: '复盘' },
    { key: 'players', label: '玩家' },
    { key: 'log', label: '记录' },
  ];

  return (
    <div
      className="h-full flex flex-col glass rounded-2xl overflow-hidden"
      onMouseEnter={phase === 'handEnd' ? holdAutoNext : undefined}
    >
      {/* 标签栏 */}
      <div className="flex shrink-0 border-b border-line/60">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 py-2.5 text-xs transition-colors ${
              tab === t.key
                ? 'text-accent border-b-2 border-accent font-medium'
                : 'text-muted hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-3">
        {/* 复盘 */}
        {tab === 'review' && (
          <div className="space-y-2.5">
            {!lastHand && <p className="text-[11px] text-muted">第一手结束后这里会出现逐决策复盘。</p>}
            {lastHand && (
              <>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-accent font-medium">第 {lastHand.handNo} 手</span>
                  <span
                    className="font-mono"
                    style={{
                      color: lastHand.heroNet >= 0 ? 'var(--accent)' : 'var(--loss)',
                    }}
                  >
                    {lastHand.heroNet >= 0 ? '+' : ''}
                    {(lastHand.heroNet / lastHand.bb).toFixed(1)}BB
                  </span>
                </div>
                {lastHand.decisions?.length ? (
                  <DecisionReview decisions={lastHand.decisions} />
                ) : (
                  <p className="text-[11px] text-muted">这手没有轮到你的决策点。</p>
                )}
                {rabbit && phase === 'handEnd' && (
                  <p className="text-[11px] text-muted leading-relaxed">
                    桌面中央有 <span className="text-accent">兔子洞</span> 可看「如果跟到底会怎样」。
                  </p>
                )}
                {lastHand.rabbit && phase !== 'handEnd' && (
                  <p className="text-[11px] leading-relaxed">
                    <span className="text-accent">兔子洞:</span>{' '}
                    <span className="text-muted">
                      公共牌会是 {lastHand.rabbit.fullBoard}, 你会成 {lastHand.rabbit.heroHandName},{' '}
                      {lastHand.rabbit.heroWouldBeat ? '本来能赢' : '弃得对'}
                    </span>
                  </p>
                )}
                {lastNote !== undefined && (
                  <div className="pt-2 border-t border-line/60">
                    <button
                      onClick={() => setCoachOpen((v) => !v)}
                      className="w-full flex items-center gap-1.5 text-[11px] text-muted hover:text-accent transition-colors"
                    >
                      AI 教练详评
                      {coachOpen ? <CaretDown size={11} /> : <CaretUp size={11} />}
                    </button>
                    {coachOpen && (
                      <div className="mt-2">
                        <CoachNote note={lastNote} />
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* 玩家: 排行榜 + 人物看板 */}
        {tab === 'players' && (
          <div className="space-y-3">
            <div>
              <div className="text-[11px] text-muted font-medium mb-1.5">局内排行</div>
              <div className="space-y-1">
                {board.map((s, i) => (
                  <div
                    key={s.id}
                    className={`flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-xs ${
                      s.isHero ? 'bg-accent/10 border border-accent/30' : 'bg-background/30'
                    } ${s.out ? 'opacity-55' : ''}`}
                  >
                    <span className="font-mono text-muted w-4">
                      {i === 0 ? <Crown size={13} weight="fill" className="text-[#cdaa6d]" /> : i + 1}
                    </span>
                    <Avatar name={s.name} avatarId={s.avatarId} isHero={s.isHero} size={18} />
                    <span className={`truncate ${s.isHero ? 'font-medium' : ''}`}>
                      {s.name}
                      {s.isHero ? ' (你)' : ''}
                    </span>
                    {s.out && (
                      <span className="text-[9px] px-1.5 py-px rounded-full border border-line text-muted/70 shrink-0">
                        已下桌
                      </span>
                    )}
                    <span
                      className="ml-auto font-mono"
                      style={{ color: s.net >= 0 ? 'var(--accent)' : 'var(--loss)' }}
                    >
                      {s.net >= 0 ? '+' : ''}
                      {(s.net / bb).toFixed(1)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div className="text-[11px] text-muted font-medium mb-1.5">人物看板</div>
              <div className="space-y-2">
                {/* 英雄自己的数据 */}
                {heroStats && (
                  <div className="rounded-xl bg-background/30 border border-accent/25 p-2.5">
                    <div className="flex items-center gap-1.5 text-xs font-medium mb-1">
                      <Avatar name="你" isHero size={20} />
                      你
                      <span className="ml-auto font-mono text-[10px] text-muted">
                        后手 {((seats.find((s) => s.isHero)?.stack ?? 0) / bb).toFixed(0)}BB
                      </span>
                    </div>
                    <div className="text-[10px] font-mono text-muted">
                      入池 {heroStats.vpip.toFixed(0)}% · 翻前加注 {heroStats.pfr.toFixed(0)}% ·
                      翻后进攻 {heroStats.afq.toFixed(0)}%
                    </div>
                  </div>
                )}
                {seats
                  .filter((s) => !s.isHero)
                  .map((s) => {
                    const img = images.find((x) => x.name === s.name);
                    const prof = s.personality ? PERSONALITIES[s.personality] : null;
                    return (
                      <div key={s.id} className="rounded-xl bg-background/30 border border-line p-2.5">
                        <div className="flex items-center gap-1.5 text-xs font-medium mb-1">
                          <Avatar name={s.name} avatarId={s.avatarId} size={20} />
                          {s.name}
                          {config.showPersonalities && prof ? (
                            <span className="text-[9px] px-1.5 py-px rounded-full border border-line text-muted">
                              {prof.tagZh}
                            </span>
                          ) : (
                            <span className="text-[9px] px-1.5 py-px rounded-full border border-line text-muted/60">
                              风格隐藏
                            </span>
                          )}
                          <span className="ml-auto font-mono text-[10px] text-muted">
                            {s.out ? '已下桌' : `后手 ${(s.stack / bb).toFixed(0)}BB`}
                          </span>
                        </div>
                        {img && img.hands > 0 ? (
                          <>
                            <div className="text-[10px] font-mono text-muted">
                              入池 {img.vpip.toFixed(0)}% · 翻前主动 {img.pfr.toFixed(0)}% · 翻后进攻{' '}
                              {img.afq.toFixed(0)}%
                            </div>
                            {img.recentShowdowns.length > 0 && (
                              <div className="text-[10px] text-muted/80 mt-0.5">
                                {img.recentShowdowns[img.recentShowdowns.length - 1]}
                              </div>
                            )}
                          </>
                        ) : (
                          <div className="text-[10px] text-muted/60">暂无观察数据</div>
                        )}
                        {s.rebuys > 0 && (
                          <div className="text-[10px] text-muted/60 mt-0.5">已补码 {s.rebuys} 次</div>
                        )}
                      </div>
                    );
                  })}
              </div>
            </div>
          </div>
        )}

        {/* 记录 */}
        {tab === 'log' && (
          <div className="h-full -m-3">
            <ActionLog hand={hand} embedded />
          </div>
        )}
      </div>
    </div>
  );
}
