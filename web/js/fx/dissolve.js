// dissolve.js — 人生之书 照片「像素溶解 / 波纹」翻页转场
//
// 原生 ESM、零依赖、无 CDN、可离线运行。只做一件事：把照片查看器 #photo-stage
// 里的一张图「溶解」到另一张图，溶解前沿带动态波纹 + 噪声 + 极轻微马赛克。
//
// 设计要点：
//   * 两张 WebGL 纹理复用：每张新图只在切入时上传一次，另一张复用上一次的结果；
//     空闲时不跑 requestAnimationFrame（不做后台持续渲染）。
//   * devicePixelRatio 感知，DPR 封顶 2。
//   * prefers-reduced-motion：纹波关闭，塌缩为 ≤150ms 的纯交叉淡入。
//   * WebGL 不可用 / 着色器编译失败：回退为两张 <img> 的 CSS 交叉淡入。
//
// 公开 API：
//   createDissolveStage(container, opts) → { transitionTo, destroy, mode }
//
//   transitionTo(imageUrlOrDataUrl, { direction, durationMs, onDone })
//     direction : -1（左翻，波纹从右往左推进）| 1（右翻，波纹从左往右推进）
//     durationMs: 本次转场时长（默认 700）；prefers-reduced-motion 时强制 ≤150
//     onDone    : 转场结束后回调（新图已成为下一帧的 from 之后触发）
//     首次调用（还没有 from 图）时直接显示第一张，onDone 在加载并显示后触发。
//     若补间未完成前又调了一次 transitionTo，旧一次会被取消、其 onDone 不触发。
//
// 本文件不修改 index.html / app.css / app.js；样式在首次使用时注入一个 <style>。

const STYLE_ID = 'dissolve-fx-style';
const DEFAULT_DURATION_MS = 700;
const REDUCED_DURATION_MS = 120;
const DPR_CAP = 2;

let styleInjected = false;

const CSS_TEXT = [
  '.dissolve-stage { position: relative; overflow: hidden; }',
  '.dissolve-stage__canvas {',
  '  position: absolute; inset: 0;',
  '  width: 100%; height: 100%;',
  '  display: block;',
  '}',
  '.dissolve-stage__img {',
  '  position: absolute; inset: 0;',
  '  width: 100%; height: 100%;',
  '  object-fit: contain;',
  '  object-position: center;',
  '  display: block;',
  '  opacity: 0;',
  '  pointer-events: none;',
  '  user-select: none;',
  '}'
].join('\n');

function ensureStyle() {
  if (styleInjected) return;
  styleInjected = true;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS_TEXT;
  document.head.appendChild(style);
}

const reducedMotionQuery =
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null;

function prefersReducedMotion() {
  return !!(reducedMotionQuery && reducedMotionQuery.matches);
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if ('decoding' in img) img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片打不开'));
    img.src = src;
  });
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// ---------- 着色器 ----------

const VERT_SRC = [
  'attribute vec2 aPos;',
  'varying vec2 vUv;',
  'void main() {',
  '  vUv = aPos * 0.5 + 0.5;',
  '  gl_Position = vec4(aPos, 0.0, 1.0);',
  '}'
].join('\n');

