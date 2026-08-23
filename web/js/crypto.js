// crypto.js — 导出/导入时给"人生之书"上锁（AES-256-GCM + PBKDF2）。
//
// 为什么需要：老人的人生故事是高度隐私。书平时只存在他自己的手机里；
// 要发给家人看时，先用一个口令加密成一个文件，家人拿到文件 + 口令才能打开。
// 没有口令，谁也读不了。
//
// 同时兼容浏览器和 Node（都用 WebCrypto），所以能在 Node 里直接测。

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToB64(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (typeof btoa === 'function') {
    let bin = '';
    for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
    return btoa(bin);
  }
  // Node 兜底
  return Buffer.from(u8).toString('base64');
}

function b64ToBytes(b64) {
  if (typeof atob === 'function') {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

async function deriveKey(password, salt) {
  const material = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 210_000, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptText(plainText, password) {
  if (!password) throw new Error('口令不能为空');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(plainText)
  );
  const out = new Uint8Array(16 + 12 + cipher.byteLength);
  out.set(salt, 0);
  out.set(iv, 16);
  out.set(new Uint8Array(cipher), 28);
  return bytesToB64(out);
}

export async function decryptText(payload, password) {
  if (!password) throw new Error('口令不能为空');
  const data = b64ToBytes(payload);
  if (data.length < 29) throw new Error('文件格式不对');
  const salt = data.slice(0, 16);
  const iv = data.slice(16, 28);
  const cipher = data.slice(28);
  const key = await deriveKey(password, salt);
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
    return decoder.decode(plain);
  } catch {
    throw new Error('口令不对，打不开');
  }
}
