// pcm.js — 把录音（webm/opus）转成讯飞要的 16k/16bit 单声道 PCM，再 base64。
// 浏览器专用（用 Web Audio API 解码 + 线性重采样），Node 里不测。

export async function blobToPcm16Base64(blob, targetRate = 16000) {
  const arrayBuffer = await blob.arrayBuffer();
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = new AC();
  let audioBuffer;
  try {
    audioBuffer = await ctx.decodeAudioData(arrayBuffer);
  } finally {
    if (ctx.close) ctx.close().catch(() => {});
  }

  const ch = audioBuffer.getChannelData(0); // 取第一声道
  const ratio = targetRate / audioBuffer.sampleRate;
  const newLen = Math.max(1, Math.round(ch.length * ratio));
  const pcm = new Int16Array(newLen);
  for (let i = 0; i < newLen; i++) {
    const src = i / ratio;
    const i0 = Math.floor(src);
    const i1 = Math.min(i0 + 1, ch.length - 1);
    const frac = src - i0;
    const s = ch[i0] * (1 - frac) + ch[i1] * frac;
    pcm[i] = Math.max(-1, Math.min(1, s)) * 0x7fff;
  }

  const bytes = new Uint8Array(pcm.buffer);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}
