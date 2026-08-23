// timeline.js — 把零散的事实片段，按人生阶段归拢成"人生时间线"。
// 纯函数，不碰 DOM。

import { bank } from './bank.js';
import { STAGE_ORDER } from './model.js';

export function stageName(id) {
  const s = bank.stages.find((x) => x.id === id);
  return s ? s.name : id;
}

export function buildTimeline(session) {
  const groups = STAGE_ORDER.map((id) => {
    const moments = session.moments
      .filter((m) => m.stage === id)
      .map((m) => ({ ...m }));
    return { id, name: stageName(id), moments };
  }).filter((g) => g.moments.length > 0);

  return {
    person: session.person || {},
    groups,
    totalMoments: session.moments.length,
    stageCount: groups.length,
    generatedAt: new Date().toISOString()
  };
}
