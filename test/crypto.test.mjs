// 加密模块测试。跑法：node test/crypto.test.mjs
import assert from 'node:assert/strict';
import { encryptText, decryptText } from '../web/js/crypto.js';

let failures = 0;
const ok = (name, fn) => {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`  ✗ ${name}\n    ${err.message}`);
  }
};

console.log('crypto.test');

ok('加密解密往返一致', async () => {
  const secret = '姥爷的传记：他十六岁进厂，师傅姓王。';
  const enc = await encryptText(secret, '家人口令123');
  assert.notEqual(enc, secret);
  const dec = await decryptText(enc, '家人口令123');
  assert.equal(dec, secret);
});

ok('不同口令每次加密结果不同（随机盐+IV）', async () => {
  const a = await encryptText('同一段话', '口令');
  const b = await encryptText('同一段话', '口令');
  assert.notEqual(a, b);
});

ok('错误口令解不开', async () => {
  const enc = await encryptText('秘密', '对的');
  await assert.rejects(() => decryptText(enc, '错的'), /口令不对/);
});

ok('空口令拒绝', async () => {
  await assert.rejects(() => encryptText('秘密', ''), /口令不能为空/);
});

ok('中文和 emoji 都能原样还原', async () => {
  const s = '老家在东北，冬天冷。🎉 苞米叫玉米。';
  const enc = await encryptText(s, 'x');
  const dec = await decryptText(enc, 'x');
  assert.equal(dec, s);
});

console.log(failures ? `\n${failures} 项未通过。` : '\n全部通过。');
if (failures) process.exitCode = 1;
