// 人生之书 dialects.js 方言支持包自检
// 运行：node test\check-dialects.mjs （在项目根目录）
// 逐项输出实际数字，不达标时非零退出。

import { dialects } from '../web/js/core/dialects.js';

const failures = [];

function record(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
  if (!ok) failures.push(name);
}

const EXPECTED_IDS = ['dongbei', 'xian', 'tianjin', 'chuanyu', 'shandong', 'henan', 'yue', 'wu', 'putonghua'];
const ALLOWED_LANGS = new Set(['zh-CN', 'zh-HK', 'zh-TW']);
const MIN = { lexicon: 40, kinship: 10, askForms: 12, confusions: 12, flavor: 8 };

// ---------- packs 数量与 id ----------
record('packs 数量', dialects.packs.length === 9, `实际 ${dialects.packs.length}，要求 9`);
const ids = dialects.packs.map((p) => p.id);
record(
  'packs id 集合与给定一致',
  JSON.stringify([...ids].sort()) === JSON.stringify([...EXPECTED_IDS].sort()),
  `实际 [${ids.join(', ')}]`
);
record(
  'pack.id 无重复',
  new Set(ids).size === ids.length,
  ids.length !== new Set(ids).size ? '存在重复 id' : `共 ${ids.length} 个`
);

// ---------- 每个 pack ----------
for (const p of dialects.packs) {
  const isPth = p.id === 'putonghua';

  // 非普通话包：lexicon / kinship / askForms / confusions / flavor 达到最低要求
  if (!isPth) {
    for (const key of Object.keys(MIN)) {
      const n = (p[key] || []).length;
      record(`${p.id} 的 ${key} 数量`, n >= MIN[key], `实际 ${n}，最低 ${MIN[key]}`);
    }
  } else {
    const n = (p.askForms || []).length;
    record('putonghua 的 askForms 数量', n >= 12, `实际 ${n}，最低 12`);
  }

  // speechLang 合法
  record(`${p.id} 的 speechLang`, ALLOWED_LANGS.has(p.speechLang), `实际 ${p.speechLang}`);

  // lexicon 条目：dialect / standard 非空且不相等
  const badLex = (p.lexicon || []).filter((e) => !e || !e.dialect || !e.standard || e.dialect === e.standard);
  record(
    `${p.id} 的 lexicon 条目有效（dialect/standard 非空且不等）`,
    badLex.length === 0,
    `共 ${(p.lexicon || []).length} 条，不合规 ${badLex.length} 条`
  );
}

// ---------- 全局 ----------
record('assistPrompts 数量', dialects.assistPrompts.length >= 10, `实际 ${dialects.assistPrompts.length}，最低 10`);
record('commonConfusions 数量', dialects.commonConfusions.length >= 12, `实际 ${dialects.commonConfusions.length}，最低 12`);

if (failures.length) {
  console.log(`\n自检未通过：${failures.length} 项（${failures.join('、')}）`);
  process.exit(1);
}
console.log('\n全部通过');
