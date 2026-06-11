import type { NextConfig } from "next";

// STATIC_EXPORT=1 时输出纯静态站点(GitHub Pages):
// - basePath 指向仓库子路径
// - 服务端 API 路由在 CI 中被移除, DeepSeek 调用走浏览器直连(见 lib/llm.ts)
const isStatic = process.env.STATIC_EXPORT === "1";

const nextConfig: NextConfig = {
  ...(isStatic
    ? {
        output: "export" as const,
        basePath: process.env.NEXT_PUBLIC_BASE_PATH || "/felt-lab",
        images: { unoptimized: true },
      }
    : {}),
};

export default nextConfig;
