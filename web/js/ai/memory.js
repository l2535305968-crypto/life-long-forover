// memory.js — 把已经聊出来的事实，压成一段"AI 记得住"的中文摘要。
//
// 背景：session 里其实早就存了不少家底（profile/重复的事/moments），
// 但 interviewSystemPrompt 从没用过它们——AI 每次只能看到最近 24 条原始对话，
// 于是永远像头一回聊。这里把那些结构化事实翻译成一小段人话，塞进系统提示词，
// 让 AI 能接着"上次您说……"往下走，而不是重新打听。
//
// 底线：只写老人真说过的话。person 里那些还没聊出来的（出生地、年份）不编。
// 摘要必须短——它只是"背景"，不能把 40 字回话的口语感冲掉，所以用"标签：片段"的紧凑格式。

// fieldId → 中文标签。这些是 bank.js 里 captures / profile 用到的字段。
const FIELD_LABEL = {
  food: '吃食', home: '住家', parents: '爹娘', siblings: '兄弟姐妹',
  joy: '高兴的事', hardship: '最难的时候', school: '求学', job: '干活',
  children: '儿女', heirloom: '老物件', festival: '过节', importantPerson: '要紧的人',
  illness: '身子', motto: '留给后人的话', marriage: '成家', military: '当兵',
  money: '钱财', birthPlace: '出生地', clothes: '穿戴', countryside: '老家',
  craft: '手艺', factory: '工厂', firstJob: '头一份活', letter: '书信',
  importantYear: '要紧的年头', move: '搬家', retire: '退休', travel: '出门',
  babyName: '孩子的名儿', catchphrase: '口头禅'
};

// 每条事实的片段都剪到这么长，太长的截断，别让摘要撑爆 prompt。
function clip(s, max = 26) {
  const t = String(s || '').trim();
  return t.length > max ? t.slice(0, max) + '…' : t;
}

// 单个字段的事实串：把该字段下所有片段包进一段。
function fieldFacts(fieldId, texts) {
  const label = FIELD_LABEL[fieldId] || fieldId;
  const parts = (texts || []).map((t) => clip(t)).filter(Boolean);
  if (!parts.length) return '';
  return label + '：' + parts.join('、');
}

// 老人反复讲的事（count ≥ 2 才算"他放心上"），只挑最近的 2 条，别铺开。
function emphasized(session) {
  const reps = (session.repeats || []).filter((r) => r.count >= 2);
  if (!reps.length) return '';
  const top = reps.slice(-2).map((r) => clip(r.text)).filter(Boolean);
  return top.length ? '他反复提到：' + top.join('；') : '';
}

// 拼出一段摘要。maxFields 控制"最多列几类事实"，太长就只取前面几类，别冲淡口语。
export function memoryDigest(session, { maxFields = 6 } = {}) {
  const out = [];

  // 从 profile 里挑出有"内容"的字段，按出现字段的顺序。
  const fields = Object.entries(session.profile || {})
    .filter(([, texts]) => Array.isArray(texts) && texts.length)
    .map(([id, texts]) => fieldFacts(id, texts))
    .filter(Boolean);

  if (fields.length) {
    const capped = fields.slice(0, maxFields);
    out.push('已知：' + capped.join('；'));
    if (fields.length > maxFields) out.push('（还有别的，先记这些要紧的。）');
  }

  const emph = emphasized(session);
  if (emph) out.push(emph);

  return out.join('\n');
}

// 是否已经聊出足够的东西，值得给 AI 提示"记得住"。
// 摘要为空、或只有一两条时，让它别硬装——没得记就别硬往"记得"上拐。
export function hasSubstance(session) {
  const facts = Object.values(session.profile || {}).filter((t) => t && t.length);
  const reps = (session.repeats || []).filter((r) => r.count >= 2).length;
  return facts.length >= 2 || reps >= 1;
}
