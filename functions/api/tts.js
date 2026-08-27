// Cloudflare Pages Function — /api/tts（火山引擎在线语音合成，HTTP 一次性返回）
//
// 把一段中文文本合成为 mp3 音频（老人听得见的"有温度"声音），替代浏览器机器音。
// 之所以用火山引擎而非讯飞：讯飞的合成只有 WebSocket 流式接口（wss），而 Cloudflare
// Pages Function 运行在 Bundled 计划，出站 WebSocket 长连接只有约 50ms CPU 时间就被
// 强制关闭，拿不全一整段语音。火山引擎的 HTTP 接口一次性返回完整音频，没有这个问题。
//
// 接口：POST https://openspeech.bytedance.com/api/v1/tts
//   · 鉴权：Authorization = "Bearer; <token>" （注意是分号，不是冒号）
//   · body：{appid, token, cluster, voice_type, reqid, text, format}
//   · 返回：{code:3000, message:"Success", data:"<base64 音频>"}
//
// Key 全部放在 Cloudflare 环境变量里，绝不下发到浏览器：
//   DOC_TOKEN（Access Token）  DOC_APPID（App ID）
//
// 本端点是否需要新增环境变量？看 health.js 的 hasTts 判断 → 前端 tts.js 据此决定。

const CLUSTER = 'volcano_tts';        // 短文本 HTTP 合成集群
const DEFAULT_VOICE = 'zh_female_qingxin'; // 柔和清心女声，适合陪老人聊天

// 我方方言 id → 火山音色。火山大多数音色是标准普通话，方言音色需单独开通；
// 暂统一用柔和女声，后续可按需加川渝音色（如开通了方言音色再填）。
const VOICE_MAP = {
  putonghua: 'zh_female_qingxin',
  yue: 'zh_female_qingxin',
  chuanyu: 'zh_female_qingxin'
};

function voiceFor(dialectId) {
  return VOICE_MAP[dialectId] || DEFAULT_VOICE;
}

// 按方言场合做儿化收敛（只影响 AI 回话，老人原话不受影响）。
// 与讯飞版（server/xfyun-tts.mjs）一致：南方方言去掉地域性儿化。
const REGIONAL_ERHUA = [
  ['今儿', '今天'], ['明儿', '明天'], ['昨儿', '昨天'], ['前儿', '前天'],
  ['天儿', '天气'], ['干活儿', '干活'], ['好玩儿', '好玩'],
  ['一点点儿', '一点点'], ['有点儿', '有点'],
  ['那会儿', '那时'], ['这会儿', '这时'], ['多会儿', '什么时候'],
  ['事儿', '事']
];
const SOUTHERN = new Set(['yue', 'wu', 'xiang', 'min', 'gan', 'chuanyu', 'henan']);

function normalizeForDialect(text, dialectId = 'putonghua') {
  const t = String(text || '');
  if (!t) return '';
  if (!SOUTHERN.has(dialectId)) return t;
  let out = t;
  for (const [from, to] of REGIONAL_ERHUA) {
    out = out.split(from).join(to);
  }
  return out;
}

// 调火山 HTTP 合成，返回 Uint8Array（mp3 字节）。失败抛 Error。
async function synthesizeByRequest({ appid, token, text, voiceType, speedRatio = 1, timeoutMs = 30000 }) {
  const reqid = crypto.randomUUID(); // Workers 原生有 randomUUID
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch('https://openspeech.bytedance.com/api/v1/tts', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer; ' + token,          // 注意：分号
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        appid,
        token,
        cluster: CLUSTER,
        voice_type: voiceType,
        reqid,
        text,
        format: 'mp3',
        sample_rate: 24000,
        speed_ratio: speedRatio,
        volume_ratio: 1,
        pitch_ratio: 1
      }),
      signal: ctrl.signal
    });
    if (!res.ok) {
      // 401 = token 无效/未配；403 = 未开通；其他看 body
      const body = await res.text().catch(() => '');
      throw new Error('火山返回 HTTP ' + res.status + ' ' + body.slice(0, 120));
    }
    const json = await res.json().catch(() => null);
    if (!json) throw new Error('火山返回不是合法 JSON');
    if (json.code !== 3000) {
      throw new Error('火山合成失败 code=' + json.code + ' ' + (json.message || ''));
    }
    const b64 = json.data;
    if (!b64) throw new Error('火山未返回音频数据');
    return b64ToBytes(b64);
  } finally {
    clearTimeout(timer);
  }
}

// base64 → Uint8Array（替代 Buffer）
function b64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// ---------- Pages Function 入口 ----------
export async function onRequestPost(context) {
  const env = context.env || {};
  const appid = (env.DOC_APPID || '').trim();
  const token = (env.DOC_TOKEN || '').trim();

  // 没配全：明确告知缺什么（前端会据此降级浏览器朗读）
  if (!appid || !token) {
    return json(503, {
      ok: false,
      code: 'NO_TTSKEY',
      error: '火山引擎未配全（环境变量 DOC_APPID / DOC_TOKEN），暖声音不可用。请到 Cloudflare 项目设置里配置。'
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
  if (text.length > 1000) return json(413, { ok: false, code: 'TOO_LONG', error: '一句话最多 1000 字' });

  const dialect = (body && body.dialect) || 'putonghua';
  const voiceType = voiceFor(dialect);
  const rate = Number(body.rate) || 1;
  // 按方言场合做儿化收敛（只影响 AI 回话）
  const shaped = normalizeForDialect(text, dialect);

  try {
    const bytes = await synthesizeByRequest({ appid, token, text: shaped, voiceType, speedRatio: rate });
    return new Response(bytes.buffer, {
      status: 200,
      headers: {
        'content-type': 'audio/mpeg',
        'content-length': bytes.length,
        'cache-control': 'no-store'
      }
    });
  } catch (err) {
    return json(502, {
      ok: false,
      code: 'TTS_FAIL',
      error: (err && err.message) || '语音合成失败'
    });
  }
}

function json(status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}
