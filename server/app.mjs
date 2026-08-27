// app.mjs — 《人生之书》服务端应用（可测试：createApp 只建不 listen）。
//
// 组装三件事：
//   1. 静态文件服务（web/）
//   2. 旧版接口 /api/health /api/chat /api/asr（web 前端继续用）
//   3. SDK 接口 /api/v1/*（手机 App / 脚本客户端用，见 docs/08-SDK接入.md）
//
// 隐私底线不变：不落盘任何老人说的话，不打印请求正文，日志只有时间、路径、状态码。

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from './env.mjs';
import { chatCompletions } from './deepseek.mjs';
import { transcribe, accentFor } from './xfyun-asr.mjs';
import { synthesize as xfyunSynthesize, vcnFor, normalizeForDialect } from './xfyun-tts.mjs';
import { createV1Router } from './api-v1.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const WEB_DIR = path.join(ROOT, 'web');

const MIME = new Map(Object.entries({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8'
}));

export async function createApp({ envPath = path.join(ROOT, '.env') } = {}) {
  const { vars, hadFile } = await loadEnv(envPath);

  const config = {
    port: Number(vars.PORT || 8788),
    host: vars.HOST || '0.0.0.0',
    apiKey: (vars.DEEPSEEK_API_KEY || '').trim(),
    model: (vars.DEEPSEEK_MODEL || 'deepseek-chat').trim(),
    baseUrl: (vars.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, ''),
    ratePerMinute: Number(vars.RATE_PER_MINUTE || 40),
    xfAppid: (vars.XF_APPID || '').trim(),
    xfApiKey: (vars.XF_API_KEY || '').trim(),
    xfApiSecret: (vars.XF_API_SECRET || '').trim(),
    localAsrUrl: (vars.LOCAL_ASR_URL || '').trim(),
    // TTS_URL 没写用默认地址；写了空串（TTS_URL=）表示明确关掉暖声音
    ttsUrl: vars.TTS_URL == null ? 'http://127.0.0.1:7861/tts' : vars.TTS_URL.trim(),
    // 暖声音护门 token（.env 配了 TTS_TOKEN 才启用）。Cloudflare 转发时带 x-tts-token，
    // 校验通过才合成；没配 token 则不校验（兼容本地开发）。
    ttsToken: (vars.TTS_TOKEN || '').trim(),
    hadFile
  };

  // ---------- 小工具 ----------
  function sendJson(res, status, body) {
    const text = JSON.stringify(body);
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(text),
      'cache-control': 'no-store'
    });
    res.end(text);
  }

  function sendText(res, status, text, type = 'text/plain; charset=utf-8') {
    res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(text);
  }

  async function readBody(req, limitBytes = 256 * 1024) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > limitBytes) {
        const err = new Error('body too large');
        err.code = 'E_TOO_LARGE';
        throw err;
      }
      chunks.push(chunk);
    }
    if (!chunks.length) return null;
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }

  function clientIp(req) {
    return (req.socket && req.socket.remoteAddress) || 'unknown';
  }

  function log(req, res, note) {
    const stamp = new Date().toTimeString().slice(0, 8);
    const url = (req.url || '').split('?')[0];
    console.log(`${stamp}  ${String(res.statusCode).padEnd(3)}  ${(req.method || '').padEnd(4)} ${url}${note ? '  ' + note : ''}`);
  }

  // ---------- 限流（内存计数，只在自己家里跑） ----------
  const hits = new Map();
  function rateLimited(ip) {
    const now = Date.now();
    const windowStart = now - 60_000;
    const list = (hits.get(ip) || []).filter((t) => t > windowStart);
    if (list.length >= config.ratePerMinute) {
      hits.set(ip, list);
      return true;
    }
    list.push(now);
    hits.set(ip, list);
    if (hits.size > 500) {
      for (const [k, v] of hits) if (!v.some((t) => t > windowStart)) hits.delete(k);
    }
    return false;
  }

  // ---------- 静态文件 ----------
  async function serveStatic(req, res, urlPath) {
    let rel = decodeURIComponent(urlPath);
    if (rel === '/' || rel === '') rel = '/index.html';
    const target = path.resolve(WEB_DIR, '.' + rel);
    if (target !== WEB_DIR && !target.startsWith(WEB_DIR + path.sep)) {
      sendText(res, 403, '不在允许的目录里');
      return log(req, res);
    }
    try {
      const data = await readFile(target);
      const type = MIME.get(path.extname(target).toLowerCase()) || 'application/octet-stream';
      const headers = { 'content-type': type, 'content-length': data.length };
      if (rel === '/index.html' || rel === '/sw.js') headers['cache-control'] = 'no-cache';
      else headers['cache-control'] = 'public, max-age=60';
      res.writeHead(200, headers);
      res.end(data);
      log(req, res);
    } catch (err) {
      if (err.code === 'ENOENT' || err.code === 'EISDIR') {
        sendText(res, 404, '没有这个文件');
      } else {
        sendText(res, 500, '读文件出错');
      }
      log(req, res, err.code || '');
    }
  }

  // ---------- 对话代理 ----------
  function sanitizeMessages(input) {
    if (!Array.isArray(input) || input.length === 0) return { error: 'messages 必须是非空数组' };
    if (input.length > 60) return { error: 'messages 太长了，最多 60 条' };
    const out = [];
    let chars = 0;
    for (const m of input) {
      if (!m || typeof m !== 'object') return { error: 'messages 里有不是对象的东西' };
      const role = m.role;
      if (role !== 'system' && role !== 'user' && role !== 'assistant') {
        return { error: 'role 只能是 system / user / assistant' };
      }
      const content = typeof m.content === 'string' ? m.content : '';
      if (!content) return { error: 'content 不能为空' };
      chars += content.length;
      if (chars > 60_000) return { error: '内容总长超出限制' };
      out.push({ role, content });
    }
    return { messages: out };
  }

  async function handleChat(req, res) {
    if (!config.apiKey) {
      return sendJson(res, 503, {
        ok: false,
        code: 'NO_KEY',
        error: '这台电脑上还没配 DeepSeek 的 Key。把 .env.example 复制成 .env，填上 DEEPSEEK_API_KEY，然后重启这个服务。'
      });
    }
    const ip = clientIp(req);
    if (rateLimited(ip)) {
      return sendJson(res, 429, { ok: false, code: 'RATE', error: '一分钟里问得太多了，歇一下再来。' });
    }

    let body;
    try {
      body = await readBody(req);
    } catch (err) {
      const tooLarge = err.code === 'E_TOO_LARGE';
      return sendJson(res, tooLarge ? 413 : 400, {
        ok: false,
        code: tooLarge ? 'TOO_LARGE' : 'BAD_JSON',
        error: tooLarge ? '一次发过来的内容太大了' : '请求不是合法的 JSON'
      });
    }
    if (!body) return sendJson(res, 400, { ok: false, code: 'EMPTY', error: '请求是空的' });

    const checked = sanitizeMessages(body.messages);
    if (checked.error) return sendJson(res, 400, { ok: false, code: 'BAD_MESSAGES', error: checked.error });

    const started = Date.now();
    try {
      const out = await chatCompletions({
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        model: config.model,
        messages: checked.messages,
        temperature: body.temperature,
        maxTokens: body.max_tokens
      });
      sendJson(res, 200, { ok: true, text: out.text, usage: out.usage, model: out.model });
      log(req, res, `${out.ms}ms`);
    } catch (err) {
      const timedOut = err.name === 'TimeoutError' || err.name === 'AbortError';
      sendJson(res, timedOut ? 504 : 502, {
        ok: false,
        code: timedOut ? 'TIMEOUT' : (err.code || 'NETWORK'),
        status: err.status || null,
        error: timedOut ? '等太久了，没等到回话' : (err.message || '连不上对话服务，检查一下网络')
      });
      log(req, res, err.name || 'network error');
    }
  }

  // ---------- 语音识别代理（本地 FunASR 优先，讯飞兜底） ----------
  async function callLocalAsr(audioBase64, dialect) {
    const res = await fetch(config.localAsrUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ audio: audioBase64, dialect }),
      signal: AbortSignal.timeout(30000)
    });
    if (!res.ok) throw new Error('local asr http ' + res.status);
    const data = await res.json().catch(() => null);
    if (!data || typeof data.text !== 'string' || !data.text.trim()) return '';
    return data.text.trim();
  }

  async function handleAsr(req, res) {
    const ip = clientIp(req);
    if (rateLimited(ip)) {
      return sendJson(res, 429, { ok: false, code: 'RATE', error: '一分钟里问得太多了，歇一下再来。' });
    }

    // 方言识别走讯飞「方言识别大模型」（星火协议），accent 固定 'mulacc'（202 种方言免切换），
    // 因此前端传的 dialect 只需用于提示/后续 TTS，识别本身不再逐方言映射。
    let body;
    try {
      body = await readBody(req, 4 * 1024 * 1024);
    } catch (err) {
      const tooLarge = err.code === 'E_TOO_LARGE';
      return sendJson(res, tooLarge ? 413 : 400, {
        ok: false,
        code: tooLarge ? 'TOO_LARGE' : 'BAD_JSON',
        error: tooLarge ? '音频太大了' : '请求不是合法 JSON'
      });
    }
    if (!body || typeof body.audio !== 'string' || !body.audio) {
      return sendJson(res, 400, { ok: false, code: 'BAD_AUDIO', error: '缺少 audio 字段' });
    }

    if (config.localAsrUrl) {
      try {
        const text = await callLocalAsr(body.audio, body.dialect);
        if (text) {
          sendJson(res, 200, { ok: true, text });
          return log(req, res, 'local');
        }
      } catch {
        // 本地挂了，落到讯飞
      }
    }

    if (!config.xfAppid || !config.xfApiKey || !config.xfApiSecret) {
      return sendJson(res, 503, {
        ok: false,
        code: 'NO_ASR_KEY',
        error: '没配讯飞 Key，本地 FunASR 也没配（.env 里加 LOCAL_ASR_URL）。'
      });
    }

    const accent = body.accent || accentFor(body.dialect) || 'mandarin';
    try {
      const r = await transcribe({
        appId: config.xfAppid,
        apiKey: config.xfApiKey,
        apiSecret: config.xfApiSecret,
        audioBase64: body.audio,
        accent
      });
      sendJson(res, 200, { ok: true, text: r.text });
    } catch (err) {
      sendJson(res, 502, { ok: false, code: 'ASR_FAILED', error: err.message || '语音识别失败' });
    }
    log(req, res);
  }

  // ---------- 温暖声音朗读代理（Qwen3-TTS 本地服务） ----------
  // 前端 tts.js 把 AI 的话 POST 到这里，本服务转发给 TTS_URL（tools/qwen3_tts_server.py），
  // 拿回 wav 给浏览器播。TTS_URL 没配或服务没起时返回 503，前端自动回退浏览器朗读。
  async function handleTts(req, res) {
    const ip = clientIp(req);
    if (rateLimited(ip)) {
      return sendJson(res, 429, { ok: false, code: 'RATE', error: '一分钟里问得太多了，歇一下再来。' });
    }

    // 暖声音护门：.env 配了 TTS_TOKEN 才启用。Cloudflare 转发时带 x-tts-token 才能合成，
    // 否则一律拒绝——这样公网 8788 即使被扫到，也只有持有 token 的代理能调用它。
    if (config.ttsToken) {
      const got = String(req.headers['x-tts-token'] || '');
      if (got !== config.ttsToken) {
        return sendJson(res, 401, { ok: false, code: 'NO_TTS_TOKEN', error: '缺少正确的暖声音访问令牌。' });
      }
    }

    let body;
    try {
      body = await readBody(req, 64 * 1024);
    } catch (err) {
      const tooLarge = err.code === 'E_TOO_LARGE';
      return sendJson(res, tooLarge ? 413 : 400, {
        ok: false,
        code: tooLarge ? 'TOO_LARGE' : 'BAD_JSON',
        error: tooLarge ? '要念的文字太长了' : '请求不是合法 JSON'
      });
    }
    const text = body && typeof body.text === 'string' ? body.text.trim() : '';
    if (!text) {
      return sendJson(res, 400, { ok: false, code: 'BAD_TEXT', error: '缺少 text 字段' });
    }
    if (text.length > 2000) {
      return sendJson(res, 413, { ok: false, code: 'TOO_LONG', error: '一句话最多 2000 字，这句太长了' });
    }

    // 讯飞 TTS 优先（云端，不占本机内存/显卡），本地 Qwen3 兜底。
    const xfyunReady = Boolean(config.xfAppid && config.xfApiKey && config.xfApiSecret);

    if (!xfyunReady && !config.ttsUrl) {
      return sendJson(res, 503, {
        ok: false,
        code: 'NO_TTS',
        error: '没配任何语音服务：.env 里加讯飞三件套（XF_APPID/XF_API_KEY/XF_API_SECRET），或加一行 TTS_URL=http://127.0.0.1:7861/tts。'
      });
    }

    try {
      // 讯飞优先：一次性返回整段合成音频
      if (xfyunReady) {
        const dialect = (body && body.dialect) || 'putonghua';
        const vcn = vcnFor(dialect);
        const rate = Number(body.rate) || 1.0;
        // 按方言场合做儿化/口语收敛（只影响 AI 回话，老人原话在浏览器端不变）
        const shaped = normalizeForDialect(text, dialect);
        const { wav } = await xfyunSynthesize({
          appId: config.xfAppid,
          apiKey: config.xfApiKey,
          apiSecret: config.xfApiSecret,
          text: shaped,
          vcn,
          speed: rate,           // 讯飞 speed 0.5~2.0；rate 接近 1.0 即正常语速
          timeoutMs: 30000
        });
        res.writeHead(200, {
          'content-type': 'audio/wav',
          'content-length': wav.length,
          'cache-control': 'no-store'
        });
        res.end(wav);
        return log(req, res, 'xfyun-tts/' + Math.round(wav.length / 1024) + 'KB');
      }

      // 本地 Qwen3 兜底（原逻辑）
      const ttsRes = await fetch(config.ttsUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text, rate: body.rate || 1.0 }),
        signal: AbortSignal.timeout(90000) // 首次要冷加载模型，给足时间
      });
      if (!ttsRes.ok) {
        return sendJson(res, 502, {
          ok: false,
          code: 'TTS_UPSTREAM',
          error: '本地配音服务报错（HTTP ' + ttsRes.status + '）。'
        });
      }
      const ctype = (ttsRes.headers.get('content-type') || '').toLowerCase();
      if (ctype.includes('audio/')) {
        // 直接回音频字节
        const buf = Buffer.from(await ttsRes.arrayBuffer());
        res.writeHead(200, {
          'content-type': ctype,
          'content-length': buf.length,
          'cache-control': 'no-store'
        });
        res.end(buf);
        return log(req, res, 'audio/' + Math.round(buf.length / 1024) + 'KB');
      }
      // JSON 包装（audio 为 base64）
      const data = await ttsRes.json().catch(() => null);
      if (!data || typeof data.audio !== 'string' || !data.audio) {
        return sendJson(res, 502, { ok: false, code: 'TTS_BAD_RESPONSE', error: '本地配音服务返回了没法用的内容。' });
      }
      const buf = Buffer.from(data.audio, 'base64');
      res.writeHead(200, {
        'content-type': data.format || 'audio/wav',
        'content-length': buf.length,
        'cache-control': 'no-store'
      });
      res.end(buf);
      return log(req, res, 'json/' + Math.round(buf.length / 1024) + 'KB');
    } catch (err) {
      const timedOut = err.name === 'TimeoutError' || err.name === 'AbortError';
      sendJson(res, timedOut ? 504 : 502, {
        ok: false,
        code: timedOut ? 'TTS_TIMEOUT' : 'TTS_UNREACHABLE',
        error: timedOut
          ? '配音服务加载太久了（首次要加载模型，稍后再试）。'
          : '语音服务出错了：' + (err.message || '未知错误') + '。'
      });
      return log(req, res, err.name || 'tts network error');
    }
  }

  // ---------- 路由 ----------
  const v1 = createV1Router({
    config,
    helpers: { sendJson, sendText, readBody, clientIp, log, rateLimited, handleChat, handleAsr }
  });

  const server = http.createServer(async (req, res) => {
    const urlPath = (req.url || '/').split('?')[0];

    // SDK v1 接口优先
    if (urlPath.startsWith('/api/v1/')) {
      const handled = await v1(req, res, urlPath);
      if (handled) return;
      sendJson(res, 404, { ok: false, code: 'NOT_FOUND', error: '没有这个 v1 接口' });
      return log(req, res);
    }

    if (urlPath === '/api/health') {
      const hasXf = Boolean(config.xfAppid && config.xfApiKey && config.xfApiSecret);
      const hasLocalAsr = Boolean(config.localAsrUrl);
      const hasTts = Boolean(config.ttsUrl);
      sendJson(res, 200, {
        ok: true,
        hasKey: Boolean(config.apiKey),
        // 语音识别：本地 FunASR 或讯飞任一可用，前端就能开"按住说话"
        hasAsr: hasXf || hasLocalAsr,
        hasLocalAsr,
        hasXf,
        // 温暖声音 TTS：本地 Qwen3-TTS 服务（TTS_URL）配了就算可用，前端会优先用它，
        // 服务没起来时 tts.js 自动回退到浏览器朗读，不会打断对话
        hasTts,
        model: config.model,
        envFile: config.hadFile,
        secureContextNote: 'http 的局域网地址拿不到麦克风，手机真机请用 https 隧道或托管地址',
        time: new Date().toISOString()
      });
      return log(req, res);
    }

    if (urlPath === '/api/chat') {
      if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, code: 'METHOD', error: '这个地址只收 POST' });
        return log(req, res);
      }
      return handleChat(req, res);
    }

    if (urlPath === '/api/asr') {
      if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, code: 'METHOD', error: '这个地址只收 POST' });
        return log(req, res);
      }
      return handleAsr(req, res);
    }

    if (urlPath === '/api/tts') {
      if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, code: 'METHOD', error: '这个地址只收 POST' });
        return log(req, res);
      }
      return handleTts(req, res);
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 405, { ok: false, code: 'METHOD', error: '只支持 GET' });
      return log(req, res);
    }

    return serveStatic(req, res, urlPath);
  });

  return { server, config };
}
