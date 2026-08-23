// biography.js — 传记生成与文风检查。
//
// 两条路径：
//   1. renderDeterministic(session)：没有 AI 时的诚实兜底。只用老人真说过的片段，
//      按阶段排成可读的段落。宁可短，不编造。
//   2. buildContext(session)：给 AI 用的素材包 + 写作禁令。AI 写出自然、有温度的长传记，
//      再由 lint() 把 human-writing 的禁令逐条检查一遍。
//
// 底线（贯穿两条路径）：传记只写老人说过的话。没说的一律不写。

import { prose } from './prose.js';
import { buildTimeline, stageName } from './timeline.js';
import { STAGE_ORDER } from './model.js';

// ---------- 文风检查 ----------
export function lint(text) {
  const str = String(text || '');
  const errors = [];
  const warnings = [];
  for (const rule of prose.banned) {
    const re = new RegExp(rule.pattern.source, rule.pattern.flags);
    const hits = str.match(re);
    if (hits && hits.length) {
      errors.push({ id: rule.id, name: rule.name, count: hits.length, hint: rule.hint });
    }
  }
  for (const rule of prose.warnings) {
    const re = new RegExp(rule.pattern.source, rule.pattern.flags);
    const hits = str.match(re);
    if (hits && hits.length) {
      warnings.push({ id: rule.id, name: rule.name, count: hits.length, hint: rule.hint });
    }
  }
  return { errors, warnings, clean: errors.length === 0, length: str.length };
}

// ---------- 素材包（给 AI） ----------
export function buildContext(session) {
  const profile = {};
  for (const [field, texts] of Object.entries(session.profile || {})) {
    profile[field] = Array.isArray(texts) ? texts.slice() : [];
  }
  return {
    person: session.person || {},
    profile,
    moments: (session.moments || []).map((m) => ({ ...m })),
    turns: (session.turns || []).map((t) => ({ role: t.role, text: t.text })),
    repeats: (session.repeats || []).map((r) => ({ key: r.key, count: r.count })),
    writingRules: prose.writingRules,
    eraAnchors: prose.eraAnchors
  };
}

// ---------- 诚实兜底：只用老人说过的话 ----------
export function renderDeterministic(session) {
  const timeline = buildTimeline(session);
  const parts = [];
  const name = (session.person && session.person.name && session.person.name.trim()) || '他';
  const birthPlace = session.person && session.person.birthPlace && session.person.birthPlace.trim();

  if (birthPlace) {
    parts.push(`${name}生在${birthPlace}。`);
  }

  for (const group of timeline.groups) {
    if (!group.moments.length) continue;
    const sentences = group.moments.map((m) => m.text.trim()).filter(Boolean);
    if (!sentences.length) continue;
    parts.push(`说起${group.name}，${sentences.join('。')}。`);
  }

  const motto = session.profile && session.profile.motto && session.profile.motto.length
    ? session.profile.motto[session.profile.motto.length - 1]
    : null;
  if (motto && motto.trim()) {
    parts.push(`${name}留给后人的话，${motto.trim()}。`);
  }

  if (!parts.length) {
    const text = prose.gapPhrases[0] || '这本书还没记下多少。';
    return { text, ...lint(text), deterministic: true };
  }

  const text = parts.join('\n\n');
  const report = lint(text);
  return { text, ...report, deterministic: true };
}

// ---------- 阶段推进提示（给家人看当前聊到哪） ----------
export function stageProgress(session) {
  const idx = STAGE_ORDER.indexOf(session.interview.stage);
  return {
    current: session.interview.stage,
    currentName: stageName(session.interview.stage),
    index: idx,
    total: STAGE_ORDER.length,
    next: idx >= 0 && idx < STAGE_ORDER.length - 1 ? STAGE_ORDER[idx + 1] : null
  };
}

export { prose };
