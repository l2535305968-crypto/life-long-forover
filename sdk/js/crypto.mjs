// crypto.mjs — 《人生之书》SDK 加密工具。
// 直接复用 web/js/crypto.js（AES-256-GCM + PBKDF2，浏览器和 Node 都用 WebCrypto）。
// 导出的文件格式：base64(salt[16] + iv[12] + ciphertext)。没口令谁也打不开。
import { encryptText, decryptText } from '../../web/js/crypto.js';

export { encryptText, decryptText };

// 导出整本书为加密文本（供分享给家人）。
export async function exportBook(session, password) {
  if (!password || password.length < 6) throw new Error('口令至少 6 位');
  return encryptText(JSON.stringify(session), password);
}

// 用口令解开家人发来的加密文本，得到 session。
export async function importBook(cipher, password) {
  const plain = await decryptText(cipher, password);
  const obj = JSON.parse(plain);
  if (!obj || !obj.id || !obj.person) throw new Error('这不是一本《人生之书》');
  return obj;
}
