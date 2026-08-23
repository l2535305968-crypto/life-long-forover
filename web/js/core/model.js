// model.js — 会话数据结构与工厂函数。
//
// 这是整本书的数据骨架。所有模块都读写同一个 session 对象。
// 隐私底线在这里有体现：老人的故事是一个本地对象，序列化后只进 IndexedDB，
// 不经过服务端；服务端只看到"正在问什么"的临时对话请求。

const STAGE_ORDER = ['childhood', 'schooling', 'youth', 'family', 'midlife', 'later', 'anytime'];

let seq = 0;
function makeId(prefix) {
  seq = (seq + 1) % 0xffffff;
  const rnd = Math.floor(Math.random() * 0xffffff).toString(36).padStart(4, '0');
  const ts = Date.now().toString(36).slice(-4);
  return `${prefix}_${ts}${rnd}${seq.toString(36).padStart(2, '0')}`;
}

function makeGrantCode() {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let s = '';
  for (let i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

export { STAGE_ORDER, makeId };

export function newSession(opts = {}) {
  const now = new Date().toISOString();
  return {
    version: 1,
    id: makeId('book'),
    createdAt: now,
    updatedAt: now,

    // 老人是谁
    person: {
      name: opts.personName || '',
      birthYear: null,        // 数字或字符串（"记不清"），不能替老人定
      birthPlace: '',
      dialect: opts.dialect || 'putonghua'
    },

    // 访谈进行到哪一步
    interview: {
      stage: STAGE_ORDER[0],
      askedInStage: 0,        // 当前阶段已经问了几条
      warmTurns: 0,           // 累计的"实质回答"轮数，越高越可以碰敏感话题
      recentRefuse: 0,        // 距离上一次拒绝经过的轮数，敏感话题要看它
      askedQuestionIds: [],   // 问过的问题 id（含 followUp 的 id）
      refusedTopics: [],      // 老人拒绝过的话题 id
      coveredTopics: []       // 已覆盖的主题 id（大致去重用）
    },

    // 从聊天里沉淀出来的事实
    profile: {},              // fieldId -> 字符串片段数组
    moments: [],              // { id, stage, topic, field, text, ts, audioId }
    turns: [],                // { role: 'elder'|'ai', text, ts, audioId?, intent? }
    repeats: [],              // { key, text, count, lastTs } 老人反复讲的事

    // 录音（原声是产品价值的一部分）
    audio: [],                // { id, mime, size, durationMs, dataUrl, ts }（dataUrl 可导出）

    // 照片（老照片、老物件，作为"书页"翻着看）
    images: [],               // { id, name, dataUrl, width, height, size, caption, ts }

    // 日志（本机事件记录，随书保存，可单独导出）
    log: [],                  // { ts, type, msg }

    // 家人查看授权
    auth: {
      grantCode: makeGrantCode(),
      familyEnabled: false,
      grantedAt: null
    },

    // 元数据
    meta: {
      engineVersion: '1.0',
      lastStage: STAGE_ORDER[0]
    }
  };
}

export function touch(session) {
  session.updatedAt = new Date().toISOString();
  return session;
}

export function addTurn(session, role, text, extra = {}) {
  session.turns.push({
    role,
    text,
    ts: new Date().toISOString(),
    ...extra
  });
  return touch(session);
}

// 往档案里记一个字段片段。同一字段可有多段，传记生成时拼起来。
export function addProfile(session, fieldId, text) {
  if (!text || !fieldId) return session;
  if (!session.profile[fieldId]) session.profile[fieldId] = [];
  const t = String(text).trim();
  if (t && !session.profile[fieldId].includes(t)) {
    session.profile[fieldId].push(t);
  }
  return touch(session);
}

export function addMoment(session, { stage, topic, field, text, audioId }) {
  if (!text) return session;
  session.moments.push({
    id: makeId('m'),
    stage: stage || session.interview.stage,
    topic: topic || null,
    field: field || null,
    text: String(text).trim(),
    ts: new Date().toISOString(),
    audioId: audioId || null
  });
  return touch(session);
}

// 记录老人反复讲的事。key 用话题或字段，text 保留最近一次说法。
export function noteRepeat(session, key, text) {
  const existing = session.repeats.find((r) => r.key === key);
  if (existing) {
    existing.count += 1;
    existing.text = text;
    existing.lastTs = new Date().toISOString();
  } else {
    session.repeats.push({ key, text, count: 1, lastTs: new Date().toISOString() });
  }
  return touch(session);
}

export function markRefusedTopic(session, topicId) {
  if (topicId && !session.interview.refusedTopics.includes(topicId)) {
    session.interview.refusedTopics.push(topicId);
  }
  session.interview.recentRefuse = 0;
  return touch(session);
}

// 往书里插一张照片。dataUrl 是字符串，能进 IndexedDB、也能原样导出/导入。
export function addImage(session, img) {
  if (!img || !img.dataUrl) return session;
  if (!Array.isArray(session.images)) session.images = [];
  session.images.push({
    id: makeId('img'),
    name: img.name || '',
    dataUrl: img.dataUrl,
    width: img.width || 0,
    height: img.height || 0,
    size: img.size || 0,
    caption: img.caption || '',
    ts: new Date().toISOString()
  });
  return touch(session);
}

export function removeImage(session, id) {
  if (!Array.isArray(session.images)) return session;
  session.images = session.images.filter((im) => im.id !== id);
  return touch(session);
}

// 记一条日志（只存本机，随书走）。type 用简短的英文，msg 用中文给人看。
export function addLog(session, type, msg) {
  if (!Array.isArray(session.log)) session.log = [];
  session.log.push({ ts: new Date().toISOString(), type: String(type || 'info'), msg: String(msg || '') });
  if (session.log.length > 500) session.log = session.log.slice(-500);
  return touch(session);
}
