// Cloudflare Pages Function — /api/chat
// 对应本机 server.mjs 的 /api/chat：代理 DeepSeek，Key 只在 Cloudflare 环境变量里。
// 隐私底线不变：不落盘、不打印正文，只把"最近几句"交给模型，回一句问话。

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}

export async function onRequestPost(context) {
  const env = context.env || {};
  const API_KEY = (env.DEEPSEEK_API_KEY || '').trim();
  const MODEL = (env.DEEPSEEK_MODEL || 'deepseek-chat').trim();
  const BASE_URL = (env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, '');

  if (!API_KEY) {
    return json(503, { ok: false, code: 'NO_KEY', error: '服务端还没配 DeepSeek Key' });
  }

  let body;
  try {
    body = await context.request.json();
  } catch {
    return json(400, { ok: false, code: 'BAD_JSON', error: '请求不是合法的 JSON' });
  }
  if (!body || !Array.isArray(body.messages) || !body.messages.length) {
    return json(400, { ok: false, code: 'BAD_MESSAGES', error: 'messages 必须是非空数组' });
  }

  const messages = body.messages
    .slice(0, 60)
    .map((m) => ({ role: m && m.role, content: String((m && m.content) || '') }))
    .filter((m) => (m.role === 'system' || m.role === 'user' || m.role === 'assistant') && m.content);
  if (!messages.length) {
    return json(400, { ok: false, code: 'BAD_MESSAGES', error: 'messages 内容为空' });
  }

  const payload = {
    model: MODEL,
    messages,
    temperature: typeof body.temperature === 'number' ? Math.min(Math.max(body.temperature, 0), 1.5) : 0.8,
    max_tokens: Math.min(Math.max(Number(body.max_tokens) || 700, 32), 3000),
    stream: false
  };

  try {
    const upstream = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify(payload)
    });
    const raw = await upstream.text();
    if (!upstream.ok) {
      const hint =
        upstream.status === 401 ? 'Key 不对或过期' :
        upstream.status === 402 ? '账户余额不够' :
        upstream.status === 429 ? '上游限流了，等一会儿' :
        upstream.status >= 500 ? '上游服务出错' : '上游拒绝了这次请求';
      return json(502, { ok: false, code: 'UPSTREAM', status: upstream.status, error: hint });
    }
    const parsed = JSON.parse(raw);
    const text = parsed && parsed.choices && parsed.choices[0] && parsed.choices[0].message && parsed.choices[0].message.content;
    if (typeof text !== 'string' || !text.trim()) {
      return json(502, { ok: false, code: 'UPSTREAM_EMPTY', error: '上游没给出内容' });
    }
    return json(200, { ok: true, text, usage: parsed.usage || null, model: parsed.model || MODEL });
  } catch {
    return json(502, { ok: false, code: 'NETWORK', error: '连不上对话服务' });
  }
}
