'use client';

import { BASE_PATH } from '@/lib/llm';

// BitmapPunks 像素头像: 从预生成的随机头像池(24个)按 avatarId 取用,
// 每局开桌随机分配, 与名字不绑定。英雄固定 hero.svg。

const FALLBACK_HUES = [158, 200, 26, 280, 340, 95, 215, 45];
function hueOf(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return FALLBACK_HUES[h % FALLBACK_HUES.length];
}

export const AVATAR_POOL_SIZE = 24;

export function Avatar({
  name,
  avatarId,
  isHero = false,
  size = 20,
}: {
  name: string;
  avatarId?: number | null;
  isHero?: boolean;
  size?: number;
}) {
  const file = isHero
    ? 'hero'
    : typeof avatarId === 'number' && avatarId >= 0
      ? `p${avatarId % AVATAR_POOL_SIZE}`
      : null;
  if (file) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`${BASE_PATH}/avatars/${file}.svg`}
        width={size}
        height={size}
        alt={name}
        className="rounded-[5px] shrink-0 [image-rendering:pixelated] ring-1 ring-white/20 shadow-[0_2px_6px_rgb(0_0_0/0.4)]"
      />
    );
  }
  return (
    <span
      className="rounded-[5px] shrink-0 flex items-center justify-center font-bold text-black/75"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.45,
        background: `linear-gradient(180deg, hsl(${hueOf(name)} 55% 72%), hsl(${hueOf(name)} 45% 52%))`,
      }}
    >
      {name.slice(0, 1)}
    </span>
  );
}
