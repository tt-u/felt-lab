import Link from 'next/link';

// 品牌化 404: 替换 Next 默认页
export default function NotFound() {
  return (
    <main className="min-h-[100dvh] flex items-center justify-center px-4">
      <div className="glass rounded-3xl px-10 py-12 flex flex-col items-center gap-4 max-w-sm text-center">
        <span className="font-mono text-sm text-accent tracking-[0.4em]">FELT LAB</span>
        <p className="text-5xl font-semibold tracking-tighter">404</p>
        <p className="text-sm text-muted leading-relaxed">这张牌不在牌堆里。</p>
        <Link href="/" className="btn-primary px-8 py-3 text-sm mt-2">
          回到牌桌
        </Link>
      </div>
    </main>
  );
}
