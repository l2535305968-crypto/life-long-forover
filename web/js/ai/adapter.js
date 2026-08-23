// adapter.js — AI 适配层。
// 唯一跟 /api/chat 打交道的地方。上层（UI）只调用这里的函数，不关心 Key 在哪。
// Key 永远留在家人的电脑上（server/server.mjs），手机拿不到。

import { interviewSystemPrompt, turnPrompt, biographyPrompts } from './prompt.js';
import { buildContext } from '../core/biography.js';

export async function callChat(messages, opts = {}) {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      messages,
      temperature: opts.temperature,
      max_tokens: opts.maxTokens
    })
  });
  const data = await res.json().catch(() => ({ ok: false, error: '服务返回的不是 JSON' }));
  if (!res.ok || !data.ok) {
    const err = new Error(data.error || `请求失败（HTTP ${res.status}）`);
    err.code = data.code || 'UNKNOWN';
    throw err;
  }
  return data.text;
}

function historyMessages(session, limit = 24) {
  return (session.turns || [])
    .slice(-limit)
    .map((t) => ({ role: t.role === 'elder' ? 'user' : 'assistant', content: t.text }));
}

function stripQuotes(s) {
  return String(s || '').trim().replace(/^["'""'']+|["'""'']+$/g, '').trim();
}

// 把引擎挑中的问题，润色成"像孙辈在说"的一句。extraSystem 用于追加智能体人设。
export async function polishQuestion(session, questionText, extraSystem = '') {
  const messages = [
    { role: 'system', content: interviewSystemPrompt(session, extraSystem) },
    ...historyMessages(session, 24),
    { role: 'user', content: turnPrompt(session, questionText) }
  ];
  const text = await callChat(messages, { temperature: 0.85, maxTokens: 140 });
  const polished = stripQuotes(text);
  if (polished && polished.length <= 80) return polished;
  return questionText;
}

// 生成传记正文。只写材料里老人说过的话。
export async function generateBiography(session) {
  const { system, user } = biographyPrompts(buildContext(session));
  const text = await callChat(
    [{ role: 'system', content: system }, { role: 'user', content: user }],
    { temperature: 0.7, maxTokens: 3000 }
  );
  return stripQuotes(text);
}

// 上层统一入口：引擎先给出"该说什么"，AI 负责"说得好听"。
// 拒绝 / 沉默 / 重复的软话不需要 AI，直接用引擎的。agentSystem 为可选智能体人设。
export async function nextAiLine(session, engineResult, { aiEnabled = true, agentSystem = '' } = {}) {
  if (!engineResult.question || !aiEnabled) return engineResult.reply;
  try {
    return await polishQuestion(session, engineResult.question.text, agentSystem);
  } catch {
    // 断网 / 没 Key / 上游出错，退回引擎的确定性问句。访谈不中断。
    return engineResult.reply;
  }
}
