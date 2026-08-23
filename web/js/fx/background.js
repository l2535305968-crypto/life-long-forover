// web/js/fx/background.js — 人生之书 · 全屏流体波纹背景（零依赖，原生 ESM）
//
// 只产出本文件：样式在运行时注入一个 <style> 标签，不改 index.html / app.css / app.js。
// 后端自选：WebGL2 优先 → WebGL1 回退 → Canvas2D 兜底；三者共用同一个 controller API。
//
// 公开 API：createBackground(opts?) → { start, stop, setIntensity, destroy }
//   - 默认调用即自动 start，并自动挂到 document.body。
//
// 省电与无障碍：
//   - prefers-reduced-motion 命中时，不创建任何渲染上下文，只呈现 CSS 静态柔和渐变（不跑波纹）。
//   - document.visibilitychange 页面隐藏时暂停 RAF，可见后恢复。
//   - devicePixelRatio 上限 2，总像素封顶约 200 万，防止手机过热。
//   - 帧率预算 30fps；intensity 为 0 时停掉 RAF，只保留静态纸底。

/* ====================================================================
 * 1. 颜色令牌（OKLCH → sRGB，纯手写，无依赖）
 * ================================================================== */
const OKLCH = {
  paper:  [0.94, 0.022, 85],   // 米白纸底
  paper2: [0.915, 0.022, 85],  // 卡片面（渐变底端）
  brick:  [0.40, 0.09, 160],   // 墨绿（与 app.css 主色一致）
  amber:  [0.76, 0.12, 70],    // 琥珀
  ink:    [0.24, 0.03, 40],    // 墨色
};

function clamp01(x) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

// OKLCH → sRGB（分量 0..1）。基于 CSS Color 4 / Björn Ottosson 矩阵。
function oklchToSrgb(L, C, H) {
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);

  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  let r = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  let g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  let bl = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;

  const toGamma = (c) => {
    c = clamp01(c);
    return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  };
  return [toGamma(r), toGamma(g), toGamma(bl)];
}

function srgbToCss(rgb, alpha = 1) {
  const r = Math.round(clamp01(rgb[0]) * 255);
  const g = Math.round(clamp01(rgb[1]) * 255);
  const b = Math.round(clamp01(rgb[2]) * 255);
  return alpha === 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${alpha})`;
}

// 模块级预计算（纯数学，不触 DOM；import 本模块在任意环境下都安全）。
const C = {};
for (const k of Object.keys(OKLCH)) C[k] = oklchToSrgb(...OKLCH[k]);

const CSS = {
  paper:     srgbToCss(C.paper),
  paper2:    srgbToCss(C.paper2),
  amberSoft: srgbToCss(C.amber, 0.16),
  brickSoft: srgbToCss(C.brick, 0.10),
};

/* ====================================================================
 * 2. 运行时样式注入（幂等）
 * ================================================================== */
const STYLE_ID = 'llfx-background-style';

const STYLE_CSS = `
/* 人生之书 · 流体波纹背景层（由 web/js/fx/background.js 注入） */
.llfx-background {
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 0;
  border: 0;
  display: block;
  z-index: 0;   /* 0（内容层 z-index:1 压在其上），避免负 z-index 被根背景/老内核盖掉 */
  pointer-events: none;
  user-select: none;
  -webkit-user-select: none;
  /* 静态兜底：WebGL/Canvas2D 都不可用、或 prefers-reduced-motion 命中时，
     画布保持透明，此 CSS 渐变作为柔和暖纸底直接呈现 */
  background:
    radial-gradient(120% 85% at 86% 92%, ${CSS.amberSoft}, rgba(0,0,0,0) 62%),
    radial-gradient(90% 70% at 12% 8%, ${CSS.brickSoft}, rgba(0,0,0,0) 55%),
    linear-gradient(180deg, ${CSS.paper} 0%, ${CSS.paper2} 100%);
}
`;

let styleRefs = 0;
function ensureStyle() {
  styleRefs += 1;
  if (!document.getElementById(STYLE_ID)) {
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = STYLE_CSS;
    document.head.appendChild(s);
  }
}
function releaseStyle() {
  styleRefs = Math.max(0, styleRefs - 1);
  if (styleRefs === 0) {
    const s = document.getElementById(STYLE_ID);
    if (s) s.remove();
  }
}

/* ====================================================================
 * 3. 着色器（WebGL2 / WebGL1 共用同一核心，仅包装不同）
 * ================================================================== */
const VERT_GL1 = `
precision highp float;
attribute vec2 a_pos;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

