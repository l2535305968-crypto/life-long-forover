// agents.js — 本地智能体插件（管理 + 编译 + 人设文案）
//
// 智能体只在用户自己的设备上运行，数据存 localStorage，不上传。
// 两种形态：
//   1. prompt 人设配置：追加/覆盖给 DeepSeek 的系统提示词，仍走 /api/chat。
//   2. script 本地脚本：在页面里运行。脚本源码通过 new Function 求值，
//      需返回一个对象 { name?, reply(ctx) }。reply 返回非空字符串即作为 AI 回话；
//      返回 null / undefined / 空串则回落到默认 AI 或引擎。
//
// 脚本 ctx 由调用方（app.js）注入：
//   ctx.elderText    老人刚说的话
//   ctx.engineReply  引擎给出的确定性回话
//   ctx.engineQuestion 引擎挑中的问题文本（可能为 null）
//   ctx.history      最近对话 [{ role: 'user'|'assistant', text }]
//   ctx.callChat     (messages, opts) => Promise<string>  —— 可复用 /api/chat
//
// 注意：agents.js 只负责"用户自建的智能体"。默认「晚辈陪聊」人设（即最常用的
// 访谈追问能力）在 ai/prompt.js 的 interviewSystemPrompt / turnPrompt 里，
// 想改默认追问行为请去那个文件。
//
// 想自建一个"更会追问"的人设智能体？在「新增智能体」对话框里选人设(prompt)，
// 把下面这段粘进内容区即可（它会的：顺着老人说的一个具体词往下钻细节，
// 一次只钻一个、不造物不造事、绝不拿"我"举例）：
//
// const RZL_FOLLOW_UP_AGENT_TEMPLATE = `
// 【你是陪着老人唠嗑的晚辈，专攻"把一件事问透"。】
// - 顺藤摸瓜：老人刚说出口的那个具体词（吃食/物件/地方/称呼/节日/玩意儿）就是追问入口。
// - 停在这个词上往下钻一两个细节：那是啥样的、跟谁一块儿、头一回啥时候、啥感觉、那会儿你在干啥。
// - 一次只钻一个词，钻得透，不比问一串强。一句问不深就再轻轻跟半句。
// - 只抓老人自己说的词，绝不自己造物、造屋、造事硬塞。
// - 绝不拿"我小时候""我记得"套近乎；话题只从老人刚说的话里长出来。
// - 先接情绪再追问；老人拒绝/沉默就换，不劝不逼。
// - 只回一两句口语，别超过 40 个字。`;

const LS_AGENTS = 'rss.agents.v1';
const LS_ACTIVE = 'rss.activeAgent.v1';

function readAll() {
  try {
    const arr = JSON.parse(localStorage.getItem(LS_AGENTS) || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function writeAll(list) {
  localStorage.setItem(LS_AGENTS, JSON.stringify(list));
}

function makeId() {
  return 'ag_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export function listAgents() {
  return readAll();
}

export function getActiveAgentId() {
  try {
    return localStorage.getItem(LS_ACTIVE) || '';
  } catch {
    return '';
  }
}

export function setActiveAgentId(id) {
  localStorage.setItem(LS_ACTIVE, id || '');
}

// 取当前激活智能体。脚本形态会做一次编译，失败时返回 null（不影响默认流程）。
export function getActiveAgent() {
  const id = getActiveAgentId();
  if (!id) return null;
  const a = readAll().find((x) => x.id === id);
  if (!a) return null;
  if (a.kind === 'script') {
    return compileScript(a);
  }
  return a;
}

// 添加智能体。参数：{ name, kind: 'prompt'|'script'|'tool', content, toolId }。校验失败抛错。
// kind='tool'：本地工具智能体，只登记 { toolId }（对应后端白名单），不存脚本源码、不参与聊天激活。
export function addAgent({ name, kind, content, toolId }) {
  const cleanName = String(name || '').trim();
  if (!cleanName) throw new Error('给智能体起个名字');

  const a = { id: makeId(), name: cleanName, kind: kind === 'script' ? 'script' : (kind === 'tool' ? 'tool' : 'prompt') };

  if (a.kind === 'script') {
    if (!String(content || '').trim()) throw new Error('脚本内容不能为空');
    a.source = String(content);
    // 立即编译验证；失败则不让加入。
    const compiled = compileScript(a);
    if (!compiled || typeof compiled.reply !== 'function') {
      throw new Error('脚本要 return 一个带 reply(ctx) 函数的对象');
    }
  } else if (a.kind === 'tool') {
    // 工具型：必须指明后端白名单里的一个工具 id。
    if (!toolId) throw new Error('请选一个工具');
    a.toolId = String(toolId);
  } else {
    // prompt 形态：允许直接写一段提示词，或写 JSON {system, model?, temperature?}
    let cfg = content;
    if (typeof content === 'string') {
      const t = content.trim();
      if (t.startsWith('{')) {
        try {
          cfg = JSON.parse(t);
        } catch {
          throw new Error('JSON 解析失败，检查引号和逗号');
        }
      } else {
        cfg = { system: t };
      }
    }
    if (!cfg || typeof cfg !== 'object' || !String(cfg.system || '').trim()) {
      throw new Error('人设需要一个 system 字段（提示词）');
    }
    a.system = String(cfg.system).trim();
    if (cfg.model) a.model = String(cfg.model);
    if (typeof cfg.temperature === 'number') a.temperature = cfg.temperature;
  }

  const list = readAll();
  list.push(a);
  writeAll(list);
  // 只有 prompt / script 参与聊天激活；tool 靠交互键手动触发，不抢占激活位。
  if (a.kind !== 'tool' && !getActiveAgentId()) setActiveAgentId(a.id);
  return a;
}

export function removeAgent(id) {
  writeAll(readAll().filter((x) => x.id !== id));
  scriptCache.delete(id);
  if (getActiveAgentId() === id) setActiveAgentId('');
}

// 已编译脚本的缓存：让脚本闭包状态能跨轮次保持（更像"插件"）。
const scriptCache = new Map();

// 编译脚本智能体。返回 { name, reply } 或 null。
export function compileScript(a) {
  if (!a) return null;
  const cached = scriptCache.get(a.id);
  if (cached) return cached;
  const src = String(a.source || '').trim();
  if (!src) return null;
  try {
    // 源码形如：return { name: '...', reply: async (ctx) => '...' }
    const factory = new Function(src);
    const obj = factory();
    if (obj && typeof obj === 'object' && typeof obj.reply === 'function') {
      const compiled = { name: obj.name || a.name, reply: obj.reply };
      scriptCache.set(a.id, compiled);
      return compiled;
    }
    return null;
  } catch {
    return null;
  }
}

// 生成追加到 system 提示词末尾的人设片段。
export function personaSystem(agent) {
  if (!agent || agent.kind === 'script') return '';
  const s = String(agent.system || '').trim();
  if (!s) return '';
  return '\n\n【当前智能体 · ' + (agent.name || '自定义') + '】\n' + s;
}
