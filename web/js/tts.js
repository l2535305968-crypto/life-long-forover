// tts.js — 把 AI 的话念给老人听（语音朗读）。
// 老人眼神、识字都可能有困难，听得见比看得清更管用。
//
// 声音有两档：
//   1. 温暖声音（首选）：本机 Qwen3-TTS（tools/qwen3_tts_server.py）通过 /api/tts 念，
//      有烟火气、不干瘪。服务没起时会自动回退，不打断对话。
//   2. 浏览器朗读（兜底）：speechSynthesis 机器音，任何浏览器都有。
//
// 上层用法不变：speak(text, { rate, onEnd }) / stop() / available() / speaking()。

import { withTokenHeaders } from './token.js';

let zhVoice = null;
let warmEnabled = false;   // /api/health 说 hasTts 为真
let warmProbeState = 'idle'; // idle | probing | done
let warmCoolUntil = 0;     // 上游失败后冷却，避免每句都撞一次
let warmAudio = null;      // 当前正在播的暖声音 <audio>
let nativeSpeaking = false;
let warmDialect = 'putonghua'; // 当前书的方言，随 /api/tts 下发，让服务端做儿化收敛

// ---------- 暖声音（Qwen3-TTS） ----------

// 由 app.js 在拿到 /api/health 后调用，是主开关。
export function setWarmEnabled(enabled) {
  warmEnabled = !!enabled;
  warmProbeState = warmEnabled ? 'done' : 'idle';
}

// 设置当前书的方言，让服务端念出符合场合的儿化/口吻。app.js 在开书/切方言时调用。
export function setDialect(id) {
  warmDialect = id || 'putonghua';
}

// 自己补一次探测（app.js 没跑完 health 时 speak 也能自己判断）。
async function ensureWarmProbe() {
  if (warmProbeState === 'done') return;
  if (warmProbeState === 'probing') return; // 正在探测，等下次
  warmProbeState = 'probing';
  try {
    const res = await fetch('/api/health', { cache: 'no-store' });
    const data = await res.json().catch(() => null);
    warmEnabled = !!(data && data.hasTts);
    warmProbeState = 'done';
  } catch {
    warmEnabled = false;
    warmProbeState = 'done';
  }
}

function warmAvailable() {
  return warmEnabled && Date.now() >= warmCoolUntil;
}

async function speakWarm(text, opts = {}) {
  let audio = null;
  try {
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: withTokenHeaders({ 'content-type': 'application/json' }),
      // dialect 让服务端按这本书的方言做儿化/口吻收敛（见 server/xfyun-tts.mjs normalizeForDialect）
      body: JSON.stringify({ text, dialect: warmDialect, rate: opts.rate != null ? opts.rate : 0.95 })
    });
    if (!res.ok) throw new Error('tts http ' + res.status);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    audio = new Audio(url);
    warmAudio = audio;
    audio.onended = () => {
      URL.revokeObjectURL(url);
      if (warmAudio === audio) warmAudio = null;
      if (typeof opts.onEnd === 'function') opts.onEnd();
    };
    audio.onerror = () => {
      URL.revokeObjectURL(url);
      if (warmAudio === audio) warmAudio = null;
      warmCoolUntil = Date.now() + 15000; // 播放失败，冷却 15 秒再试暖声音
      if (typeof opts.onEnd === 'function') opts.onEnd();
    };
    await audio.play();
  } catch (e) {
    // 上游没起 / 超时：这次退回浏览器朗读，并冷却一会儿别再撞
    warmCoolUntil = Date.now() + 15000;
    if (audio) {
      try { audio.pause(); } catch { /* 忽略 */ }
    }
    speakNative(text, opts);
  }
}

// ---------- 浏览器朗读（兜底） ----------

function pickZhVoice() {
  if (typeof speechSynthesis === 'undefined') return null;
  const voices = speechSynthesis.getVoices();
  if (!voices || !voices.length) return null;
  const cn = voices.filter((v) => /^zh[-_]?/i.test(v.lang));
  const exact = cn.find((v) => /zh[-_]CN/i.test(v.lang)) || cn[0] || null;
  return exact || voices[0] || null;
}

function ensureVoice() {
  if (!zhVoice && available()) {
    zhVoice = pickZhVoice();
    if (typeof speechSynthesis !== 'undefined') {
      speechSynthesis.onvoiceschanged = () => {
        zhVoice = pickZhVoice();
      };
    }
  }
  return zhVoice;
}

function speakNative(text, opts = {}) {
  if (!available()) return false;
  const u = new SpeechSynthesisUtterance(text);
  const voice = ensureVoice();
  if (voice) u.voice = voice;
  u.lang = (voice && voice.lang) || 'zh-CN';
  u.rate = opts.rate != null ? opts.rate : 0.92;
  u.pitch = 1.0;
  u.volume = 1.0;
  nativeSpeaking = true;
  u.onend = () => {
    nativeSpeaking = false;
    if (typeof opts.onEnd === 'function') opts.onEnd();
  };
  u.onerror = () => {
    nativeSpeaking = false;
    if (typeof opts.onEnd === 'function') opts.onEnd();
  };
  speechSynthesis.speak(u);
  return true;
}

// ---------- 对外接口 ----------

export function available() {
  return typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined';
}

// 有没有"任何"能念的通道（暖声音或浏览器都算）。
export function anyTts() {
  return warmEnabled || available();
}

export function speaking() {
  if (warmAudio && !warmAudio.paused && !warmAudio.ended) return true;
  if (nativeSpeaking) return true;
  if (typeof speechSynthesis !== 'undefined' && speechSynthesis.speaking) return true;
  return false;
}

export function speak(text, opts = {}) {
  const t = String(text || '').trim();
  if (!t) return false;
  stop();
  if (warmAvailable()) {
    ensureWarmProbe(); // 已 done 时是空操作
    speakWarm(t, opts); // 失败内部自动回退浏览器
    return true;
  }
  if (warmProbeState !== 'done') {
    // 还没探过 health：先探一下（决定下次用暖声音），这次先用浏览器
    ensureWarmProbe();
    return speakNative(t, opts);
  }
  return speakNative(t, opts);
}

export function stop() {
  if (warmAudio) {
    try {
      warmAudio.pause();
      warmAudio.currentTime = 0;
    } catch { /* 忽略 */ }
    warmAudio = null;
  }
  if (available()) speechSynthesis.cancel();
  nativeSpeaking = false;
}
