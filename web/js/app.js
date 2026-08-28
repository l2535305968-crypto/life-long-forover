// app.js — 人生之书 前端（原生 ESM，无任何外部依赖）
//
// 访谈流程（硬性顺序，见任务书）：
//   addTurn(session,'elder',text,{audioId})
//   → respond(session,text,{audioId}) → nextAiLine(session,engineResult,{aiEnabled})
//   → addTurn(session,'ai',aiText) → 显示 + speak() → saveBook
// 注：nextAiLine 只在引擎给出 question 时请 AI 润色；拒绝/沉默/重复直接返回引擎软话，不绕过。

import { newSession, addTurn, addImage, removeImage, addLog } from './core/model.js';
import { respond, opening, closing } from './core/engine.js';
import { renderDeterministic, lint, stageProgress } from './core/biography.js';
import { buildTimeline } from './core/timeline.js';
import { renderTranscript, renderLog } from './core/transcript.js';
import { dialects } from './core/dialects.js';
import { nextAiLine, generateBiography, callChat } from './ai/adapter.js';
import { listAgents, getActiveAgentId, setActiveAgentId, addAgent, removeAgent, getActiveAgent, personaSystem } from './agents.js';
import { saveBook, loadBook, listBooks, deleteBook, importBookText } from './storage.js';
import { encryptText, decryptText } from './crypto.js';
import { available as ttsAvailable, anyTts, speaking as ttsSpeakingNow, setWarmEnabled, setDialect, speak } from './tts.js';
import { supported as recorderSupported, startRecording, blobToDataUrl } from './recorder.js';
import { processImageFile } from './image.js';
import { createBackground } from './fx/background.js';
import { makeGlassBubble } from './fx/glass.js';
import { createDissolveStage } from './fx/dissolve.js';
import { asrSupported, asrLang, createRecognizer, createXfyunRecognizer } from './asr.js';

// ---------- 状态 ----------
const state = {
  current: null,          // 当前打开的 session
  aiEnabled: false,
  aiChecked: false,
  pendingAudioId: null,   // 本轮录音，提交时附上
  recorder: null,         // 正在录的句柄 {stream, stop}
  sending: false,
  warmedThisLoad: false,  // 这次打开书是否已经念过开场白
  saving: false,
  pendingDelete: null,    // 正在等删除确认的那本书（书架× / 访谈都写这里）
  // 语音优先（ASR）
  autoListen: false,      // 大麦克风的自动听循环是否开启
  asrActive: false,       // 识别器正在运行
  asrUnusable: false,     // 识别不可用（不支持/权限/网络）→ 回退手写
  recognizer: null,       // 当前识别器句柄
  aiSpeaking: false,      // AI 正在念话，绝不开麦
  aiSeq: 0,               // 念话序号，防旧的 onEnd 干扰
  asrRetryTimer: null,
  hasAsr: false,          // /api/health 告知服务端讯飞识别链路是否可用
  forceBrowserAsr: false, // 讯飞隧道网络失败后，暂时只走浏览器识别（普通话），识别成功即撤销
  asrFallbackReason: null, // 'env'（环境不行，可被 health 恢复）| 'runtime'（运行期出错）
  asrAborted: false,      // 手动丢弃本句（讯飞 abort 后仍可能回调 onFinal，用它挡掉）
  chatExpanded: false     // 对话区是否被用户手动展开（展开后新消息不再自动收）
};

// ---------- 小工具 ----------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, String(v));
  }
  for (const c of children) {
    if (c == null) continue;
    node.append(c.nodeType ? c : document.createTextNode(c));
  }
  return node;
}

function iconNode(name, cls = 'ic') {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', cls);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const use = document.createElementNS(ns, 'use');
  use.setAttribute('href', '#i-' + name);
  svg.append(use);
  return svg;
}

let toastTimer = null;
function toast(msg, tone = '') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast' + (tone ? ' toast--' + tone : '');
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 4200);
}

function fmtTime(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('zh-CN', {
      month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  } catch {
    return '—';
  }
}

function dialectName(id) {
  const p = dialects.packs.find((x) => x.id === id);
  return p ? p.name : '';
}

// ---------- 本地设置（打字输入开关等，存 localStorage，不上传） ----------
const SETTINGS_KEY = 'rss.settings.v1';

function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    return s && typeof s === 'object' ? s : {};
  } catch {
    return {};
  }
}
function saveSettings(s) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}
function typingEnabled() {
  return !!loadSettings().typing;
}
function setTypingEnabled(on) {
  const s = loadSettings();
  s.typing = !!on;
  saveSettings(s);
  applyTyping();
}
function applyTyping() {
  const on = typingEnabled();
  const row = $('#text-row');
  if (row) row.hidden = !on;
  const toggle = $('#set-typing');
  if (toggle) toggle.checked = on;
}

// ---------- 表单错误（blur 触发的 touched 模式） ----------
function setErr(inputSel, msg) {
  const input = $(inputSel);
  input.setAttribute('aria-invalid', 'true');
  const note = input.getAttribute('aria-describedby') ? $('#' + input.getAttribute('aria-describedby')) : null;
  if (note) {
    note.textContent = msg;
    note.classList.add('field__note--error');
  }
}
function clearErr(inputSel) {
  const input = $(inputSel);
  input.removeAttribute('aria-invalid');
  const note = input.getAttribute('aria-describedby') ? $('#' + input.getAttribute('aria-describedby')) : null;
  if (note) {
    note.textContent = note.dataset.helper || '';
    note.classList.remove('field__note--error');
  }
}
function wireTouched(inputSel, errMsg) {
  const input = $(inputSel);
  input.addEventListener('blur', () => {
    if (!input.value.trim()) setErr(inputSel, errMsg);
  });
  input.addEventListener('input', () => clearErr(inputSel));
}

// ---------- 保存（每轮都存；录音/开场白等用防抖） ----------
let saveTimer = null;
function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveNow(); }, 400);
}
async function saveNow() {
  const s = state.current;
  if (!s || state.saving) return;
  state.saving = true;
  try {
    await saveBook(s);
  } catch {
    toast('没存上，这一句可能丢了。别退出，稍后会自动再存。', 'error');
  }
  state.saving = false;
}
window.addEventListener('pagehide', () => {
  if (state.current) saveBook(state.current).catch(() => {});
});

// ---------- 朗读 ----------
// 念话。opts.onEnd 只在"念完"后才触发（TTS 不可用时给一点延时再触发）。
// 自动听循环靠它重启，保证不会一边念一边听。
function speakIt(text, opts = {}) {
  const seq = ++state.aiSeq;
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    if (seq !== state.aiSeq) return; // 已被更新的念话取代，旧回调作废
    state.aiSpeaking = false;
    updateVoiceBtn();
    if (typeof opts.onEnd === 'function') opts.onEnd();
  };
  if (anyTts()) {
    state.aiSpeaking = true;
    const ok = speak(text, { rate: 0.92, onEnd: finish });
    if (!ok) {
      state.aiSpeaking = false;
      setTimeout(finish, 350);
    } else {
      // 兜底：个别浏览器/WebView 的 onend 可能漏触发，超时强制收尾，
      // 否则 aiSpeaking 会卡死、麦克风被永久锁住。按文本长度估一个宽松上限。
      const maxMs = Math.min(30000, Math.max(4000, String(text).length * 500));
      setTimeout(finish, maxMs);
    }
  } else {
    setTimeout(finish, 350);
  }
}

// 让暖声音按当前书的方言念（儿化/口吻收敛）。开书、切方言都走这里。
function syncTtsDialect() {
  const s = state.current;
  setDialect((s && s.person && s.person.dialect) || 'putonghua');
}

// ---------- 按钮 loading 态 ----------
function setLoading(btn, label) {
  btn.dataset.origHtml = btn.innerHTML;
  btn.innerHTML = '';
  btn.textContent = label;
  btn.classList.add('is-loading');
  btn.disabled = true;
  btn.setAttribute('aria-busy', 'true');
}
function clearLoading(btn) {
  btn.classList.remove('is-loading');
  btn.disabled = false;
  btn.removeAttribute('aria-busy');
  if (btn.dataset.origHtml != null) {
    btn.innerHTML = btn.dataset.origHtml;
    delete btn.dataset.origHtml;
  }
}

