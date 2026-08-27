// web/js/fx/glass.js — 「液态玻璃」对话气泡（零依赖 · 原生 ESM · 离线可用）
//
// 设计：暖纸主题下，把聊天气泡做成「半透明磨砂玻璃 + 一圈缓慢流动/变形的液体描边」。
//   · 磨砂玻璃体：CSS 半透明渐变（任务允许的「半透明渐变」技法，GPU 友好，老人手机轻量）。
//   · 液体描边 + 高光：手写 SVG（linearGradient 流动 + feTurbulence/feDisplacementMap 缓慢变形）。
//   · 文字：永远是真实 HTML 文本（p.glass__text），SVG 只做 aria-hidden 的视觉外壳。
//   · 弹入：CSS keyframes（spring 缩放 + 上移 + 淡入），支持内联 animation-delay 逐条错落。
//
// 只导出两个名字：
//   mountGlassStyles()   —— 运行时注入一次 <style>（幂等）。
//   makeGlassBubble({ role, text, replay, delay? })  —— 返回一个可直接 append 到聊天流的 DOM 元素。
//
// 不修改 web/index.html、web/app.css、web/js/app.js；上层集成时只需替换「造气泡」的那几行。

const SVG_NS = 'http://www.w3.org/2000/svg';

// 高光（玻璃反光）：三档白，从中心往外淡出。所有角色共用。
const GLOW_STOPS = [
  ['0', 'oklch(1 0 0 / 0.52)'],
  ['0.55', 'oklch(1 0 0 / 0.10)'],
  ['1', 'oklch(1 0 0 / 0)'],
];

// 各角色的配色与动效参数（颜色均取自暖纸主题令牌的同族 oklch 值）。
const THEME = {
  // 浅绿玻璃 · 靠左（AI）
  ai: {
    background: 'linear-gradient(155deg, oklch(0.935 0.035 160 / 0.92), oklch(0.905 0.035 160 / 0.66) 62%, oklch(0.915 0.035 160 / 0.80))',
    edge: [
      ['0', 'oklch(0.40 0.09 160 / 0.85)'],   // 墨绿
      ['0.5', 'oklch(0.76 0.12 70 / 0.9)'],   // 琥珀
      ['1', 'oklch(0.40 0.09 160 / 0.85)'],
    ],
    strokeWidth: 2.4,
    scaleBase: '1.4',
    scaleValues: '0.7;2.2;0.7',
    baseFrequency: '0.012 0.045',
    flowDur: 9,
    wobbleDur: 7,
    replayColor: 'oklch(0.40 0.09 160)',      // 墨绿（再念一遍按钮）
  },
  // 深墨绿玻璃 · 靠右（老人）· 深底白字，与 AI 浅底深字一眼分清（WCAG AAA 7:1）
  elder: {
    background: 'linear-gradient(155deg, oklch(0.32 0.06 160 / 0.97), oklch(0.27 0.06 160 / 0.93) 62%, oklch(0.30 0.06 160 / 0.96))',
    edge: [
      ['0', 'oklch(0.42 0.09 160 / 0.9)'],   // 墨绿描边（比底亮一档，白字更清晰）
      ['0.5', 'oklch(0.76 0.12 70 / 0.6)'],  // 琥珀微光
      ['1', 'oklch(0.42 0.09 160 / 0.9)'],
    ],
    strokeWidth: 2.4,
    scaleBase: '1.2',
    scaleValues: '0.6;1.9;0.6',
    baseFrequency: '0.014 0.05',
    flowDur: 11,
    wobbleDur: 8,
    replayColor: 'oklch(1 0 0 / 0.95)',      // 白（深底上再念一遍按钮）
  },
  // 开场白玻璃 · 通栏 · 更大字号 · 墨绿描边
  warm: {
    background: 'linear-gradient(155deg, oklch(0.97 0.02 85 / 0.96), oklch(0.935 0.03 80 / 0.74) 55%, oklch(0.955 0.025 82 / 0.88))',
    edge: [
      ['0', 'oklch(0.40 0.09 160 / 0.9)'],   // 墨绿描边
      ['0.5', 'oklch(0.76 0.12 70 / 0.85)'], // 琥珀流动
      ['1', 'oklch(0.40 0.09 160 / 0.9)'],
    ],
    strokeWidth: 3.2,
    scaleBase: '1.6',
    scaleValues: '0.9;2.6;0.9',
    baseFrequency: '0.011 0.04',
    flowDur: 10,
    wobbleDur: 7,
    replayColor: 'oklch(0.40 0.09 160)',      // 墨绿
  },
};

