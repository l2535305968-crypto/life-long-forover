// 意图识别与相似度的 Node 测试。跑法：node test/intent.test.mjs
import assert from 'node:assert/strict';
import {
  INTENT, classify, looksLikeRefusal, looksLikeSilence,
  similarity, isRepeatAgainstHistory, bigrams, clean
} from '../web/js/core/intent.js';

const ok = (name, fn) => {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}\n    ${err.message}`);
    process.exitCode = 1;
  }
};

console.log('intent.test');

ok('空输入判为 EMPTY', () => {
  assert.equal(classify(''), INTENT.EMPTY);
  assert.equal(classify('   '), INTENT.EMPTY);
  assert.equal(classify('。'), INTENT.EMPTY);
});

ok('语气词判为 SILENCE', () => {
  assert.equal(classify('嗯'), INTENT.SILENCE);
  assert.equal(classify('啊，那个……'), INTENT.SILENCE);
  assert.equal(classify('嗯嗯'), INTENT.SILENCE);
  assert.equal(classify('就是那个啥'), INTENT.SILENCE);
});

ok('单字实义回答不误判成沉默', () => {
  assert.equal(classify('有'), INTENT.SUBSTANTIVE);
  assert.equal(classify('远'), INTENT.SUBSTANTIVE);
  assert.equal(classify('嗯，有'), INTENT.SUBSTANTIVE);
});

ok('忘了/记不清判为 SILENCE 而非拒绝', () => {
  assert.equal(classify('忘了'), INTENT.SILENCE);
  assert.equal(classify('记不清了'), INTENT.SILENCE);
  assert.equal(classify('说不上来'), INTENT.SILENCE);
});

ok('明确拒绝判为 REFUSE', () => {
  assert.equal(classify('这个我不想说'), INTENT.REFUSE);
  assert.equal(classify('别问了'), INTENT.REFUSE);
  assert.equal(classify('没啥好说的'), INTENT.REFUSE);
});

ok('实质回答判为 SUBSTANTIVE', () => {
  assert.equal(classify('小时候最常吃苞米面饼子'), INTENT.SUBSTANTIVE);
  assert.equal(classify('我十六岁就进厂了'), INTENT.SUBSTANTIVE);
});

ok('长句里出现"忘了"不误判成沉默', () => {
  // 老人真在讲事，只是顺嘴说某处忘了，这是实质回答
  assert.equal(classify('那年在哈尔滨干过两年活，后来厂子黄了我就回老家了'), INTENT.SUBSTANTIVE);
});

ok('拒绝词表不外扩，口语"算了"不误伤', () => {
  assert.equal(looksLikeRefusal('算了'), false);
});

ok('相似度：同一件事换个说法也能识别', () => {
  const a = '我十六岁进厂当学徒，师傅姓王';
  const b = '十六岁那年我进厂当学徒，师傅姓王';
  assert.ok(similarity(a, b) > 0.55, `expected high similarity, got ${similarity(a, b)}`);
});

ok('相似度：完全不同的两件事低相似', () => {
  const a = '我十六岁进厂当学徒，师傅姓王';
  const b = '我家院子里有一棵枣树，秋天打枣吃';
  assert.ok(similarity(a, b) < 0.3, `expected low similarity, got ${similarity(a, b)}`);
});

ok('重复检测在历史里能命中', () => {
  const history = ['我十六岁进厂当学徒，师傅姓王，在车间干了八年'];
  const again = '我十六岁进厂当学徒，师傅姓王，车间里干了八年';
  assert.equal(isRepeatAgainstHistory(again, history), true);
});

ok('短于 4 字不参与重复比较', () => {
  assert.equal(isRepeatAgainstHistory('是啊', ['是']), false);
  assert.equal(similarity('嗯', '嗯'), 0);
});

ok('bigrams 与 clean 基础行为', () => {
  assert.equal(clean('  你好  '), '你好');
  assert.ok(bigrams('吃饭').has('吃饭'));
});

console.log(process.exitCode ? '\n有测试未通过。' : '\n全部通过。');