// ---------- AI 状态 ----------
async function checkAi() {
  const chip = $('#ai-status');
  try {
    const res = await fetch('/api/health', { cache: 'no-store' });
    const data = await res.json().catch(() => null);
    state.aiEnabled = !!(data && data.ok && data.hasKey);
    state.hasAsr = !!(data && data.hasAsr);
    setWarmEnabled(!!(data && data.hasTts)); // 暖声音可用（Qwen3-TTS 本地服务）
  } catch {
    state.aiEnabled = false;
    state.hasAsr = false;
    setWarmEnabled(false);
  }
  state.aiChecked = true;
  syncVoiceAvailability();
  if (chip) {
    if (state.aiEnabled) {
      chip.textContent = 'AI 在线';
      chip.dataset.state = 'online';
    } else {
      chip.textContent = 'AI 离线（用内置问题）';
      chip.dataset.state = 'offline';
    }
  }
}

// ---------- 视图路由 ----------
const VIEWS = ['shelf', 'interview', 'photos', 'timeline', 'bio'];

function showView(name) {
  if (!VIEWS.includes(name)) name = 'shelf';
  if (['interview', 'timeline', 'bio', 'photos'].includes(name) && !state.current) name = 'shelf';

  // 离开访谈：关掉自动听循环和正在听的麦克风
  if (name !== 'interview') {
    state.autoListen = false;
    stopRecognition();
  }

  for (const v of VIEWS) {
    const sec = $('#view-' + v);
    const active = v === name;
    sec.hidden = !active;
    sec.classList.toggle('is-active', active);
  }
  for (const item of $$('.drawer-nav__item')) {
    if (item.dataset.view === name) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  }

  const h1 = $('#view-' + name + ' .view__title');
  if (h1) {
    h1.tabIndex = -1;
    h1.focus({ preventScroll: true });
  }

  if (name === 'shelf') renderShelf();
  else if (name === 'interview') enterInterview();
  else if (name === 'photos') renderPhotos();
  else if (name === 'timeline') renderTimeline();
  else if (name === 'bio') renderBioView();
}

// ---------- 书架 ----------
async function renderShelf() {
  const listEl = $('#book-list');
  const emptyEl = $('#shelf-empty');
  let books = [];
  try {
    books = await listBooks();
  } catch {
    toast('书架打不开了，稍后再试', 'error');
    return;
  }
  books.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));

  listEl.replaceChildren();
  if (!books.length) {
    emptyEl.hidden = false;
    listEl.hidden = true;
    return;
  }
  emptyEl.hidden = true;
  listEl.hidden = false;
  for (const b of books) listEl.append(makeBookCard(b));
}

function makeBookCard(b) {
  const name = (b.person && b.person.name) || '（未起名）';
  const dname = dialectName(b.person && b.person.dialect);
  const when = fmtTime(b.updatedAt);
  const n = (b.moments || []).length;
  const p = (b.images || []).length;
  const storyLine = n
    ? '已记下 ' + n + ' 段故事' + (p ? ' · ' + p + ' 张照片' : '')
    : p
      ? '有 ' + p + ' 张照片，点开看看'
      : '还没记下故事，点开聊聊';
  const card = el('button', { class: 'book-card', type: 'button' },
    el('span', { class: 'book-card__name', text: name }),
    el('span', {
      class: 'book-card__meta',
      text: (dname ? dname + ' · ' : '') + '最后聊于 ' + when
    }),
    el('span', { class: 'book-card__meta', text: storyLine })
  );
  // 删除按钮：嵌在卡片（也是 button）里，故用 role="button" 的 <span>，
  // 并 stopPropagation 防止冒泡触发出卡片本身的"打开"。
  const del = el('span', {
    class: 'book-card__del',
    role: 'button',
    tabindex: '0',
    title: '删除《' + name + '》',
    'aria-label': '删除《' + name + '》'
  });
  del.append(iconNode('trash'));
  del.addEventListener('click', (e) => {
    e.stopPropagation();
    askDeleteBook(b);
  });
  del.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      askDeleteBook(b);
    }
  });
  card.append(del);
  card.addEventListener('click', () => openBook(b.id));
  return card;
}

async function openBook(id) {
  try {
    const s = await loadBook(id);
    if (!s) {
      toast('这本书找不到了', 'error');
      renderShelf();
      return;
    }
    state.current = s;
    state.pendingAudioId = null;
    state.warmedThisLoad = false;
    state.chatExpanded = false;   // 每本书新开，对话区都从"收起"开始
    addLog(s, 'open', '打开这本书');
    $('#appbar-book').textContent = (s.person && s.person.name) || '（未起名）';
    $('#appbar-book').hidden = false;
    showView('interview');
  } catch {
    toast('打开这本书失败了', 'error');
  }
}

// ---------- 新建书 ----------
function resetNewForm() {
  const name = $('#new-name');
  name.value = '';
  clearErr('#new-name');
  $('#new-dialect').value = 'putonghua';
}

function wireNewBook() {
  const select = $('#new-dialect');
  select.replaceChildren(
    ...dialects.packs.map((p) =>
      el('option', { value: p.id, text: p.name + '（' + p.area + '）' })
    )
  );
  select.value = 'putonghua';
  wireTouched('#new-name', '给书起个称呼，比如"姥爷"。');

  $('#btn-new-book').addEventListener('click', () => {
    resetNewForm();
    $('#dlg-new').showModal();
    $('#new-name').focus();
  });

  $('#form-new').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('#new-name').value.trim();
    if (!name) {
      setErr('#new-name', '给书起个称呼，比如"姥爷"。');
      $('#new-name').focus();
      return;
    }
    const s = newSession({ personName: name, dialect: $('#new-dialect').value });
    try {
      await saveBook(s);
      $('#dlg-new').close();
      state.current = s;
      state.pendingAudioId = null;
      state.warmedThisLoad = false;
      $('#appbar-book').textContent = s.person.name;
      $('#appbar-book').hidden = false;
      showView('interview');
    } catch {
      toast('这本书没存下来，换个称呼再试一次', 'error');
    }
  });
}

// ---------- 访谈 ----------
function enterInterview() {
  const s = state.current;
  if (!s) return;
  syncTtsDialect();
  // 标题只留一个：进了书，顶上 appbar 就显示书名了，这里不再重复放"和XX聊聊"。
  // 顶栏书名占位，正文标题收起，只留一双眼看得到的大标题（appbar），避免上下两个标题打架。
  $('#title-interview').hidden = Boolean(s.person && s.person.name);

  renderChat(s);
  refreshChatCollapse();

  // 开场：没有对话时才说。opening() 会先暖场，再带出第一个具体问题，
  // 并同步在引擎里种下这个问题（有字段归属），老人第一句话就不会掉进
  // "没问就先答"的空档。它改 session 状态，所以每本书只调一次，
  // 用 meta.openingText 记住，避免重进视图时重复种问题。
  if ((s.turns || []).length === 0) {
    if (!s.meta.openingText) {
      const o = opening(s);
      s.meta.openingText = o && o.text ? o.text : '咱们随便聊聊，想到哪儿说到哪儿。';
      saveSoon();
    }
    appendWarm(s.meta.openingText);
    if (!state.warmedThisLoad) {
      state.warmedThisLoad = true;
      // 开场白念完再放话筒：浏览器要一次手势才能开麦，等老人点一下
      speakIt(s.meta.openingText, {
        onEnd: () => {
          if (voiceCapable() && !state.asrUnusable) {
            state.autoListen = false;
            setComposerStatus('点一下开始说话。');
          }
        }
      });
    }
  } else if (voiceCapable() && !state.asrUnusable && !state.sending) {
    // 聊过的书再进来：话筒就绪
    if (!$('#composer-status').textContent) setComposerStatus('点一下开始说话。');
  }

  renderInterviewPhoto();
  checkAi();
}

function renderChat(s) {
  const chat = $('#chat-stream');
  chat.replaceChildren();
  for (const t of s.turns || []) {
    if (t.role === 'elder') appendMsg('elder', t.text);
    else if (t.role === 'ai') appendMsg('ai', t.text);
  }
}

function appendMsg(role, text) {
  const chat = $('#chat-stream');
  const wrap = makeGlassBubble({ role, text, replay: role === 'ai' });
  if (role === 'ai') {
    const rep = wrap.querySelector('.glass__replay');
    if (rep) {
      rep.append(iconNode('speaker'));
      rep.addEventListener('click', () => { stopRecognition(); speakIt(text); });
    }
  }
  chat.append(wrap);
  chat.scrollTop = chat.scrollHeight;
  refreshChatCollapse();   // 每条新消息进来，都重新看要不要收/展开
}

function appendWarm(text) {
  const chat = $('#chat-stream');
  if (chat.querySelector('.msg--warm')) return;
  const wrap = makeGlassBubble({ role: 'warm', text, replay: true });
  wrap.append(el('p', { class: 'glass__meta msg__meta', text: '开场白' }));
  const rep = wrap.querySelector('.glass__replay');
  if (rep) {
    rep.setAttribute('aria-label', '再念一遍开场白');
    rep.append(iconNode('speaker'));
    rep.addEventListener('click', () => speakIt(text));
  }
  chat.prepend(wrap);
  chat.scrollTop = chat.scrollHeight;
}

