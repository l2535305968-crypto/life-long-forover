// 访谈引擎行为测试。跑法：node test/engine.test.mjs
import assert from 'node:assert/strict';
import { newSession } from '../web/js/core/model.js';
import {
  respond, warmup, opening, closing, sensitivityCeiling, pickFreshQuestion,
  advanceStage, createRng, hashString, INTENT
} from '../web/js/core/engine.js';
import { bank } from '../web/js/core/bank.js';

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

console.log('engine.test');

ok('开场白来自 warmups', () => {
  const s = newSession();
  const line = warmup(s);
  assert.ok(bank.warmups.includes(line), `unexpected warmup: ${line}`);
});

ok('开场白不连续重复同一句', () => {
  const s = newSession();
  const a = warmup(s);
  const b = warmup(s);
  assert.notEqual(a, b);
});

ok('opening 会带出第一个具体问题，并记下归属', () => {
  const s = newSession();
  const op = opening(s);
  assert.ok(op.firstQuestion, '应有第一个问题');
  assert.ok(op.text.includes(op.firstQuestion));
  assert.ok(s.meta.lastQuestion && s.meta.lastQuestion.captures.length > 0, '第一问应带字段归属');
});

ok('拒绝：回复来自 refusalReplies，且不追问', () => {
  const s = newSession();
  // 先让引擎给一个带话题的问题
  const first = respond(s, '行，那咱开始吧');
  assert.ok(first.question && first.question.topic, '首问应有 topic');
  const r = respond(s, '这个我不想说');
  assert.equal(r.intent, INTENT.REFUSE);
  assert.ok(bank.refusalReplies.includes(r.reply));
  // 拒绝过的话题不应再被冷启动问到
  const refused = first.question.topic;
  for (let i = 0; i < 30; i++) {
    const rr = respond(s, '嗯，我们接着聊点别的');
    if (rr.question && rr.question.topic) {
      assert.notEqual(rr.question.topic, refused, '拒绝过的话题不该再出现');
    }
  }
});

ok('沉默：回复来自 silenceReplies，不催', () => {
  const s = newSession();
  const r = respond(s, '嗯');
  assert.equal(r.intent, INTENT.SILENCE);
  assert.ok(bank.silenceReplies.includes(r.reply));
});

ok('连续两次沉默后，会补一个更小的具体问题', () => {
  const s = newSession();
  respond(s, '啊，那个');
  const r = respond(s, '嗯嗯');
  assert.equal(r.intent, INTENT.SILENCE);
  assert.ok(r.question, '第二次沉默应补一个具体问题');
  assert.equal(r.question.sensitivity, 0, '补的问题必须是零敏感');
});

ok('实质回答会累积暖场度', () => {
  const s = newSession();
  respond(s, '小时候家里最常吃苞米面饼子');
  assert.equal(s.interview.warmTurns, 1);
});

ok('顺着上句延伸：提"苞米"会追问细粮', () => {
  const s = newSession();
  // 强行让上一问是 food-childhood-01（它的追问是"那细粮是留着啥时候吃？"）
  s.meta.lastQuestion = {
    id: 'food-childhood-01', text: '您小时候，家里最常吃的是啥饭？',
    stage: 'childhood', topic: 'food', sensitivity: 0,
    captures: ['food'],
    followUps: [
      { when: ['玉米', '苞米', '粗粮'], ask: '那细粮是留着啥时候吃？' },
      { when: [], ask: '这饭是谁做的？' }
    ]
  };
  const r = respond(s, '最常吃苞米，一年到头都是它');
  assert.ok(r.extension, '应走延伸路径');
  assert.equal(r.reply, '那细粮是留着啥时候吃？');
});

ok('重复：不点破，回复来自 repeatReplies，并记录重复', () => {
  const s = newSession();
  const a = '我十六岁进厂当学徒，师傅姓王，在车间干了八年';
  respond(s, a);
  const r = respond(s, '我十六岁进厂当学徒，师傅姓王，车间里干了八年');
  assert.equal(r.repeat, true);
  assert.ok(bank.repeatReplies.includes(r.reply));
  assert.ok(s.repeats.length >= 1);
});

ok('冷启动不会问敏感问题（暖场不足）', () => {
  const s = newSession();
  assert.equal(sensitivityCeiling(s), 0);
  for (let i = 0; i < 10; i++) {
    const q = pickFreshQuestion(s, createRng(hashString(s.id + i)));
    if (q) {
      assert.ok(q.sensitivity <= sensitivityCeiling(s), `asked sensitivity ${q.sensitivity} at ceiling ${sensitivityCeiling(s)}`);
    }
  }
});

ok('拒绝会暂时压低敏感上限', () => {
  const s = newSession();
  s.interview.warmTurns = 20; // 本来该到 3
  s.interview.recentRefuse = 0; // 刚拒绝过
  assert.equal(sensitivityCeiling(s), 1);
});

ok('拒绝过的话题进黑名单', () => {
  const s = newSession();
  respond(s, '行，那咱开始吧');
  const first = respond(s, '这地方我不想说');
  assert.equal(first.intent, INTENT.REFUSE);
  assert.ok(s.interview.refusedTopics.length >= 1);
});

ok('阶段推进：问够配额后往下走', () => {
  const s = newSession();
  const rng = createRng(42);
  let advanced = false;
  for (let i = 0; i < 30 && !advanced; i++) {
    pickFreshQuestion(s, rng);
    if (s.interview.stage !== 'childhood') advanced = true;
  }
  assert.ok(advanced, '30 次内应推进到下一阶段');
});

ok('引擎输出不查户口（全程无索取性问句）', () => {
  // 冷启动跑 50 轮实质回答，确保没有"您叫什么名字/多大岁数/住哪儿"这类问题。
  const s = newSession();
  const banned = ['叫什么名字', '多大岁数', '多大年纪', '家庭住址', '身份证', '您贵姓'];
  for (let i = 0; i < 50; i++) {
    const r = respond(s, '那会儿日子挺紧巴的，我给您细说说');
    if (r.question) {
      for (const b of banned) {
        assert.ok(!r.question.text.includes(b), `查户口句被问到：${r.question.text}`);
      }
    }
  }
});

ok('确定性：同样种子与输入，输出一致', () => {
  const mk = () => {
    const s = newSession();
    s.id = 'fixed-id';
    respond(s, '行，那咱开始吧');
    return respond(s, '小时候最常吃苞米').reply;
  };
  assert.equal(mk(), mk());
});

ok('closing 来自 closings', () => {
  const s = newSession();
  assert.ok(bank.closings.includes(closing(s)));
});

console.log(failures ? `\n${failures} 项未通过。` : '\n全部通过。');
if (failures) process.exitCode = 1;
