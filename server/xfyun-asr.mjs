// xfyun-asr.mjs — 讯飞语音听写（流式版）WebAPI 客户端。
// 把一段 16k/16bit 单声道 PCM 音频转成文字，支持方言（accent）。
// Key 只在这里用（服务端），不下发。走 wss://iat-api.xfyun.cn/v2/iat。

import crypto from 'node:crypto';

const HOST = 'iat-api.xfyun.cn';
const PATH = '/v2/iat';

// 我方方言 id → 讯飞 accent 参数。
// 已核对：普通话 mandarin、粤语 cantonese。四川话 lmz 为讯飞文档常见写法，待最终核对。
// 其余方言讯飞听写暂按普通话处理（东北/西安/天津等需要在讯飞后台另开对应能力后再补码）。
export const ACCENT_MAP = {
  putonghua: 'mandarin',
  yue: 'cantonese',
  chuanyu: 'lmz'
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

export function accentFor(dialectId) {
  return ACCENT_MAP[dialectId] || 'mandarin';
}

export function transcribe({ appId, apiKey, apiSecret, audioBase64, accent = 'mandarin', timeoutMs = 30000, debug = false }) {
  return new Promise((resolve, reject) => {
    let ws;
    try {
      ws = new WebSocket(buildWsUrl(apiKey, apiSecret));
    } catch (e) {
      reject(e);
      return;
    }

    let settled = false;
    const finish = (ok, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.close(); } catch { /* 忽略 */ }
      ok ? resolve(value) : reject(value);
    };

    const timer = setTimeout(() => finish(false, new Error('讯飞识别超时')), timeoutMs);

    ws.onopen = () => {
      // 第一帧：参数 + status 0 + 整段音频（短音频一次发完即可）
      ws.send(JSON.stringify({
        common: { app_id: appId },
        business: { language: 'zh_cn', domain: 'iat', accent },
        data: { status: 0, format: 'audio/L16;rate=16000', encoding: 'raw', audio: audioBase64 }
      }));
      // 结束帧
      ws.send(JSON.stringify({
        data: { status: 2, format: 'audio/L16;rate=16000', encoding: 'raw', audio: '' }
      }));
    };

    ws.onmessage = (ev) => {
      if (debug) console.error('[xfyun frame]', typeof ev.data === 'string' ? ev.data.slice(0, 400) : String(ev.data).slice(0, 400));
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.code !== 0) {
        finish(false, new Error(`讯飞错误 code=${msg.code}${msg.message ? ' ' + msg.message : ''}`));
        return;
      }
      if (msg.data && msg.data.status === 2) {
        let text = '';
        const wsArr = msg.data.result && msg.data.result.ws;
        if (Array.isArray(wsArr)) {
          for (const seg of wsArr) {
            for (const cw of seg.cw || []) {
              if (cw.w) text += cw.w;
            }
          }
        }
        finish(true, { text: text.trim(), raw: msg });
      }
    };

    ws.onerror = () => finish(false, new Error('连不上讯飞，检查网络或签名'));
    ws.onclose = () => {
      if (!settled) finish(false, new Error('讯飞连接提前关闭'));
    };
  });
}