// ---------- 对话折叠：语音优先，默认只露最新一句，点一下展开全部 ----------
function refreshChatCollapse() {
  const wrap = $('#view-interview').querySelector('.chat-wrap');
  const btn = $('#btn-chat-toggle');
  if (!wrap || !btn) return;
  const n = $$('#chat-stream .glass').length;
  // 只有一条以上才给"查看/收起"开关；一条都不用收，纯语音开场。
  const canCollapse = n > 1;
  btn.hidden = !canCollapse;
  if (!canCollapse) {
    wrap.classList.remove('is-collapsed');
    btn.setAttribute('aria-expanded', 'false');
    syncChatToggleLabel();
    return;
  }
  // 记忆用户的选择：本会话里手动展开过就不再自动收（否则每句新消息都把它挤回去）。
  if (!state.chatExpanded) {
    wrap.classList.add('is-collapsed');
    btn.setAttribute('aria-expanded', 'false');
  } else {
    wrap.classList.remove('is-collapsed');
    btn.setAttribute('aria-expanded', 'true');
  }
  syncChatToggleLabel();
}

function syncChatToggleLabel() {
  const btn = $('#btn-chat-toggle');
  const label = $('#chat-toggle-label');
  if (!btn || !label) return;
  const expanded = btn.getAttribute('aria-expanded') === 'true';
  label.textContent = expanded ? '收起记录' : '查看全部记录';
}

function wireChatToggle() {
  const btn = $('#btn-chat-toggle');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const wrap = $('#view-interview').querySelector('.chat-wrap');
    if (!wrap) return;
    const expanding = wrap.classList.contains('is-collapsed');
    if (expanding) {
      state.chatExpanded = true;         // 展开后，消息来了也别自动收
      wrap.classList.remove('is-collapsed');
      btn.setAttribute('aria-expanded', 'true');
      const chat = $('#chat-stream');
      chat.scrollTop = chat.scrollHeight; // 展开后滚到能看到最新
    } else {
      state.chatExpanded = false;
      wrap.classList.add('is-collapsed');
      btn.setAttribute('aria-expanded', 'false');
    }
    syncChatToggleLabel();
  });
}

function setComposerStatus(text) {
  const st = $('#composer-status');
  st.replaceChildren();
  if (!text) return;
  if (state.pendingAudioId) {
    st.append(document.createTextNode(text + ' '));
    const undo = el('button', { class: 'btn btn--ghost btn--sm', type: 'button', text: '取消原声' });
    undo.addEventListener('click', () => {
      const s = state.current;
      if (s && state.pendingAudioId) {
        s.audio = (s.audio || []).filter((a) => a.id !== state.pendingAudioId);
      }
      state.pendingAudioId = null;
      setComposerStatus('');
      saveSoon();
    });
    st.append(undo);
  } else {
    st.textContent = text;
  }
}

// ---------- 提交一句（语音/打字共用内核，流程固定） ----------
async function commitElder(text, { audioId = null } = {}) {
  const s = state.current;
  if (!s || state.sending) return;
  const t = String(text || '').trim();
  if (!t) return;
  const audioOpt = audioId ? { audioId } : {};

  state.sending = true;
  setControlsBusy(true);
  $('#asr-interim').hidden = true;
  $('#asr-interim').textContent = '';
  clearTimeout(state.asrRetryTimer);

  addTurn(s, 'elder', t, audioOpt);
  appendMsg('elder', t);
  if (audioId) {
    state.pendingAudioId = null;
    setComposerStatus('');
  }

  let engineResult = null;
  try {
    engineResult = respond(s, t, audioOpt);
  } catch {
    engineResult = null;
    toast('这一句没接住，先歇一下再聊', 'error');
  }

  if (engineResult) {
    setComposerStatus('想想怎么说…');
    let aiText = '';
    const activeAgent = getActiveAgent();
    // 脚本智能体：只接管"正常推进（有 question）"的回话；拒绝/沉默/重复仍走引擎软话。
    if (engineResult.question && activeAgent && activeAgent.kind === 'script' && typeof activeAgent.reply === 'function') {
      try {
        const out = await activeAgent.reply({
          elderText: t,
          engineReply: engineResult.reply,
          engineQuestion: engineResult.question ? engineResult.question.text : null,
          history: (s.turns || []).slice(-24).map((x) => ({ role: x.role === 'elder' ? 'user' : 'assistant', text: x.text })),
          callChat: (messages, opts) => callChat(messages, opts)
        });
        if (typeof out === 'string' && out.trim()) aiText = out.trim();
      } catch {
        toast('智能体脚本出错了，先用默认回话。', 'error');
      }
    }
    if (!aiText) {
      const agentSystem = activeAgent && activeAgent.kind === 'prompt' ? personaSystem(activeAgent) : '';
      try {
        aiText = await nextAiLine(s, engineResult, { aiEnabled: state.aiEnabled, agentSystem });
      } catch {
        aiText = engineResult.reply || '';
      }
    }
    if (!aiText) aiText = engineResult.reply || '';
    setComposerStatus('');
    addTurn(s, 'ai', aiText);
    appendMsg('ai', aiText);
    // 关键：AI 念完（speak 的 onEnd）才决定是否接着听，绝不一边念一边听
    const seq = state.aiSeq + 1;
    speakIt(aiText, { onEnd: () => maybeRestartListening(seq) });
  }

  state.sending = false;
  setControlsBusy(false);
  await saveNow();
}

// 手写 / 家人改字路径
async function submitTyped() {
  const s = state.current;
  if (!s || state.sending) return;
  if (state.recorder) {
    toast('先松手保存这段录音，再发送');
    return;
  }

  const input = $('#elder-input');
  const text = input.value.trim();
  const audioId = state.pendingAudioId;

  if (!text && !audioId) {
    toast('先在下面写两句，或按住"留原声"存原声');
    input.focus();
    return;
  }

  if (!text) {
    // 只有原声、还没有文字：不把占位句当成老人的话喂给引擎，避免污染时间线和传记。
    const displayText = '（这段只有原声，把文字补上再继续）';
    const audioOpt = audioId ? { audioId } : {};
    addTurn(s, 'elder', displayText, audioOpt);
    appendMsg('elder', displayText);
    input.value = '';
    if (audioId) {
      state.pendingAudioId = null;
      setComposerStatus('');
    }
    setComposerStatus('这段只有原声。把老人说的字补进去，我才能接着聊。');
    saveNow();
    input.focus();
    return;
  }

  await commitElder(text, { audioId });
  input.value = '';
  input.focus();
}

// ---------- 录音 ----------
const canRecord = window.isSecureContext === true && recorderSupported();
let recTimer = null;

function setRecordLabel(text) {
  const l = $('#record-label');
  if (l) l.textContent = text;
}

async function beginRecord() {
  if (state.recorder || state.sending) return;
  try {
    const rec = await startRecording();
    state.recorder = rec;
    const btn = $('#btn-record');
    btn.classList.add('is-recording');
    setRecordLabel('松手保存');
    let secs = 0;
    setComposerStatus('正在录音…');
    clearInterval(recTimer);
    recTimer = setInterval(() => {
      secs += 1;
      setComposerStatus('正在录音 ' + secs + ' 秒，说完松手');
    }, 1000);
  } catch {
    setRecordLabel('留原声');
    toast('没拿到麦克风。看看是不是没允许录音权限。', 'error');
  }
}

async function endRecord(keep) {
  const rec = state.recorder;
  if (!rec) return;
  state.recorder = null;
  clearInterval(recTimer);
  recTimer = null;

  const btn = $('#btn-record');
  btn.classList.remove('is-recording');
  setRecordLabel('留原声');

  let out = null;
  try {
    out = await rec.stop();
  } catch {
    out = null;
  }

  if (!keep || !out || !out.blob || out.size === 0) {
    setComposerStatus('');
    return;
  }

  const s = state.current;
  if (!s) return;

  const audioId = 'a_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  // 原声存成 dataURL，才能随书加密导出（Blob 会被 JSON.stringify 丢掉）。
  let dataUrl = null;
  try {
    dataUrl = await blobToDataUrl(out.blob);
  } catch {
    dataUrl = null;
  }
  s.audio = s.audio || [];
  s.audio.push({
    id: audioId,
    mime: out.mime,
    size: out.size,
    durationMs: out.durationMs,
    dataUrl,
    ts: new Date().toISOString()
  });
  state.pendingAudioId = audioId;

  const secs = Math.max(1, Math.round(out.durationMs / 1000));
  setComposerStatus('已录下 ' + secs + ' 秒原声，发送时会一起存进这本书');
  saveSoon();
}

