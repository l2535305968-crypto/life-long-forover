// xfyun-asr.mjs — 讯飞语音识别客户端。
// 优先走「方言识别大模型 / 星火协议」（header+parameter+payload，wss://iat.cn-huabei-1.xf-yun.com/v1）。
// key 只在服务端用，不下发。
//
// 背景：方言识别大模型与老的「语音听写流式版」虽然都叫 iat，但协议结构不同：
//   老流式版：common + business + data
//   星火版：  header + parameter + payload
// 用错结构会报 10404（no category route）。本模块用星火版做方言转写。
// 若需兼容老流式版，可切 DIALECT_PROTOCOL='legacy'。

import crypto from 'node:crypto';

// 方言识别大模型（星火协议）地址
const DIALECT_HOST = 'iat.cn-huabei-1.xf-yun.com';
const DIALECT_PATH = '/v1';
// 老流式版地址
const LEGACY_HOST = 'iat-api.xfyun.cn';
const LEGACY_PATH = '/v2/iat';

// 走哪个协议方言识别。默认星火（方言大模型，支持 202 种方言免切换）。
const DIALECT_PROTOCOL = process.env.XF_ASR_PROTOCOL || 'spark';

// 我方方言 id → 讯飞 accent 参数。
// 方言大模型统一用 accent='mulacc'（202 种方言免切换），不依赖个别映射。
// 老流式版仍按 ACCENT_MAP 逐个映射（普通话/粤语/四川话）。
export const ACCENT_MAP = {
  putonghua: 'mandarin',
  yue: 'cantonese',
  chuanyu: 'lmz'
};

function buildWsUrl(host, apiPath, apiKey, apiSecret) {
  const date = new Date().toUTCString(); // RFC1123
  const origin = `host: ${host}\ndate: ${date}\nGET ${apiPath} HTTP/1.1`;
  const sig = crypto.createHmac('sha256', apiSecret).update(origin).digest('base64');
  const auth = Buffer.from(
    `api_key="${apiKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${sig}"`
  ).toString('base64');
  return `wss://${host}${apiPath}?authorization=${auth}&date=${encodeURIComponent(date)}&host=${host}`;
}

export function accentFor(dialectId) {
  return ACCENT_MAP[dialectId] || 'mandarin';
}

// 把老流式版返回的 ws[] 拼成文字
function textFromLegacy(msg) {
  let text = '';
  const wsArr = msg.data && msg.data.result && msg.data.result.ws;
  if (Array.isArray(wsArr)) {
    for (const seg of wsArr) {
      for (const cw of seg.cw || []) {
        if (cw.w) text += cw.w;
      }
    }
  }
  return text.trim();
}

// 提取星火协议一帧 payload.result.text 里的词（base64 → JSON → ws[].cw[].w）。
// 流式（dwa=wpgs）下每帧只带这一小段词，需由外部逐帧累加。
function extractSparkWords(msg) {
  const b64 = msg.payload && msg.payload.result && msg.payload.result.text;
  if (!b64) return [];
  let json;
  try {
    json = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
  } catch {
    return [];
  }
  const words = [];
  const wsArr = json && json.ws;
  if (Array.isArray(wsArr)) {
    for (const seg of wsArr) {
      for (const cw of seg.cw || []) {
        if (cw.w) words.push(cw.w);
      }
    }
  }
  return words;
}

export function transcribe({ appId, apiKey, apiSecret, audioBase64, accent = 'mandarin', timeoutMs = 30000, debug = false }) {
  return new Promise((resolve, reject) => {
    const spark = DIALECT_PROTOCOL === 'spark';
    const host = spark ? DIALECT_HOST : LEGACY_HOST;
    const apiPath = spark ? DIALECT_PATH : LEGACY_PATH;

    let ws;
    try {
      ws = new WebSocket(buildWsUrl(host, apiPath, apiKey, apiSecret));
    } catch (e) {
      reject(e);
      return;
    }

    let settled = false;
    let sparkBuf = []; // 流式（wpgs）逐帧词，拼出整句
    const finish = (ok, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.close(); } catch { /* 忽略 */ }
      ok ? resolve(value) : reject(value);
    };

    const timer = setTimeout(() => finish(false, new Error('讯飞识别超时')), timeoutMs);

    ws.onopen = () => {
      if (spark) {
        // 星火协议：header + parameter + payload
        // header.status：0=开始 1=继续 2=结束（协议必传）
        ws.send(JSON.stringify({
          header: { app_id: appId, status: 0 },
          parameter: {
            iat: {
              language: 'zh_cn',      // 仅支持中文
              accent: 'mulacc',      // 202 种方言免切换
              domain: 'slm',         // 方言大模型固定 slm
              eos: 1800,
              dwa: 'wpgs',           // 流式识别，实时出结果
              ptt: 1,                // 标点预测
              nunum: 1,              // 数字规整
              ltc: 1,                // 中英文筛选：1=不筛选（仅接受 1/2/3）
              result: { encoding: 'utf8', compress: 'raw', format: 'json' }
            }
          },
          payload: {
            audio: {
              encoding: 'raw',
              sample_rate: 16000,
              channels: 1,
              bit_depth: 16,
              status: 0,
              seq: 0,
              audio: audioBase64
            }
          }
        }));
        // 结束帧（header.status=2）
        ws.send(JSON.stringify({
          header: { app_id: appId, status: 2 },
          payload: {
            audio: {
              encoding: 'raw', sample_rate: 16000, channels: 1, bit_depth: 16,
              status: 2, seq: 0, audio: ''
            }
          }
        }));
      } else {
        // 老流式版：common + business + data
        ws.send(JSON.stringify({
          common: { app_id: appId },
          business: { language: 'zh_cn', domain: 'iat', accent },
          data: { status: 0, format: 'audio/L16;rate=16000', encoding: 'raw', audio: audioBase64 }
        }));
        ws.send(JSON.stringify({
          data: { status: 2, format: 'audio/L16;rate=16000', encoding: 'raw', audio: '' }
        }));
      }
    };

    ws.onmessage = (ev) => {
      if (debug) console.error('[xfyun frame]', typeof ev.data === 'string' ? ev.data.slice(0, 400) : String(ev.data).slice(0, 400));
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }

      // 星火协议错误码在 header.code 或顶层 code；老协议在顶层 code
      const code = msg.header ? msg.header.code : msg.code;
      if (code && code !== 0) {
        const message = msg.header ? msg.header.message : msg.message;
        finish(false, new Error(`讯飞错误 code=${code}${message ? ' ' + message : ''}`));
        return;
      }

      if (spark) {
        // 流式：每帧都把词塞进缓冲
        sparkBuf.push(...extractSparkWords(msg));
        // 结束：header.status === 2
        if (msg.header && msg.header.status === 2) {
          finish(true, { text: sparkBuf.join('').trim(), raw: msg });
        }
      } else if (msg.data && msg.data.status === 2) {
        finish(true, { text: textFromLegacy(msg), raw: msg });
      }
    };

    ws.onerror = () => finish(false, new Error('连不上讯飞，检查网络或签名'));
    ws.onclose = () => {
      if (!settled) finish(false, new Error('讯飞连接提前关闭'));
    };
  });
}
