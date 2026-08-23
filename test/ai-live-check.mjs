// 真实 DeepSeek 联调脚本（需先起服务 node server/server.mjs，且 .env 已配 Key）。
// 跑法：node test/ai-live-check.mjs
// 只打一条访谈问题，验证提示词 + 服务端 + 模型全链路。不打印 Key。
import { interviewSystemPrompt, turnPrompt } from '../web/js/ai/prompt.js';

const session = {
  person: { name: '姥爷', dialect: 'putonghua' },
  turns: [
    { role: 'elder', text: '小时候最常吃苞米面饼子，一年到头都是它' }
  ]
};

const messages = [
  { role: 'system', content: interviewSystemPrompt(session) },
  { role: 'user', content: turnPrompt(session, '那细粮是留着啥时候吃？') }
];

try {
  const res = await fetch('http://localhost:8788/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages, temperature: 0.85, max_tokens: 140 })
  });
  const data = await res.json().catch(() => ({ ok: false }));
  console.log('HTTP', res.status);
  if (!res.ok || !data.ok) {
    console.error('ERR', data.code, '|', data.error);
    process.exit(1);
  }
  console.log('AI 回话：' + data.text);
  console.log('usage：', data.usage ? JSON.stringify(data.usage) : '—');
} catch (e) {
  console.error('连不上服务：', e.message);
  process.exit(1);
}