function wireInterview() {
  const input = $('#elder-input');

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      submitTyped();
    }
  });

  $('#btn-send').addEventListener('click', submitTyped);

  const recBtn = $('#btn-record');
  if (!canRecord) {
    recBtn.hidden = true;
    $('#rec-unsupported').hidden = false;
  } else {
    recBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try { recBtn.setPointerCapture(e.pointerId); } catch { /* 忽略 */ }
      beginRecord();
    });
    recBtn.addEventListener('pointerup', (e) => {
      e.preventDefault();
      endRecord(true);
    });
    recBtn.addEventListener('pointercancel', () => endRecord(false));
    recBtn.addEventListener('keydown', (e) => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        if (state.recorder) endRecord(true);
        else beginRecord();
      }
    });
  }

  $('#btn-end').addEventListener('click', async () => {
    const s = state.current;
    if (!s) return;
    state.autoListen = false;
    stopRecognition();
    const close = closing(s) || '今天先聊到这儿，改天接着聊。';
    addTurn(s, 'ai', close);
    appendMsg('ai', close);
    speakIt(close);
    await saveNow();
    showView('shelf');
  });
}

// ---------- 语音识别（ASR）----------
// 环境有没有可能听：服务端讯飞（hasAsr），或浏览器内置
function voiceCapable() {
  return state.hasAsr || asrSupported();
}

let controlsBusy = false;
let asrGen = 0; // 识别器代次：每次 startListening 自增，旧识别器的回调据此作废，避免串扰

// 语音合成是否还在出声（onend 可能提前/漏触发，用它做双保险，避免开麦采到 AI 的声音）
function ttsSpeaking() {
  try {
    return ttsSpeakingNow(); // 暖声音（Qwen3-TTS）播放中也算在念，避免一边念一边听
  } catch {
    return false;
  }
}

function setControlsBusy(busy) {
  controlsBusy = busy;
  $('#btn-send').disabled = busy;
  if (canRecord) $('#btn-record').disabled = busy;
  updateVoiceBtn();
}

function updateVoiceBtn() {
  const btn = $('#btn-voice');
  if (!btn) return;
  btn.disabled = controlsBusy || state.aiSpeaking || state.asrUnusable;
  btn.classList.toggle('is-listening', state.asrActive);
  if (state.asrActive) {
    btn.setAttribute('aria-label', '正在听，点一下暂停');
    btn.setAttribute('aria-pressed', 'true');
  } else {
    btn.setAttribute('aria-label', '点一下开始说话');
    btn.setAttribute('aria-pressed', 'false');
  }
}

function startListening() {
  if (state.asrUnusable || state.asrActive || state.sending || state.aiSpeaking || ttsSpeaking()) return;
  const s = state.current;
  if (!s) return;

  const gen = ++asrGen;
  const callbacks = {
    onInterim: (text) => {
      // 浏览器内置才有逐字 interim；讯飞是"说完才返回"，保持为空即可
      if (gen !== asrGen) return;
      $('#asr-interim').textContent = text || '';
    },
    onStart: () => {
      if (gen !== asrGen) return;
      state.asrActive = true;
      updateVoiceBtn();
      $('#asr-interim').hidden = false;
      setComposerStatus('正在听，说完停一下就行…');
    },
    onFinal: (text) => { if (gen !== asrGen) return; handleAsrFinal(text); },
    onError: (code, message) => { if (gen !== asrGen) return; handleAsrError(code, message); },
    onEnd: () => { if (gen !== asrGen) return; handleAsrEnd(); }
  };

  // 按 hasAsr 选识别器：服务端讯飞优先（安卓/微信/方言都能用），否则浏览器内置，都没有则回退。
  // 若刚网络失败被降到浏览器（forceBrowserAsr），本次先走浏览器，避免反复撞不通的隧道。
  let rec = null;
  if (state.hasAsr && !state.forceBrowserAsr) {
    rec = createXfyunRecognizer({ dialect: (s.person && s.person.dialect) || 'putonghua', ...callbacks });
  } else if (asrSupported()) {
    rec = createRecognizer({ lang: asrLang(s.person && s.person.dialect), ...callbacks });
  }

  if (!rec) {
    handleAsrError('unsupported');
    return;
  }
  state.asrAborted = false;
  state.recognizer = rec;
  rec.start();
}

function stopRecognition() {
  clearTimeout(state.asrRetryTimer);
  if (state.recognizer) {
    try { state.recognizer.stop(); } catch { /* 忽略 */ }
  }
  state.recognizer = null;
  state.asrActive = false;
  $('#asr-interim').hidden = true;
  $('#asr-interim').textContent = '';
  updateVoiceBtn();
}

function abortRecognition() {
  clearTimeout(state.asrRetryTimer);
  if (state.recognizer) {
    try { state.recognizer.abort(); } catch { /* 忽略 */ }
  }
  state.recognizer = null;
  state.asrActive = false;
  // 讯飞 abort 后仍可能回调 onFinal，挡掉这一句
  state.asrAborted = true;
  $('#asr-interim').hidden = true;
  $('#asr-interim').textContent = '';
  updateVoiceBtn();
}

// 识别结束（讯飞 onEnd 先到、onFinal 异步后到；浏览器 onEnd 先到、onFinal 同步随后）
// 这里只做收尾，不再自动重听：是否重听交由 onFinal（有话说 → commitElder 后重启）
// 或 onError('no-speech')（没听见 → 延迟重听）决定，避免在上一句还没转出来前就再次开麦。
function handleAsrEnd() {
  state.asrActive = false;
  state.recognizer = null;
  $('#asr-interim').hidden = true;
  $('#asr-interim').textContent = '';
  updateVoiceBtn();
}

function handleAsrFinal(text) {
  clearTimeout(state.asrRetryTimer);
  // 识别成功：撤掉浏览器降级标记，下句回到优先讯飞（方言）再试。
  state.forceBrowserAsr = false;
  $('#asr-interim').hidden = true;
  $('#asr-interim').textContent = '';
  if (state.asrAborted) {
    state.asrAborted = false;
    return;
  }
  const t = String(text || '').trim();
  if (!t) return;
  commitElder(t, { audioId: state.pendingAudioId });
}

function handleAsrError(code) {
  clearTimeout(state.asrRetryTimer);
  state.asrActive = false;
  state.recognizer = null;
  $('#asr-interim').hidden = true;
  $('#asr-interim').textContent = '';
  updateVoiceBtn();
  if (code === 'not-allowed') {
    setComposerStatus('没给麦克风权限，去设置里允许一下，再点一次。');
    toast('没给麦克风权限，去设置里允许一下', 'error');
  } else if (code === 'no-speech') {
    // 只在自动听模式下提示并重试；手动"按住说"或暂停时静默忽略，避免误弹"没听见"
    if (state.autoListen) {
      setComposerStatus('没听见，再说一遍就行。');
      state.asrRetryTimer = setTimeout(() => {
        if (state.autoListen && !state.asrActive && !state.sending && !state.aiSpeaking && !ttsSpeaking()) startListening();
      }, 900);
    }
  } else if (code === 'network') {
    // 服务端 / 讯飞隧道不通。别急着把语音整个关掉：如果浏览器自己也能识别（普通话），
    // 就降级到浏览器识别，老人还能出声；实在不行才回退手写。
    if (asrSupported()) {
      setComposerStatus('方言识别暂时不通，先用普通话听，你继续说就行。');
      state.forceBrowserAsr = true;
      if (state.autoListen) {
        state.asrRetryTimer = setTimeout(() => {
          if (state.autoListen && !state.asrActive && !state.sending && !state.aiSpeaking && !ttsSpeaking()) startListening();
        }, 900);
      }
    } else {
      setComposerStatus('语音识别暂时不通，用输入法听写或打字。');
      toast('语音识别暂时不通，用输入法听写或打字', 'error');
      setVoiceFallback('runtime');
    }
  } else if (code === 'aborted') {
    // 主动 abort（长按换句 / 取消）产生的 aborted，不是环境问题，静默忽略
  } else {
    // start-failed / unsupported / 其他：环境听不了 → 回退手写，说句实话
    setVoiceFallback('env');
    toast('这台手机或这个浏览器听不了语音，用输入法自带的语音听写，或请家人帮着打字', 'error');
  }
}

