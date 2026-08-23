// server.mjs — 《人生之书》本机服务入口。
// 逻辑全在 app.mjs（createApp 只建不 listen，方便测试）；这里负责 listen 和启动横幅。

import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { server, config } = await createApp({ envPath: path.join(ROOT, '.env') });

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const nic of list || []) {
      if (nic.family === 'IPv4' && !nic.internal) out.push(nic.address);
    }
  }
  return out;
}

server.listen(config.port, config.host, () => {
  const lines = [];
  lines.push('');
  lines.push('  人生之书 · 本机服务已启动');
  lines.push('');
  lines.push(`  这台电脑上打开   http://localhost:${config.port}`);
  for (const ip of lanAddresses()) {
    lines.push(`  同一个 WiFi      http://${ip}:${config.port}   （能看能点，但拿不到麦克风）`);
  }
  lines.push('');
  lines.push(`  对话模型         ${config.model}`);
  lines.push(`  DeepSeek Key     ${config.apiKey ? '已配置' : '没配（先复制 .env.example 成 .env 填上）'}`);
  lines.push('');
  lines.push('  SDK 接口（手机 App / 脚本客户端用）');
  lines.push('    GET  /api/v1/health       能力与版本');
  lines.push('    POST /api/v1/session/new  新建一本空书');
  lines.push('    POST /api/v1/engine/*     访谈引擎（opening/closing/respond/summarize）');
  lines.push('    POST /api/v1/ai/*          AI 润色（polish/next）');
  lines.push('    POST /api/v1/bio/*        传记（render/generate/lint）');
  lines.push('    POST /api/v1/timeline     人生时间线');
  lines.push('    POST /api/v1/transcript   对话记录导出文本');
  lines.push('    GET  /api/v1/dialects     方言包列表');
  lines.push('    POST /api/v1/chat | /asr | /tts  对话代理 / 语音识别 / 温暖声音朗读');
  lines.push('  详见 docs/08-SDK接入.md');
  lines.push('');
  lines.push('  手机上要用麦克风、要能加到桌面，必须是 https。');
  lines.push('  临时办法          cloudflared tunnel --url http://localhost:' + config.port);
  lines.push('');
  console.log(lines.join('\n'));
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  端口 ${config.port} 被别的程序占了。改 .env 里的 PORT，或者把占用的程序关掉。\n`);
    process.exit(1);
  }
  throw err;
});