// 运行时注入的样式。所有 oklch/字体变量带 fallback，模块可脱离 app.css 单独使用。
const CSS = `
/* —— 液态玻璃气泡（web/js/fx/glass.js 运行时注入）—— */
.glass.msg {
  position: relative;
  isolation: isolate;
  background: transparent;
  border: none;
  box-shadow:
    0 8px 20px -8px oklch(0.24 0.03 40 / 0.16),
    0 1px 2px oklch(0.24 0.03 40 / 0.10),
    inset 0 1px 0 oklch(1 0 0 / 0.5),
    inset 0 -1px 0 oklch(0.24 0.03 40 / 0.06);
  animation: glass-pop 560ms var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1)) both;
}

.glass.msg--ai { background: ${THEME.ai.background}; }
.glass.msg--elder { background: ${THEME.elder.background}; }
.glass.msg--warm { background: ${THEME.warm.background}; }

/* 老人气泡深墨绿底：文字、再念一遍按钮一律白色，保证 7:1 对比 */
.glass.msg--elder .glass__text,
.glass.msg--elder { color: oklch(1 0 0 / 0.97); }

.glass__art {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
  pointer-events: none;
  z-index: 0;
}

.glass__text,
.glass__meta,
.glass__replay {
  position: relative;
  z-index: 1;
}

.glass__replay { margin-top: var(--space-2, 0.5rem); }
.glass.msg--ai .glass__replay { color: ${THEME.ai.replayColor}; }
.glass.msg--elder .glass__replay { color: ${THEME.elder.replayColor}; }
.glass.msg--warm .glass__replay { color: ${THEME.warm.replayColor}; }

@keyframes glass-pop {
  0%   { opacity: 0; transform: translateY(16px) scale(0.82); }
  55%  { opacity: 1; transform: translateY(-3px) scale(1.025); }
  78%  { transform: translateY(1px) scale(0.99); }
  100% { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes glass-fade {
  from { opacity: 0; }
  to   { opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
  .glass.msg {
    animation-name: glass-fade;
    animation-duration: 180ms;
    animation-timing-function: ease-out;
  }
}
`;

let uidCounter = 0;

function svgEl(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    node.setAttribute(k, String(v));
  }
  return node;
}