// AI 念完这句之后：自动听开着就重启一轮（绝不会在念的时候开麦；留足余量避免采到回声）
function maybeRestartListening(seq) {
  if (seq !== state.aiSeq) return;
  if (!state.autoListen || state.asrUnusable || state.sending || state.asrActive) return;
  clearTimeout(state.asrRetryTimer);
  state.asrRetryTimer = setTimeout(() => {
    if (state.autoListen && !state.asrActive && !state.sending && !state.aiSpeaking && !ttsSpeaking()) startListening();
  }, 600);
}

// 识别不可用 → 回退手写输入。reason: 'env'（环境本来就不行，health 回来后可以恢复）
// 或 'runtime'（运行期出错，不自动复活）
function setVoiceFallback(reason = 'runtime') {
  state.asrUnusable = true;
  state.asrFallbackReason = reason;
  state.autoListen = false;
  abortRecognition();
  $('#btn-voice').hidden = true;
  $('#voice-hint').hidden = true;
  $('#asr-fallback-note').hidden = false;
  setTypingEnabled(true); // 听不了语音就自动打开打字，家人可以帮敲字
  updateVoiceBtn();
}

// health 拿到 hasAsr 后重算一次语音可用性：
// 环境具备能力就把之前"环境不行"的回退撤销；确实不行就回退。
function syncVoiceAvailability() {
  if (!voiceCapable()) {
    if (!state.asrUnusable) setVoiceFallback('env');
    return;
  }
  if (state.asrUnusable && state.asrFallbackReason === 'env') {
    state.asrUnusable = false;
    state.asrFallbackReason = null;
    $('#btn-voice').hidden = false;
    $('#voice-hint').hidden = false;
    $('#asr-fallback-note').hidden = true;
    updateVoiceBtn();
  }
}

function expandTextRow() {
  $('#text-row').hidden = false;
}

function wireVoice() {
  const btn = $('#btn-voice');
  const HOLD_MS = 350;
  let pressTimer = null;
  let holding = false;       // 是否已判定为"按住说"
  let pressWasAuto = false;  // 按下前 autoListen 的状态，用于点一下时决定开/关

  // 点击波纹：在按钮中心扩散一圈，animationend 后移除
  function spawnRipple() {
    const ring = document.createElement('span');
    ring.className = 'ripple-ring';
    const host = btn.querySelector('.btn-voice__ripple');
    if (host) host.append(ring);
    ring.addEventListener('animationend', () => ring.remove());
  }

  // 点一下 = 切换连续听。以按下前的状态为准，避免和"按住说"互相抢状态。
  function tapToggle() {
    if (state.asrUnusable) {
      setVoiceFallback('env');
      return;
    }
    if (pressWasAuto) {
      // 之前在连续听 → 点一下 = 暂停
      state.autoListen = false;
      stopRecognition();
      setComposerStatus('歇会儿。想听的时候再点一下。');
    } else {
      // 之前没在听 → 点一下 = 开始连续听
      state.autoListen = true;
      startListening();
    }
  }

  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (state.sending || state.aiSpeaking || state.asrUnusable) return;
    try { btn.setPointerCapture(e.pointerId); } catch { /* 忽略 */ }
    spawnRipple();
    holding = false;
    pressWasAuto = state.autoListen;
    clearTimeout(pressTimer);
    // 长按判定：到点后进入"按住说"（先丢弃当前连续听，避免双麦），松手才结束这一句
    pressTimer = setTimeout(() => {
      if (state.asrUnusable || state.sending || state.aiSpeaking || ttsSpeaking()) return;
      holding = true;
      state.autoListen = false;
      if (state.recognizer) abortRecognition();
      startListening();
    }, HOLD_MS);
  });

  btn.addEventListener('pointerup', (e) => {
    e.preventDefault();
    clearTimeout(pressTimer);
    if (holding) {
      // 长按松手：结束这一句（识别器 onFinal 会提交给引擎）
      holding = false;
      stopRecognition();
      return;
    }
    if (state.sending || state.aiSpeaking) return;
    tapToggle();
  });

  btn.addEventListener('pointercancel', () => {
    clearTimeout(pressTimer);
    if (holding) {
      holding = false;
      abortRecognition();
    }
  });

  // 键盘可达：空格 / 回车 = 点一下切换
  btn.addEventListener('keydown', (e) => {
    if (e.key !== ' ' && e.key !== 'Enter') return;
    e.preventDefault();
    if (state.asrUnusable || state.sending || state.aiSpeaking) return;
    spawnRipple();
    pressWasAuto = state.autoListen;
    tapToggle();
  });

  // 语音可用性以 health 的 hasAsr + 浏览器支持为准；health 回来后（checkAi）会再算一次
  syncVoiceAvailability();
}

// ---------- 时间线 ----------
function playMomentAudio(audioId) {
  const s = state.current;
  if (!s) return;
  const a = (s.audio || []).find((x) => x.id === audioId);
  if (!a || !a.dataUrl) {
    toast('这段原声已经不在手机上了', 'error');
    return;
  }
  const audio = new Audio(a.dataUrl);
  audio.play().catch(() => toast('没能播放这段原声', 'error'));
}

function renderTimeline() {
  const s = state.current;
  if (!s) return;
  const listEl = $('#timeline-list');
  const emptyEl = $('#timeline-empty');
  listEl.replaceChildren();

  let t;
  try {
    t = buildTimeline(s);
  } catch {
    toast('时间线算不出来，先聊几句再回来看', 'error');
    return;
  }

  if (!t.groups || t.groups.length === 0) {
    listEl.hidden = true;
    emptyEl.hidden = false;
    return;
  }
  listEl.hidden = false;
  emptyEl.hidden = true;

  const name = (s.person && s.person.name) || '这本书';
  listEl.append(el('p', { class: 'lede', text: name + '已经聊出 ' + t.totalMoments + ' 段故事，按人生阶段归拢在这里。' }));

  for (const g of t.groups) {
    const card = el('section', { class: 'card timeline-group' });
    card.append(el('h2', { class: 'timeline-group__name', text: g.name }));
    for (const m of g.moments) {
      const row = el('div', { class: 'moment' });
      row.append(el('p', { class: 'moment__text', text: m.text }));
      if (m.audioId) {
        const pb = el('button', { class: 'btn btn--ghost btn--sm moment__audio', type: 'button', text: '▶ 播放原声' });
        pb.addEventListener('click', () => playMomentAudio(m.audioId));
        row.append(pb);
      }
      card.append(row);
    }
    listEl.append(card);
  }
}

// ---------- 传记 ----------
function renderBioView() {
  const s = state.current;
  if (!s) return;
  const textEl = $('#bio-text');
  const lintEl = $('#bio-lint');
  const emptyEl = $('#bio-empty');
  const note = $('#bio-note');

  const last = s.meta && s.meta.lastBio;
  if (!last || !last.text) {
    textEl.hidden = true;
    lintEl.hidden = true;
    emptyEl.hidden = false;
    note.textContent = '';
    return;
  }
  emptyEl.hidden = true;
  textEl.hidden = false;
  textEl.textContent = last.text;
  renderLint(last.lint);
  note.textContent =
    last.source === 'ai'
      ? '这一版是 AI 写的，只用了老人说过的话。检查结果在文末。'
      : '这一版没请 AI，只用老人说过的话整理，不会编造。';
}

function renderLint(report) {
  const el2 = $('#bio-lint');
  el2.replaceChildren();
  const r = report || {};
  const errs = r.errors || [];
  const warns = r.warnings || [];
  if (!errs.length && !warns.length) {
    el2.hidden = true;
    return;
  }
  el2.hidden = false;
  el2.className = 'bio-lint' + (errs.length ? ' bio-lint--error' : ' bio-lint--warn');
  const list = errs.length ? errs : warns;
  const head = errs.length
    ? '写完后检查到 ' + errs.length + ' 处要改的地方（建议先改再存）：'
    : '写完后检查到 ' + warns.length + ' 处小地方，不影响读，可以留意：';
  el2.append(el('h2', { text: head }));
  const ul = el('ul');
  for (const it of list) {
    ul.append(el('li', {}, el('strong', { text: it.name + '：' }), ' ' + (it.hint || '')));
  }
  el2.append(ul);
}

async function generateBio() {
  const s = state.current;
  if (!s) return;
  const btn = $('#btn-gen');
  const note = $('#bio-note');

  setLoading(btn, '正在写…');
  note.textContent = state.aiEnabled
    ? 'AI 正在把聊过的事写成传记，可能要等一会儿…'
    : '正在把老人说过的话整理成一版…';
  $('#bio-lint').hidden = true;

  let text = '';
  let source = 'det';
  try {
    if (state.aiEnabled) {
      try {
        text = await generateBiography(s);
        source = 'ai';
      } catch {
        text = renderDeterministic(s).text;
        source = 'det-fallback';
      }
    } else {
      text = renderDeterministic(s).text;
    }
  } catch {
    try {
      text = renderDeterministic(s).text;
    } catch {
      text = '这本书还没记下多少，先回去陪老人聊几段再来写。';
    }
    source = 'det-fallback';
  }

  const report = lint(text);
  s.meta.lastBio = {
    text,
    source,
    lint: { errors: report.errors || [], warnings: report.warnings || [] },
    at: new Date().toISOString()
  };
  addLog(s, 'bio', '生成传记（' + (source === 'ai' ? 'AI' : '本地整理') + '）');
  await saveNow();

  renderBioView();
  clearLoading(btn);
}

