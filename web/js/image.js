// image.js — 图片处理（浏览器专用）。
// 老人传上来的老照片往往很大。这里统一压到最长边 1600px、转成 JPEG dataURL，
// 这样：1) 存得下；2) 翻页不卡；3) dataURL 是字符串，能进 IndexedDB、也能导出/导入。

const MAX_DIM = 1600;
const QUALITY = 0.85;

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error || new Error('读文件失败'));
    r.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('这张图打不开，可能不是图片文件'));
    img.src = src;
  });
}

function fitTo(w, h, maxDim) {
  if (w <= maxDim && h <= maxDim) return { width: w, height: h };
  const scale = maxDim / Math.max(w, h);
  return { width: Math.round(w * scale), height: Math.round(h * scale) };
}

// 估算 dataURL 对应的字节数（base64 长度 * 3/4），够显示"多大"用。
function estimateSize(dataUrl) {
  const idx = dataUrl.indexOf(',');
  if (idx < 0) return 0;
  return Math.round(((dataUrl.length - idx - 1) * 3) / 4);
}

// 主入口：一个 File → 处理好的图片对象。
export async function processImageFile(file, opts = {}) {
  const maxDim = opts.maxDim || MAX_DIM;
  const quality = opts.quality != null ? opts.quality : QUALITY;

  const raw = await readFileAsDataUrl(file);
  const img = await loadImage(raw);
  const { width, height } = fitTo(img.naturalWidth || img.width, img.naturalHeight || img.height, maxDim);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  // 白底，防止透明 PNG 转成 JPEG 后发黑。
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);

  const dataUrl = canvas.toDataURL('image/jpeg', quality);
  return {
    dataUrl,
    width,
    height,
    size: estimateSize(dataUrl),
    name: file.name || '',
    mime: 'image/jpeg'
  };
}
