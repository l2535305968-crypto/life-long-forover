// transcript.js — 把对话记录 / 日志单独整理成可读文本，供导出。
// 纯函数，Node 可测。只输出老人和 AI 说过的话，不掺别的东西。

function fmt(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
    });
  } catch {
    return '';
  }
}

export function renderTranscript(session) {
  const name = (session.person && session.person.name && session.person.name.trim()) || '老人';
  const lines = [];
  lines.push('《人生之书》对话记录');
  lines.push('人物：' + name);
  lines.push('导出时间：' + fmt(new Date().toISOString()));
  lines.push('');

  const opening = session.meta && session.meta.openingText;
  if (opening) {
    lines.push('AI（开场）：' + opening);
    lines.push('');
  }

  for (const t of session.turns || []) {
    if (!t || typeof t.text !== 'string') continue;
    if (t.role === 'elder') lines.push(name + '（' + fmt(t.ts) + '）：' + t.text);
    else if (t.role === 'ai') lines.push('AI（' + fmt(t.ts) + '）：' + t.text);
    else lines.push(t.role + '：' + t.text);
  }

  if ((session.turns || []).length === 0 && !opening) {
    lines.push('（还没有对话记录。）');
  }

  return lines.join('\n');
}

export function renderLog(session) {
  const lines = [];
  lines.push('《人生之书》日志');
  lines.push('导出时间：' + fmt(new Date().toISOString()));
  lines.push('');
  for (const e of session.log || []) {
    lines.push('[' + fmt(e.ts) + '] ' + (e.type || 'info') + '：' + (e.msg || ''));
  }
  if (!(session.log || []).length) {
    lines.push('（还没有日志。）');
  }
  return lines.join('\n');
}
