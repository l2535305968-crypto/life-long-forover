// 讯飞语音听写自检（需 .env 里已配 XF_APPID / XF_API_KEY / XF_API_SECRET）。
// 跑法：node test/xfyun-asr-check.mjs
// 用 1 秒静音 PCM 发过去，验证签名 + 连接 + 协议是否走通。
// 静音预期：返回 code=0、text 为空（或"嗯"之类），而不是签名/鉴权错误。
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '../server/env.mjs';
import { transcribe, accentFor } from '../server/xfyun-asr.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { vars } = await loadEnv(path.join(ROOT, '.env'));

const appId = (vars.XF_APPID || '').trim();
const apiKey = (vars.XF_API_KEY || '').trim();
const apiSecret = (vars.XF_API_SECRET || '').trim();

if (!appId || !apiKey || !apiSecret) {
  console.error('XF_APPID / XF_API_KEY / XF_API_SECRET 有一个没填。');
  process.exit(1);
}

// 1 秒静音 = 16000 个 16bit 0
const pcm = Buffer.alloc(16000 * 2, 0);
const audioBase64 = pcm.toString('base64');

console.log('appid 长度', appId.length, '| key 长度', apiKey.length, '| secret 长度', apiSecret.length);
console.log('accent 映射：普通话=', accentFor('putonghua'), '粤语=', accentFor('yue'), '四川=', accentFor('chuanyu'));
console.log('发送 1 秒静音，等待讯飞…');

try {
  const r = await transcribe({ appId, apiKey, apiSecret, audioBase64, accent: 'mandarin' });
  console.log('成功。识别文本：', JSON.stringify(r.text));
  console.log('（静音下文本为空属正常，关键是 code=0 无鉴权报错）');
} catch (e) {
  console.error('失败：', e.message);
  process.exit(1);
}
