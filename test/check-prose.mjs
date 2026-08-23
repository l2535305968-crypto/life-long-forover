// 人生之书 prose.js 数据自检
// 运行：node test\check-prose.mjs （在项目根目录）
// 不达标时非零退出。

import { prose } from '../web/js/core/prose.js';

const failures = [];

function record(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
  if (!ok) failures.push(name);
}

// ---------- 数量下限 ----------
const minCounts = {
  banned: 22,
  warnings: 18,
  templates: 24,
  connectors: 20,
  eraAnchors: 45,
  writingRules: 16,
  gapPhrases: 8
};
for (const [key, min] of Object.entries(minCounts)) {
  const actual = prose[key] ? prose[key].length : 0;
  record(`${key} 数量`, actual >= min, `实际 ${actual}，要求 >= ${min}`);
}

// ---------- 正则可编译 ----------
let regexOk = true;
for (const kind of ['banned', 'warnings']) {
  for (const item of prose[kind]) {
    try {
      new RegExp(item.pattern.source, item.pattern.flags);
    } catch (e) {
      regexOk = false;
      console.log(`  ${kind}/${item.id} 正则编译失败：${item.pattern.source}`);
    }
  }
}
record('全部正则可编译', regexOk, `banned ${prose.banned.length} 条 + warnings ${prose.warnings.length} 条`);

// ---------- template.text 与 connector 过 banned，必须零命中 ----------
const bannedRegexes = prose.banned.map((b) => new RegExp(b.pattern.source, b.pattern.flags));

const templateHits = [];
for (const t of prose.templates) {
  for (const re of bannedRegexes) {
    re.lastIndex = 0;
    if (re.test(t.text)) templateHits.push(`${t.id} 命中 ${re.source}`);
  }
}
record(
  'templates 零命中 banned',
  templateHits.length === 0,
  templateHits.length ? templateHits.join('；') : `共检查 ${prose.templates.length} 条`
);

const connectorHits = [];
for (const c of prose.connectors) {
  for (const re of bannedRegexes) {
    re.lastIndex = 0;
    if (re.test(c)) connectorHits.push(`"${c}" 命中 ${re.source}`);
  }
}
record(
  'connectors 零命中 banned',
  connectorHits.length === 0,
  connectorHits.length ? connectorHits.join('；') : `共检查 ${prose.connectors.length} 条`
);

// ---------- eraAnchors：年份 1930-2015 且升序（同年多条允许） ----------
let yearOk = true;
const yearDetails = [];
const years = prose.eraAnchors.map((a) => a.year);
for (const y of years) {
  if (y < 1930 || y > 2015) {
    yearOk = false;
    yearDetails.push(`${y} 超出 1930-2015`);
  }
}
for (let i = 1; i < years.length; i++) {
  if (years[i] < years[i - 1]) {
    yearOk = false;
    yearDetails.push(`第 ${i + 1} 条年份 ${years[i]} 小于前一条 ${years[i - 1]}`);
  }
}
record(
  'eraAnchors 年份范围与升序',
  yearOk,
  yearDetails.length ? yearDetails.join('；') : `共 ${years.length} 条，年份 ${years[0]} 到 ${years[years.length - 1]}`
);

// ---------- template.stage 属于允许集合 ----------
const allowedStages = new Set(['childhood', 'schooling', 'youth', 'family', 'midlife', 'later', 'anytime', 'opening', 'closing']);
const badStages = prose.templates.filter((t) => !allowedStages.has(t.stage)).map((t) => `${t.id}:${t.stage}`);
record('templates stage 合法', badStages.length === 0, badStages.length ? badStages.join('，') : `共 ${prose.templates.length} 条`);

// ---------- 每个 stage 至少 2 条模板 ----------
const stageCount = {};
for (const t of prose.templates) stageCount[t.stage] = (stageCount[t.stage] || 0) + 1;
const thinStages = Object.entries(stageCount).filter(([, c]) => c < 2).map(([s, c]) => `${s}:${c}`);
record(
  '每个 stage 至少 2 条模板',
  thinStages.length === 0,
  thinStages.length ? thinStages.join('，') : Object.entries(stageCount).map(([s, c]) => `${s} ${c}`).join(' / ')
);

// ---------- 连接说法不含路标词 ----------
const roadmap = /接下来|另一方面|总而言之|总之|综上所述|首先|其次|最后/;
const badConnectors = prose.connectors.filter((c) => roadmap.test(c));
record('connectors 无路标词', badConnectors.length === 0, badConnectors.length ? badConnectors.join('，') : `共 ${prose.connectors.length} 条`);

// ---------- id 唯一 ----------
const ids = [];
for (const kind of ['banned', 'warnings', 'templates']) {
  for (const item of prose[kind]) ids.push(`${kind}/${item.id}`);
}
const dupIds = ids.filter((v, i) => ids.indexOf(v) !== i);
record('id 唯一', dupIds.length === 0, dupIds.length ? dupIds.join('，') : `共 ${ids.length} 个 id`);

// ---------- 汇总 ----------
console.log('');
if (failures.length === 0) {
  console.log('全部通过。');
} else {
  console.log(`未通过 ${failures.length} 项：${failures.join('，')}`);
}
process.exitCode = failures.length ? 1 : 0;
