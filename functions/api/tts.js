// Cloudflare Pages Function — /api/tts（反向代理到阿里云 ECS 的讯飞 TTS）
//
// 为什么是代理而不是 Cloudflare 自己合成：
//   · Cloudflare Pages(Bundled) 对出站 WebSocket 长连接 ~50ms CPU 就被强断，讯飞的
//     wss 流式合成拿不全；豆包大模型 HTTP 流式又被 workerd 拒（返回 data:null），
//     大流读取还会让 Worker 崩（网关兜底 502）。所以 Cloudflare 只当一个轻量反代：
//     把浏览器的 POST /api/tts 原样转发给阿里云 8.137.13.183:8788，把音频字节回传。
//
// 接口：POST https://<pages域名>/api/tts
//   body:  { text, dialect?, rate? }
//   返回：audio/wav（讯飞返回的是 WAVE/PCM，不是 mp3）或 502 { ok:false, code, error }
//
// 护门：token（RSZ_TTS_TOKEN）放在 Cloudflare 环境变量里，绝不下发浏览器。
//       Worker 转发时替浏览器补一个 x-tts-token header，服务器校验通过才合成。

// 上游后端地址。云端配置 RSZ_TTS_UPSTREAM 环境变量可覆盖（便于换固定隧道域名）；
// 未配置时默认用已验证的 cloudflared 快速隧道（同一 Cloudflare 生态，绕开直连公网 IP 被 403）。
// 注意：地址要带 /api/tts 路径前缀（本代理透传全部子路径）。
const DEFAULT_UPSTREAM = 'https://sustained-revenues-heading-discipline.trycloudflare.com/api/tts';

export async function onRequestPost(context) {
  const env = context.env || {};
  const token = (env.RSZ_TTS_TOKEN || '').trim();
  const upstream = ((env.RSZ_TTS_UPSTREAM || '').trim() || DEFAULT_UPSTREAM).replace(/\/$/, '');

  if (!token) {
    return json(503, {
      ok: false,
      code: 'NO_TTS_TOKEN',
      error: '暖声音代理未配置（缺环境变量 RSZ_TTS_TOKEN），请到 Cloudflare 项目设置里配置。'
    });
  }

  let body;
  try {
    body = await context.request.json();
  } catch {
    return json(400, { ok: false, code: 'BAD_JSON', error: '请求不是合法 JSON' });
  }
  const text = body && typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) return json(400, { ok: false, code: 'BAD_TEXT', error: '缺少 text 字段' });

  try {
    const up = await fetch(upstream, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // 替浏览器补 token；浏览器自己碰不到这个值
        'x-tts-token': token
      },
      body: JSON.stringify({
        text,
        dialect: (body && body.dialect) || 'putonghua',
        rate: (body && body.rate) || 1
      })
    });

    if (up.status !== 200) {
      // 服务器返回 JSON 错误（401 / 503 等），原样透传 code/error 给前端
      let data = null;
      try { data = await up.json(); } catch { /* 非 JSON 就忽略 */ }
      return json(up.status, {
        ok: false,
        code: (data && data.code) || 'UPSTREAM_' + up.status,
        error: (data && data.error) || ('暖声音服务返回 HTTP ' + up.status)
      });
    }

    const ctype = (up.headers.get('content-type') || 'audio/wav').toLowerCase();
    const buf = await up.arrayBuffer();
    return new Response(buf, {
      status: 200,
      headers: {
        'content-type': ctype,
        'content-length': buf.byteLength,
        'cache-control': 'no-store'
      }
    });
  } catch (err) {
    return json(502, {
      ok: false,
      code: 'TTS_PROXY_FAIL',
      error: '连不上暖声音服务器：' + ((err && err.message) || '未知错误')
    });
  }
}

function json(status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}
