// deepseek.mjs — DeepSeek 上游调用的唯一入口（/api/chat 与 /api/v1/* 共用）。
// Key 只在这里用（服务端），不下发。不打印请求正文。

export async function chatCompletions({ baseUrl, apiKey, model, messages, temperature, maxTokens, timeoutMs = 90_000 }) {
  const payload = {
    model,
    messages,
    temperature: typeof temperature === 'number' ? Math.min(Math.max(temperature, 0), 1.5) : 0.8,
    max_tokens: Math.min(Math.max(Number(maxTokens) || 700, 32), 3000),
    stream: false
  };

  const started = Date.now();
  const upstream = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs)
  });

  const raw = await upstream.text();
  if (!upstream.ok) {
    const hint =
      upstream.status === 401 ? 'Key 不对或者过期了' :
      upstream.status === 402 ? '账户余额不够了' :
      upstream.status === 429 ? '上游限流了，等一会儿' :
      upstream.status >= 500 ? '上游服务出错了' : '上游拒绝了这次请求';
    const err = new Error(hint);
    err.code = 'UPSTREAM';
    err.status = upstream.status;
    err.ms = Date.now() - started;
    throw err;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const err = new Error('上游返回的不是 JSON');
    err.code = 'UPSTREAM_BAD_JSON';
    err.status = 502;
    err.ms = Date.now() - started;
    throw err;
  }

  const text = parsed?.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || !text.trim()) {
    const err = new Error('上游没给出内容');
    err.code = 'UPSTREAM_EMPTY';
    err.status = 502;
    err.ms = Date.now() - started;
    throw err;
  }

  return {
    text,
    usage: parsed.usage || null,
    model: parsed.model || model,
    ms: Date.now() - started
  };
}
