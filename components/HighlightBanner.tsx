'use client';

import { motion } from 'motion/react';
import type { Banner } from '@/lib/drama';

// 高光横幅: 光晕 / 题签 / 饰线 / 渐变标题 / 扫光 / 副标胶囊 分层登场。
// 性能约束: 只动画 transform 与 opacity(合成器处理), 严禁动画 filter —
// 旧版动画 blur+drop-shadow 在结算瞬间叠加收池动画导致掉帧(用户报"屏幕卡住")。
// 玻璃高光不用 text-shadow + bg-clip-text(WebKit 下阴影会盖住渐变填充), 光感全靠底层光晕。

const KICKER: Record<Banner['kind'], string> = {
  badbeat: '残酷一手',
  herocall: '神级读牌',
  bluffwin: '心理战',
  monster: '大丰收',
  cooler: '冤家牌',
};

export function HighlightBanner({ banner }: { banner: Banner }) {
  const main = banner.kind === 'badbeat' ? 'var(--loss)' : 'var(--accent)';
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 1.04 }}
      transition={{ duration: 0.25 }}
      className="fixed inset-x-0 top-[26%] z-40 flex flex-col items-center pointer-events-none will-change-transform"
    >
      {/* 椭圆光晕: 从桌面中央亮起 */}
      <motion.div
        aria-hidden
        className="absolute -inset-y-20 inset-x-0"
        style={{
          background: `radial-gradient(ellipse 480px 180px at 50% 52%, color-mix(in srgb, ${main} 24%, transparent), transparent 72%)`,
        }}
        initial={{ opacity: 0, scale: 0.7 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.55, ease: 'easeOut' }}
      />
      {/* 题签 */}
      <motion.div
        className="font-mono text-[11px] tracking-[0.5em] mb-3 pl-[0.5em]"
        style={{ color: main }}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1, duration: 0.35 }}
      >
        ◆ {KICKER[banner.kind]} ◆
      </motion.div>
      {/* 饰线 + 标题 + 扫光 */}
      <div className="flex items-center gap-5">
        <motion.span
          aria-hidden
          className="h-px w-14 sm:w-24 origin-right"
          style={{ background: `linear-gradient(to left, ${main}, transparent)` }}
          initial={{ scaleX: 0, opacity: 0 }}
          animate={{ scaleX: 1, opacity: 1 }}
          transition={{ delay: 0.18, duration: 0.45, ease: 'easeOut' }}
        />
        <div className="relative overflow-hidden px-2 py-1">
          <motion.h2
            className="text-4xl sm:text-6xl font-bold tracking-tight text-transparent bg-clip-text"
            style={{
              backgroundImage: `linear-gradient(to bottom, #ffffff 18%, color-mix(in srgb, ${main} 72%, white) 58%, ${main} 96%)`,
            }}
            initial={{ opacity: 0, scale: 0.82, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 240, damping: 16, delay: 0.05 }}
          >
            {banner.title}
          </motion.h2>
          {/* 扫光: 斜切高光条横扫一次 */}
          <motion.span
            aria-hidden
            className="absolute inset-y-0 left-0 w-1/3 -skew-x-12"
            style={{
              background:
                'linear-gradient(to right, transparent, rgba(255,255,255,0.32), transparent)',
            }}
            initial={{ x: '-180%' }}
            animate={{ x: '380%' }}
            transition={{ delay: 0.55, duration: 0.85, ease: 'easeInOut' }}
          />
        </div>
        <motion.span
          aria-hidden
          className="h-px w-14 sm:w-24 origin-left"
          style={{ background: `linear-gradient(to right, ${main}, transparent)` }}
          initial={{ scaleX: 0, opacity: 0 }}
          animate={{ scaleX: 1, opacity: 1 }}
          transition={{ delay: 0.18, duration: 0.45, ease: 'easeOut' }}
        />
      </div>
      {/* 副标胶囊 */}
      <motion.div
        className="mt-3.5 glass rounded-full px-4 py-1.5 text-sm text-foreground/85"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.32, duration: 0.35 }}
      >
        {banner.sub}
      </motion.div>
    </motion.div>
  );
}