// ---------- 导出加密 ----------
function openExport() {
  const s = state.current;
  if (!s) return;
  clearErr('#export-pw');
  clearErr('#export-pw2');
  $('#export-pw').value = '';
  $('#export-pw2').value = '';
  $('#dlg-export').showModal();
  $('#export-pw').focus();
}

function wireExport() {
  wireTouched('#export-pw', '口令至少 6 位');
  const pw = $('#export-pw');
  const pw2 = $('#export-pw2');
  pw.addEventListener('blur', () => {
    if (pw.value.trim() && pw.value.length < 6) setErr('#export-pw', '口令至少 6 位');
  });
  pw2.addEventListener('input', () => {
    if (pw2.value && pw2.value !== pw.value) setErr('#export-pw2', '两次输入的不一样');
    else clearErr('#export-pw2');
  });

  $('#btn-export').addEventListener('click', openExport);

  $('#form-export').addEventListener('submit', async (e) => {
    e.preventDefault();
    const s = state.current;
    if (!s) return;
    const password = pw.value;
    if (password.length < 6) {
      setErr('#export-pw', '口令至少 6 位');
      $('#export-pw').focus();
      return;
    }
    if (password !== pw2.value) {
      setErr('#export-pw2', '两次输入的不一样');
      $('#export-pw2').focus();
      return;
    }
    const btn = $('#btn-export-go');
    setLoading(btn, '正在上锁…');
    try {
      const cipher = await encryptText(JSON.stringify(s), password);
      const blob = new Blob([cipher], { type: 'text/plain;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = '人生之书-' + ((s.person && s.person.name) || '未起名') + '.txt';
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      $('#dlg-export').close();
      $('#bio-note').textContent = '已加密导出。这份 .txt 只有口令能打开。';
      addLog(s, 'export', '加密导出整本书');
    } catch (err) {
      setErr('#export-pw', (err && err.message) || '加密失败了');
    } finally {
      clearLoading(btn);
    }
  });
}

// ---------- 导入 ----------
function openImport() {
  clearErr('#file-import');
  clearErr('#import-pw');
  $('#file-import').value = '';
  $('#import-pw').value = '';
  const note = $('#file-import-note');
  note.textContent = note.dataset.helper || '还没选文件';
  $('#dlg-import').showModal();
}

function wireBio() {
  $('#btn-gen').addEventListener('click', generateBio);
}

function wireImport() {
  $('#btn-import').addEventListener('click', openImport);

  $('#file-import').addEventListener('change', () => {
    const f = $('#file-import').files[0];
    clearErr('#file-import');
    $('#file-import-note').textContent = f ? '选好了：' + f.name : '还没选文件';
  });
  wireTouched('#import-pw', '请输入打开这份文件的口令');

  $('#form-import').addEventListener('submit', async (e) => {
    e.preventDefault();
    const file = $('#file-import').files[0];
    const password = $('#import-pw').value;
    if (!file) {
      setErr('#file-import', '先选一个加密文件（.txt）');
      return;
    }
    if (!password) {
      setErr('#import-pw', '请输入打开这份文件的口令');
      return;
    }
    const btn = $('#btn-import-go');
    setLoading(btn, '正在解开…');
    try {
      const cipher = await file.text();
      const plain = await decryptText(cipher, password);
      const s = await importBookText(plain);
      await saveBook(s);
      $('#dlg-import').close();
      state.current = s;
      state.pendingAudioId = null;
      state.warmedThisLoad = false;
      $('#appbar-book').textContent = (s.person && s.person.name) || '（未起名）';
      $('#appbar-book').hidden = false;
      showView('shelf');
      toast('导入成功，这本书回来了');
      addLog(s, 'import', '导入一本书');
    } catch (err) {
      const msg = (err && err.message) || '打不开这份文件';
      if (msg.includes('口令') || msg.includes('打开')) setErr('#import-pw', msg);
      else setErr('#file-import', msg);
    } finally {
      clearLoading(btn);
    }
  });
}

// ---------- 导出对话记录 / 日志 ----------
function downloadText(filename, text) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

function exportTalk() {
  const s = state.current;
  if (!s) return;
  const name = (s.person && s.person.name) || '未起名';
  downloadText('人生之书-对话记录-' + name + '.txt', renderTranscript(s));
  addLog(s, 'export_talk', '导出对话记录');
  saveSoon();
  toast('对话记录已导出为 .txt 文件');
}

function exportLogText() {
  const s = state.current;
  if (!s) return;
  const name = (s.person && s.person.name) || '未起名';
  downloadText('人生之书-日志-' + name + '.txt', renderLog(s));
  toast('日志已导出为 .txt 文件');
}

function wireTranscript() {
  $('#btn-export-talk').addEventListener('click', exportTalk);
  $('#btn-export-log').addEventListener('click', exportLogText);
}

// ---------- 抽屉（菜单与设置） ----------
function renderDrawer() {
  const has = !!state.current;
  $('#drawer-book-section').hidden = !has;
  $('#drawer-input-section').hidden = !has;
  if (has) {
    $('#grant-code').textContent = (state.current.auth && state.current.auth.grantCode) || '—';
  }
  syncDialectSelect();
  applyTyping();
  renderAgents();
}

function syncDialectSelect() {
  const s = state.current;
  $('#set-dialect').value = (s && s.person && s.person.dialect) || 'putonghua';
}

function renderAgents() {
  const list = $('#agent-list');
  list.replaceChildren();
  const agents = listAgents();
  const activeId = getActiveAgentId();
  if (!agents.length) {
    list.append(el('p', { class: 'agent-empty', text: '还没有智能体。默认是「晚辈陪聊」人设。' }));
    return;
  }
  for (const a of agents) {
    const isActive = a.id === activeId;
    const row = el('div', {
      class: 'agent-item',
      'data-active': isActive ? 'true' : 'false',
      role: 'radio',
      'aria-checked': isActive ? 'true' : 'false',
      tabindex: 0
    });
    row.append(el('span', { class: 'agent-item__name', text: a.name }));
    row.append(el('span', { class: 'agent-item__kind', text: a.kind === 'script' ? '脚本' : '人设' }));
    const del = el('button', { class: 'icon-btn', type: 'button', 'aria-label': '删除智能体 ' + a.name }, iconNode('trash'));
    del.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      removeAgent(a.id);
      renderAgents();
    });
    row.append(del);
    row.addEventListener('click', () => { setActiveAgentId(a.id); renderAgents(); });
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActiveAgentId(a.id); renderAgents(); }
    });
    list.append(row);
  }
}

function setPageInert(on) {
  for (const node of document.body.children) {
    if (node.id === 'drawer' || node.id === 'drawer-backdrop' || node.tagName === 'DIALOG' || node.id === 'photo-viewer') continue;
    if (on) node.setAttribute('inert', '');
    else node.removeAttribute('inert');
  }
}

function openDrawer() {
  renderDrawer();
  $('#drawer').removeAttribute('inert');
  $('#drawer').setAttribute('aria-hidden', 'false');
  $('#drawer').classList.add('is-open');
  $('#drawer-backdrop').hidden = false;
  $('#btn-menu').setAttribute('aria-expanded', 'true');
  setPageInert(true);
  $('#btn-drawer-close').focus();
}

function closeDrawer() {
  $('#drawer').classList.remove('is-open');
  $('#drawer').setAttribute('aria-hidden', 'true');
  $('#drawer').setAttribute('inert', '');
  $('#drawer-backdrop').hidden = true;
  $('#btn-menu').setAttribute('aria-expanded', 'false');
  setPageInert(false);
  $('#btn-menu').focus();
}

function openAgentDialog() {
  $('#agent-name').value = '';
  $('#agent-content').value = '';
  $('#agent-name-note').textContent = '';
  updateAgentKindHint();
  $('#dlg-agent').showModal();
  $('#agent-name').focus();
}

