'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion, useReducedMotion } from 'motion/react';
import {
  ArrowRight,
  Eye,
  EyeSlash,
  Play,
  Sparkle,
  Strategy,
  UsersThree,
} from '@phosphor-icons/react';
import { useGame, loadSessionRecord, type OpponentConfig } from '@/lib/store';
import { BASE_PATH } from '@/lib/llm';
import { BOT_NAMES } from '@/lib/poker/personality';
import { PERSONALITIES, PERSONALITY_IDS, PERSONALITY_HUES } from '@/lib/poker/personality';

const TABLE_SIZES = [2, 6, 7, 8, 9] as const;
const STACK_OPTIONS = [50, 100, 200] as const;
export default function SetupPage() {
  const router = useRouter();
  const startSession = useGame((s) => s.startSession);
  const reduce = useReducedMotion();

  const [tableSize, setTableSize] = useState<number>(6);
  const [showPersonalities, setShowPersonalities] = useState(true);
  const [startingBB, setStartingBB] = useState<number>(100);
  const [lastSession, setLastSession] = useState<{
    hands: number;
    netBB: number;
    inProgress: boolean;
  } | null>(null);

  useEffect(() => {
    // 挂载后读取上次训练记录(浏览器存储)
    const rec = loadSessionRecord();
    if (rec?.histories.length || rec?.inProgress) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLastSession({
        hands: rec.histories.length,
        netBB: rec.histories.reduce((s, h) => s + h.heroNet / h.bb, 0),
        inProgress: !!rec.inProgress,
      });
    }
  }, []);

  const oppCount = tableSize - 1;

  // 对手风格全随机, 开局后(若选择显示)在座位上揭晓
  const opponents: OpponentConfig[] = useMemo(
    () =>
      Array.from({ length: oppCount }, (_, i) => ({
        name: BOT_NAMES[i],
        personality: 'random' as const,
      })),
    [oppCount]
  );

  function start() {
    startSession({
      tableSize,
      showPersonalities,
      liveCoach: true,
      startingBB,
      sb: 1,
      bb: 2,
      targetHands: null,
      opponents,
    });
    router.push('/table');
  }

  return (
    <main className="relative min-h-[100dvh] overflow-hidden">
      {/* HyperFrames 渲染的氛围视频背景: fixed 锁定视口, 不随内容高度变化 */}
      <div className="fixed inset-0" aria-hidden="true">
        {!reduce && (
          <video
            autoPlay
            muted
            playsInline
            poster={`${BASE_PATH}/hero-poster.jpg`}
            className="w-full h-full object-cover"
          >
            <source src={`${BASE_PATH}/hero.mp4`} type="video/mp4" />
          </video>
        )}
        {reduce && (
          <div
            className="w-full h-full bg-cover bg-center"
            style={{ backgroundImage: `url(${BASE_PATH}/hero-poster.jpg)` }}
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-r from-background via-background/80 to-background/45" />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-background/40" />
      </div>

      <div className="relative z-10 max-w-[1240px] mx-auto px-4 sm:px-8 py-10 lg:py-0 lg:min-h-[100dvh] grid grid-cols-1 lg:grid-cols-[1fr_450px] gap-10 lg:gap-20 items-start lg:items-center">
        {/* 左: 品牌与说明 */}
        <motion.section
          initial={reduce ? false : { opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="flex items-center gap-3">
            <span className="h-px w-8 bg-[#cdaa6d]/60" />
            <span className="text-accent text-sm font-mono tracking-[0.45em]">FELT LAB</span>
          </div>
          <h1 className="mt-5 text-5xl md:text-7xl font-semibold tracking-tighter leading-[0.95]">
            翻牌屋
          </h1>
          <p className="mt-6 text-lg text-muted leading-relaxed max-w-[40ch]">
            和会算范围的对手过招。每一手都被实时拆解, 打完整局还有行为模式复盘。
          </p>

          {/* 六种对手风格预览 */}
          <div className="mt-7 flex flex-wrap gap-1.5 max-w-[44ch]">
            {PERSONALITY_IDS.map((id) => (
              <span
                key={id}
                className="text-[11px] px-2.5 py-1 rounded-full border font-medium"
                style={{
                  color: `hsl(${PERSONALITY_HUES[id]} 60% 68%)`,
                  borderColor: `hsl(${PERSONALITY_HUES[id]} 50% 50% / 0.45)`,
                }}
                title={PERSONALITIES[id].descZh}
              >
                {PERSONALITIES[id].nameZh}
              </span>
            ))}
          </div>

          {/* 上次训练入口: 未打完的优先提供"继续" */}
          {lastSession?.inProgress ? (
            <Link
              href="/table"
              className="mt-5 inline-flex items-center gap-2 text-xs px-3.5 py-2 rounded-full glass text-accent border border-accent/30 hover:border-accent transition-colors"
            >
              有一局未打完: 已打 {lastSession.hands} 手,{' '}
              <span className="font-mono">
                {lastSession.netBB >= 0 ? '+' : ''}
                {lastSession.netBB.toFixed(1)}BB
              </span>
              · 继续训练 <ArrowRight size={12} />
            </Link>
          ) : lastSession ? (
            <Link
              href="/review"
              className="mt-5 inline-flex items-center gap-2 text-xs px-3.5 py-2 rounded-full glass text-muted hover:text-accent transition-colors"
            >
              上次训练: {lastSession.hands} 手,{' '}
              <span
                className="font-mono"
                style={{
                  color: lastSession.netBB >= 0 ? 'var(--accent)' : 'var(--loss)',
                }}
              >
                {lastSession.netBB >= 0 ? '+' : ''}
                {lastSession.netBB.toFixed(1)}BB
              </span>
              · 查看复盘 <ArrowRight size={12} />
            </Link>
          ) : null}

          <ul className="mt-9 space-y-5 text-sm max-w-[46ch]">
            <li className="flex gap-3.5">
              <span className="glass w-9 h-9 rounded-xl flex items-center justify-center shrink-0">
                <Strategy size={17} className="text-accent" />
              </span>
              <span className="text-muted leading-relaxed">
                标准范围表 + 范围对范围引擎驱动的 GTO 近似对手, 可叠加紧弱、松凶、跟注站等性格供你剥削。
              </span>
            </li>
            <li className="flex gap-3.5">
              <span className="glass w-9 h-9 rounded-xl flex items-center justify-center shrink-0">
                <UsersThree size={17} className="text-accent" />
              </span>
              <span className="text-muted leading-relaxed">
                单挑到 9 人满员桌, 位置、盲注、边池全按规则; 单挑与多人桌使用不同的均衡范围。
              </span>
            </li>
            <li className="flex gap-3.5">
              <span className="glass w-9 h-9 rounded-xl flex items-center justify-center shrink-0">
                <Sparkle size={17} className="text-accent" />
              </span>
              <span className="text-muted leading-relaxed">
                每手实时拆解决策点(对手范围 / 胜率 / 教练建议), 弃牌后兔子洞看反事实,
                整局结束生成行为模式复盘, 任意一手可渲染回放视频。
              </span>
            </li>
          </ul>
        </motion.section>

        {/* 右: 设置面板 */}
        <motion.section
          initial={reduce ? false : { opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
          className="glass rounded-3xl p-6 sm:p-7 space-y-6"
          style={{ backgroundColor: 'rgb(12 16 20 / 0.82)' }}
        >
          <div>
            <div className="text-sm font-medium mb-2.5">桌型</div>
            <div className="flex gap-1.5 flex-wrap">
              {TABLE_SIZES.map((n) => (
                <button
                  key={n}
                  data-on={tableSize === n}
                  onClick={() => setTableSize(n)}
                  className="seg px-4 py-2 text-sm"
                >
                  {n === 2 ? '单挑' : `${n} 人`}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div>
              <div className="text-sm font-medium mb-2.5">风格可见性</div>
              <div className="flex gap-1.5">
                <button
                  data-on={showPersonalities}
                  onClick={() => setShowPersonalities(true)}
                  className="seg flex items-center gap-1.5 px-3.5 py-2 text-sm"
                >
                  <Eye size={15} /> 显示
                </button>
                <button
                  data-on={!showPersonalities}
                  onClick={() => setShowPersonalities(false)}
                  className="seg flex items-center gap-1.5 px-3.5 py-2 text-sm"
                >
                  <EyeSlash size={15} /> 隐藏
                </button>
              </div>
            </div>
            <div>
              <div className="text-sm font-medium mb-2.5">起始筹码</div>
              <div className="flex gap-1.5">
                {STACK_OPTIONS.map((s) => (
                  <button
                    key={s}
                    data-on={startingBB === s}
                    onClick={() => setStartingBB(s)}
                    className="seg px-3 py-1.5 text-xs font-mono"
                  >
                    {s}BB
                  </button>
                ))}
              </div>
            </div>
          </div>
          <p className="text-xs text-muted leading-relaxed -mt-2">
            {showPersonalities
              ? '座位上会标出对手风格, 适合练针对性调整。'
              : '盲打模式: 自己读对手牌风, 复盘时揭晓。'}
            随时点「结束并复盘」收官。
          </p>

          <div className="pt-3 border-t border-white/10">
            <p className="text-xs text-muted mb-4">盲注 1/2 · 现金桌规则, 对手破产自动补码</p>
            <button onClick={start} className="btn-primary w-full flex items-center justify-center gap-2 py-3.5 text-[15px]">
              <Play size={18} weight="fill" />
              开始训练
            </button>
          </div>
        </motion.section>
      </div>
    </main>
  );
}
