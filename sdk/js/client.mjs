// client.mjs — 《人生之书》SDK 网络客户端。
// 零依赖，浏览器（fetch）和 Node 18+（全局 fetch）都能用。
// 用法：const client = new SdkClient('http://192.168.1.5:8788');
import { stripForWire, mergeSession } from './session.mjs';

export class SdkError extends Error {
  constructor(message, { code = 'UNKNOWN', status = 0, cause } = {}) {
    super(message);
    this.name = 'SdkError';
    this.code = code;
    this.status = status;
    this.cause = cause;
  }
}

export class SdkClient {
  constructor(baseUrl = '', fetchImpl = null) {
    this.baseUrl = String(baseUrl || '').replace(/\/+$/, '');
    this.fetchImpl = fetchImpl || globalThis.fetch;
    if (typeof this.fetchImpl !== 'function') {
      throw new Error('当前环境没有 fetch。浏览器请直接 new SdkClient()；Node 18+ 自带 fetch。');
    }
  }

  url(p) {
    return this.baseUrl + '/api/v1' + p;
  }

  async req(method, path, body = undefined) {
    let res;
    try {
      res = await this.fetchImpl(this.url(path), {
        method,
        headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined
      });
    } catch (err) {
      throw new SdkError('连不上服务：' + (err && err.message ? err.message : err), { code: 'NETWORK', cause: err });
    }
    let data = null;
    try { data = await res.json(); } catch { /* 非 JSON */ }
    if (!res.ok || !data || data.ok === false) {
      throw new SdkError((data && data.error) || `HTTP ${res.status}`, {
        code: (data && data.code) || 'UNKNOWN',
        status: res.status
      });
    }
    return data;
  }

  // ---------- 基础 ----------
  health() { return this.req('GET', '/health'); }
  dialects() { return this.req('GET', '/dialects'); }

  // ---------- 会话 ----------
  async newSession(opts = {}) {
    const data = await this.req('POST', '/session/new', { personName: opts.personName || '', dialect: opts.dialect || 'putonghua' });
    return data.session;
  }

  // ---------- 引擎 ----------
  // 每个引擎接口：发 session（剥掉照片/录音/日志）→ 服务端改 → 合回本地。
  async opening(session) {
    const data = await this.req('POST', '/engine/opening', { session: stripForWire(session) });
    return { result: data.result, session: mergeSession(session, data.session) };
  }

  async closing(session) {
    const data = await this.req('POST', '/engine/closing', { session: stripForWire(session) });
    return { result: data.result, session: mergeSession(session, data.session) };
  }

  async respond(session, text, opts = {}) {
    const body = { session: stripForWire(session), text };
    if (opts.audioId) body.audioId = opts.audioId;
    const data = await this.req('POST', '/engine/respond', body);
    return { result: data.result, session: mergeSession(session, data.session) };
  }

  async summarize(session) {
    const data = await this.req('POST', '/engine/summarize', { session: stripForWire(session) });
    return { summary: data.summary, session: mergeSession(session, data.session) };
  }

  // ---------- AI 润色 ----------
  async aiPolish(session, questionText, opts = {}) {
    const body = { session: stripForWire(session), questionText };
    if (opts.extraSystem) body.extraSystem = opts.extraSystem;
    const data = await this.req('POST', '/ai/polish', body);
    return { text: data.text, source: data.source };
  }

  async aiNext(session, engineResult, opts = {}) {
    const body = { session: stripForWire(session), engineResult };
    if (opts.aiEnabled !== undefined) body.aiEnabled = opts.aiEnabled;
    if (opts.extraSystem) body.extraSystem = opts.extraSystem;
    const data = await this.req('POST', '/ai/next', body);
    return { text: data.text, source: data.source };
  }

  // ---------- 传记 / 时间线 / 记录 ----------
  async bioRender(session) {
    const data = await this.req('POST', '/bio/render', { session: stripForWire(session) });
    return { text: data.text, lint: data.lint, deterministic: data.deterministic };
  }

  async bioGenerate(session) {
    const data = await this.req('POST', '/bio/generate', { session: stripForWire(session) });
    return { text: data.text, source: data.source, lint: data.lint };
  }

  async bioLint(text) {
    const data = await this.req('POST', '/bio/lint', { text });
    return data.report;
  }

  async timeline(session) {
    const data = await this.req('POST', '/timeline', { session: stripForWire(session) });
    return data.timeline;
  }

  async transcript(session) {
    const data = await this.req('POST', '/transcript', { session: stripForWire(session) });
    return { transcript: data.transcript, log: data.log };
  }

  // ---------- 对话代理 / 语音识别（跟 web 前端同源） ----------
  async chat(messages, opts = {}) {
    const body = { messages };
    if (opts.temperature !== undefined) body.temperature = opts.temperature;
    if (opts.maxTokens !== undefined) body.max_tokens = opts.maxTokens;
    const data = await this.req('POST', '/chat', body);
    return { text: data.text, usage: data.usage, model: data.model };
  }

  async asr(audioBase64, opts = {}) {
    const body = { audio: audioBase64 };
    if (opts.dialect) body.dialect = opts.dialect;
    if (opts.accent) body.accent = opts.accent;
    const data = await this.req('POST', '/asr', body);
    return data.text;
  }
}