function prefersReducedMotion() {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

// 构建单个气泡的 SVG 视觉外壳（玻璃高光 + 流动的液体描边）。
// num：自增序号，用于生成唯一 id 与每个气泡不同的湍流 seed。
function buildArt(kind, num, reduced) {
  const t = THEME[kind];
  const uid = `glass-${num}`;
  const seed = String(((num * 37) + 7) % 97 + 3);

  const svg = svgEl('svg', {
    class: 'glass__art',
    'aria-hidden': 'true',
    focusable: 'false',
    viewBox: '0 0 100 100',
    preserveAspectRatio: 'none',
  });
  const defs = svgEl('defs');

  // 描边渐变：SMIL 旋转 gradientTransform，让砖红/琥珀沿边框缓慢「流动」。
  const edgeGrad = svgEl('linearGradient', {
    id: `${uid}-edge`, x1: '0', y1: '0', x2: '1', y2: '1', gradientUnits: 'userSpaceOnUse',
  });
  for (const [offset, color] of t.edge) {
    edgeGrad.append(svgEl('stop', { offset, 'stop-color': color }));
  }
  if (!reduced) {
    edgeGrad.append(svgEl('animateTransform', {
      attributeName: 'gradientTransform',
      type: 'rotate',
      values: '0 50 50; 360 50 50',
      dur: `${t.flowDur}s`,
      repeatCount: 'indefinite',
    }));
  }
  defs.append(edgeGrad);

  // 高光渐变（玻璃反光，柔和淡出）。
  const glowGrad = svgEl('radialGradient', { id: `${uid}-glow`, cx: '0.32', cy: '0.15', r: '0.92' });
  for (const [offset, color] of GLOW_STOPS) {
    glowGrad.append(svgEl('stop', { offset, 'stop-color': color }));
  }
  defs.append(glowGrad);

  // 液体描边滤镜：静态湍流（只算一次）+ 位移量缓慢摆动（便宜，不重算噪声）。
  const filter = svgEl('filter', {
    id: `${uid}-liquid`,
    x: '-30%', y: '-30%', width: '160%', height: '160%',
    colorInterpolationFilters: 'sRGB',
  });
  const turb = svgEl('feTurbulence', {
    type: 'fractalNoise',
    baseFrequency: t.baseFrequency,
    numOctaves: '2',
    seed,
    result: 'noise',
  });
  const disp = svgEl('feDisplacementMap', {
    in: 'SourceGraphic',
    in2: 'noise',
    scale: t.scaleBase,
    xChannelSelector: 'R',
    yChannelSelector: 'G',
  });
  if (!reduced) {
    disp.append(svgEl('animate', {
      attributeName: 'scale',
      values: t.scaleValues,
      dur: `${t.wobbleDur}s`,
      repeatCount: 'indefinite',
      calcMode: 'spline',
      keySplines: '0.42 0 0.58 1;0.42 0 0.58 1',
      keyTimes: '0;0.5;1',
    }));
  }
  filter.append(turb, disp);
  defs.append(filter);

  svg.append(defs);

  // 顶部高光。
  svg.append(svgEl('ellipse', {
    class: 'glass__glow',
    cx: '32', cy: '14', rx: '60', ry: '28',
    fill: `url(#${uid}-glow)`,
  }));

  // 液体描边：vector-effect 让描边宽度不随 viewBox 拉伸而变粗/变细；滤镜让边缓慢变形。
  svg.append(svgEl('rect', {
    class: 'glass__edge',
    x: '1.6', y: '1.6', width: '96.8', height: '96.8', rx: '6.5',
    fill: 'none',
    stroke: `url(#${uid}-edge)`,
    'stroke-width': String(t.strokeWidth),
    'vector-effect': 'non-scaling-stroke',
    filter: `url(#${uid}-liquid)`,
  }));

  return svg;
}

/**
 * 注入一次液态玻璃样式（幂等：多次调用只注入一份 <style data-glass-fx>）。
 * @returns {void}
 */
export function mountGlassStyles() {
  if (document.querySelector('style[data-glass-fx]')) return;
  const style = document.createElement('style');
  style.setAttribute('data-glass-fx', '');
  style.textContent = CSS;
  document.head.append(style);
}

/**
 * 生成一个液态玻璃对话气泡 DOM 元素。
 * @param {object} opts
 * @param {'ai'|'elder'|'warm'} [opts.role='ai']  气泡角色。
 * @param {string} [opts.text='']                 以真实 HTML 文本呈现的内容（保留换行）。
 * @param {boolean} [opts.replay=false]           为 true 时内含一个「再念一遍」按钮占位（.glass__replay）。
 * @param {number} [opts.delay]                   可选弹入延迟（毫秒），等价于自行设置 el.style.animationDelay。
 * @returns {HTMLDivElement}
 */
export function makeGlassBubble({ role = 'ai', text = '', replay = false, delay } = {}) {
  mountGlassStyles();

  const kind = THEME[role] ? role : 'ai';
  uidCounter += 1;

  const root = document.createElement('div');
  root.className = `glass msg msg--${kind} glass--${kind}`;
  root.setAttribute('data-glass-role', kind);

  root.append(buildArt(kind, uidCounter, prefersReducedMotion()));

  const p = document.createElement('p');
  p.className = 'glass__text msg__text';
  p.textContent = text;
  root.append(p);

  if (replay) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'glass__replay icon-btn msg__replay';
    btn.setAttribute('aria-label', '再念一遍');
    root.append(btn);
  }

  if (typeof delay === 'number' && delay >= 0) {
    root.style.animationDelay = `${delay}ms`;
  }

  return root;
}
