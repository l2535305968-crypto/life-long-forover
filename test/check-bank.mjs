// 人生之书 bank.js 访谈话术库自检
// 运行：node test\check-bank.mjs （在项目根目录）
// 不达标时非零退出，并打印各项实际数字。

import { bank } from '../web/js/core/bank.js';

const failures = [];

function record(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
  if (!ok) failures.push(name);
}

const stageIds = bank.stages.map((s) => s.id);
const topicIds = bank.topics.map((t) => t.id);
const fieldIds = bank.profileFields.map((f) => f.id);
const questions = bank.questions;
const rules = bank.followUpRules;

// ---------- 基础数量 ----------
record('stages 数量', bank.stages.length === 7, `实际 ${bank.stages.length}，要求 7`);
record(
  'stages 顺序与 id',
  JSON.stringify(stageIds) === JSON.stringify(['childhood', 'schooling', 'youth', 'family', 'midlife', 'later', 'anytime']),
  `实际 [${stageIds.join(', ')}]`
);
record('topics 数量', bank.topics.length >= 16 && bank.topics.length <= 22, `实际 ${bank.topics.length}，要求 16~22`);
record('profileFields 数量', bank.profileFields.length >= 20 && bank.profileFields.length <= 30, `实际 ${bank.profileFields.length}，要求 20~30`);

// ---------- questions ----------
record('questions 数量', questions.length >= 150, `实际 ${questions.length}，要求 >= 150`);

const dupIds = questions.map((q) => q.id).filter((id, i, arr) => arr.indexOf(id) !== i);
record('question.id 唯一', dupIds.length === 0, dupIds.length ? `重复：${[...new Set(dupIds)].join(', ')}` : `共 ${questions.length} 条`);

const badStage = questions.filter((q) => !stageIds.includes(q.stage));
record('question.stage 合法', badStage.length === 0, badStage.length ? `非法：${[...new Set(badStage.map((q) => q.stage))].join(', ')}` : '全部在 stages 内');

const badTopic = questions.filter((q) => !topicIds.includes(q.topic));
record('question.topic 合法', badTopic.length === 0, badTopic.length ? `非法：${[...new Set(badTopic.map((q) => q.topic))].join(', ')}` : '全部在 topics 内');

const badCaptures = questions.flatMap((q) => q.captures.filter((c) => !fieldIds.includes(c)));
record('captures 字段有定义', badCaptures.length === 0, badCaptures.length ? `未定义：${[...new Set(badCaptures)].join(', ')}` : '全部在 profileFields 内');

const longTexts = questions.filter((q) => q.text.length > 30);
record('question.text 长度 <= 30', longTexts.length === 0, longTexts.length ? `超长：${longTexts.map((q) => `${q.id}(${q.text.length}字)`).join('、')}` : '全部 <= 30 字');

const badWeight = questions.filter((q) => !(q.weight >= 1 && q.weight <= 5));
record('question.weight 1~5', badWeight.length === 0, `实际范围检查通过，异常 ${badWeight.length} 条`);

const badSens = questions.filter((q) => !(q.sensitivity >= 0 && q.sensitivity <= 3));
record('question.sensitivity 0~3', badSens.length === 0, `异常 ${badSens.length} 条`);

const badFollowCount = questions.filter((q) => !(q.followUps.length >= 0 && q.followUps.length <= 4));
record('question.followUps 0~4 条', badFollowCount.length === 0, `异常 ${badFollowCount.length} 条`);

const kinds = {};
for (const q of questions) kinds[q.kind] = (kinds[q.kind] || 0) + 1;
record('kind: sensory >= 25', (kinds.sensory || 0) >= 25, `实际 ${kinds.sensory || 0}`);
record('kind: object >= 15', (kinds.object || 0) >= 15, `实际 ${kinds.object || 0}`);
record('kind: value >= 15', (kinds.value || 0) >= 15, `实际 ${kinds.value || 0}`);

const sens3 = questions.filter((q) => q.sensitivity === 3);
record('sensitivity=3 <= 12', sens3.length <= 12, `实际 ${sens3.length}，id：${sens3.map((q) => q.id).join('、') || '无'}`);

const banned = ['请描述', '请介绍', '能否', '分享', '体验', '旅程'];
const bannedHits = questions.flatMap((q) => banned.filter((w) => q.text.includes(w)).map((w) => `${q.id} 含「${w}」`));
record('question.text 无禁用词', bannedHits.length === 0, bannedHits.length ? bannedHits.join('；') : '全部干净');

