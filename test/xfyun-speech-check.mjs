// 真实语音端到端测试：读一个 WAV 文件 → 转 16k PCM → 讯飞识别。
// 用法：node test/xfyun-speech-check.mjs <wav文件路径>
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '../server/env.mjs';
import { transcribe } from '../server/xfyun-asr.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const wavPath = process.argv[2];
if (!wavPath) {
  console.error('用法：node test/xfyun-speech-check.mjs <wav文件路径>');
  process.exit(1);
}

// 解析 WAV（仅处理 PCM 16bit，单/双声道都行）
function wavToPcm16(wavBuf, targetRate = 16000) {
  const view = new DataView(wavBuf.buffer, wavBuf.byteOffset, wavBuf.byteLength);
  if (wavBuf.toString('ascii', 0, 4) !== 'RIFF' || wavBuf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('不是 WAV 文件');
  }
  let sampleRate = 0, channels = 0, bits = 0;
  let dataOff = 0, dataLen = 0;
  let off = 12;
  while (off + 8 <= wavBuf.length) {
    const id = wavBuf.toString('ascii', off, off + 4);
    const size = view.getUint32(off + 4, true);
    if (id === 'fmt ') {
      const fmt = view.getUint16(off + 8, true); // 1 = PCM
      channels = view.getUint16(off + 10, true);
      sampleRate = view.getUint32(off + 12, true);
      bits = view.getUint16(off + 22, true);
      if (fmt !== 1 || bits !== 16) throw new Error('只支持 16bit PCM WAV');
    } else if (id === 'data') {
      dataOff = off + 8;
      dataLen = size;
    }
    off += 8 + size + (size % 2);
  }
  if (!sampleRate || !dataOff) throw new Error('WAV 缺 fmt 或 data');

  const samplesPerCh = Math.floor(dataLen / (channels * 2));
  const raw = new Int16Array(samplesPerCh);
  for (let i = 0; i < samplesPerCh; i++) {
    raw[i] = view.getInt16(dataOff + i * channels * 2, true); // 取第一声道
  }
  // 线性重采样到 16k
  const ratio = targetRate / sampleRate;
  const newLen = Math.round(samplesPerCh * ratio);
  const out = new Int16Array(newLen);
  for (let i = 0; i < newLen; i++) {
    const src = i / ratio;
    const i0 = Math.floor(src);
    const i1 = Math.min(i0 + 1, samplesPerCh - 1);
    const frac = src - i0;
    out[i] = Math.round(raw[i0] * (1 - frac) + raw[i1] * frac);
  }
  return Buffer.from(out.buffer, out.byteOffset, out.byteLength);
}

const { vars } = await loadEnv(path.join(ROOT, '.env'));
const wav = readFileSync(wavPath);
const pcm = wavToPcm16(wav);
console.log('WAV →', pcm.length / 2, '个 16k 采样（约', Math.round(pcm.length / 32000 * 10) / 10, '秒）');
console.log('识别中…');

try {
  const r = await transcribe({
    appId: (vars.XF_APPID || '').trim(),
    apiKey: (vars.XF_API_KEY || '').trim(),
    apiSecret: (vars.XF_API_SECRET || '').trim(),
    audioBase64: pcm.toString('base64'),
    accent: 'mandarin'
  });
  console.log('识别结果：', JSON.stringify(r.text));
} catch (e) {
  console.error('失败：', e.message);
  process.exit(1);
}
