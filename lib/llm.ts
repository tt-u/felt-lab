// LLM 调用层: 两种部署形态自动切换
// - 服务端形态(本地 dev / Vercel / 自托管): 走 /api/review 代理, key 只在服务器
// - 静态形态(GitHub Pages): 构建时注入 NEXT_PUBLIC_DEEPSEEK_API_KEY, 浏览器直连 DeepSeek
//   注意: 静态形态下 key 打进前端包, 对站点访客可见, 仅适合个人演示

const PUBLIC_KEY = process.env.NEXT_PUBLIC_DEEPSEEK_API_KEY;
const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';

export interface ChatRequest {
  system: string;
  user: string;
  json?: boolean;
  maxTokens?: number;
  signal?: AbortSignal;
}

function directBody(req: ChatRequest, stream: boolean) {
  return JSON.stringify({
    model: 'deepseek-chat',
    messages: [
      { role: 'system', content: req.system },
      { role: 'user', content: req.user },
    ],
    stream,
    temperature: 0.6,
    max_tokens: Math.min(Math.max(req.maxTokens ?? 4096, 16), 4096),
    ...(req.json ? { response_format: { type: 'json_object' } } : {}),
  });
}

// 非流式: 返回完整 content
export async function chatOnce(req: ChatRequest): Promise<string> {
  if (PUBLIC_KEY) {
    const res = await fetch(DEEPSEEK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${PUBLIC_KEY}` },
      body: directBody(req, false),
      signal: req.signal,
    });
    if (!res.ok) throw new Error(`DeepSeek 请求失败 (${res.status})`);
    const j = await res.json();
    return String(j?.choices?.[0]?.message?.content ?? '');
  }
  const res = await fetch('/api/review', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...req, stream: false }),
    signal: req.signal,
  });
  if (!res.ok) {
    const j = await res.json().catch(() => null);
    throw new Error(j?.error ?? `复盘服务请求失败 (${res.status})`);
  }
  const j = await res.json();
  return String(j?.content ?? '');
}

// 流式: 逐块回调, 返回累计文本
export async function chatStream(
  req: ChatRequest,
  onChunk: (acc: string) => void
): Promise<string> {
  if (PUBLIC_KEY) {
    const res = await fetch(DEEPSEEK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${PUBLIC_KEY}` },
      body: directBody(req, true),
      signal: req.signal,
    });
    if (!res.ok || !res.body) throw new Error(`DeepSeek 请求失败 (${res.status})`);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    let acc = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === '[DONE]') continue;
        try {
          const j = JSON.parse(payload);
          const delta: string | undefined = j?.choices?.[0]?.delta?.content;
          if (delta) {
            acc += delta;
            onChunk(acc);
          }
        } catch {
          // 跳过不完整分片
        }
      }
    }
    return acc;
  }
  const res = await fetch('/api/review', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...req }),
    signal: req.signal,
  });
  if (!res.ok || !res.body) {
    const j = await res.json().catch(() => null);
    throw new Error(j?.error ?? `复盘服务请求失败 (${res.status})`);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let acc = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    acc += dec.decode(value, { stream: true });
    onChunk(acc);
  }
  return acc;
}

// 静态资源前缀(GitHub Pages 子路径部署)
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
