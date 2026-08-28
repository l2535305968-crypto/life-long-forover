// asr.js — 语音识别适配层（可插拔）。
//
// 产品目标：像豆包那样，按住说，或"进了对话就不用按"，老人说一句、停顿，
// 自动转成文字、AI 念回来、再接着听下一句。全程不碰输入框。
//
// 现在有两条实现：
//   1. 浏览器内置 SpeechRecognition（iPhone Safari / 桌面 Chrome 可用，只认普通话）。
//   2. 讯飞语音听写（createXfyunRecognizer）——手机录一段音，发到本机 /api/asr 转文字，
//      安卓、微信、方言都能用（取决于服务端讯飞 Key 配没配）。
// 上层 UI 用 asrSupported() / hasXfyun() 挑，接口一致，都是"说一句 → 给回这一句"。

import { blobToPcm16Base64 } from './pcm.js';
import { withTokenHeaders } from './token.js';

export function asrSupported() {
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

// 方言 → 语音识别语言代码。大陆方言普遍没有独立代码，统一 zh-CN；
// 只有粤语有 zh-HK。没有的不要瞎编。
export function asrLang(dialectId) {
  const map = { yue: 'zh-HK' };
  return map[dialectId] || 'zh-CN';
}

// 讯飞模式是否可用（以服务端 /api/health 的 hasAsr 为准，本文件不直接知道）。
// 这里只提供一个"用讯飞转一句"的原语，供上层在 hasAsr 为真时调用。
export async function transcribeViaXfyun(pcmBase64, dialect) {
  const res = await fetch('/api/asr', {
    method: 'POST',
    headers: withTokenHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify({ audio: pcmBase64, dialect })
  });
  const data = await res.json().catch(() => ({ ok: false }));
  if (!res.ok || !data.ok) {
    const err = new Error(data.error || '语音识别失败');
    err.code = data.code;
    throw err;
  }
  return data.text;
}

// 讯飞识别器：录音 + 简单能量静音检测（VAD），老人停下约 0.9 秒就自动结束这一句。
// 返回 { start, stop, abort }，跟 createRecognizer 一样的用法。
export function createXfyunRecognizer({
  dialect = 'putonghua',
  onInterim,
  onFinal,
  onError,
  onStart,
  onEnd
} = {}) {
  let stream = null;
  let recorder = null;
  let audioCtx = null;
  let analyser = null;
  let rafId = null;
  let stopped = false;
  let speaking = false;
  let silenceMs = 0;
  let chunks = [];
  let done = false;

  const SILENCE_THRESHOLD = 0.03;
  const SILENCE_DURATION = 2000; // 老人停 2 秒算说完，自动断句

  function cleanup() {
    cancelAnimationFrame(rafId);
    try { stream && stream.getTracks().forEach((t) => t.stop()); } catch { /* 忽略 */ }
    try { audioCtx && audioCtx.close(); } catch { /* 忽略 */ }
    stream = recorder = audioCtx = analyser = null;
  }

  async function finish() {
    if (done) return;
    done = true;
    stopped = true;
    cancelAnimationFrame(rafId);
    try { recorder && recorder.stop(); } catch { /* 忽略 */ }
    // ondataavailable 会收最后一块；这里稍等 onstop
  }

  async function start() {
    done = false;
    stopped = false;
    speaking = false;
    silenceMs = 0;
    chunks = [];
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
      const AC = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AC();
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 1024;
      audioCtx.createMediaStreamSource(stream).connect(analyser);

      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
      recorder = new MediaRecorder(stream, { mimeType: mime });
      recorder.addEventListener('dataavailable', (e) => {
        if (e.data && e.data.size) chunks.push(e.data);
      });
      recorder.addEventListener('stop', async () => {
        cleanup();
        if (onEnd) onEnd();
        if (!chunks.length) {
          if (onError) onError('no-speech', '');
          return;
        }
        try {
          const blob = new Blob(chunks, { type: recorder ? (recorder.mimeType || mime) : mime });
          const pcm = await blobToPcm16Base64(blob);
          if (onInterim) onInterim('');
          const text = await transcribeViaXfyun(pcm, dialect);
          if (text && onFinal) onFinal(text);
          else if (onError) onError('no-speech', '');
        } catch (e) {
          if (onError) onError('network', e.message || String(e));
        }
      });
      recorder.start(250);
      if (onStart) onStart();

      const buf = new Float32Array(analyser.fftSize);
      const tick = () => {
        if (stopped) return;
        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        const rms = Math.sqrt(sum / buf.length);
        if (rms > SILENCE_THRESHOLD) {
          speaking = true;
          silenceMs = 0;
        } else if (speaking) {
          silenceMs += 40;
          if (silenceMs >= SILENCE_DURATION) {
            finish();
            return;
          }
        }
        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
    } catch (e) {
      cleanup();
      if (onError) onError('not-allowed', e.message || String(e));
    }
  }

  return {
    start,
    stop: finish,
    abort() {
      stopped = true;
      cancelAnimationFrame(rafId);
      try { recorder && recorder.stop(); } catch { /* 忽略 */ }
      cleanup();
    }
  };
}

// 创建一个"说一句 → 停顿 → 给回这一句"的浏览器内置识别器。
export function createRecognizer({
  lang = 'zh-CN',
  onInterim,   // (text) => void   实时识别，用于把正在说的话显示出来
  onFinal,     // (text) => void   停顿后拿到这一句最终文本
  onError,     // (code, message) => void
  onStart,     // () => void
  onEnd        // () => void
} = {}) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const rec = new SR();
  rec.lang = lang;
  rec.continuous = false; // 说一句，停顿就自动结束
  rec.interimResults = true;
  rec.maxAlternatives = 1;

  let finalText = '';
  let errored = false;

  rec.onstart = () => {
    finalText = '';
    errored = false;
    if (onStart) onStart();
  };
  rec.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalText += r[0].transcript;
      else interim += r[0].transcript;
    }
    if (onInterim) onInterim((finalText + interim).trim());
  };
  rec.onerror = (e) => {
    errored = true;
    if (onError) onError(e.error, e.message || '');
  };
  rec.onend = () => {
    if (onEnd) onEnd();
    const text = finalText.trim();
    if (text && onFinal) onFinal(text);
    else if (!errored && onError) onError('no-speech', '');
  };

  return {
    start() {
      try {
        rec.start();
      } catch (e) {
        if (onError) onError('start-failed', e.message || String(e));
      }
    },
    stop() {
      try { rec.stop(); } catch { /* 忽略 */ }
    },
    abort() {
      try { rec.abort(); } catch { /* 忽略 */ }
    }
  };
}
