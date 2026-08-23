// 传记与时间线测试。跑法：node test/bio.test.mjs
import assert from 'node:assert/strict';
import { newSession } from '../web/js/core/model.js';
import { lint, renderDeterministic, buildContext } from '../web/js/core/biography.js';
import { buildTimeline, stageName } from '../web/js/core/timeline.js';

let failures = 0;
const ok = (name, fn) => {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`  ✗ ${name}\n    ${err.message}`);
  }
};

console.log('bio.test');

ok('lint 能抓住冒号', () => {
  const r = lint('他说：那年真苦。');
  assert.ok(r.errors.some((e) => e.id === 'colon'));
});

ok('lint 能抓住"不是而是"翻案句', () => {
  const r = lint('那几年不是享福而是熬日子。');
  assert.ok(r.errors.some((e) => e.id === 'notBut'));
});

ok('lint 能抓住商业黑话', () => {
  const r = lint('这段经历给他的人生赋能。');
  assert.ok(r.errors.some((e) => e.id === 'fuNeng'));
});

ok('lint 对干净文字零报错', () => {
  const r = lint('他生在河北，小时候吃的是棒子面。后来进了厂，一干就是半辈子。');
  assert.equal(r.clean, true);
  assert.equal(r.errors.length, 0);
});

ok('lint 会把"旅程"标成警告而非错误', () => {
  const r = lint('他这一生的旅程，走得不容易。');
  assert.equal(r.clean, true); // 警告不判不合格
  assert.ok(r.warnings.some((w) => w.id === 'journey'));
});

ok('renderDeterministic 只写老人说过的，不编造地点', () => {
  const s = newSession();
  s.person.name = '老李';
  s.person.birthPlace = '保定';
  s.profile.food = ['棒子面饼子'];
  s.moments = [
    { stage: 'childhood', text: '小时候吃的是棒子面饼子' },
    { stage: 'youth', text: '十六岁进厂学钳工' }
  ];
  const r = renderDeterministic(s);
  assert.equal(r.clean, true, '兜底输出自身应文风干净');
  assert.ok(r.text.includes('保定'));
  assert.ok(r.text.includes('棒子面饼子'));
  assert.ok(r.text.includes('进厂学钳工'));
  assert.ok(!r.text.includes('北京'), '不应编出老人没说的地名');
});

ok('renderDeterministic 没素材时给诚实占位', () => {
  const s = newSession();
  const r = renderDeterministic(s);
  assert.ok(typeof r.text === 'string' && r.text.length > 0);
  assert.ok(!r.text.includes('他生在'), '没素材不该假装有出生地');
});

ok('buildTimeline 按阶段归拢', () => {
  const s = newSession();
  s.moments = [
    { stage: 'childhood', text: 'a' },
    { stage: 'youth', text: 'b' },
    { stage: 'childhood', text: 'c' }
  ];
  const tl = buildTimeline(s);
  assert.equal(tl.totalMoments, 3);
  assert.equal(tl.groups.length, 2);
  assert.equal(tl.groups[0].id, 'childhood');
  assert.equal(tl.groups[0].moments.length, 2);
});

ok('stageName 返回中文名', () => {
  assert.equal(stageName('childhood'), '童年');
});

ok('buildContext 带上写作禁令和素材', () => {
  const s = newSession();
  s.profile.food = ['玉米'];
  const ctx = buildContext(s);
  assert.ok(Array.isArray(ctx.writingRules));
  assert.ok(ctx.writingRules.length >= 16);
  assert.deepEqual(ctx.profile.food, ['玉米']);
});

console.log(failures ? `\n${failures} 项未通过。` : '\n全部通过。');
if (failures) process.exitCode = 1;
