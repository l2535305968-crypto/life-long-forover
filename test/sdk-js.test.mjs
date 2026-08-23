// sdk-js.test.mjs — JS SDK 端到端测试（走真实 HTTP，不依赖 .env 的 Key）。
// 跑法：node test/sdk-js.test.mjs
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/app.mjs';
import { SdkClient, Conversation, exportBook, importBook } from '../sdk/js/index.mjs';

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
const client = new SdkClient(base);

const ANSWERS = [
  '小时候最常吃苞米面饼子，一年到头都是它',
  '过年才能吃上白面饺子，平常都是粗粮',
  '我爹年轻时候是木匠，手艺好得很',
  '小时候睡的是火炕，冬天烧得热乎',
  '我娘做的酸菜炖粉条，那味道现在都记得',
  '小时候下河摸过鱼，水凉得直打颤',
  '家里墙上贴的是年画，红彤彤的',
  '上学要走三里地，土路，下雨天打滑'
];

console.log('sdk-js.test');

await ok('health / dialects 可访问', async () => {
  const h = await client.health();
  assert.equal(h.ok, true);
  assert.equal(h.apiVersion, 1);
  const d = await client.dialects();
  assert.ok(d.packs.length >= 9);
});

await ok('newSession → start → 完整访谈 → 传记 → 时间线', async () => {
  let session = await client.newSession({ personName: '姥爷', dialect: 'putonghua' });
  assert.ok(session.id);

  const conv = new Conversation(client, session);
  const start = await conv.start();
  assert.ok(start.text.length > 0);

  let replies = 0;
  for (const text of ANSWERS) {
    const out = await conv.say(text);
    assert.ok(out.text.length > 0, 'AI 每轮都要有回话');
    assert.ok(out.intent === 'substantive', `意图应为 substantive，实际 ${out.intent}`);
    replies += 1;
  }

  session = conv.session;
  assert.equal(session.turns.length, 1 + replies * 2, '开场 1 条 + 每轮 老人/AI 各 1 条');
  assert.ok(session.moments.length >= ANSWERS.length - 1, '老人的话应沉淀为片段');
  assert.ok(Object.keys(session.profile).length >= 3, '档案字段应被填充');

  // 拒绝测试：拒绝后不追问
  const refuse = await conv.say('不想说这个');
  assert.equal(refuse.intent, 'refuse');

  // 收尾
  const close = await conv.close();
  assert.ok(close.text.length > 0);

  // 传记（确定性兜底，不联网）
  const bio = await client.bioRender(session);
  assert.ok(bio.text.length > 0);
  assert.equal(bio.deterministic, true);

  // 时间线
  const tl = await client.timeline(session);
  assert.equal(tl.totalMoments, session.moments.length);
  assert.ok(tl.groups.length >= 1);

  // 对话记录
  const tr = await client.transcript(session);
  assert.ok(tr.transcript.includes('姥爷'));
});

await ok('隐私：发往服务端的请求不含照片/录音/日志', async () => {
  let seenWire = null;
  const spy = new SdkClient(base, async (...args) => {
    const body = args[1].body ? JSON.parse(args[1].body) : null;
    if (body && body.session) seenWire = body.session;
    return fetch(...args);
  });
  const session = await client.newSession({ personName: '隐私测试' });
  session.images = [{ id: 'img_x', dataUrl: 'data:image/jpeg;base64,AAAA' }];
  session.audio = [{ id: 'a_x', dataUrl: 'data:audio/webm;base64,BBBB' }];
  session.log = [{ ts: 'x', type: 'open', msg: '打开' }];
  await spy.opening(session);
  assert.ok(seenWire, '应捕获到发出去的 session');
  assert.equal(seenWire.images, undefined, '照片不得上传');
  assert.equal(seenWire.audio, undefined, '录音不得上传');
  assert.equal(seenWire.log, undefined, '日志不得上传');
  // 本地合并后照片/录音还在
  const merged = await spy.opening(session);
  assert.equal(merged.session.images.length, 1);
  assert.equal(merged.session.audio.length, 1);
});

await ok('加密导出/导入往返', async () => {
  const session = await client.newSession({ personName: '姥姥', dialect: 'chuanyu' });
  const cipher = await exportBook(session, '家人口令123');
  const back = await importBook(cipher, '家人口令123');
  assert.equal(back.id, session.id);
  assert.equal(back.person.name, '姥姥');

  let threw = false;
  try {
    await importBook(cipher, '错误口令');
  } catch {
    threw = true;
  }
  assert.ok(threw, '错误口令必须打不开');
});

await ok('断网/错误：SdkError 带 code', async () => {
  // 找一个没人监听的端口，模拟服务不在线 → NETWORK
  const dead = new SdkClient('http://127.0.0.1:1');
  let threw = null;
  try {
    await dead.health();
  } catch (e) {
    threw = e;
  }
  assert.ok(threw && threw.code === 'NETWORK', '应抛 SdkError code=NETWORK，实际 ' + (threw && threw.code));
});

server.close();
console.log(failures ? `\n${failures} 项未通过。` : '\n全部通过。');
if (failures) process.exitCode = 1;
