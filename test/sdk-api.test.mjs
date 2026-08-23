// sdk-api.test.mjs — /api/v1/* SDK 接口测试（不需要 .env，起在临时端口）。
// 跑法：node test/sdk-api.test.mjs
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/app.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
async function ok(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`  ✗ ${name}\n    ${err.message}`);
  }
}

const { server } = await createApp({ envPath: path.join(ROOT, '.env') });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const V1 = base + '/api/v1';

async function post(p, body) {
  const res = await fetch(V1 + p, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

console.log('sdk-api.test');

await ok('health 报告 apiVersion 与能力', async () => {
  const res = await fetch(V1 + '/health');
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.ok, true);
  assert.equal(data.apiVersion, 1);
  assert.equal(typeof data.hasKey, 'boolean');
});

await ok('session/new 生成完整会话', async () => {
  const { status, data } = await post('/session/new', { personName: '姥爷', dialect: 'dongbei' });
  assert.equal(status, 200);
  assert.equal(data.ok, true);
  assert.ok(data.session.id.startsWith('book_'));
  assert.equal(data.session.person.name, '姥爷');
  assert.equal(data.session.person.dialect, 'dongbei');
  assert.ok(Array.isArray(data.session.turns));
  assert.ok(data.session.auth && data.session.auth.grantCode);
});

await ok('opening 带出暖场 + 第一个具体问题', async () => {
  const { data: s } = await post('/session/new', { personName: '姥姥', dialect: 'putonghua' });
  const { status, data } = await post('/engine/opening', { session: s.session });
  assert.equal(status, 200);
  assert.ok(data.result.text.length > 0);
  assert.ok(data.result.firstQuestion.length > 0);
  assert.ok(data.result.question && data.result.question.id);
  assert.ok(data.session.interview.askedQuestionIds.includes(data.result.question.id));
});

await ok('respond 正常推进：沉淀片段 + 顺着追问', async () => {
  const { data: s } = await post('/session/new', { personName: '姥爷', dialect: 'putonghua' });
  const op = await post('/engine/opening', { session: s.session });
  const { status, data } = await post('/engine/respond', {
    session: op.data.session,
    text: '小时候最常吃苞米面饼子，一年到头都是它'
  });
  assert.equal(status, 200);
  assert.equal(data.ok, true);
  assert.equal(data.result.intent, 'substantive');
  assert.ok(data.result.reply.length > 0);
  assert.ok(data.result.question || data.result.extension);
  assert.equal(data.session.moments.length, 1, '老人的话应沉淀为一段片段');
  assert.equal(data.session.moments[0].text, '小时候最常吃苞米面饼子，一年到头都是它');
});

await ok('respond 拒绝：不追问、标记话题', async () => {
  const { data: s } = await post('/session/new', { personName: '姥爷' });
  const op = await post('/engine/opening', { session: s.session });
  const { status, data } = await post('/engine/respond', { session: op.data.session, text: '不想说这个' });
  assert.equal(status, 200);
  assert.equal(data.result.intent, 'refuse');
  assert.ok(data.result.reply.length > 0);
  assert.ok(!data.result.question, '拒绝后不应有新问题');
});

await ok('respond 沉默：不催', async () => {
  const { data: s } = await post('/session/new', {});
  const op = await post('/engine/opening', { session: s.session });
  const { status, data } = await post('/engine/respond', { session: op.data.session, text: '忘了' });
  assert.equal(status, 200);
  assert.equal(data.result.intent, 'silence');
  assert.ok(data.result.reply.length > 0);
});

await ok('summarize 给进度摘要', async () => {
  const { data: s } = await post('/session/new', { personName: '姥爷' });
  const { data } = await post('/engine/summarize', { session: s.session });
  assert.equal(data.ok, true);
  assert.ok(data.summary.name === '姥爷');
  assert.equal(typeof data.summary.warmTurns, 'number');
  assert.equal(typeof data.summary.moments, 'number');
});

await ok('bio/render 兜底传记 + lint', async () => {
  const { data: s } = await post('/session/new', { personName: '姥爷' });
  const op = await post('/engine/opening', { session: s.session });
  await post('/engine/respond', { session: op.data.session, text: '小时候最常吃苞米面饼子' });
  const { status, data } = await post('/bio/render', { session: op.data.session });
  assert.equal(status, 200);
  assert.equal(data.deterministic, true);
  assert.ok(data.text.length > 0);
  assert.equal(typeof data.lint.clean, 'boolean');
});

await ok('bio/lint 抓到文风问题', async () => {
  const { status, data } = await post('/bio/lint', { text: '不是苦不苦的问题，而是：日子就这样过。' });
  assert.equal(status, 200);
  assert.ok(data.report.errors.length >= 2, '应同时抓到 冒号 和 不是而是');
});

await ok('timeline 归拢人生阶段', async () => {
  const { data: s } = await post('/session/new', {});
  const op = await post('/engine/opening', { session: s.session });
  const rp = await post('/engine/respond', { session: op.data.session, text: '小时候最常吃苞米面饼子' });
  const { status, data } = await post('/timeline', { session: rp.data.session });
  assert.equal(status, 200);
  assert.equal(data.timeline.totalMoments, 1);
  assert.ok(Array.isArray(data.timeline.groups));
});

await ok('transcript 生成对话记录文本', async () => {
  const { data: s } = await post('/session/new', { personName: '姥爷' });
  const { data } = await post('/transcript', { session: s.session });
  assert.equal(data.ok, true);
  assert.ok(data.transcript.includes('对话记录'));
  assert.ok(data.log.includes('日志'));
});

await ok('dialects 列出 9 个方言包', async () => {
  const res = await fetch(V1 + '/dialects');
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.packs.length, 9);
  const ids = data.packs.map((p) => p.id);
  assert.ok(ids.includes('dongbei') && ids.includes('chuanyu') && ids.includes('yue'));
});

await ok('错误码：坏 session / 坏 text / 未定义接口', async () => {
  const bad1 = await post('/engine/respond', { session: null, text: 'x' });
  assert.equal(bad1.status, 400);
  assert.equal(bad1.data.code, 'BAD_SESSION');

  const bad2 = await post('/engine/respond', { session: { interview: {} }, text: 123 });
  assert.equal(bad2.status, 400);
  assert.equal(bad2.data.code, 'BAD_TEXT');

  const res = await fetch(V1 + '/nope');
  assert.equal(res.status, 404);
});

await ok('chat 接口：无 messages 报 BAD_MESSAGES（不依赖 Key）', async () => {
  const { status, data } = await post('/chat', { messages: [] });
  assert.equal(status, 400);
  assert.equal(data.code, 'BAD_MESSAGES');
});

server.close();
console.log(failures ? `\n${failures} 项未通过。` : '\n全部通过。');
if (failures) process.exitCode = 1;