const VERT_GL2 = `#version 300 es
precision highp float;
in vec2 a_pos;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

// 占位符 OUTPUT 会在包装时替换为 gl_FragColor / fragColor 赋值。
const FRAG_CORE = `
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_intensity;
uniform vec3 u_paper;
uniform vec3 u_paper2;
uniform vec3 u_brick;
uniform vec3 u_amber;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float aspect = u_resolution.x / u_resolution.y;
  vec2 p = vec2(uv.x * aspect, uv.y); // aspect 校正，圆形涟漪不变形

  // 暖纸渐变底 + 一抹极淡的琥珀暗角
  vec3 base = mix(u_paper, u_paper2, clamp(uv.y * 0.65 + uv.x * 0.12, 0.0, 1.0));
  float glow = exp(-length(vec2((uv.x - 0.86) * aspect, uv.y - 0.94)) * 2.6);
  base = mix(base, u_amber, glow * 0.05);

  float t = u_time;
  // 三个波源，随时间非常缓慢地漂移
  vec2 c1 = vec2(0.40 * aspect, 0.54) + vec2(sin(t * 0.051) * 0.20 * aspect, cos(t * 0.043 + 1.7) * 0.13);
  vec2 c2 = vec2(0.63 * aspect, 0.58) + vec2(sin(t * 0.037 + 2.1) * 0.16 * aspect, cos(t * 0.059 + 0.6) * 0.14);
  vec2 c3 = vec2(0.50 * aspect, 0.42) + vec2(cos(t * 0.047 + 4.0) * 0.12 * aspect, sin(t * 0.053 + 2.9) * 0.10);

  float d1 = length(p - c1);
  float d2 = length(p - c2);
  float d3 = length(p - c3);

  // 缓扩散 + 干涉叠加的正弦涟漪，随距离指数衰减
  float r = 0.0;
  r += sin(d1 * 10.0 - t * 0.30) * exp(-d1 * 0.55);
  r += sin(d2 * 12.0 - t * 0.26 + 1.3) * exp(-d2 * 0.50);
  r += sin(d3 *  9.0 - t * 0.34 + 2.6) * exp(-d3 * 0.60);
  // 低次谐波，更柔和、更像水面
  r += 0.5 * sin(d1 * 5.0 + t * 0.18) * exp(-d1 * 0.35);
  r += 0.5 * sin(d2 * 6.0 + t * 0.15 + 0.8) * exp(-d2 * 0.32);

  float strength = clamp(r, -1.0, 1.0) * u_intensity;
  float crest = clamp(0.5 + 0.5 * strength, 0.0, 1.0); // 0=波谷 1=波峰
  vec3 crestCol = mix(u_amber, u_brick, 0.35);
  vec3 col = mix(base, crestCol, crest * 0.08 * u_intensity);

  // 极轻的静态纸纹颗粒（时间不变：省电、不闪烁）
  float n = hash(floor(gl_FragCoord.xy) + vec2(7.0, 3.0));
  col += (n - 0.5) * 0.010 * u_intensity;

  OUTPUT
}
`;

const FRAG_GL1 = 'precision highp float;\n' + FRAG_CORE.replace('OUTPUT', 'gl_FragColor = vec4(col, 1.0);');
const FRAG_GL2 = '#version 300 es\nprecision highp float;\nout vec4 fragColor;\n' + FRAG_CORE.replace('OUTPUT', 'fragColor = vec4(col, 1.0);');

/* ====================================================================
 * 4. WebGL 渲染器
 * ================================================================== */
// alpha:true 让画布在「尚未绘制」时保持透明 → 兜底 CSS 渐变直接透出，不会黑屏；
// 实际绘制始终输出 alpha=1（不透明纸底），premultiplied 下与不透明等价。
const GL_ATTRS = {
  alpha: true,
  premultipliedAlpha: true,
  antialias: false,
  depth: false,
  stencil: false,
  powerPreference: 'low-power',
  preserveDrawingBuffer: false,
  failIfMajorPerformanceCaveat: false,
};

function compileShader(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(sh) || '';
    gl.deleteShader(sh);
    throw new Error('shader compile failed: ' + info);
  }
  return sh;
}

function makeGLRenderer(gl, isGL2) {
  const vs = compileShader(gl, gl.VERTEX_SHADER, isGL2 ? VERT_GL2 : VERT_GL1);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, isGL2 ? FRAG_GL2 : FRAG_GL1);
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog) || '';
    gl.deleteProgram(prog);
    throw new Error('link failed: ' + log);
  }
  gl.useProgram(prog);

  // 全屏三角形（3 顶点覆盖整个裁剪空间）
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(prog, 'a_pos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  const u = {};
  for (const name of ['u_resolution', 'u_time', 'u_intensity', 'u_paper', 'u_paper2', 'u_brick', 'u_amber']) {
    u[name] = gl.getUniformLocation(prog, name);
  }

  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.BLEND);

  let w = 0;
  let h = 0;

  return {
    setSize(W, H) {
      w = W;
      h = H;
      gl.viewport(0, 0, w, h);
      gl.uniform2f(u.u_resolution, w, h);
    },
    draw(time, intensity) {
      gl.useProgram(prog);
      gl.uniform1f(u.u_time, time);
      gl.uniform1f(u.u_intensity, intensity);
      gl.uniform3f(u.u_paper, C.paper[0], C.paper[1], C.paper[2]);
      gl.uniform3f(u.u_paper2, C.paper2[0], C.paper2[1], C.paper2[2]);
      gl.uniform3f(u.u_brick, C.brick[0], C.brick[1], C.brick[2]);
      gl.uniform3f(u.u_amber, C.amber[0], C.amber[1], C.amber[2]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose() {
      try {
        gl.deleteProgram(prog);
        gl.deleteShader(vs);
        gl.deleteShader(fs);
        gl.deleteBuffer(buf);
      } catch (e) { /* 上下文已丢失等情况，忽略 */ }
    },
  };
}

// 用一次性探针画布完整编译/链接验证可用性，避免污染真实画布
//（真实画布一旦 getContext('webgl2') 成功，就再也不能退回 2d）。
function probeWebGL() {
  const attempts = [
    ['webgl2', true],
    ['webgl', false],
    ['experimental-webgl', false],
  ];
  for (const [name, isGL2] of attempts) {
    try {
      const c = document.createElement('canvas');
      const gl = c.getContext(name, GL_ATTRS);
      if (!gl) continue;
      const r = makeGLRenderer(gl, isGL2);
      r.dispose();
      return isGL2 ? 'gl2' : 'gl1';
    } catch (e) {
      // 继续尝试下一档
    }
  }
  return null;
}

function createWebGLRenderer(canvas) {
  const kind = probeWebGL();
  if (!kind) return null;
  try {
    const gl = kind === 'gl2'
      ? canvas.getContext('webgl2', GL_ATTRS)
      : (canvas.getContext('webgl', GL_ATTRS) || canvas.getContext('experimental-webgl', GL_ATTRS));
    if (!gl) return null;
    return makeGLRenderer(gl, kind === 'gl2');
  } catch (e) {
    return null;
  }
}

/* ====================================================================
 * 5. Canvas2D 兜底渲染器（简单径向波纹）
 * ================================================================== */
function frac(x) {
  return x - Math.floor(x);
}

function create2DRenderer(canvas) {
  let ctx = null;
  try {
    ctx = canvas.getContext('2d', { alpha: true });
  } catch (e) {
    ctx = canvas.getContext('2d');
  }
  if (!ctx) return null;

  let w = 0;
  let h = 0;
  let baseGrad = null;
  let glowGrad = null;

  function buildGrads() {
    baseGrad = ctx.createLinearGradient(0, 0, 0, h);
    baseGrad.addColorStop(0, srgbToCss(C.paper));
    baseGrad.addColorStop(1, srgbToCss(C.paper2));

    const gx = w * 0.86;
    const gy = h * 0.94;
    const gr = Math.max(w, h) * 0.7;
    glowGrad = ctx.createRadialGradient(gx, gy, 0, gx, gy, gr);
    glowGrad.addColorStop(0, srgbToCss(C.amber, 0.05));
    glowGrad.addColorStop(1, srgbToCss(C.amber, 0));
  }

  function setSize(W, H) {
    w = W;
    h = H;
    buildGrads();
  }

  const sources = [
    { fx: 0.40, fy: 0.54, ph: 0.0,  sp: 0.021, amp: 1.0 },
    { fx: 0.63, fy: 0.58, ph: 0.33, sp: 0.017, amp: 0.85 },
    { fx: 0.50, fy: 0.42, ph: 0.66, sp: 0.025, amp: 0.7 },
  ];

  function draw(time, intensity) {
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = baseGrad;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = glowGrad;
    ctx.fillRect(0, 0, w, h);

    if (intensity <= 0.0001) return;

    const s = Math.min(w, h);
    const t = time;
    for (const src of sources) {
      const dx = Math.sin(t * 0.05 + src.ph * 7.0) * 0.06 * w;
      const dy = Math.cos(t * 0.04 + src.ph * 5.0) * 0.05 * h;
      const cx = src.fx * w + dx;
      const cy = src.fy * h + dy;
      const cycle = 0.16 + 0.30 * frac(t * src.sp + src.ph);
      const R = s * cycle;
      const ringW = s * 0.045;
      const fade = Math.max(0, 1 - cycle / 0.6);
      const alpha = 0.05 * intensity * src.amp * fade;
      if (alpha <= 0.001) continue;

      const g = ctx.createRadialGradient(cx, cy, Math.max(0, R - ringW), cx, cy, R + ringW);
      g.addColorStop(0, srgbToCss(C.brick, 0));
      g.addColorStop(0.5, srgbToCss(C.brick, alpha));
      g.addColorStop(1, srgbToCss(C.brick, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, R + ringW, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  return { setSize, draw, dispose() {} };
}

/* ====================================================================
 * 6. 控制器
 * ================================================================== */
const FPS = 30;                 // 帧率预算：省电，慢速波纹下肉眼无感
const FRAME_MS = 1000 / FPS;
const MAX_PIXELS = 2_000_000;   // 总像素封顶 ≈200 万

const nowSeconds = () =>
  (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;

export function createBackground(opts = {}) {
  const initIntensity = opts && typeof opts.intensity === 'number' ? opts.intensity : 0.55;
  let targetIntensity = clamp01(initIntensity);

  ensureStyle();

  const canvas = document.createElement('canvas');
  canvas.className = 'llfx-background';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.setAttribute('data-llfx', '');

  let renderer = null;
  let running = false;      // 用户是否希望运行（start/stop 的意图）
  let destroyed = false;
  let loopActive = false;   // RAF 是否正在调度
  let rafId = 0;
  let lastFrameAt = 0;

  const motionQuery = typeof matchMedia === 'function'
    ? matchMedia('(prefers-reduced-motion: reduce)')
    : null;
  let reducedMotion = motionQuery ? motionQuery.matches : false;

  if (document.body) {
    document.body.appendChild(canvas);
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      if (!destroyed && document.body) document.body.appendChild(canvas);
    }, { once: true });
  }

  function computeSize() {
    const dpr = Math.min(typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1, 2);
    const vw = window.innerWidth || document.documentElement.clientWidth || 1;
    const vh = window.innerHeight || document.documentElement.clientHeight || 1;
    let w = Math.round(vw * dpr);
    let h = Math.round(vh * dpr);
    if (w * h > MAX_PIXELS) {
      const scale = Math.sqrt(MAX_PIXELS / (w * h));
      w = Math.max(1, Math.round(w * scale));
      h = Math.max(1, Math.round(h * scale));
    }
    return { w, h };
  }

  function resize() {
    const s = computeSize();
    if (canvas.width !== s.w) canvas.width = s.w;
    if (canvas.height !== s.h) canvas.height = s.h;
    if (renderer) renderer.setSize(s.w, s.h);
  }

  function ensureRenderer() {
    if (renderer || reducedMotion) return renderer;
    renderer = createWebGLRenderer(canvas) || create2DRenderer(canvas);
    if (renderer) {
      const s = computeSize();
      renderer.setSize(s.w, s.h);
    }
    return renderer;
  }

  function drawStatic() {
    if (renderer) renderer.draw(nowSeconds(), targetIntensity);
  }

  function startLoop() {
    if (loopActive) return;
    loopActive = true;
    lastFrameAt = 0;
    const step = (ts) => {
      if (!loopActive) return;
      rafId = requestAnimationFrame(step);
      if (ts - lastFrameAt < FRAME_MS) return;
      lastFrameAt = ts;
      if (renderer) renderer.draw(ts / 1000, targetIntensity);
    };
    rafId = requestAnimationFrame(step);
  }

  function stopLoop() {
    loopActive = false;
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
  }

  function syncLoop() {
    const should = running && !destroyed && !document.hidden &&
      !reducedMotion && !!renderer && targetIntensity > 0.0001;
    if (should) startLoop();
    else stopLoop();
  }

  function onVisibility() {
    syncLoop();
    if (!loopActive && !document.hidden) drawStatic();
  }
  function onResize() {
    resize();
    if (!loopActive) drawStatic();
  }
  function onMotion() {
    reducedMotion = motionQuery ? motionQuery.matches : false;
    if (reducedMotion) {
      if (renderer) {
        try { renderer.dispose(); } catch (e) { /* noop */ }
        renderer = null;
      }
    } else {
      ensureRenderer();
      resize();
    }
    syncLoop();
    if (!loopActive) drawStatic();
  }
  function onContextLost(e) {
    e.preventDefault();
    stopLoop();
  }
  function onContextRestored() {
    if (renderer) {
      try { renderer.dispose(); } catch (e) { /* noop */ }
      renderer = null;
    }
    ensureRenderer();
    resize();
    syncLoop();
    if (!loopActive) drawStatic();
  }

  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);
  document.addEventListener('visibilitychange', onVisibility);
  if (motionQuery) {
    if (typeof motionQuery.addEventListener === 'function') motionQuery.addEventListener('change', onMotion);
    else if (typeof motionQuery.addListener === 'function') motionQuery.addListener(onMotion);
  }
  canvas.addEventListener('webglcontextlost', onContextLost);
  canvas.addEventListener('webglcontextrestored', onContextRestored);

  // 初始：intensity>0 才建上下文（0 时直接走 CSS 静态渐变，省电、避免黑帧）
  if (targetIntensity > 0.0001) ensureRenderer();
  resize();
  drawStatic();

  function start() {
    if (destroyed) return;
    running = true;
    if (targetIntensity > 0.0001) ensureRenderer();
    resize();
    syncLoop();
    if (!loopActive) drawStatic();
  }

  function stop() {
    if (destroyed) return;
    running = false;
    syncLoop();
  }

  function setIntensity(n) {
    if (destroyed) return targetIntensity;
    targetIntensity = clamp01(typeof n === 'number' ? n : targetIntensity);
    if (targetIntensity > 0.0001) ensureRenderer();
    resize();
    syncLoop();
    if (!loopActive) drawStatic();
    return targetIntensity;
  }

  function destroy() {
    destroyed = true;
    running = false;
    stopLoop();
    window.removeEventListener('resize', onResize);
    window.removeEventListener('orientationchange', onResize);
    document.removeEventListener('visibilitychange', onVisibility);
    if (motionQuery) {
      if (typeof motionQuery.removeEventListener === 'function') motionQuery.removeEventListener('change', onMotion);
      else if (typeof motionQuery.removeListener === 'function') motionQuery.removeListener(onMotion);
    }
    canvas.removeEventListener('webglcontextlost', onContextLost);
    canvas.removeEventListener('webglcontextrestored', onContextRestored);
    if (renderer) {
      try { renderer.dispose(); } catch (e) { /* noop */ }
      renderer = null;
    }
    if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
    releaseStyle();
  }

  const api = { start, stop, setIntensity, destroy };
  start(); // 默认自动 start
  return api;
}

export default createBackground;
