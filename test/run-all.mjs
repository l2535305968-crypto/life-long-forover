// 一键跑完所有测试与数据自检。跑法：node test/run-all.mjs
//
// 只跑「不依赖真实服务/Key」的自动化测试。两类文件区分：
//   - 自动测试：*.test.mjs + check-*.mjs + 纯自检（起假服务，无外部依赖）
//   - 联调脚本（LIVE_CHECKS）：需要真实 DeepSeek/讯飞 Key 或已起服务，单独手动跑
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dir, '..');

// 需要真实 Key / 服务才能跑的联调脚本，不进 npm test，避免无 Key 环境假失败。
const LIVE_CHECKS = [
  'ai-live-check.mjs',          // 需 DeepSeek Key + 服务
  'prompt-warmth-check.mjs',    // 需 DeepSeek Key + 服务
  'xfyun-asr-check.mjs',        // 需讯飞 Key
  'xfyun-speech-check.mjs'      // 需讯飞 Key + WAV 文件
];

const files = readdirSync(dir)
  .filter((f) => /(^check-.+\.mjs$)|(\.test\.mjs$)/.test(f) || /-check\.mjs$/.test(f))
  .filter((f) => !LIVE_CHECKS.includes(f))
  .sort();

let failed = 0;
for (const f of files) {
  console.log(`\n════════════ ${f} ════════════`);
  const r = spawnSync(process.execPath, [path.join(dir, f)], {
    stdio: 'inherit',
    cwd: root
  });
  if (r.status !== 0) {
    failed += 1;
    console.log(`>>> ${f} 失败（exit ${r.status}）`);
  }
}

console.log(`\n========== 汇总：${files.length - failed}/${files.length} 通过 ==========`);
if (failed) process.exitCode = 1;
