// engine.js — 访谈引擎（确定性内核）
//
// 这是整个产品的"方法论执行器"。它不生成华丽的句子，只做三件最要紧的事：
//   1. 分清老人这句是拒绝、沉默、重复，还是真的往下讲了。
//   2. 顺着老人上句话延伸追问；延伸不出来，才从话术库里挑一个"具体到细节"的新问题。
//   3. 管住分寸：敏感话题要看暖场程度；拒绝过的话题不再碰；重复当成"这事对他重要"。
//
// 华丽、自然的那一层交给 DeepSeek（ai/prompt.js + adapter.js）。
// 引擎保证的是：哪怕没有 AI，问出来的也绝不是"查户口"。
//
// 纯逻辑，不碰 DOM，可在 Node 里直接测。

import { bank } from './bank.js';
import { prose } from './prose.js';
import { classify, isRepeatAgainstHistory, INTENT } from './intent.js';
import { addProfile, addMoment, noteRepeat, markRefusedTopic, touch } from './model.js';

export { INTENT };

const LINEAR_STAGES = ['childhood', 'schooling', 'youth', 'family', 'midlife', 'later'];
const STAGE_QUOTA = 6; // 一个阶段问够 6 条就往下走

// ---------- 随机数（可复现） ----------
export function hashString(s) {
  let h = 2166136261 >>> 0;
  const str = String(s == null ? '' : s);
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function createRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rngFor(session) {
  ensureMeta(session);
  session.meta.turnSeed = (session.meta.turnSeed || 0) + 1;
  return createRng(hashString(session.id + '|' + session.meta.turnSeed));
}

// 从数组里挑一个，尽量不重复最近的（recentSaid 存最近说过的句子）。
function pickAndRecord(session, arr, rng) {
  if (!arr || !arr.length) return '';
  const recent = session.meta.recentSaid || [];
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const chosen = shuffled.find((x) => !recent.includes(x)) || shuffled[0];
  recent.push(chosen);
  if (recent.length > 12) recent.shift();
  session.meta.recentSaid = recent;
  return chosen;
}

function ensureMeta(session) {
  if (!session.meta) session.meta = {};
  if (!session.meta.elderUtterances) session.meta.elderUtterances = [];
  if (!session.meta.recentSaid) session.meta.recentSaid = [];
  if (session.interview.consecutiveSilence == null) session.interview.consecutiveSilence = 0;
  if (session.interview.recentRefuse == null) session.interview.recentRefuse = 0;
  if (session.interview.warmTurns == null) session.interview.warmTurns = 0;
  if (session.meta.extChain == null) session.meta.extChain = 0;
  if (session.meta.breatheCadence == null) session.meta.breatheCadence = 0;
  if (session.meta.breathePace == null) session.meta.breathePace = BREATHE_PACE;
  return session;
}

// ---------- 呼吸节奏：这一拍要不要"只接住、不追问" ----------
// 访谈最怕连珠炮：老人刚说一句有分量的话，马上被追问下一个问题，显得着急。
// 引擎负责的正是这个"分寸"——它决定哪些回合"不推进、只陪着"。
const BREATHE_PACE = 3; // 每隔几个实质回合，给一个纯回应拍（不含问题）。

// 该不该歇一拍？规则尽量简单、可预测、可测：
//   - 头两个实质回合不歇，先把节奏带起来。
//   - 之后每到 BREATHE_PACE 的节奏点，就歇一拍（这不设随机，避免把访谈结果打乱）。
function shouldBreathe(session) {
  const w = session.interview.warmTurns || 0;
  if (w <= 2) return false;
  return (session.meta.breatheCadence || 0) >= (session.meta.breathePace || BREATHE_PACE) - 1;
}

// ---------- 分寸：敏感话题上限 ----------
export function sensitivityCeiling(session) {
  const w = session.interview.warmTurns || 0;
  // 注意：recentRefuse 这个字段名有点误导，它实际存的是「距离上一次拒绝过了几轮」，
  // 不是拒绝次数。刚拒绝时（=0）值最小，越往后值越大，越大才越敢碰敏感话题。
  const turnsSinceRefuse = session.interview.recentRefuse || 0;
  let c = 0;
  if (w >= 3) c = 1;
  if (w >= 8) c = 2;
  if (w >= 14) c = 3;
  // 刚被拒绝过（距上次拒绝不足 2 轮），先别往深里问。
  if (turnsSinceRefuse < 2) c = Math.min(c, 1);
  return c;
}

// ---------- 上次问了什么 ----------
function lastQuestion(session) {
  return session.meta.lastQuestion || null;
}

function setLastQuestion(session, q) {
  session.meta.lastQuestion = q;
  touch(session);
  return session;
}

// ---------- 从老人的话里找延伸 ----------
function matchesAny(text, keywords) {
  return keywords.some((k) => text.includes(k));
}

export function pickExtension(session, text, rng) {
  const last = lastQuestion(session);
  const ceiling = sensitivityCeiling(session);
  const refused = session.interview.refusedTopics || [];
  const candidates = [];

  // 优先：上一问自己带的追问。带条件的（具体命中）优先，无条件的是兜底。
  if (last && Array.isArray(last.followUps) && !refused.includes(last.topic)) {
    const cond = [];
    const uncond = [];
    for (const fu of last.followUps) {
      if (fu.when && fu.when.length) {
        if (matchesAny(text, fu.when)) cond.push(fu);
      } else {
        uncond.push(fu);
      }
    }
    const picked = cond.length ? cond : uncond;
    for (const fu of picked) {
      if (last.sensitivity <= ceiling) {
        candidates.push({
          text: fu.ask,
          source: 'question',
          topic: last.topic,
          sensitivity: last.sensitivity,
          captures: last.captures || []
        });
      }
    }
  }

  // 其次：全局触发式规则（关键词出现在老人自己的话里）。
  for (const rule of bank.followUpRules) {
    if (rule.sensitivity > ceiling) continue;
    const stageOk = rule.stage === 'any' || rule.stage === session.interview.stage;
    if (!stageOk) continue;
    if (!matchesAny(text, rule.when)) continue;
    for (const ask of rule.asks) {
      candidates.push({
        text: ask,
        source: 'rule',
        topic: last ? last.topic : null,
        sensitivity: rule.sensitivity,
        captures: last ? last.captures || [] : []
      });
    }
  }

  if (!candidates.length) return null;

  const recent = session.meta.recentSaid || [];
  const fresh = candidates.filter((c) => !recent.includes(c.text));
  const pool = fresh.length ? fresh : candidates;

  // 上一问自带的追问最贴题，优先；没有再用规则里随机挑一条。
  const byQuestion = pool.filter((c) => c.source === 'question');
  const chosen = byQuestion.length
    ? byQuestion[Math.floor(rng() * byQuestion.length)]
    : pool[Math.floor(rng() * pool.length)];

  recent.push(chosen.text);
  if (recent.length > 12) recent.shift();
  session.meta.recentSaid = recent;

  return chosen;
}

// ---------- 挑一条新问题 ----------
export function pickFreshQuestion(session, rng, opts = {}) {
  // 一个阶段问够配额，就往下一个阶段走，避免在童年问题上打转。
  if (
    session.interview.stage !== 'anytime' &&
    (session.interview.askedInStage || 0) >= STAGE_QUOTA &&
    advanceStage(session)
  ) {
    return pickFreshQuestion(session, rng, opts);
  }

  const ceiling = opts.preferEasy ? 0 : sensitivityCeiling(session);
  const stage = session.interview.stage;

  const pool = bank.questions.filter((q) => {
    if (q.stage !== stage && q.stage !== 'anytime') return false;
    if (session.interview.askedQuestionIds.includes(q.id)) return false;
    if (session.interview.refusedTopics.includes(q.topic)) return false;
    if (q.sensitivity > ceiling) return false;
    if (opts.preferEasy && q.sensitivity !== 0) return false;
    return true;
  });

  if (!pool.length) {
    // 当前阶段问完了 / 被筛空了，就往下走一个阶段。
    if (advanceStage(session)) {
      return pickFreshQuestion(session, rng, opts);
    }
    // 都问遍了，回到 anytime 的浅题兜底。
    const fallback = bank.questions.filter(
      (q) => q.stage === 'anytime' && q.sensitivity === 0 && !session.interview.askedQuestionIds.includes(q.id)
    );
    if (fallback.length) return pickWeighted(session, fallback, rng);
    return null;
  }

  return pickWeighted(session, pool, rng);
}

function pickWeighted(session, pool, rng) {
  // 权重 = 自带 weight × 话题新颖度加成（没聊过的话题优先，保证覆盖面）。
  const covered = session.interview.coveredTopics || [];
  const weighted = pool.map((q) => {
    const novelty = covered.includes(q.topic) ? 1 : 2.2;
    return { q, w: (q.weight || 1) * novelty };
  });
  const total = weighted.reduce((s, x) => s + x.w, 0);
  let r = rng() * total;
  let picked = weighted[0].q;
  for (const { q, w } of weighted) {
    r -= w;
    if (r <= 0) {
      picked = q;
      break;
    }
  }

  session.interview.askedQuestionIds.push(picked.id);
  if (!covered.includes(picked.topic)) covered.push(picked.topic);
  if (picked.stage !== 'anytime') session.interview.askedInStage = (session.interview.askedInStage || 0) + 1;
  session.meta.extChain = 0; // 新问题开始，重置追问链

  const ctx = {
    id: picked.id,
    text: picked.text,
    stage: picked.stage,
    topic: picked.topic,
    sensitivity: picked.sensitivity,
    captures: picked.captures || [],
    followUps: picked.followUps || []
  };
  setLastQuestion(session, ctx);
  return ctx;
}

export function advanceStage(session) {
  const idx = LINEAR_STAGES.indexOf(session.interview.stage);
  if (idx < 0) return false;
  if (idx >= LINEAR_STAGES.length - 1) return false;
  session.interview.stage = LINEAR_STAGES[idx + 1];
  session.interview.askedInStage = 0;
  touch(session);
  return true;
}

// ---------- 开场 / 收尾 ----------
export function warmup(session) {
  ensureMeta(session);
  const rng = rngFor(session);
  return pickAndRecord(session, bank.warmups, rng);
}

// 进访谈时用这个，而不是裸 warmup：第一句是"认人"——先自然地问一声怎么称呼对方，
// 不劈头就砸具体问题。问称呼本身就是开场白，老人答了称呼，话题自然就有了下文，
// 不会掉进"没问就先答"的空档。所以这一句**只有问候/问称呼，不带第一个问题**，
// 第一个具体问题留在老人回应称呼之后由引擎正常带出。
export function opening(session) {
  ensureMeta(session);
  const rng = rngFor(session);
  const greeting = pickAndRecord(session, bank.warmups, rng);
  return { greeting, firstQuestion: '', text: greeting, question: null };
}

export function closing(session) {
  ensureMeta(session);
  const rng = rngFor(session);
  return pickAndRecord(session, bank.closings, rng);
}

// ---------- 核心入口：老人说一句，引擎回一句 ----------
export function respond(session, text, { audioId } = {}) {
  ensureMeta(session);
  const rng = rngFor(session);
  const intent = classify(text);

  // 这一轮没说拒绝，就代表「距上次拒绝又远了一轮」，值 +1 拉开距离。
  // （拒绝时会在 markRefusedTopic 里把它清零，重新开始累计。）
  if (intent !== INTENT.REFUSE) {
    session.interview.recentRefuse = (session.interview.recentRefuse || 0) + 1;
  }

  // 空 / 沉默：陪着等，不催；连续两回沉默就给一个更小的具体问题。
  if (intent === INTENT.EMPTY || intent === INTENT.SILENCE) {
    session.interview.consecutiveSilence = (session.interview.consecutiveSilence || 0) + 1;
    const base = pickAndRecord(session, bank.silenceReplies, rng);
    if (session.interview.consecutiveSilence >= 2) {
      session.interview.consecutiveSilence = 0;
      const q = pickFreshQuestion(session, rng, { preferEasy: true });
      return { intent, reply: q ? `${base} ${q.text}` : base, question: q };
    }
    return { intent, reply: base };
  }

  session.interview.consecutiveSilence = 0;

  // 拒绝：停，不劝，不追问。标记这个话题以后不再碰，并清掉上一问的追问上下文。
  if (intent === INTENT.REFUSE) {
    const last = lastQuestion(session);
    if (last && last.topic) markRefusedTopic(session, last.topic);
    session.meta.lastQuestion = null;
    session.meta.extChain = 0;
    const reply = pickAndRecord(session, bank.refusalReplies, rng);
    return { intent, reply };
  }

  // 实质回答。
  const history = session.meta.elderUtterances || [];
  if (isRepeatAgainstHistory(text, history)) {
    // 重复：当成"这件事对他要紧"，接住，不点破。
    const last = lastQuestion(session);
    const key = (last && last.topic) || 'misc';
    noteRepeat(session, key, text);
    const reply = pickAndRecord(session, bank.repeatReplies, rng);
    return { intent, repeat: true, reply };
  }

  // 正常推进。
  session.interview.warmTurns += 1;
  session.meta.elderUtterances.push(text);
  if (session.meta.elderUtterances.length > 60) session.meta.elderUtterances.shift();

  const last = lastQuestion(session);
  const fields = last && Array.isArray(last.captures) ? last.captures : [];
  for (const field of fields) addProfile(session, field, text);
  // 老人的话，无论有没有问题上下文，都要记进时间线。字段归属没有就留空，话不能丢。
  addMoment(session, {
    stage: last ? last.stage : session.interview.stage,
    topic: last ? last.topic : null,
    field: fields.length ? fields[0] : null,
    text,
    audioId
  });

  // 呼吸拍：该歇就歇。这一拍不追问、只接住——老人刚说的话里有分量，给它留个空。
  // 引擎只是决定"节奏"，并不生成句子；AI 开着时由 AI 把这段润色成贴心的回应，
  // 这里给一个"没开 AI 也能接住"的兜底。歇完一拍，下一轮再照常推进。
  if (shouldBreathe(session)) {
    session.meta.breatheCadence = 0;
    const reply = pickAndRecord(session, bank.beatReplies, rng);
    return { intent, reply, breathe: true };
  }
  session.meta.breatheCadence = (session.meta.breatheCadence || 0) + 1;

  const ext = (session.meta.extChain || 0) >= 2
    ? null
    : pickExtension(session, text, rng);

  if (ext) {
    session.meta.extChain = (session.meta.extChain || 0) + 1;
    const q = {
      text: ext.text,
      stage: last ? last.stage : session.interview.stage,
      topic: ext.topic,
      sensitivity: ext.sensitivity,
      captures: ext.captures || [],
      followUps: [],
      extension: true
    };
    setLastQuestion(session, q);
    return { intent, reply: ext.text, question: q, extension: true };
  }

  // 追问到头了，转广度，问一个带字段归属的新问题。
  const q = pickFreshQuestion(session, rng);
  if (!q) {
    // 聊到没得挑了，就收个尾。
    return { intent, reply: pickAndRecord(session, bank.closings, rng), closing: true };
  }
  return { intent, reply: q.text, question: q };
}

// ---------- 给家人 / 测试看的进度摘要 ----------
export function summarize(session) {
  ensureMeta(session);
  return {
    name: session.person && session.person.name,
    stage: session.interview.stage,
    warmTurns: session.interview.warmTurns,
    coveredTopics: (session.interview.coveredTopics || []).length,
    refusedTopics: session.interview.refusedTopics.slice(),
    moments: session.moments.length,
    profileFields: Object.keys(session.profile).length,
    repeats: session.repeats.length,
    turns: session.turns.length,
    sensitivityCeiling: sensitivityCeiling(session)
  };
}

// prose 供传记模块用，这里转出去避免二次 import 顺序问题。
export { prose, bank };