const FRAG_SRC = [
  'precision mediump float;',
  '',
  'varying vec2 vUv;',
  '',
  'uniform sampler2D uFrom;',
  'uniform sampler2D uTo;',
  'uniform float uProgress;',   // 0..1
  'uniform float uTime;',       // 本次转场已流逝的秒数（小值，保证 mediump 精度）
  'uniform float uDirection;',  // +1 或 -1
  'uniform float uPixel;',      // 马赛克格子数，<=1 关闭
  'uniform float uRipple;',     // 1 = 溶解；0 = 纯交叉淡入
  'uniform vec2 uFromScale;',   // contain 缩放 (sx, sy)
  'uniform vec2 uToScale;',
  '',
  'float hash21(vec2 p) {',
  '  p = fract(p * vec2(234.34, 435.345));',
  '  p += dot(p, p + 34.23);',
  '  return fract(p.x * p.y);',
  '}',
  '',
  'float vnoise(vec2 p) {',
  '  vec2 i = floor(p);',
  '  vec2 f = fract(p);',
  '  f = f * f * (3.0 - 2.0 * f);',
  '  float a = hash21(i);',
  '  float b = hash21(i + vec2(1.0, 0.0));',
  '  float c = hash21(i + vec2(0.0, 1.0));',
  '  float d = hash21(i + vec2(1.0, 1.0));',
  '  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);',
  '}',
  '',
  'void main() {',
  '  vec2 uv = vUv;',
  '',
  '  // contain + 居中：把画布 uv 映射到每张图的纹理 uv，图外区域用 alpha 镂空',
  '  vec2 fromUv = (uv - 0.5) / uFromScale + 0.5;',
  '  vec2 toUv   = (uv - 0.5) / uToScale   + 0.5;',
  '  float fromMask = step(0.0, fromUv.x) * step(fromUv.x, 1.0)',
  '                 * step(0.0, fromUv.y) * step(fromUv.y, 1.0);',
  '  float toMask   = step(0.0, toUv.x)   * step(toUv.x, 1.0)',
  '                 * step(0.0, toUv.y)   * step(toUv.y, 1.0);',
  '',
  '  float mixF = uProgress;',
  '',
  '  if (uRipple > 0.5) {',
  '    // 极轻微像素化：把参与阈值计算的坐标量化，让溶解按小块切换',
  '    vec2 cell = uPixel > 1.0 ? floor(uv * uPixel) / uPixel : uv;',
  '    float dir = uDirection >= 0.0 ? 1.0 : -1.0;',
  '    // 波纹前沿位置：direction=1 从左往右，direction=-1 从右往左',
  '    float front = dir > 0.0 ? uProgress : 1.0 - uProgress;',
  '    float dist = dir > 0.0 ? (front - cell.x) : (cell.x - front);',
  '',
  '    // 波浪 + 噪声做溶解阈值，前沿因此抖动、涟漪化',
  '    float wave = sin(cell.y * 6.28318 * 2.5 + uTime * 4.0) * 0.05',
  '               + sin((cell.x + cell.y) * 6.28318 * 1.5 - uTime * 2.8) * 0.045;',
  '    float n = vnoise(cell * vec2(9.0, 6.0) + uTime * 0.4) - 0.5;',
  '    float t = dist + wave + n * 0.34;',
  '    mixF = smoothstep(-0.085, 0.085, t);',
  '  }',
  '',
  '  vec4 from = texture2D(uFrom, fromUv);',
  '  vec4 to   = texture2D(uTo, toUv);',
  '  vec3 rgb  = mix(from.rgb, to.rgb, mixF);',
  '  float a   = mix(fromMask, toMask, mixF);',
  '  gl_FragColor = vec4(rgb, a);',
  '}'
].join('\n');

// ---------- WebGL 小工具 ----------

function compileShader(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(sh) || '着色器编译失败';
    gl.deleteShader(sh);
    throw new Error(info);
  }
  return sh;
}

function buildProgram(gl, vsSrc, fsSrc) {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc);
  const p = gl.createProgram();
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(p) || '着色器链接失败';
    gl.deleteProgram(p);
    throw new Error(info);
  }
  return p;
}

function createTexture(gl) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  return tex;
}

function uploadTexture(gl, tex, img) {
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
}

// 图片以 contain 居中铺在缓冲里的缩放系数（单位：画布宽高的比例）。
function containScale(iw, ih, w, h) {
  const ac = w / h; // 画布宽高比
  const ai = iw / ih; // 图片宽高比
  if (ai > ac) return [1, ac / ai]; // 图更宽：左右撑满，上下留边
  return [ai / ac, 1]; // 图更高：上下撑满，左右留边
}

// ---------- WebGL 舞台 ----------

