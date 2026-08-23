// 一键跑完所有测试与数据自检。跑法：node test/run-all.mjs
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dir, '..');

const files = readdirSync(dir)
  .filter((f) => /(^check-.+\.mjs$)|(\.test\.mjs$)/.test(f))
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
