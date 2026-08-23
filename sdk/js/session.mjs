// session.mjs — 《人生之书》SDK 会话工具。
//
// 隐私底线在这里实现：
//   - 照片（images）、录音（audio）、日志（log）只存在客户端本地；
//     发请求前用 stripForWire 剥掉，服务端永远看不到。
//   - 服务端只看到引擎算下一步需要的字段：person / interview / meta / profile / moments / turns / repeats。
//
// session 数据结构与 web/js/core/model.js 完全一致（同一套 schema）。

import { newSession, addTurn, addImage, removeImage, addLog } from '../../web/js/core/model.js';

export { newSession, addTurn, addImage, removeImage, addLog };

// 发往服务端前：深拷贝并剥掉本地专属字段。
export function stripForWire(session) {
  const copy = JSON.parse(JSON.stringify(session || {}));
  delete copy.images;
  delete copy.audio;
  delete copy.log;
  return copy;
}

// 服务端返回的 session（不含照片/录音/日志）合回本地：保留本地的这三样，其余以服务端为准。
export function mergeSession(local, wire) {
  if (!local || typeof local !== 'object') return wire;
  if (!wire || typeof wire !== 'object') return local;
  const images = local.images || [];
  const audio = local.audio || [];
  const log = local.log || [];
  const merged = JSON.parse(JSON.stringify(wire));
  merged.images = images;
  merged.audio = audio;
  merged.log = log;
  return merged;
}

// 一轮访谈的完整数据（对话用）：
//   role: 'elder' | 'ai'
//   text, ts, audioId?, intent?
export function lastAiTurn(session) {
  const turns = (session && session.turns) || [];
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i] && turns[i].role === 'ai') return turns[i];
  }
  return null;
}

export function lastElderTurn(session) {
  const turns = (session && session.turns) || [];
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i] && turns[i].role === 'elder') return turns[i];
  }
  return null;
}

// 一个方便的"陪聊会话"：把 加话 → 引擎回话 → （可选）AI 润色 → 记下 AI 的话 串成一步。
// 语义与 web 前端 commitElder 完全一致：拒绝/沉默/重复直接用引擎软话，只有正常推进才请 AI。
export class Conversation {
  constructor(client, session) {
    if (!client || typeof client.respond !== 'function') throw new Error('Conversation 需要 SdkClient 实例');
    if (!session || typeof session !== 'object') throw new Error('Conversation 需要 session（用 client.newSession() 创建）');
    this.client = client;
    this.session = session;
    this.openingText = (session.meta && session.meta.openingText) || '';
  }

  // 进访谈：念开场白 + 种下第一个问题。只调一次（有 openingText 就不重复种）。
  async start() {
    if (this.openingText) return { text: this.openingText, first: true };
    const { result, session } = await this.client.opening(this.session);
    this.session = session;
    const text = (result && result.text) || '咱们随便聊聊，想到哪儿说到哪儿。';
    this.session.meta = this.session.meta || {};
    this.session.meta.openingText = text;
    addTurn(this.session, 'ai', text);
    this.openingText = text;
    return { text, first: true };
  }

  // 老人说一句 → 返回 AI 该说的一句（已写进 session.turns）。
  async say(text, opts = {}) {
    const t = String(text || '').trim();
    if (!t) return { text: '', intent: 'empty' };
    addTurn(this.session, 'elder', t, opts.audioId ? { audioId: opts.audioId } : {});

    const { result, session } = await this.client.respond(this.session, t, { audioId: opts.audioId });
    this.session = session;

    let aiText = '';
    let source = 'engine';
    const aiEnabled = opts.aiEnabled !== false && !opts.forceEngine;
    if (result && result.question && aiEnabled) {
      try {
        const out = await this.client.aiNext(this.session, result, { aiEnabled: true });
        aiText = out.text || '';
        source = out.source || 'engine';
      } catch {
        aiText = result.reply || '';
      }
    } else {
      aiText = (result && result.reply) || '';
    }
    if (!aiText) aiText = (result && result.reply) || '';

    addTurn(this.session, 'ai', aiText);
    return { text: aiText, intent: result ? result.intent : 'empty', source, result };
  }

  // 收尾。
  async close() {
    const { result, session } = await this.client.closing(this.session);
    this.session = session;
    const text = result || '今天先聊到这儿，改天接着聊。';
    addTurn(this.session, 'ai', text);
    return { text };
  }
}
