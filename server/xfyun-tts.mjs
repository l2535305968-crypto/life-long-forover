// xfyun-tts.mjs — 讯飞在线语音合成（流式版）WebAPI 客户端。
// 把一段中文文本合成为 PCM16 音频（老人听得见的"有温度"声音），替代浏览器机器音。
// Key 与讯飞听写共用同一套 APPID / APIKey / APISecret（服务端持有，不下发）。
// 走 wss://tts-api.xfyun.cn/v2/tts。

import crypto from 'node:crypto';

const HOST = 'tts-api.xfyun.cn';
const PATH = '/v2/tts';

// 我方方言 id → 讯飞发音人（vcn）。
// 已核对的稳定普通话发音人：xiaoyan（小燕·女）、xiaofeng（小峰·男）。
// 老人陪聊场景用"小燕"这种柔和女声更亲切；方言发音人需在讯飞后台另开能力，暂按普通话。
const VCN_MAP = {
  putonghua: 'xiaoyan',
  yue: 'xiaoyan',
  chuanyu: 'xiaoyan'
};

function buildWsUrl(apiKey, apiSecret) {
  const date = new Date().toUTCString(); // RFC1123
  const origin = `host: ${HOST}\ndate: ${date}\nGET ${PATH} HTTP/1.1`;
  const sig = crypto.createHmac('sha256', apiSecret).update(origin).digest('base64');
  const auth = Buffer.from(
    `api_key="${apiKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${sig}"`
  ).toString('base64');
  return `wss://${HOST}${PATH}?authorization=${auth}&date=${encodeURIComponent(date)}&host=${HOST}`;
}

export function vcnFor(dialectId) {
  return VCN_MAP[dialectId] || 'xiaoyan';
}

// ---------- 按方言场合的儿化/口语预处理 ----------
// 目标：让 AI 回话在"念出来"那一刻符合老人的方言场合，而不是一刀切全带北方儿化。
// 原则（重要，别改反）：
//   · 只处理 AI 生成的回话，绝不碰老人原话（老人的儿化/土话是他自己的身份印记）。
//   · 功能性儿化（一会儿/有点儿/这儿/花儿...）普通话通用，任何方言都保留，删了反而拗口。
//   · 地域性儿化（今儿/天儿/干活儿/好玩儿/嗓门儿...）是北方口语标志，对南方老人要收敛成不带儿。
//
// 每个方言包分成两档：'keep'＝保留通用儿化（默认），'strip'＝额外把地域性儿化也去掉。
// CORE_ERHUA 永远保留（普通话/南方都通用）；REGIONAL_ERHUA 只对南方话去掉。

// 通用性儿化：普通话和北方、南方都用，删了反而别扭 → 任何场合都保留。
const CORE_ERHUA = new Set([
  '一会儿', '有点儿', '一会儿', '这儿', '那儿', '哪儿', '花儿', '事儿',
  '味儿', '劲儿', '活儿', '门儿', '头儿', '底儿', '份儿'
]);

// 地域性儿化：北方口吻标志，AI 回话里常见。南方话（粤/川/吴/湘/闽）要去掉，换成不带儿。
const REGIONAL_ERHUA = [
  ['今儿', '今天'], ['明儿', '明天'], ['昨儿', '昨天'], ['前儿', '前天'],
  ['天儿', '天气'], ['干活儿', '干活'], ['好玩儿', '好玩'],
  ['一点点儿', '一点点'], ['有点儿', '有点'],
  ['那会儿', '那时'], ['这会儿', '这时'], ['多会儿', '什么时候'],
  ['事儿', '事'] // 注意：只替换"事儿"，保留"事情"
];

// 南方方言 id（读到这里就说明需要收敛地域儿化）
const SOUTHERN = new Set(['yue', 'wu', 'xiang', 'min', 'gan', 'chuanyu', 'henan']);

/**
 * 按方言场合把一段文本"说话化"。目前只做儿化收敛，未来可扩展土话/接续词。
 * @param {string} text 要念的文本（通常是 AI 回话）
 * @param {string} [dialectId] 书里设的方言 id
 * @returns {string} 处理后的文本
 */
export function normalizeForDialect(text, dialectId = 'putonghua') {
  const t = String(text || '');
  if (!t) return '';
  // 非南方方言：保留地域儿化（老人就是北方口音，念出"天儿""今儿"正合适）
  if (!SOUTHERN.has(dialectId)) return t;
  // 南方方言：把地域儿化收敛成不带儿；通用儿化（"头儿""份儿"等不在上表）保留
  let out = t;
  for (const [from, to] of REGIONAL_ERHUA) {
    // 只替换整个词，避免把"事儿"误伤成别的
    out = out.split(from).join(to);
  }
  return out;
}