function updateAgentKindHint() {
  const kind = $('#agent-kind').value;
  const note = $('#agent-content-note');
  const ta = $('#agent-content');
  if (kind === 'script') {
    note.textContent = '脚本要 return 一个 { reply(ctx) } 对象。ctx 有 elderText、history、engineReply、callChat 等。';
    ta.placeholder = 'return {\n  reply: async (ctx) => "……",\n}';
  } else {
    note.textContent = '可直接写一段提示词，或写 JSON：{"system":"你是一位……","temperature":0.85}';
    ta.placeholder = '{"system":"你是一位……","temperature":0.85}';
  }
}

function wireAgentDialog() {
  $('#btn-add-agent').addEventListener('click', openAgentDialog);
  $('#agent-kind').addEventListener('change', updateAgentKindHint);
  $('#btn-agent-file').addEventListener('click', () => $('#agent-file').click());
  $('#agent-file').addEventListener('change', async () => {
    const f = $('#agent-file').files[0];
    if (!f) return;
    try {
      const text = await f.text();
      $('#agent-content').value = text;
    } catch {
      toast('读这个文件失败了', 'error');
    }
    $('#agent-file').value = '';
  });
  $('#form-agent').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('#agent-name').value.trim();
    const kind = $('#agent-kind').value;
    const content = $('#agent-content').value;
    if (!name) {
      toast('给智能体起个名字', 'error');
      $('#agent-name').focus();
      return;
    }
    if (!content.trim()) {
      toast('写点内容，或从文件选择', 'error');
      $('#agent-content').focus();
      return;
    }
    try {
      addAgent({ name, kind, content });
      $('#dlg-agent').close();
      renderAgents();
      toast('智能体已加入');
    } catch (err) {
      toast((err && err.message) || '没加入成功', 'error');
      $('#agent-content').focus();
    }
  });
}

function wireDrawer() {
  $('#btn-menu').addEventListener('click', openDrawer);
  $('#btn-drawer-close').addEventListener('click', closeDrawer);
  $('#drawer-backdrop').addEventListener('click', closeDrawer);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && $('#drawer').classList.contains('is-open')) closeDrawer();
  });

  // 方言设置（影响当前这本书的问话口音与听写）
  const dialectSel = $('#set-dialect');
  dialectSel.replaceChildren(
    ...dialects.packs.map((p) => el('option', { value: p.id, text: p.name + '（' + p.area + '）' }))
  );
  dialectSel.addEventListener('change', () => {
    const s = state.current;
    if (!s) return;
    s.person.dialect = dialectSel.value;
    syncTtsDialect();
    saveNow();
    toast('方言已切到 ' + dialectName(dialectSel.value));
  });

  // 打字输入开关
  $('#set-typing').addEventListener('change', (e) => {
    setTypingEnabled(e.target.checked);
  });

  wireBookActions();
  wireAgentDialog();
}

function wireBookActions() {
  $('#btn-copy-grant').addEventListener('click', async () => {
    const code = $('#grant-code').textContent;
    const btn = $('#btn-copy-grant');
    if (!code || code === '—') return;
    let ok = false;
    try {
      await navigator.clipboard.writeText(code);
      ok = true;
    } catch {
      try {
        const ta = el('textarea', { class: 'sr-only' });
        ta.value = code;
        document.body.append(ta);
        ta.select();
        ok = document.execCommand('copy');
        ta.remove();
      } catch {
        ok = false;
      }
    }
    if (ok) {
      const orig = btn.dataset.origHtml || btn.innerHTML;
      btn.dataset.origHtml = orig;
      btn.textContent = '已复制';
      btn.dataset.state = 'copied';
      setTimeout(() => {
        btn.innerHTML = btn.dataset.origHtml;
        delete btn.dataset.origHtml;
        delete btn.dataset.state;
      }, 2000);
    } else {
      toast('复制不了，长按选字手动复制吧', 'error');
    }
  });

  // 访谈内"删除这本书"：目标就是当前打开的书
  $('#btn-delete').addEventListener('click', () => {
    const s = state.current;
    if (!s) return;
    askDeleteBook(s);
  });

  $('#btn-delete-go').addEventListener('click', async () => {
    const s = state.pendingDelete;
    if (!s) return;
    const btn = $('#btn-delete-go');
    const deletingCurrent = state.current && state.current.id === s.id;
    setLoading(btn, '正在删除…');
    try {
      await deleteBook(s.id);
      $('#dlg-delete').close();
      state.pendingDelete = null;
      clearLoading(btn);
      // 删的是"当前打开的书"：清掉现场，回书架。
      // 删的是"书架上的其他书"：留在原地，只刷新书架。
      if (deletingCurrent) {
        state.current = null;
        state.pendingAudioId = null;
        $('#appbar-book').hidden = true;
        closeViewer();
        closeDrawer();
        showView('shelf');
      } else {
        renderShelf();
      }
    } catch {
      clearLoading(btn);
      toast('删除没成功，再试一次', 'error');
    }
  });
}

// 弹出删除确认框。书架× 和访谈"删除这本书"共用这里。
function askDeleteBook(b) {
  if (!b) return;
  state.pendingDelete = b;
  $('#delete-name').textContent = (b.person && b.person.name) || '这本书';
  $('#dlg-delete').showModal();
}

// ---------- 照片 ----------
function renderPhotos() {
  const s = state.current;
  if (!s) return;
  const grid = $('#photos-grid');
  const empty = $('#photos-empty');
  grid.replaceChildren();
  const imgs = s.images || [];
  if (!imgs.length) {
    empty.hidden = false;
    grid.hidden = true;
    return;
  }
  empty.hidden = true;
  grid.hidden = false;
  imgs.forEach((im, i) => {
    const thumb = el('button', {
      class: 'photo-thumb',
      type: 'button',
      'aria-label': (im.name || '照片') + '，第 ' + (i + 1) + ' 张'
    });
    thumb.append(el('img', {
      class: 'photo-thumb__img',
      src: im.dataUrl,
      alt: im.name || '照片',
      loading: 'lazy',
      width: im.width || 400,
      height: im.height || 300
    }));
    thumb.addEventListener('click', () => openViewer(i));
    grid.append(thumb);
  });
}

function wirePhotos() {
  const input = $('#photo-input');
  $('#btn-add-photos').addEventListener('click', () => input.click());

  input.addEventListener('change', async () => {
    const s = state.current;
    if (!s) return;
    const files = [...input.files];
    if (!files.length) return;
    const btn = $('#btn-add-photos');
    setLoading(btn, '正在放进 ' + files.length + ' 张…');
    let ok = 0;
    for (const f of files) {
      try {
        const img = await processImageFile(f);
        addImage(s, img);
        ok += 1;
      } catch {
        // 单张打不开不中断，继续处理剩下的
      }
    }
    if (ok > 0) await saveNow();
    clearLoading(btn);
    input.value = '';
    renderPhotos();
    if (ok > 0) {
      toast(ok < files.length ? '已放进 ' + ok + ' 张，有 ' + (files.length - ok) + ' 张没打开' : '已放进 ' + ok + ' 张');
    } else {
      toast('没放进任何照片，看看文件是不是图片', 'error');
    }
  });
}

// ---------- 照片翻页查看器 ----------
let viewerOpen = false;
let viewerIndex = 0;
let viewerReturnFocus = null;
let pendingPhotoDeleteId = null;
let swipeX = null;
let swipeY = null;

// ---- 视觉特效句柄（背景波纹 / 照片溶解转场）----
let dissolveStage = null;
let bg = null;

// ---------- 访谈页照片背景（老人主页可左右翻看老照片） ----------
let interviewPhotoStage = null;
let photoBgIndex = 0;
let photoSwipeX = null;
let photoSwipeY = null;

function renderInterviewPhoto() {
  const s = state.current;
  const imgs = (s && s.images) || [];
  const wrap = $('#interview-photo');
  if (!imgs.length) {
    wrap.hidden = true;
    return;
  }
  wrap.hidden = false;
  if (!interviewPhotoStage) {
    interviewPhotoStage = createDissolveStage($('#interview-photo-stage'), { durationMs: 600 });
  }
  if (photoBgIndex < 0 || photoBgIndex >= imgs.length) photoBgIndex = 0;
  interviewPhotoStage.transitionTo(imgs[photoBgIndex].dataUrl, { direction: 0 });
  $('#interview-photo-count').textContent = (photoBgIndex + 1) + ' / ' + imgs.length;
}

function flipInterviewPhoto(delta) {
  const s = state.current;
  const imgs = (s && s.images) || [];
  if (!imgs.length || !interviewPhotoStage) return;
  const ni = photoBgIndex + delta;
  if (ni < 0 || ni >= imgs.length) return;
  photoBgIndex = ni;
  interviewPhotoStage.transitionTo(imgs[ni].dataUrl, { direction: delta > 0 ? 1 : -1, durationMs: 600 });
  $('#interview-photo-count').textContent = (photoBgIndex + 1) + ' / ' + imgs.length;
}

