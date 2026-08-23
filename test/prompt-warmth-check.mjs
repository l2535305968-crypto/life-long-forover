// 提示词加温验证：用真实 DeepSeek 看 AI 的话有没有情绪、有没有烟火气。
// 需服务在跑（node server/server.mjs）。跑法：node test/prompt-warmth-check.mjs
// 场景故意挑带情绪的：苦、骄傲、心酸、高兴。AI 要"先接情绪"，别为问而问——
// 如果四句全是干巴巴的问句（没有一句带情绪反应），测试就红。
// 文风底子按 human-writing / humanizer 两套技能校准：
//   1) 三四句里至少有一两句是纯回应（不带问号），别句句都甩问题；
//   2) 假坦诚（说实话）、假口语（咱就是说）、金句升华、书式共情，一句都不能有。
import { interviewSystemPrompt, turnPrompt } from '../web/js/ai/prompt.js';

const SCENARIOS = [
  { label: '苦（苞米饼子）', elder: '小时候最常吃苞米面饼子，一年到头都是它', question: '那细粮是留着啥时候吃？' },
  { label: '骄傲（手艺）', elder: '我爹年轻时候是木匠，手艺好得很，十里八村都找他打家具', question: '您爹打的家具现在还留着吗？' },
  { label: '心酸（上学）', elder: '上学要走三里地土路，冬天冻得脚生疮，我也没哭过一回', question: '那时候上学最怕啥？' },
  { label: '高兴（过年）', elder: '过年最盼吃白面饺子，我妈一包饺子我就蹲在灶台边上等', question: '过年还有啥高兴事儿？' }
];

// 情绪/口语标记：四句里至少两句要沾上，否则说明模型又变回"采访机器"了
const MARKERS = ['哎', '呀', '那会儿', '可不', '不容易', '紧巴', '心酸', '遭罪', '怪', '稀罕', '乐子', '热乎', '惦记', '咋', '啥', '呢', '吧', '真', '可'];

// 假坦诚 / 假口语 / 金句 / 书式共情：命中任何一句，说明模型又在穿表演服
const AI_TELLS = ['说实话', '咱就是说', '您猜怎么着', '值得记一辈子', '我理解您的心情', '您辛苦了', '这段经历很有价值'];

let failures = 0;
const results = [];
for (const sc of SCENARIOS) {
  const session = { person: { name: '姥爷', dialect: 'putonghua' }, turns: [{ role: 'elder', text: sc.elder }] };
  const messages = [
    { role: 'system', content: interviewSystemPrompt(session) },
    { role: 'user', content: turnPrompt(session, sc.question) }
  ];
  const res = await fetch('http://localhost:8788/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages, temperature: 0.85, max_tokens: 140 })
  });
  const data = await res.json().catch(() => ({ ok: false }));
  if (!res.ok || !data.ok) {
    console.log('[' + sc.label + '] HTTP', res.status, data.code || '', data.error || '');
    failures += 1;
    continue;
  }
  const text = (data.text || '').trim();
  const hasEmotion = MARKERS.some((m) => text.includes(m));
  const hasQuestion = text.includes('？');
  const aiTell = AI_TELLS.find((m) => text.includes(m)) || '';
  const tooLong = text.length > 45; // 硬线 45；40~45 之间只警告
  console.log('[' + sc.label + '] ' + text);
  console.log('   长度 ' + text.length + ' 字（目标≤40' + (text.length > 40 ? '，略超但自然' : '') + '）| 情绪标记：' + (hasEmotion ? '有' : '无') + ' | 问号：' + (hasQuestion ? '有' : '无') + (aiTell ? ' | ⚠ AI味词：' + aiTell : ''));
  if (tooLong) failures += 1;
  if (aiTell) failures += 1;
  results.push({ label: sc.label, text, hasEmotion, hasQuestion, aiTell });
}

const withEmotion = results.filter((r) => r.hasEmotion).length;
const pureReplies = results.filter((r) => !r.hasQuestion).length;
const withTells = results.filter((r) => r.aiTell).length;
console.log('');
console.log('四句里带情绪反应的：' + withEmotion + '/4（要求至少 2 句，否则说明又变回干巴巴的问句了）');
console.log('四句里纯回应（不带问号）的：' + pureReplies + '/4（要求至少 1 句，否则说明又在句句甩问题）');
console.log('四句里带 AI 味词的：' + withTells + '/4（要求 0，否则说明又在穿表演服）');
if (withEmotion < 2) {
  console.error('✗ 情绪不够：AI 又变成采访机器了，提示词需要再调。');
  failures += 1;
}
if (pureReplies === 0) {
  console.error('✗ 句句带问号：AI 又在为问而问，需要再松一松（问题留到下一句）。');
  failures += 1;
}
if (withTells > 0) {
  console.error('✗ 出现 AI 味词：假坦诚 / 假口语 / 金句 / 书式共情，需要再调。');
  failures += 1;
}
console.log('========== prompt-warmth-check：' + (failures ? failures + ' 处失败' : '全部通过') + ' ==========');
process.exitCode = failures ? 1 : 0;
