'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion, AnimatePresence } from 'motion/react';
import {
  ChartLine,
  List,
  Pause,
  Play,
  SpeakerHigh,
  SpeakerSlash,
  X,
} from '@phosphor-icons/react';
import { useGame } from '@/lib/store';
import { isMuted, setMuted } from '@/lib/sound';
import { PokerTable } from '@/components/PokerTable';
import { ActionBar } from '@/components/ActionBar';
import { SidePanel } from '@/components/SidePanel';
import { RabbitHole } from '@/components/RabbitHole';

export default function TablePage() {
  const router = useRouter();
  const config = useGame((s) => s.config);
  const hand = useGame((s) => s.hand);
  const phase = useGame((s) => s.phase);
  const histories = useGame((s) => s.histories);
  const seats = useGame((s) => s.seats);
  const equities = useGame((s) => s.equities);
  const heroRead = useGame((s) => s.heroRead);
  const banner = useGame((s) => s.banner);
  const rabbit = useGame((s) => s.rabbit);
  const heroAct = useGame((s) => s.heroAct);
  const nextHand = useGame((s) => s.nextHand);
  const endSession = useGame((s) => s.endSession);
  const holdAutoNext = useGame((s) => s.holdAutoNext);
  const paused = useGame((s) => s.paused);
  const pause = useGame((s) => s.pause);
  const resume = useGame((s) => s.resume);
  // version 驱动重渲染(引擎对象原地变更)
  useGame((s) => s.version);

  const [showLog, setShowLog] = useState(false);
  const [muted, setMutedState] = useState(false);

  useEffect(() => {
    // 客户端挂载后同步静音状态
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMutedState(isMuted());
  }, []);

  // 没有内存会话时先尝试从存档还原(刷新恢复), 失败才回设置页
  useEffect(() => {
    if (!config && !useGame.getState().restore()) router.replace('/');
  }, [config, router]);

  // 会话结束跳转复盘
  useEffect(() => {
    if (phase === 'over') router.replace('/review');
  }, [phase, router]);

  const netBB = useMemo(
    () => histories.reduce((s, h) => s + h.heroNet / h.bb, 0),
    [histories]
  );

  const avatars = useMemo(
    () => Object.fromEntries(seats.map((s) => [s.id, s.avatarId])),
    [seats]
  );

  if (!config || !hand) {
    return (
      <main className="min-h-[100dvh] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <span className="w-2 h-2 rounded-full bg-accent animate-ping" />
          <span className="font-mono text-xs text-accent tracking-[0.4em]">FELT LAB</span>
          <span className="text-sm text-muted">正在开桌…</span>
        </div>
      </main>
    );
  }

  function handleEnd() {
    const midHand = phase === 'playing' && !hand?.result;
    if (midHand && histories.length === 0) {
      router.push('/');
      useGame.getState().reset();
      return;
    }
    if (midHand && !window.confirm('当前这手牌还没打完, 直接结束并进入复盘吗?')) return;
    endSession();
    router.push('/review');
  }

  function toggleMute() {
    const next = !muted;
    setMuted(next);
    setMutedState(next);
  }

  return (
    // 锁定一屏高度: 页面不滚动, 右侧面板内部独立滚动
    <main className="h-[100dvh] flex flex-col overflow-hidden">
      {/* 顶栏: 窄屏防换行 */}
      <header className="h-12 sm:h-14 shrink-0 glass !border-x-0 !border-t-0 rounded-none flex items-center justify-between gap-2 px-3 sm:px-6 z-20">
        <div className="flex items-center gap-2 sm:gap-4 min-w-0">
          <Link
            href="/"
            className="font-mono text-[11px] sm:text-sm text-accent tracking-[0.18em] sm:tracking-[0.3em] whitespace-nowrap"
          >
            FELT LAB
          </Link>
          <span className="text-xs text-muted font-mono hidden md:inline whitespace-nowrap">
            盲注 {config.sb}/{config.bb}
          </span>
        </div>
        <div className="flex items-center gap-2 sm:gap-4 shrink-0">
          <span className="text-[11px] sm:text-xs font-mono text-muted whitespace-nowrap">
            第 {hand.handNo} 手{config.targetHands ? `/${config.targetHands}` : ''}
          </span>
          <span
            className="text-[11px] sm:text-xs font-mono whitespace-nowrap"
            style={{ color: netBB >= 0 ? 'var(--accent)' : 'var(--loss)' }}
          >
            {netBB >= 0 ? '+' : ''}
            {netBB.toFixed(1)}BB
          </span>
          <button
            onClick={() => (paused ? resume() : pause())}
            className="p-1.5 rounded-full border border-line text-muted hover:text-accent hover:border-accent transition-colors"
            aria-label={paused ? '继续' : '暂停'}
          >
            {paused ? <Play size={14} /> : <Pause size={14} />}
          </button>
          <button
            onClick={toggleMute}
            className="p-1.5 rounded-full border border-line text-muted hover:text-foreground transition-colors"
            aria-label={muted ? '开启音效' : '静音'}
          >
            {muted ? <SpeakerSlash size={14} /> : <SpeakerHigh size={14} />}
          </button>
          <button
            onClick={() => setShowLog((v) => !v)}
            className="lg:hidden p-1.5 rounded-full border border-line text-muted hover:text-foreground"
            aria-label="复盘与玩家面板"
          >
            {showLog ? <X size={15} /> : <List size={15} />}
          </button>
          <button
            onClick={handleEnd}
            className="flex items-center gap-1.5 text-xs px-2.5 sm:px-3.5 py-1.5 rounded-full border border-line text-muted hover:border-accent hover:text-accent transition-colors whitespace-nowrap"
          >
            <ChartLine size={14} />
            <span className="hidden sm:inline">结束并复盘</span>
            <span className="sm:hidden">复盘</span>
          </button>
        </div>
      </header>

      {/* 桌面区 */}
      <div className="flex-1 flex min-h-0">
        <motion.div
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="flex-1 flex flex-col justify-center px-2 sm:px-6 py-3 min-h-0 min-w-0 overflow-hidden"
        >
          <PokerTable
            hand={hand}
            showPersonalities={config.showPersonalities}
            equities={equities}
            avatars={avatars}
          />
          {/* 固定高度槽位: 出现/消失不会推动页面 */}
          <div className="h-12 mt-1 flex items-center justify-center gap-3">
            {phase === 'handEnd' && (
              <>
                {rabbit && <RabbitHole rabbit={rabbit} onReveal={holdAutoNext} />}
                <button
                  onClick={nextHand}
                  className="text-xs px-4 py-1.5 rounded-full bg-surface-2 border border-line text-muted hover:text-accent hover:border-accent transition-colors"
                >
                  下一手
                </button>
              </>
            )}
          </div>
        </motion.div>

        {/* 右侧统一面板: 复盘 / 玩家 / 记录(内部独立滚动) */}
        <aside className="hidden lg:block w-80 shrink-0 p-4 pl-0 min-h-0">
          <SidePanel />
        </aside>

        {/* 移动端浮层: 实色遮罩压住牌桌, 点遮罩关闭 */}
        {showLog && (
          <div className="lg:hidden fixed inset-0 z-30">
            <div
              className="absolute inset-0 bg-background/90 backdrop-blur-sm"
              onClick={() => setShowLog(false)}
              aria-hidden="true"
            />
            <div className="absolute inset-x-3 top-14 bottom-3">
              <SidePanel />
            </div>
          </div>
        )}
      </div>

      {/* 高光时刻横幅: 只动画 transform/opacity(合成器处理), 滤镜动画会逐帧重算导致掉帧 */}
      <AnimatePresence>
        {banner && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 1.05 }}
            transition={{ type: 'spring', stiffness: 220, damping: 18 }}
            className="fixed inset-x-0 top-[30%] z-40 flex flex-col items-center pointer-events-none will-change-transform"
          >
            <div
              className={`text-4xl sm:text-5xl font-bold tracking-tight [text-shadow:0_4px_30px_rgb(0_0_0/0.6)] ${
                banner.kind === 'badbeat' ? 'text-[var(--loss)]' : 'text-accent'
              }`}
            >
              {banner.title}
            </div>
            <div className="mt-2 text-sm text-foreground/80">{banner.sub}</div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 暂停遮罩: 定时器已清空, 进度已存档 */}
      <AnimatePresence>
        {paused && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[45] flex items-center justify-center bg-background/85 backdrop-blur-sm"
          >
            <div className="glass rounded-3xl px-10 py-10 flex flex-col items-center gap-4 text-center">
              <span className="font-mono text-xs text-accent tracking-[0.4em]">FELT LAB</span>
              <p className="text-lg font-medium">已暂停</p>
              <p className="text-xs text-muted">进度已保存, 刷新或关闭后回来都能继续</p>
              <button onClick={resume} className="btn-primary px-8 py-3 text-sm mt-2 flex items-center gap-2">
                <Play size={15} weight="fill" />
                继续训练
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 操作区 */}
      <footer className="shrink-0 glass !border-x-0 !border-b-0 rounded-none">
        <ActionBar hand={hand} onAction={heroAct} heroRead={heroRead} />
      </footer>
    </main>
  );
}