function wireInterviewPhotoSwipe() {
  const view = $('#view-interview');
  view.addEventListener('touchstart', (e) => {
    if (e.target.closest('button, textarea, input, select, a, #chat-stream')) return;
    const t = e.changedTouches[0];
    photoSwipeX = t.clientX;
    photoSwipeY = t.clientY;
  }, { passive: true });
  view.addEventListener('touchend', (e) => {
    if (photoSwipeX == null) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - photoSwipeX;
    const dy = t.clientY - photoSwipeY;
    photoSwipeX = null;
    photoSwipeY = null;
    if (Math.abs(dx) < 40 || Math.abs(dx) <= Math.abs(dy)) return;
    flipInterviewPhoto(dx < 0 ? 1 : -1);
  }, { passive: true });
}

function buildViewer() {
  const viewer = el('div', {
    id: 'photo-viewer',
    class: 'photo-viewer',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': '照片翻页查看器',
    hidden: true
  });

  const top = el('div', { class: 'photo-viewer__top' });
  top.append(
    el('span', { id: 'photo-counter', class: 'photo-counter', role: 'status', 'aria-live': 'polite' }),
    el('span', { class: 'photo-viewer__top-actions' },
      el('button', { id: 'photo-delete', class: 'icon-btn icon-btn--on-dark', type: 'button', 'aria-label': '删掉这张照片' }, iconNode('trash')),
      el('button', { id: 'photo-close', class: 'icon-btn icon-btn--on-dark', type: 'button', 'aria-label': '关闭照片查看器' }, iconNode('close'))
    )
  );

  const stage = el('div', { id: 'photo-stage', class: 'photo-viewer__stage' });
  const prev = el('button', { id: 'photo-prev', class: 'btn btn--nav', type: 'button', 'aria-label': '上一张照片' },
    iconNode('chevron-l'), el('span', { text: '上一页' }));
  const next = el('button', { id: 'photo-next', class: 'btn btn--nav btn--nav-right', type: 'button', 'aria-label': '下一张照片' },
    el('span', { text: '下一页' }), iconNode('chevron-r'));
  const caption = el('div', { id: 'photo-caption', class: 'photo-viewer__caption' });

  viewer.append(top, stage, prev, next, caption);
  document.body.append(viewer);

  // 照片像素溶解转场舞台（WebGL，不可用自动回退 CSS 交叉淡入）
  dissolveStage = createDissolveStage(stage, { durationMs: 700 });

  // 按钮
  $('#photo-close').addEventListener('click', closeViewer);
  $('#photo-prev').addEventListener('click', () => stepViewer(-1));
  $('#photo-next').addEventListener('click', () => stepViewer(1));

  // 删照片：二次确认（不可逆）
  $('#photo-delete').addEventListener('click', () => {
    const s = state.current;
    if (!s) return;
    const im = (s.images || [])[viewerIndex];
    if (!im) return;
    pendingPhotoDeleteId = im.id;
    $('#dlg-photo-delete').showModal();
  });
  $('#btn-photo-delete-go').addEventListener('click', () => {
    const s = state.current;
    if (!s || !pendingPhotoDeleteId) return;
    removeImage(s, pendingPhotoDeleteId);
    pendingPhotoDeleteId = null;
    $('#dlg-photo-delete').close();
    const imgs = s.images || [];
    // 删的是当前页且是最后一页：页码回退
    if (viewerIndex >= imgs.length) viewerIndex = Math.max(0, imgs.length - 1);
    saveNow();
    renderPhotos();
    if (!imgs.length) {
      closeViewer();
      return;
    }
    renderViewerPage();
  });

  // 触摸左右滑动翻页（位移阈值约 40px，竖滑不翻页）
  stage.addEventListener('touchstart', (e) => {
    const t = e.changedTouches[0];
    swipeX = t.clientX;
    swipeY = t.clientY;
  }, { passive: true });
  stage.addEventListener('touchend', (e) => {
    if (swipeX == null) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - swipeX;
    const dy = t.clientY - swipeY;
    swipeX = null;
    swipeY = null;
    if (Math.abs(dx) < 40 || Math.abs(dx) <= Math.abs(dy)) return;
    stepViewer(dx < 0 ? 1 : -1);
  }, { passive: true });

  // 键盘：← → 翻页，Esc 关闭（有对话框打开时交给对话框处理）
  window.addEventListener('keydown', (e) => {
    if (!viewerOpen) return;
    if (document.querySelector('dialog[open]')) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      closeViewer();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      stepViewer(-1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      stepViewer(1);
    }
  });
}

function openViewer(index) {
  const s = state.current;
  if (!s || !(s.images || []).length) return;
  viewerIndex = Math.max(0, Math.min(index, s.images.length - 1));
  viewerOpen = true;
  viewerReturnFocus = document.activeElement;
  setViewerInert(true);
  $('#photo-viewer').hidden = false;
  renderViewerPage();
  $('#photo-close').focus();
}

function closeViewer() {
  if (!viewerOpen) return;
  viewerOpen = false;
  $('#photo-viewer').hidden = true;
  setViewerInert(false);
  if (viewerReturnFocus && viewerReturnFocus.focus) viewerReturnFocus.focus();
  viewerReturnFocus = null;
}

// 查看器打开时把其余内容设为 inert，焦点不跑到后面去（等效于模态焦点圈）。
// dialog 用原生 showModal，自带焦点圈，不能被设 inert，否则确认框的按钮点不动。
function setViewerInert(on) {
  for (const node of document.body.children) {
    if (node.id === 'photo-viewer' || node.tagName === 'DIALOG') continue;
    if (on) node.setAttribute('inert', '');
    else node.removeAttribute('inert');
  }
}

function renderViewerPage(opts = {}) {
  const s = state.current;
  if (!s) return;
  const imgs = s.images || [];
  if (!imgs.length) {
    closeViewer();
    return;
  }
  if (viewerIndex < 0) viewerIndex = 0;
  if (viewerIndex >= imgs.length) viewerIndex = imgs.length - 1;
  const im = imgs[viewerIndex];
  const dissolve = !!opts.dissolve;
  const direction = typeof opts.direction === 'number' ? opts.direction : 0;
  if (dissolveStage) {
    // 像素溶解转场：dissolve 走默认 700ms；非 dissolve（首屏/删除后回退）瞬时切换
    dissolveStage.transitionTo(im.dataUrl, {
      direction,
      durationMs: dissolve ? undefined : 1
    });
  } else {
    // 兜底（理论上不会走到，因 buildViewer 已建 stage）
    $('#photo-stage').style.backgroundImage = 'url("' + im.dataUrl + '")';
  }
  $('#photo-counter').textContent = (viewerIndex + 1) + ' / ' + imgs.length;
  const cap = $('#photo-caption');
  if (im.caption) {
    cap.textContent = im.caption;
    cap.hidden = false;
  } else {
    cap.textContent = '';
    cap.hidden = true;
  }
  $('#photo-prev').disabled = viewerIndex === 0;
  $('#photo-next').disabled = viewerIndex === imgs.length - 1;
}

function stepViewer(delta) {
  const s = state.current;
  if (!s) return;
  const imgs = s.images || [];
  const ni = viewerIndex + delta;
  if (ni < 0 || ni >= imgs.length) return;
  viewerIndex = ni;
  renderViewerPage({ dissolve: true, direction: delta > 0 ? 1 : -1 });
}

// ---------- 启动 ----------
function registerSw() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
}

function wireNav() {
  for (const item of $$('.drawer-nav__item')) {
    item.addEventListener('click', () => {
      closeDrawer();
      showView(item.dataset.view);
    });
  }
  $('#btn-timeline-go').addEventListener('click', () => showView('interview'));

  for (const d of $$('dialog')) {
    d.addEventListener('click', (e) => {
      if (e.target === d) d.close();
    });
  }
  for (const b of $$('[data-close]')) {
    b.addEventListener('click', () => {
      const d = b.closest('dialog');
      if (d) d.close();
    });
  }
}

async function boot() {
  // 全屏流体波纹背景（WebGL2→WebGL1→Canvas2D 三级，reduced-motion 时静态渐变）
  bg = createBackground({ intensity: 0.55 });
  registerSw();
  applyTyping();
  wireNav();
  wireNewBook();
  wireInterview();
  wireBio();
  wireExport();
  wireImport();
  wireTranscript();
  wireDrawer();
  wirePhotos();
  wireVoice();
  wireChatToggle();
  wireInterviewPhotoSwipe();
  buildViewer();
  checkAi();
  showView('shelf');
}

boot();
