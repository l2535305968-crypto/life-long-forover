// make-icon.mjs — 生成《人生之书》的 PWA 图标（纯 Node，零依赖，手写 PNG 编码）。
// 画一个简单的"打开的书 + 一轮小太阳"，暖色。跑法：node tools/make-icon.mjs
import zlib from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'web', 'icons');

// ---------- PNG 编码 ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePNG(size, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// ---------- 简单绘图 ----------
function makeCanvas(size) {
  const buf = Buffer.alloc(size * size * 4);
  return {
    size,
    buf,
    set(x, y, [r, g, b, a = 255]) {
      if (x < 0 || y < 0 || x >= size || y >= size) return;
      const i = (y * size + x) * 4;
      buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = a;
    },
    fillCircle(cx, cy, rad, col) {
      for (let y = Math.floor(cy - rad); y <= Math.ceil(cy + rad); y++) {
        for (let x = Math.floor(cx - rad); x <= Math.ceil(cx + rad); x++) {
          const dx = x + 0.5 - cx;
          const dy = y + 0.5 - cy;
          if (dx * dx + dy * dy <= rad * rad) this.set(x, y, col);
        }
      }
    },
    fillQuad(p0, p1, p2, p3, col) {
      this.fillTri(p0, p1, p2, col);
      this.fillTri(p0, p2, p3, col);
    },
    fillTri(a, b, c, col) {
      const minX = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
      const maxX = Math.min(this.size - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
      const minY = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
      const maxY = Math.min(this.size - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
      const area = edge(a, b, c);
      if (Math.abs(area) < 1e-6) return;
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          const p = [x + 0.5, y + 0.5];
          const w0 = edge(b, c, p) / area;
          const w1 = edge(c, a, p) / area;
          const w2 = edge(a, b, p) / area;
          if (w0 >= 0 && w1 >= 0 && w2 >= 0) this.set(x, y, col);
        }
      }
    }
  };
}

function edge(a, b, p) {
  return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
}

// ---------- 画图标 ----------
const CREAM = [245, 233, 211];
const RED = [154, 59, 42];
const RED_DARK = [122, 44, 32];
const AMBER = [224, 162, 59];
const PAGE = [247, 240, 224];

function renderIcon(size) {
  const c = makeCanvas(size);
  const s = size;
  // 背景
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) c.set(x, y, CREAM);

  const u = s / 512; // 单位，按 512 设计稿缩放
  const P = (x, y) => [x * u, y * u];

  // 太阳（右上）
  c.fillCircle(396 * u, 128 * u, 34 * u, AMBER);

  // 打开的书：左右两页，书脊在中间
  const spineTop = P(256, 168);
  const spineBottom = P(256, 352);
  const leftTop = P(136, 200);
  const leftBottom = P(136, 344);
  const rightTop = P(376, 200);
  const rightBottom = P(376, 344);

  // 左右页（深红封面朝外一点，内页偏米色）
  c.fillQuad(leftTop, spineTop, spineBottom, leftBottom, RED);
  c.fillQuad(spineTop, rightTop, rightBottom, spineBottom, RED);
  // 内页（略小一圈，米色）
  const inset = 26 * u;
  c.fillQuad([leftTop[0] + inset, leftTop[1]], [spineTop[0] - inset, spineTop[1]], [spineBottom[0] - inset, spineBottom[1]], [leftBottom[0] + inset, leftBottom[1]], PAGE);
  c.fillQuad([spineTop[0] + inset, spineTop[1]], [rightTop[0] - inset, rightTop[1]], [rightBottom[0] - inset, rightBottom[1]], [spineBottom[0] + inset, spineBottom[1]], PAGE);
  // 书脊
  c.fillQuad(P(250, 166), P(262, 166), P(262, 354), P(250, 354), RED_DARK);

  return encodePNG(size, c.buf);
}

// 2x 超采样再降采样，边缘更顺滑。
function supersample(size) {
  const big = renderIcon(size * 2);
  // 直接在小尺寸上重画更简单，这里用平均降采样。
  const S = size * 2;
  const out = Buffer.alloc(size * size * 4);
  // 从 big 里把像素取出来：需要解码。为省事，直接在 renderIcon 内做不了，这里改为画 big 后用简单解析。
  return big;
}

// 上面 supersample 想多了，直接画目标尺寸，代码简单可读。
mkdirSync(OUT, { recursive: true });
writeFileSync(path.join(OUT, 'icon-512.png'), renderIcon(512));
writeFileSync(path.join(OUT, 'icon-192.png'), renderIcon(192));
console.log('图标已生成：web/icons/icon-512.png、web/icons/icon-192.png');
