// Cloudflare Pages Function — /api/asr（诚实占位）
//
// 讯飞"语音听写"只有 WebSocket 接口，而 Cloudflare Workers/Pages 不能主动
// 发起对外部主机的 WebSocket 连接。因此讯飞 ASR 留在本地 Node 服务
// （server/server.mjs 的 /api/asr，已实测通过）。
//
// 这个端点只给一个明确答复，避免 404 让人摸不着头脑。
// 客户端本来就会读 /api/health 的 hasAsr（Pages 上为 false），不会真的走到这里。

export async function onRequestPost() {
  return new Response(
    JSON.stringify({
      ok: false,
      code: 'ASR_NOT_ON_PAGES',
      error: '讯飞语音识别在 Cloudflare Pages 上不可用（讯飞只有 WebSocket 接口，Pages 不能主动连外部 WebSocket）。请用本地服务 + Cloudflare Tunnel，或把 Node 服务部署到 VPS。'
    }),
    {
      status: 503,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
    }
  );
}
