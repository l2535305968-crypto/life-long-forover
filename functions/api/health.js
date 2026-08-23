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
      model: env.DEEPSEEK_MODEL || 'deepseek-chat',
      secureContextNote: 'Cloudflare Pages 是 https，麦克风、加到桌面都能用',
      time: new Date().toISOString()
    }),
    {
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
    }
  );
}
