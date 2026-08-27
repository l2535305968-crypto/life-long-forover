// Cloudflare Pages Function — /api/health
// 对应本机 server.mjs 的 /api/health。Key 存在 Cloudflare 的环境变量里，不下发。

export async function onRequestGet(context) {
  const env = context.env || {};
  return new Response(
    JSON.stringify({
      ok: true,
      hasKey: Boolean((env.DEEPSEEK_API_KEY || '').trim()),
      hasAsr: Boolean(
        (env.XF_APPID || '').trim() && (env.XF_API_KEY || '').trim() && (env.XF_API_SECRET || '').trim()
      ),
      // 暖声音：Pages 上 /api/tts 用火山引擎在线语音合成（HTTP 一次性返回 mp3）。
      // 配齐 DOC_APPID + DOC_TOKEN 即视为可用；前端 tts.js 会优先走它，失败才降级浏览器机器音。
      hasTts: Boolean(
        (env.DOC_APPID || '').trim() && (env.DOC_TOKEN || '').trim()
      ),
      model: env.DEEPSEEK_MODEL || 'deepseek-chat',
      secureContextNote: 'Cloudflare Pages 是 https，麦克风、加到桌面都能用',
      time: new Date().toISOString()
    }),
    {
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
    }
  );
}
