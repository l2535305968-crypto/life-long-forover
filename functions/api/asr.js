// Cloudflare Pages Function — /api/asr（反向代理到阿里云 ECS 的讯飞语音识别）
//
// 为什么是代理而不是 Cloudflare 自己识别：
//   讯飞「语音听写 / 方言识别大模型」只有 WebSocket 接口，Cloudflare Workers/Pages
//   不能主动连外部主机的 WebSocket（连境外更被断）。所以和 /api/tts 一样，
//   Cloudflare 只当一个轻量反代：把浏览器的 POST /api/asr 原样转发给
//   阿里云 8.137.13.183:8788 的 /api/asr（服务器已实现 handleAsr → xfyun-asr.mjs），
//   把服务器识别出的文字以 JSON 回传给浏览器。
//
// 接口：POST https://<pages域名>/api/asr
//   body:  { audio: <base64>, format?, dialect?, accent? }
//   返回：{ ok:true, text } 或 4xx/5xx { ok:false, code, error }
//
// 护门：token（RSZ_TTS_TOKEN）放在 Cloudflare 环境变量里，绝不下发浏览器。
//       Worker 转发时替浏览器补一个 x-tts-token header，服务器校验通过才识别。
//       （服务器端 handleAsr 已加上与 /api/tts 相同的 TTS_TOKEN 校验。）

// 上游后端地址。云端生产环境已配置 RSZ_ASR_UPSTREAM = https://tts.xunyiju.com/api/asr
// （cloudflared 固定隧道，与 TTS 同一隧道、同一台服务器）。此常量仅作未配置时的兜底。
// 注意：地址要带 /api/asr 路径前缀（本代理透传全部子路径）。
const DEFAULT_UPSTREAM = 'https://tts.xunyiju.com/api/asr';

export async function onRequestPost(context) {
  const env = context.env || {};
  const token = (env.RSZ_TTS_TOKEN || '').trim();
  const upstream = ((env.RSZ_ASR_UPSTREAM || '').trim() || DEFAULT_UPSTREAM).replace(/\/$/, '');

  if (!token) {
    return json(503, {
      ok: false,
      code: 'NO_ASR_TOKEN',
      error: '语音识别代理未配置（缺 RSZ_TTS_TOKEN），请到 Cloudflare 项目设置里配置。'
    });
  }

  let body;
  try {
    body = await context.request.json();
  } catch {
    return json(400, { ok: false, code: 'BAD_JSON', error: '请求不是合法 JSON' });
  }
  const audio = body && typeof body.audio === 'string' ? body.audio : '';
  if (!audio) return json(400, { ok: false, code: 'BAD_AUDIO', error: '缺少 audio 字段' });

  try {
    const up = await fetch(upstream, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // 替浏览器补 token；浏览器自己碰不到这个值
        'x-tts-token': token
      },
      body: JSON.stringify({
        audio,
        format: (body && body.format) || 'wav',
        dialect: (body && body.dialect) || 'putonghua',
        accent: (body && body.accent) || ''
      })
    });

    // 服务器返回的是 JSON（成功 {ok:true,text}，失败 {ok:false,code,error}）。
    // 把状态码和内容原样透传给前端。
    let data = null;
    try { data = await up.json(); } catch { /* 非 JSON 就忽略 */ }
    return json(up.status, data || {
      ok: false,
      code: 'UPSTREAM_' + up.status,
      error: '语音识别服务返回 HTTP ' + up.status
    });
  } catch (err) {
    return json(502, {
      ok: false,
      code: 'ASR_PROXY_FAIL',
      error: '连不上语音识别服务器：' + ((err && err.message) || '未知错误')
    });
  }
}

function json(status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}
