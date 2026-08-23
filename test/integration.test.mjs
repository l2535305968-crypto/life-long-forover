// 端到端集成测试：模拟一场完整访谈，验证各模块接线正确。
// 跑法：node test/integration.test.mjs （AI 走本地兜底，不联网）
import assert from 'node:assert/strict';
import { newSession, addTurn } from '../web/js/core/model.js';
import { opening, closing, respond, summarize } from '../web/js/core/engine.js';
import { renderDeterministic, buildContext } from '../web/js/core/biography.js';
import { buildTimeline } from '../web/js/core/timeline.js';
import { nextAiLine } from '../web/js/ai/adapter.js';
import { encryptText, decryptText } from '../web/js/crypto.js';

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

// 老人的回答池，尽量具体、口语、别触发拒绝/沉默。覆盖多个生活阶段。
const ANSWERS = [
  '小时候最常吃苞米面饼子，一年到头都是它',
  '过年才能吃上白面饺子，平常都是粗粮',
  '我爹年轻时候是木匠，手艺好得很',
  '小时候睡的是火炕，冬天烧得热乎',
  '我娘做的酸菜炖粉条，那味道现在都记得',
  '小时候下河摸过鱼，水凉得直打颤',
  '家里墙上贴的是年画，红彤彤的',
  '上学要走三里地，土路，下雨天打滑',
  '老师姓刘，是个戴眼镜的先生',
  '写字用石板，笔是石笔，咯吱咯吱响',
  '头一篇课文是天地人，现在还能背',
  '我十六岁进厂学钳工，师傅姓王',
  '那会儿出远门全靠两条腿，一走就是一天',
  '头一回坐火车是去省城，票钱一块多',
  '工钱一个月十八块，攒起来娶媳妇',
  '结婚那阵子家里办了三桌，我穿了件新褂子',
  '拉扯三个孩子，最费劲的是口粮',
  '老大生在腊月，天冷得屋里的水缸都结冰',
  '后来厂子黄了，我就回家种地',
  '从老家搬到县城，是为了孩子念书',
  '借钱是跟街坊王婶借的，还了两年',
  '那几年最难，青黄不接的时候揭不开锅',
  '收音机里最爱听评书，一响全村人都凑过来',
  '露天电影在村口麦场上放，走夜路都高兴',
  '家里第一辆自行车是飞鸽的，全村第二辆',
  '退休以后就在院子里种点菜，养了几只鸡',
  '如今每天遛弯，跟老街坊下棋',
  '我这辈子最要紧的人，是我娘',
  '最不后悔的事，是供孩子们念了书',
  '想留给后人的话，就是做人要本分'
];

console.log('integration.test');

await ok('一场完整访谈：成书、成时间线、能加密导出', async () => {
  const s = newSession({ personName: '姥爷', dialect: 'putonghua' });
  const op = opening(s);
  addTurn(s, 'ai', op.text);
  assert.ok(op.firstQuestion, '开场应带出第一个具体问题');

  for (let i = 0; i < ANSWERS.length; i++) {
    const text = ANSWERS[i % ANSWERS.length];
    addTurn(s, 'elder', text);
    const r = respond(s, text);
    const ai = await nextAiLine(s, r, { aiEnabled: false });
    assert.ok(typeof ai === 'string' && ai.length > 0, `第 ${i} 轮 AI 回话为空`);
    addTurn(s, 'ai', ai);
  }

  // 成书：老人的话不能丢，每一句实质回答都应进时间线。
  assert.ok(s.moments.length >= ANSWERS.length - 2, `应沉淀出相当数量的片段，实际 ${s.moments.length}`);
  assert.ok(Object.keys(s.profile).length >= 5, '档案字段应被填充多个');
  assert.ok(s.turns.length >= 2 * ANSWERS.length - 1, '对话轮数应记录');

  // 时间线：一场较长的访谈应跨越至少两个人生阶段。
  const tl = buildTimeline(s);
  assert.ok(tl.groups.length >= 2, `至少覆盖两个人生阶段，实际 ${tl.groups.length}`);
  assert.equal(tl.totalMoments, s.moments.length);

  // 传记兜底
  const bio = renderDeterministic(s);
  assert.ok(bio.text.length > 20, '传记正文不该是空的');
  assert.equal(bio.clean, true, '兜底传记自身应文风干净');

  // 加密导出往返
  const exported = JSON.stringify(s);
  const enc = await encryptText(exported, '家人口令');
  const dec = await decryptText(enc, '家人口令');
  assert.equal(dec, exported);

  // 摘要可读
  const sum = summarize(s);
  assert.ok(sum.warmTurns >= ANSWERS.length - 1, `warmTurns=${sum.warmTurns}`);
});

await ok('方言会随会话记录，供模型参考', () => {
  const s = newSession({ personName: '姥姥', dialect: 'dongbei' });
  assert.equal(s.person.dialect, 'dongbei');
  const ctx = buildContext(s);
  assert.equal(ctx.person.dialect, 'dongbei');
});

await ok('closing 能正常收尾', () => {
  const s = newSession();
  assert.ok(typeof closing(s) === 'string' && closing(s).length > 0);
});

console.log(failures ? `\n${failures} 项未通过。` : '\n全部通过。');
if (failures) process.exitCode = 1;
