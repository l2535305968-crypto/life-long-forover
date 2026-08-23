// api-v1.mjs — 《人生之书》SDK 接口层（/api/v1/*）。
//
// 把原来只在浏览器里跑的确定性内核（访谈引擎、意图识别、传记、时间线、对话记录）
// 变成服务端接口，手机 App / 脚本客户端就能把整套系统当 SDK 用。
//
// 隐私模型不变，且在接口层再加一道：
//   - 服务端不落盘、不打印请求正文，日志只有时间、路径、状态码。
//   - 照片 / 录音（dataURL）在客户端 SDK 发请求前就被剥掉，永远不会到服务端。
//   - 引擎对 session 的修改全部在服务端的一次请求里完成，改完即返回，不保留任何状态。
//
// 错误约定：HTTP 4xx/5xx + { ok:false, code, error }。code 见 docs/08-SDK接入.md。

import { newSession } from '../web/js/core/model.js';
import { opening, closing, respond, summarize } from '../web/js/core/engine.js';
import { renderDeterministic, lint, buildContext } from '../web/js/core/biography.js';
import { buildTimeline } from '../web/js/core/timeline.js';
import { renderTranscript, renderLog } from '../web/js/core/transcript.js';
import { dialects } from '../web/js/core/dialects.js';
import { interviewSystemPrompt, turnPrompt, biographyPrompts } from '../web/js/ai/prompt.js';

const API_VERSION = 1;

