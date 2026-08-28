// Cloudflare Pages Function — /api/upload（手机把素材流式上传到阿里云 ECS 的 8788）
//
// 为什么是代理：手机要把 B站 DASH 素材（video/audio .m4s、entry.json、danmaku.xml）
// 传到服务器，供「本地工具」脚本（bilibili 合成）处理。素材文件可能几十 MB，
// 必须流式转发，不能在 Worker 里 buffer 成 arrayBuffer（会撞 Cloudflare 内存限制）。
//
// 本代理只做三件事：
//   1. 从环境变量拿 RSZ_TTS_TOKEN（护门令牌，绝不下发浏览器）
//   2. 替浏览器补一个 x-tts-token header（服务器 /api/upload 校验通过才落盘）
//   3. 把浏览器的请求体（文件字节流）原样流式转发给上游，结果 JSON 回传
//
// 接口：POST /api/upload?filename=xxx.m4s
//   body：文件字节（不是 multipart，就是原始字节）
//   返回：{ ok:true, filename, size } 或 4xx/5xx { ok:false, code, error }
//
// 护门：token（RSZ_TTS_TOKEN）与 tts.js 是同一个。上传/合成/配音共用一个令牌，简单够用。

// 上游后端地址。云端生产环境已配置 RSZ_TTS_UPSTREAM = https://tts.xunyiju.com/api/tts
// （cloudflared 固定隧道，工具 tts.js 用的是这个带 /api/tts 后缀的值）。本代理不管它带了
// 什么路径，一律只取「站点根」再拼上 /api/upload，避免拼成 /api/tts/api/upload 导致 405。
// 此常量仅作未配置时的兜底。
const DEFAULT_UPSTREAM = 'https://tts.xunyiju.com';

export async function onRequestPost(context) {
  const env = context.env || {};
  const token = (env.RSZ_TTS_TOKEN || '').trim();
  const upstream = ((env.RSZ_TTS_UPSTREAM || '').trim() || DEFAULT_UPSTREAM).replace(/\/$/, '');

  if (!token) {
    return json(503, {
      ok: false,
      code: 'NO_TTS_TOKEN',
      error: '上传代理未配置（缺环境变量 RSZ_TTS_TOKEN），请到 Cloudflare 项目设置里配置。'
    });
  }

  // 拿到手机端的文件名（?filename=xxx.m4s），原样透传给服务器
  const url = new URL(context.request.url);
  const filename = url.searchParams.get('filename') || '';

  try {
    // 只取上游的站点根（去掉可能带上的 /api/* 路径前缀），再拼 /api/upload。
    // 这样无论 RSZ_TTS_UPSTREAM 配的是 https://tts.xunyiju.com 还是
    // https://tts.xunyiju.com/api/tts，都能正确落到服务器 /api/upload。
    const root = upstream.replace(/\/+$/, '').replace(/\/api\/.*$/, '');
    // 流式转发：Worker 不 buffer 整个文件，用 request.body 当可读流直接导给上游
    const up = await fetch(root + '/api/upload?filename=' + encodeURIComponent(filename), {
      method: 'POST',
      headers: {
        'content-type': (context.request.headers.get('content-type') || 'application/octet-stream'),
        // 替浏览器补 token；浏览器自己碰不到这个值
        'x-tts-token': token
      },
      body: context.request.body // 可读流，大文件不占 Worker 内存
    });

    // 服务器返回 JSON（成功 / 401 / 400 / 413 等），原样透传 code/error 给前端
    let data = null;
    try { data = await up.json(); } catch { /* 非 JSON 就忽略 */ }
    return json(up.status, data || {
      ok: false,
      code: 'UPSTREAM_' + up.status,
      error: '上传服务返回 HTTP ' + up.status
    });
  } catch (err) {
    return json(502, {
      ok: false,
      code: 'UPLOAD_PROXY_FAIL',
      error: '连不上上传服务：' + ((err && err.message) || '未知错误')
    });
  }
}

function json(status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}
