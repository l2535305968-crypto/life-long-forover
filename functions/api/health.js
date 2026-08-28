// Cloudflare Pages Function — /api/health
// 对应本机 server.mjs 的 /api/health。Key 存在 Cloudflare 的环境变量里，不下发。

export async function onRequestGet(context) {
  const env = context.env || {};
  return new Response(
    JSON.stringify({
      ok: true,
      hasKey: Boolean((env.DEEPSEEK_API_KEY || '').trim()),
      // 语音识别：现在也走"Pages /api/asr 代理 → cloudflared 隧道 → 阿里云 8788 → 讯飞"这条链，
      // 与暖声音 TTS 同一套后端（服务器已实现 handleAsr → xfyun-asr.mjs，方言用 accent='mulacc'）。
      // 所以只要配了 RSZ_TTS_TOKEN（能证明隧道+服务器活着，即 hasTts），/api/asr 代理就能用，
      // 前端就会优先选讯飞识别（安卓/微信/方言都能用）。讯飞三件套 Key 只存在服务器 .env，Pages 不放。
      hasAsr: Boolean((env.RSZ_TTS_TOKEN || '').trim()),
      // 暖声音：Pages 上 /api/tts 反向代理到阿里云 ECS 的讯飞 TTS。
      // 配齐 RSZ_TTS_TOKEN 即视为可用；前端 tts.js 会优先走它，失败才降级浏览器机器音。
      hasTts: Boolean((env.RSZ_TTS_TOKEN || '').trim()),
      model: env.DEEPSEEK_MODEL || 'deepseek-chat',
      secureContextNote: 'Cloudflare Pages 是 https，麦克风、加到桌面都能用',
      time: new Date().toISOString()
    }),
    {
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
    }
  );
}