export function createV1Router({ config, helpers }) {
  const { sendJson, sendText, readBody, clientIp, log, rateLimited, handleChat, handleAsr } = helpers;

  // ---------- session 防御性规整：引擎要求的最小形状 ----------
  function sessionErr(msg) {
    const err = new Error(msg);
    err.code = 'BAD_SESSION';
    err.status = 400;
    return err;
  }

  function prepareSession(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw sessionErr('session 必须是对象');
    if (!raw.person || typeof raw.person !== 'object') raw.person = {};
    if (!raw.interview || typeof raw.interview !== 'object') throw sessionErr('session.interview 缺失');
    if (!raw.meta || typeof raw.meta !== 'object') raw.meta = {};
    if (!Array.isArray(raw.interview.askedQuestionIds)) raw.interview.askedQuestionIds = [];
    if (!Array.isArray(raw.interview.refusedTopics)) raw.interview.refusedTopics = [];
    if (!Array.isArray(raw.interview.coveredTopics)) raw.interview.coveredTopics = [];
    if (!Array.isArray(raw.moments)) raw.moments = [];
    if (!Array.isArray(raw.turns)) raw.turns = [];
    if (!Array.isArray(raw.repeats)) raw.repeats = [];
    if (!raw.profile || typeof raw.profile !== 'object' || Array.isArray(raw.profile)) raw.profile = {};
    return raw;
  }

  // ---------- 读 body（v1 统一错误码） ----------
  async function readJson(req, limit = 512 * 1024) {
    let body;
    try {
      body = await readBody(req, limit);
    } catch (err) {
      const tooLarge = err.code === 'E_TOO_LARGE';
      const e = new Error(tooLarge ? '内容太大了' : '请求不是合法的 JSON');
      e.code = tooLarge ? 'TOO_LARGE' : 'BAD_JSON';
      e.status = tooLarge ? 413 : 400;
      throw e;
    }
    if (!body) {
      const e = new Error('请求是空的');
      e.code = 'EMPTY';
      e.status = 400;
      throw e;
    }
    return body;
  }

  // ---------- 服务端版 AI 润色 / 传记（adapter.js 是浏览器版，这里用直连上游） ----------
  function historyMessages(session, limit = 24) {
    return (session.turns || [])
      .slice(-limit)
      .map((t) => ({ role: t.role === 'elder' ? 'user' : 'assistant', content: t.text }));
  }

  function stripQuotes(s) {
    return String(s || '').trim().replace(/^["'""'']+|["'""'']+$/g, '').trim();
  }

  async function polishQuestionServer(session, questionText, extraSystem = '') {
    if (!config.apiKey) return questionText;
    const messages = [
      { role: 'system', content: interviewSystemPrompt(session, extraSystem) },
      ...historyMessages(session, 24),
      { role: 'user', content: turnPrompt(session, questionText) }
    ];
    try {
      const out = await chatCompletionsSafe(messages, { temperature: 0.85, maxTokens: 140 });
      const polished = stripQuotes(out.text);
      if (polished && polished.length <= 80) return polished;
    } catch { /* 断网 / 没 Key，回退原文 */ }
    return questionText;
  }

  async function generateBiographyServer(session) {
    if (!config.apiKey) return { text: renderDeterministic(session).text, source: 'det' };
    const { system, user } = biographyPrompts(buildContext(session));
    try {
      const out = await chatCompletionsSafe(
        [{ role: 'system', content: system }, { role: 'user', content: user }],
        { temperature: 0.7, maxTokens: 3000, timeoutMs: 120_000 }
      );
      const text = stripQuotes(out.text);
      if (text && text.trim()) return { text, source: 'ai' };
    } catch { /* 落到本地兜底 */ }
    return { text: renderDeterministic(session).text, source: 'det-fallback' };
  }

  async function chatCompletionsSafe(messages, opts = {}) {
    const { chatCompletions } = await import('./deepseek.mjs');
    return chatCompletions({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      model: config.model,
      messages,
      temperature: opts.temperature,
      maxTokens: opts.maxTokens,
      timeoutMs: opts.timeoutMs || 90_000
    });
  }

  // ---------- 每个接口一个处理函数 ----------
  const routes = {
    async 'GET /health'(req, res) {
      sendJson(res, 200, {
        ok: true,
        apiVersion: API_VERSION,
        hasKey: Boolean(config.apiKey),
        hasAsr: Boolean(config.xfAppid && config.xfApiKey && config.xfApiSecret),
        model: config.model,
        secureContextNote: '手机 App 不受浏览器安全上下文限制；WebView 里跑仍需 https。',
        time: new Date().toISOString()
      });
    },

    async 'POST /session/new'(req, res) {
      const body = await readJson(req);
      const personName = typeof body.personName === 'string' ? body.personName : '';
      const dialect = typeof body.dialect === 'string' && body.dialect ? body.dialect : 'putonghua';
      const session = newSession({ personName, dialect });
      sendJson(res, 200, { ok: true, session });
    },

    async 'POST /engine/opening'(req, res) {
      const body = await readJson(req);
      const session = prepareSession(structuredClone(body.session));
      const result = opening(session);
      sendJson(res, 200, { ok: true, result, session });
    },

    async 'POST /engine/closing'(req, res) {
      const body = await readJson(req);
      const session = prepareSession(structuredClone(body.session));
      const result = closing(session);
      sendJson(res, 200, { ok: true, result, session });
    },

    async 'POST /engine/respond'(req, res) {
      const body = await readJson(req);
      if (typeof body.text !== 'string') {
        const e = new Error('text 必须是字符串');
        e.code = 'BAD_TEXT';
        e.status = 400;
        throw e;
      }
      const session = prepareSession(structuredClone(body.session));
      const result = respond(session, body.text, { audioId: typeof body.audioId === 'string' ? body.audioId : undefined });
      sendJson(res, 200, { ok: true, result, session });
    },

    async 'POST /engine/summarize'(req, res) {
      const body = await readJson(req);
      const session = prepareSession(structuredClone(body.session));
      const summary = summarize(session);
      sendJson(res, 200, { ok: true, summary, session });
    },

    async 'POST /ai/polish'(req, res) {
      const body = await readJson(req);
      if (typeof body.questionText !== 'string' || !body.questionText.trim()) {
        const e = new Error('questionText 不能为空');
        e.code = 'BAD_TEXT';
        e.status = 400;
        throw e;
      }
      const session = prepareSession(structuredClone(body.session));
      const extraSystem = typeof body.extraSystem === 'string' ? body.extraSystem : '';
      const original = body.questionText.trim();
      const text = await polishQuestionServer(session, original, extraSystem);
      sendJson(res, 200, { ok: true, text, source: text === original ? 'engine' : 'ai' });
    },

    async 'POST /ai/next'(req, res) {
      const body = await readJson(req);
      const session = prepareSession(structuredClone(body.session));
      const er = body.engineResult;
      if (!er || typeof er !== 'object') {
        const e = new Error('engineResult 缺失（先调 /engine/respond）');
        e.code = 'BAD_ENGINE_RESULT';
        e.status = 400;
        throw e;
      }
      const aiEnabled = body.aiEnabled !== false;
      const extraSystem = typeof body.extraSystem === 'string' ? body.extraSystem : '';

      // 拒绝 / 沉默 / 重复：不需要 AI，直接用引擎软话。
      if (!er.question || !aiEnabled) {
        sendJson(res, 200, { ok: true, text: er.reply || '', source: 'engine' });
        return;
      }
      const original = er.question.text || '';
      const text = await polishQuestionServer(session, original, extraSystem);
      sendJson(res, 200, { ok: true, text, source: text === original ? 'engine' : 'ai' });
    },

    async 'POST /bio/render'(req, res) {
      const body = await readJson(req);
      const session = prepareSession(structuredClone(body.session));
      const out = renderDeterministic(session);
      sendJson(res, 200, {
        ok: true,
        text: out.text,
        lint: { errors: out.errors || [], warnings: out.warnings || [], clean: !!out.clean, length: out.length },
        deterministic: true
      });
    },

    async 'POST /bio/generate'(req, res) {
      const body = await readJson(req);
      const session = prepareSession(structuredClone(body.session));
      const out = await generateBiographyServer(session);
      const report = lint(out.text);
      sendJson(res, 200, {
        ok: true,
        text: out.text,
        source: out.source,
        lint: { errors: report.errors || [], warnings: report.warnings || [], clean: report.clean, length: report.length }
      });
    },

    async 'POST /bio/lint'(req, res) {
      const body = await readJson(req);
      if (typeof body.text !== 'string') {
        const e = new Error('text 必须是字符串');
        e.code = 'BAD_TEXT';
        e.status = 400;
        throw e;
      }
      const report = lint(body.text);
      sendJson(res, 200, { ok: true, report });
    },

    async 'POST /timeline'(req, res) {
      const body = await readJson(req);
      const session = prepareSession(structuredClone(body.session));
      sendJson(res, 200, { ok: true, timeline: buildTimeline(session) });
    },

    async 'POST /transcript'(req, res) {
      const body = await readJson(req);
      const session = prepareSession(structuredClone(body.session));
      sendJson(res, 200, {
        ok: true,
        transcript: renderTranscript(session),
        log: renderLog(session)
      });
    },

    async 'GET /dialects'(req, res) {
      sendJson(res, 200, {
        ok: true,
        packs: dialects.packs.map((p) => ({
          id: p.id,
          name: p.name,
          area: p.area,
          speechLang: p.speechLang,
          speechNote: p.speechNote || ''
        }))
      });
    },

    'POST /chat': handleChat,
    'POST /asr': handleAsr
  };

  // ---------- 分发 ----------
  return async function v1(req, res, urlPath) {
    const method = req.method || 'GET';
    const rel = urlPath.slice('/api/v1'.length) || '/';
    const key = `${method} ${rel}`;
    const handler = routes[key];
    if (!handler) return false;

    // 除 health / dialects 外，所有 v1 接口都限流。
    if (!(rel === '/health' || rel === '/dialects')) {
      const ip = clientIp(req);
      if (rateLimited(ip)) {
        sendJson(res, 429, { ok: false, code: 'RATE', error: '一分钟里问得太多了，歇一下再来。' });
        return true;
      }
    }

    try {
      await handler(req, res);
    } catch (err) {
      const status = err.status || 500;
      sendJson(res, status, {
        ok: false,
        code: err.code || 'INTERNAL',
        error: status === 500 ? '服务端出错了' : (err.message || '请求失败')
      });
      if (status === 500) log(req, res, 'v1 internal: ' + (err.message || ''));
      else log(req, res);
      return true;
    }
    return true;
  };
}