function createGLStage(container, options) {
  const canvas = document.createElement('canvas');
  canvas.className = 'dissolve-stage__canvas';
  canvas.setAttribute('aria-hidden', 'true');
  container.append(canvas);

  const attrs = {
    alpha: true,
    premultipliedAlpha: false,
    antialias: true,
    preserveDrawingBuffer: false,
    depth: false,
    stencil: false
  };
  const gl = canvas.getContext('webgl', attrs) || canvas.getContext('experimental-webgl', attrs);
  if (!gl) {
    canvas.remove();
    return null;
  }

  let program;
  try {
    program = buildProgram(gl, VERT_SRC, FRAG_SRC);
  } catch (err) {
    canvas.remove();
    const ext = gl.getExtension('WEBGL_lose_context');
    if (ext) { try { ext.loseContext(); } catch { /* 忽略 */ } }
    return null;
  }

  const loc = {
    aPos: gl.getAttribLocation(program, 'aPos'),
    uFrom: gl.getUniformLocation(program, 'uFrom'),
    uTo: gl.getUniformLocation(program, 'uTo'),
    uProgress: gl.getUniformLocation(program, 'uProgress'),
    uTime: gl.getUniformLocation(program, 'uTime'),
    uDirection: gl.getUniformLocation(program, 'uDirection'),
    uPixel: gl.getUniformLocation(program, 'uPixel'),
    uRipple: gl.getUniformLocation(program, 'uRipple'),
    uFromScale: gl.getUniformLocation(program, 'uFromScale'),
    uToScale: gl.getUniformLocation(program, 'uToScale')
  };

  // 全屏四边形
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(loc.aPos);
  gl.vertexAttribPointer(loc.aPos, 2, gl.FLOAT, false, 0, 0);

  // 两张纹理：texA / texB 轮流当「当前帧」，只在新图切入时各上传一次
  const texA = { texture: createTexture(gl), iw: 0, ih: 0 };
  const texB = { texture: createTexture(gl), iw: 0, ih: 0 };

  let current = null; // 当前显示的图（下一帧的 from）
  let fromTex = null;
  let toTex = null;
  let progress = 1;
  let direction = 1;
  let ripple = 0;
  let time = 0;
  let bufferW = 0;
  let bufferH = 0;
  let rafId = 0;
  let token = 0;
  let destroyed = false;

  function computeSize() {
    const dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
    const w = Math.max(1, Math.round(container.clientWidth * dpr));
    const h = Math.max(1, Math.round(container.clientHeight * dpr));
    if (w !== canvas.width || h !== canvas.height) {
      canvas.width = w;
      canvas.height = h;
    }
    bufferW = w;
    bufferH = h;
  }

  function render() {
    if (!fromTex || !toTex || !bufferW || !bufferH) return;
    gl.viewport(0, 0, bufferW, bufferH);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(program);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, fromTex.texture);
    gl.uniform1i(loc.uFrom, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, toTex.texture);
    gl.uniform1i(loc.uTo, 1);

    gl.uniform1f(loc.uProgress, progress);
    gl.uniform1f(loc.uTime, time);
    gl.uniform1f(loc.uDirection, direction);
    gl.uniform1f(loc.uPixel, options.pixelate);
    gl.uniform1f(loc.uRipple, ripple);

    const fs = containScale(fromTex.iw, fromTex.ih, bufferW, bufferH);
    const ts = containScale(toTex.iw, toTex.ih, bufferW, bufferH);
    gl.uniform2f(loc.uFromScale, fs[0], fs[1]);
    gl.uniform2f(loc.uToScale, ts[0], ts[1]);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  function transitionTo(src, o = {}) {
    const dir = o.direction == null || o.direction >= 0 ? 1 : -1;
    let dur = typeof o.durationMs === 'number' && o.durationMs > 0 ? o.durationMs : options.durationMs;
    const reduced = prefersReducedMotion();
    if (reduced) dur = Math.min(dur, REDUCED_DURATION_MS);
    const useRipple = reduced ? 0 : 1;
    const onDone = typeof o.onDone === 'function' ? o.onDone : null;

    const t = ++token;
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }

    loadImage(src).then((img) => {
      if (destroyed || t !== token) return;
      const iw = img.naturalWidth || img.width || 1;
      const ih = img.naturalHeight || img.height || 1;

      if (!current) {
        // 首屏：没有 from 图，直接显示第一张
        uploadTexture(gl, texA.texture, img);
        texA.iw = iw;
        texA.ih = ih;
        current = texA;
        fromTex = texA;
        toTex = texA;
        progress = 1;
        direction = dir;
        ripple = 0;
        time = 0;
        computeSize();
        render();
        if (onDone) onDone();
        return;
      }

      // 找到空闲槽位，把新图上传进去（这张图只上传这一次）
      const slot = current === texA ? texB : texA;
      uploadTexture(gl, slot.texture, img);
      slot.iw = iw;
      slot.ih = ih;

      const from = current;
      const to = slot;
      fromTex = from;
      toTex = to;
      direction = dir;
      time = 0;
      computeSize();

      const start = performance.now();
      function frame(now) {
        if (destroyed || t !== token) return;
        let p = dur > 0 ? (now - start) / dur : 1;
        if (p >= 1) {
          p = 1;
          current = to;
          fromTex = to;
          toTex = to;
          progress = 1;
          direction = dir;
          ripple = 0; // 收尾帧走纯交叉淡入，保证最后一张干净无噪点残留
          time = 0;
          render();
          rafId = 0;
          if (onDone) onDone();
          return;
        }
        p = easeInOutCubic(p);
        progress = p;
        ripple = useRipple;
        time = (now - start) / 1000;
        fromTex = from;
        toTex = to;
        render();
        rafId = requestAnimationFrame(frame);
      }
      rafId = requestAnimationFrame(frame);
    }).catch(() => {
      // 图加载失败：保持当前画面不变，仍回调以便上层更新计数/焦点等
      if (destroyed || t !== token) return;
      if (onDone) onDone();
    });
  }

  const onResize = () => {
    computeSize();
    render();
  };
  let resizeObserver = null;
  if (typeof ResizeObserver === 'function') {
    resizeObserver = new ResizeObserver(onResize);
    resizeObserver.observe(container);
  } else {
    window.addEventListener('resize', onResize);
  }
  onResize();

  function destroy() {
    destroyed = true;
    token++;
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    if (resizeObserver) resizeObserver.disconnect();
    else window.removeEventListener('resize', onResize);
    try { gl.deleteTexture(texA.texture); } catch { /* 忽略 */ }
    try { gl.deleteTexture(texB.texture); } catch { /* 忽略 */ }
    try { gl.deleteBuffer(quad); } catch { /* 忽略 */ }
    try { gl.deleteProgram(program); } catch { /* 忽略 */ }
    const ext = gl.getExtension('WEBGL_lose_context');
    if (ext) { try { ext.loseContext(); } catch { /* 忽略 */ } }
    if (canvas.parentNode === container) container.removeChild(canvas);
    container.classList.remove('dissolve-stage');
  }

  return { transitionTo, destroy, mode: 'webgl' };
}