// 各阶段数量（anytime 至少 20，其余至少 18）
const stageCount = {};
for (const q of questions) stageCount[q.stage] = (stageCount[q.stage] || 0) + 1;
let stageAllOk = true;
let stageDetail = [];
for (const s of stageIds) {
  const need = s === 'anytime' ? 20 : 18;
  const n = stageCount[s] || 0;
  if (n < need) stageAllOk = false;
  stageDetail.push(`${s}:${n}`);
}
record('各阶段数量达标', stageAllOk, stageDetail.join('，'));

// ---------- followUpRules ----------
record('followUpRules 数量', rules.length >= 45, `实际 ${rules.length}，要求 >= 45`);

const ruleDup = rules.map((r) => r.id).filter((id, i, arr) => arr.indexOf(id) !== i);
record('rule.id 唯一', ruleDup.length === 0, ruleDup.length ? `重复：${[...new Set(ruleDup)].join(', ')}` : `共 ${rules.length} 条`);

const badRuleWhen = rules.filter((r) => !(r.when.length >= 2 && r.when.length <= 8));
record('rule.when 关键词 2~8 个', badRuleWhen.length === 0, `异常 ${badRuleWhen.length} 条`);

const badRuleAsks = rules.filter((r) => !(r.asks.length >= 1 && r.asks.length <= 3));
record('rule.asks 1~3 句', badRuleAsks.length === 0, `异常 ${badRuleAsks.length} 条`);

const badRuleStage = rules.filter((r) => r.stage !== 'any' && !stageIds.includes(r.stage));
record('rule.stage 合法', badRuleStage.length === 0, badRuleStage.length ? `非法：${[...new Set(badRuleStage.map((r) => r.stage))].join(', ')}` : `any ${rules.filter((r) => r.stage === 'any').length} 条 + 指定阶段 ${rules.length - rules.filter((r) => r.stage === 'any').length} 条`);

const badRuleSens = rules.filter((r) => !(r.sensitivity >= 0 && r.sensitivity <= 3));
record('rule.sensitivity 0~3', badRuleSens.length === 0, `异常 ${badRuleSens.length} 条`);

// ---------- 六类回应语料 ----------
const minCounts = {
  refusalReplies: 14,
  silenceReplies: 14,
  repeatReplies: 14,
  warmups: 12,
  closings: 12,
  notUnderstoodReplies: 10
};
for (const [key, min] of Object.entries(minCounts)) {
  const actual = bank[key] ? bank[key].length : 0;
  record(`${key} 数量`, actual >= min, `实际 ${actual}，要求 >= ${min}`);
}

// ---------- 回应语料也无禁用词（附加检查） ----------
const replyHits = [];
for (const key of Object.keys(minCounts)) {
  for (const line of bank[key]) {
    for (const w of banned) {
      if (line.includes(w)) replyHits.push(`${key} 含「${w}」：${line}`);
    }
  }
}
record('六类回应无禁用词', replyHits.length === 0, replyHits.length ? replyHits.join('；') : '全部干净');

// ---------- 汇总 ----------
const stageSummary = stageDetail.map((s) => s.replace(':', '=')).join(', ');
console.log('\n===== 实际数字汇总 =====');
console.log(`questions:            ${questions.length} 条`);
console.log(`  per-stage:          ${stageSummary}`);
console.log(`  per-kind:           ${Object.entries(kinds).map(([k, n]) => `${k}=${n}`).join(', ')}`);
console.log(`  sensitivity=3:      ${sens3.length} 条`);
console.log(`followUpRules:        ${rules.length} 条`);
console.log(`refusalReplies:       ${bank.refusalReplies.length} 条`);
console.log(`silenceReplies:       ${bank.silenceReplies.length} 条`);
console.log(`repeatReplies:        ${bank.repeatReplies.length} 条`);
console.log(`warmups:              ${bank.warmups.length} 条`);
console.log(`closings:             ${bank.closings.length} 条`);
console.log(`notUnderstoodReplies: ${bank.notUnderstoodReplies.length} 条`);
console.log(`profileFields:        ${bank.profileFields.length} 个`);
console.log(`topics:               ${bank.topics.length} 个`);
console.log('========================');

if (failures.length) {
  console.error(`\n不达标 ${failures.length} 项：${failures.join('，')}`);
  process.exit(1);
}
console.log('\n全部通过。');
