import { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 120;

const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';

interface ReviewRequest {
  system: string;
  user: string;
  // 默认流式; 单手即时点评等短请求用非流式
  stream?: boolean;
  // 让模型输出 JSON 对象(结构化复盘)
  json?: boolean;
  maxTokens?: number;
}

function bad(status: number, message: string) {
  return Response.json({ error: message }, { status });
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return bad(500, '服务端未配置 DEEPSEEK_API_KEY, 请在 .env.local 中设置后重启服务');
  }

  let body: ReviewRequest;
  try {
    body = (await req.json()) as ReviewRequest;
  } catch {
    return bad(400, '请求体不是合法 JSON');
  }
  if (typeof body.system !== 'string' || typeof body.user !== 'string' || !body.user.trim()) {
    return bad(400, '缺少复盘内容');
  }
  // 防御性长度上限, 避免异常负载
  const system = body.system.slice(0, 8_000);
  const user = body.user.slice(0, 60_000);
  const stream = body.stream !== false;
  const maxTokens = Math.min(Math.max(Math.floor(body.maxTokens ?? 4096), 16), 4096);

  let upstream: Response;
  try {
    upstream = await fetch(DEEPSEEK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        stream,
        temperature: 0.6,
        max_tokens: maxTokens,
        ...(body.json ? { response_format: { type: 'json_object' } } : {}),
      }),
      signal: req.signal,
    });
  } catch {
    return bad(502, '无法连接 DeepSeek 服务, 请检查网络后重试');
  }

  if (!upstream.ok || !upstream.body) {
    let detail = '';
    try {
      const j = await upstream.json();
      detail = j?.error?.message ?? '';
    } catch {
      // 忽略解析失败
    }
    if (upstream.status === 401) return bad(502, 'DeepSeek API Key 无效或已过期');
    if (upstream.status === 402) return bad(502, 'DeepSeek 账户余额不足');
    if (upstream.status === 429) return bad(502, 'DeepSeek 请求过于频繁, 请稍后重试');
    return bad(502, `DeepSeek 服务错误 (${upstream.status})${detail ? `: ${detail}` : ''}`);
  }

  // 非流式: 直接返回完整内容
  if (!stream) {
    try {
      const j = await upstream.json();
      const content: string = j?.choices?.[0]?.message?.content ?? '';
      return Response.json({ content });
    } catch {
      return bad(502, 'DeepSeek 返回内容解析失败');
    }
  }

  // SSE -> 纯文本流
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const reader = upstream.body.getReader();

  const textStream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let buf = '';
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() ?? '';
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            const payload = trimmed.slice(5).trim();
            if (payload === '[DONE]') continue;
            try {
              const json = JSON.parse(payload);
              const delta: string | undefined = json?.choices?.[0]?.delta?.content;
              if (delta) controller.enqueue(encoder.encode(delta));
            } catch {
              // 跳过不完整的分片
            }
          }
        }
        controller.close();
      } catch {
        controller.error(new Error('流式传输中断'));
      }
    },
    cancel() {
      reader.cancel().catch(() => {});
    },
  });

  return new Response(textStream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}
