// Cloudflare Pages Function — /api/tts（火山引擎·豆包语音合成大模型2.0，HTTP 单向流式）
//
// 背景：Cloudflare Pages(Bundled) 对出站 WebSocket 长连接仅 ~50ms CPU 就被强断，
// 讯飞的在线合成（wss 流式）拿不全一整段语音。豆包大模型走 HTTP Chunked 单向流式
// /api/v3/tts/unidirectional，是 HTTP 长连接并非 WebSocket，Pages 上能完整收全，无此问题。
//
// 接口：POST https://openspeech.bytedance.com/api/v3/tts/unidirectional
//   · 鉴权 headers：
//       X-Api-Key: <API Key>            （控制台>API Key管理 获取）
//       X-Api-Resource-Id: seed-tts-2.0  （豆包语音合成大模型2.0）
//       X-Api-Request-Id: <uuid>         （每次请求随机）
//   · body：{ req_params: { text, speaker, audio_params:{format,sample_rate}, ... } }
//   · 返回：HTTP 流式，响应体拆成多段 JSON，每段含 "data":"<base64 音频>"，需拼接后再解码。
//
// Key 放在 Cloudflare 环境变量里（绝不下发到浏览器）：DOC_API_KEY

const RESOURCE_ID = 'seed-tts-2.0';   // 豆包语音合成大模型2.0
const SPEECH_RATE = 0;                // 语速：0 = 正常，-50 慢一倍，100 快一倍

// 暖声音候选（豆包大模型2.0 音色，均以 _uranus_bigtts 结尾，才能对得上 seed-tts-2.0 资源）
const VOICES = {
  // 柔和亲切，适合陪老人闲聊
  default: 'zh_female_kefunvsheng_uranus_bigtts',   // 暖阳女声 2.0
  // 稍活泼
  clear:   'zh_female_qingxinnvsheng_uranus_bigtts', // 清新女声 2.0
  sweet:   'zh_female_tianmeixiaoyuan_uranus_bigtts' // 甜美小源 2.0
};

// 我方方言 id → 豆包 explicit_dialect 取值（豆包不支持 chuanyu，用接近的 sichuan）
const DIALECT_MAP = {
  sichuan: 'sichuan',   // 四川话（川渝最接近）
  chuanyu: 'sichuan',
  yue:     'yue',       // 粤语
  dongbei: 'dongbei'
};

function voiceFor() {
  return VOICES.default;
}
function dialectFor(dialectId) {
  return DIALECT_MAP[dialectId] || null;
}

// 按方言场合做儿化收敛（只影响 AI 回话，老人原话不受影响）。
// 南方方言去掉地域性儿化；豆包方言音色对儿化处理与普通话一致，这里按需收敛。
const REGIONAL_ERHUA = [
  ['今儿', '今天'], ['明儿', '明天'], ['昨儿', '昨天'], ['前儿', '前天'],
  ['天儿', '天气'], ['干活儿', '干活'], ['好玩儿', '好玩'],
  ['一点点儿', '一点点'], ['有点儿', '有点'],
  ['那会儿', '那时'], ['这会儿', '这时'], ['多会儿', '什么时候'],
  ['事儿', '事']
];
const SOUTHERN = new Set(['yue', 'wu', 'xiang', 'min', 'gan', 'chuanyu', 'henan', 'sichuan']);

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

// 调豆包 HTTP 单向流式合成，拼接所有 data 段后统一 base64 解码，返回 Uint8Array。
async function synthesize({ apiKey, text, speaker, explicitDialect, timeoutMs = 60000 }) {
  const reqid = crypto.randomUUID();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const req_params = {
    text,
    speaker,
    audio_params: { format: 'mp3', sample_rate: 24000 },
    speech_rate: SPEECH_RATE,
    disable_markdown_filter: true
  };
  if (explicitDialect) req_params.explicit_dialect = explicitDialect;
  try {
    const res = await fetch('https://openspeech.bytedance.com/api/v3/tts/unidirectional', {
      method: 'POST',
      headers: {
        'X-Api-Key': apiKey,
        'X-Api-Resource-Id': RESOURCE_ID,
        'X-Api-Request-Id': reqid,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ req_params }),
      signal: ctrl.signal
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error('豆包返回 HTTP ' + res.status + ' ' + body.slice(0, 160));
    }
    // 流式：body 是若干段 JSON 拼接，每段含 "data":"<base64>"。逐行/整串提取所有 data 再合并。
    const raw = await res.text();
    const segments = [...raw.matchAll(/"data"\s*:\s*"([A-Za-z0-9+/=]+)"/g)];
    if (!segments.length) {
      throw new Error('豆包未返回音频数据 响应=' + raw.slice(0, 160));
    }
    const b64 = segments.map(m => m[1]).join('');
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
  const apiKey = (env.DOC_API_KEY || '').trim();

  // 没配：明确告知缺什么（前端会据此降级浏览器朗读）
  if (!apiKey) {
    return json(503, {
      ok: false,
      code: 'NO_TTSKEY',
      error: '豆包大模型未配（环境变量 DOC_API_KEY），暖声音不可用。请到 Cloudflare 项目设置里配置。'
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
  const speaker = voiceFor();
  const rate = Number(body.rate) || 1;
  // 按方言场合做儿化收敛（只影响 AI 回话）
  const shaped = normalizeForDialect(text, dialect);
  // 方言场景若音色支持，则带 explicit_dialect；暂统一用暖阳女声（普通话），
  // 方言口语由读音自然呈现，儿化已收敛。
  const explicitDialect = null; // 如需方言口音可改为 dialectFor(dialect)

  try {
    const bytes = await synthesize({ apiKey, text: shaped, speaker, explicitDialect });
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
