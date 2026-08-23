// 对话记录 / 日志导出测试。跑法：node test/transcript.test.mjs
import assert from 'node:assert/strict';
import { newSession, addTurn, addLog } from '../web/js/core/model.js';
import { renderTranscript, renderLog } from '../web/js/core/transcript.js';

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

console.log('transcript.test');

ok('空会话给诚实占位', () => {
  const s = newSession();
  const t = renderTranscript(s);
  assert.ok(t.includes('还没有对话记录'));
});

ok('对话按 老人/AI 分行，含开场白', () => {
  const s = newSession({ personName: '姥爷' });
  s.meta.openingText = '今儿个天儿好，您小时候最常吃的是啥饭？';
  addTurn(s, 'elder', '小时候最常吃苞米面饼子');
  addTurn(s, 'ai', '那细粮是留着啥时候吃？');
  const t = renderTranscript(s);
  assert.ok(t.includes('姥爷'));
  assert.ok(t.includes('AI（开场）'));
  assert.ok(t.includes('小时候最常吃苞米面饼子'));
  assert.ok(t.includes('那细粮是留着啥时候吃？'));
});

ok('AI 和老人的行有区分', () => {
  const s = newSession({ personName: '姥姥' });
  addTurn(s, 'elder', '我十六岁进厂');
  addTurn(s, 'ai', '进厂干啥？');
  const t = renderTranscript(s);
  const elderLines = t.split('\n').filter((l) => l.startsWith('姥姥（'));
  const aiLines = t.split('\n').filter((l) => l.startsWith('AI（'));
  assert.equal(elderLines.length, 1);
  assert.equal(aiLines.length, 1);
});

ok('日志渲染：空时占位，有内容时带类型', () => {
  const s = newSession();
  assert.ok(renderLog(s).includes('还没有日志'));
  addLog(s, 'export', '加密导出');
  addLog(s, 'bio', '生成传记');
  const t = renderLog(s);
  assert.ok(t.includes('export'));
  assert.ok(t.includes('加密导出'));
  assert.ok(t.includes('bio'));
});

ok('日志上限 500 条', () => {
  const s = newSession();
  for (let i = 0; i < 600; i++) addLog(s, 't', 'x');
  assert.equal(s.log.length, 500);
});

console.log(failures ? `\n${failures} 项未通过。` : '\n全部通过。');
if (failures) process.exitCode = 1;