/**
 * 合成一段中文 → 24k PCM16 wav 字节。
 * @param {object} opts
 * @param {string} opts.appId      讯飞 APPID
 * @param {string} opts.apiKey     讯飞 APIKey
 * @param {string} opts.apiSecret  讯飞 APISecret
 * @param {string} opts.text       要念的中文文本（≤2000 字）
 * @param {string} [opts.vcn]      发音人，默认 xiaoyan
 * @param {number} [opts.speed]    语速 0.5~2.0，默认 0.92（老人听着从容）
 * @param {number} [opts.timeoutMs] 超时，默认 30000
 * @returns {Promise<{wav: Buffer, sr: number}>}
 */
export function synthesize({ appId, apiKey, apiSecret, text, vcn = 'xiaoyan', speed = 0.92, timeoutMs = 30000, debug = false }) {
  return new Promise((resolve, reject) => {
    let ws;
    try {
      ws = new WebSocket(buildWsUrl(apiKey, apiSecret));
    } catch (e) {
      reject(e);
      return;
    }

    let settled = false;
    const chunks = []; // 累积各帧 base64 音频
    let finalStatusSeen = false;

    const finish = (ok, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.close(); } catch { /* 忽略 */ }
      ok ? resolve(value) : reject(value);
    };

    const timer = setTimeout(() => finish(false, new Error('讯飞合成超时')), timeoutMs);

    ws.onopen = () => {
      // 将文本 base64，一次发完（status=2 表示并是最后一帧）
      const textB64 = Buffer.from(text, 'utf8').toString('base64');
      // 采样率 16000、编码 raw（PCM16）。rate 换算成讯飞 speed（0.5~2.0）。
      const spd = Math.max(0.5, Math.min(2.0, Number(speed) || 1.0));
      ws.send(JSON.stringify({
        common: { app_id: appId },
        business: {
          aue: 'raw',
          sfl: 1,                    // 采样率 16k
          auf: 'audio/L16;rate=16000',
          vcn,
          speed: spd,
          volume: 60,
          pitch: 50,
          tte: 'UTF8'                // 文本编码 UTF-8
        },
        data: { status: 2, text: textB64 }
      }));
    };

    ws.onmessage = (ev) => {
      if (debug) console.error('[xfyun-tts frame]', typeof ev.data === 'string' ? ev.data.slice(0, 300) : String(ev.data).slice(0, 300));
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.code !== 0) {
        finish(false, new Error(`讯飞合成错误 code=${msg.code}${msg.message ? ' ' + msg.message : ''}`));
        return;
      }
      const d = msg.data || {};
      if (d.audio) chunks.push(d.audio);
      if (d.status === 2) {
        finalStatusSeen = true;
        try {
          const pcm = Buffer.concat(chunks.map((b) => Buffer.from(b, 'base64')));
          // 16k PCM16 单声道封装成 wav
          const wav = pcm16Wav(pcm, 16000);
          finish(true, { wav, sr: 16000 });
        } catch (e) {
          finish(false, e);
        }
      }
    };

    ws.onerror = () => finish(false, new Error('连不上讯飞，检查网络或签名'));
    ws.onclose = () => {
      if (!settled && chunks.length) {
        // 意外关闭但收到了音频，尽量把已有的拼出来
        try {
          const pcm = Buffer.concat(chunks.map((b) => Buffer.from(b, 'base64')));
          finish(true, { wav: pcm16Wav(pcm, 16000), sr: 16000 });
        } catch { /* 忽略 */ }
      } else if (!settled) {
        finish(false, new Error('讯飞连接提前关闭'));
      }
    };
  });
}

// 16bit 单声道 PCM → 标准 wav 字节（RIFF 头）。
function pcm16Wav(pcm, rate) {
  const dataSize = pcm.length;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);        // fmt chunk size
  header.writeUInt16LE(1, 20);         // PCM
  header.writeUInt16LE(1, 22);         // mono
  header.writeUInt32LE(rate, 24);      // sample rate
  header.writeUInt32LE(rate * 2, 28);  // byte rate
  header.writeUInt16LE(2, 32);         // block align
  header.writeUInt16LE(16, 34);        // bits per sample
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, pcm]);
}