// ---------- CSS 交叉淡入回退（WebGL 不可用） ----------

function createCSSStage(container, options) {
  const a = document.createElement('img');
  const b = document.createElement('img');
  a.className = 'dissolve-stage__img';
  b.className = 'dissolve-stage__img';
  a.alt = '';
  b.alt = '';
  a.setAttribute('aria-hidden', 'true');
  b.setAttribute('aria-hidden', 'true');
  a.draggable = false;
  b.draggable = false;
  container.append(a, b);

  let current = a;
  let hasFirst = false;
  let token = 0;
  let timer = 0;
  let destroyed = false;

  function transitionTo(src, o = {}) {
    let dur = typeof o.durationMs === 'number' && o.durationMs > 0 ? o.durationMs : options.durationMs;
    if (prefersReducedMotion()) dur = Math.min(dur, REDUCED_DURATION_MS);
    const onDone = typeof o.onDone === 'function' ? o.onDone : null;

    const t = ++token;
    clearTimeout(timer);

    loadImage(src).then(() => {
      if (destroyed || t !== token) return;
      const other = current === a ? b : a;
      other.src = src;
      other.style.transition = 'opacity ' + dur + 'ms linear';
      other.style.opacity = '1';
      if (hasFirst) {
        current.style.transition = 'opacity ' + dur + 'ms linear';
        current.style.opacity = '0';
      }
      hasFirst = true;
      timer = setTimeout(() => {
        if (destroyed || t !== token) return;
        current = other;
        if (onDone) onDone();
      }, dur + 30);
    }).catch(() => {
      if (destroyed || t !== token) return;
      if (onDone) onDone();
    });
  }

  function destroy() {
    destroyed = true;
    token++;
    clearTimeout(timer);
    if (a.parentNode === container) container.removeChild(a);
    if (b.parentNode === container) container.removeChild(b);
    container.classList.remove('dissolve-stage');
  }

  return { transitionTo, destroy, mode: 'css' };
}

// ---------- 入口 ----------

/**
 * 在已存在的 container 内建一个像素溶解转场舞台。
 *
 * @param {HTMLElement} container 已存在的 DOM 元素（上层传入照片查看器的 #photo-stage）。
 * @param {Object} [opts]
 * @param {number} [opts.durationMs=700] 默认转场时长。
 * @param {number} [opts.pixelate=56]     马赛克格子数（横跨的格数），<=1 关闭像素化。
 * @returns {{ transitionTo: Function, destroy: Function, mode: 'webgl'|'css' }}
 */
export function createDissolveStage(container, opts = {}) {
  if (!container || container.nodeType !== 1) {
    throw new Error('createDissolveStage: container 必须是已存在的 DOM 元素');
  }
  ensureStyle();

  const options = {
    durationMs:
      typeof opts.durationMs === 'number' && opts.durationMs > 0
        ? opts.durationMs
        : DEFAULT_DURATION_MS,
    pixelate: typeof opts.pixelate === 'number' ? opts.pixelate : 56
  };

  container.classList.add('dissolve-stage');
  // 防御：清掉上层可能已设过的 background-image，避免和画布叠出重影
  try { container.style.backgroundImage = 'none'; } catch { /* 忽略 */ }

  const stage = createGLStage(container, options);
  if (stage) return stage;
  return createCSSStage(container, options);
}
