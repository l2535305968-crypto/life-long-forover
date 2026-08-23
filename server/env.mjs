// 读 .env。不装依赖，自己解析。
// 只认最朴素的 KEY=VALUE，支持 # 注释和前后空格，支持值两侧的引号。

import { readFile } from 'node:fs/promises';

export function parseEnv(text) {
  const out = {};
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

// 优先级：真实环境变量 > .env 文件。
// 这样临时想换 Key 的时候，命令行前面加一个变量就能盖掉文件里的。
export async function loadEnv(envPath) {
  let fileVars = {};
  try {
    fileVars = parseEnv(await readFile(envPath, 'utf8'));
  } catch (err) {
    if (err && err.code !== 'ENOENT') throw err;
  }
  const merged = { ...fileVars };
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && v !== '') merged[k] = v;
  }
  return { vars: merged, hadFile: Object.keys(fileVars).length > 0 };
}
