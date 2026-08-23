// 图片数据模型测试（Node 侧只测模型，canvas 处理属浏览器）。跑法：node test/images.test.mjs
import assert from 'node:assert/strict';
import { newSession, addImage, removeImage } from '../web/js/core/model.js';

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

console.log('images.test');

ok('新会话带 images 空数组', () => {
  const s = newSession();
  assert.ok(Array.isArray(s.images));
  assert.equal(s.images.length, 0);
});

ok('addImage 存进照片对象（dataUrl 是字符串）', () => {
  const s = newSession();
  addImage(s, { name: '老照片.jpg', dataUrl: 'data:image/jpeg;base64,AAAA', width: 800, height: 600 });
  assert.equal(s.images.length, 1);
  assert.equal(s.images[0].name, '老照片.jpg');
  assert.ok(s.images[0].id.startsWith('img'));
  assert.ok(typeof s.images[0].dataUrl === 'string');
});

ok('addImage 拒绝空 dataUrl', () => {
  const s = newSession();
  addImage(s, { name: 'x' });
  assert.equal(s.images.length, 0);
});

ok('removeImage 按 id 删除', () => {
  const s = newSession();
  addImage(s, { dataUrl: 'data:image/jpeg;base64,AA' });
  addImage(s, { dataUrl: 'data:image/jpeg;base64,BB' });
  const first = s.images[0].id;
  removeImage(s, first);
  assert.equal(s.images.length, 1);
  assert.notEqual(s.images[0].id, first);
});

ok('照片能被 JSON 序列化（可导出/导入）', () => {
  const s = newSession();
  addImage(s, { dataUrl: 'data:image/jpeg;base64,QUJD', caption: '过年合影' });
  const round = JSON.parse(JSON.stringify(s));
  assert.equal(round.images.length, 1);
  assert.equal(round.images[0].caption, '过年合影');
  assert.equal(round.images[0].dataUrl, 'data:image/jpeg;base64,QUJD');
});

console.log(failures ? `\n${failures} 项未通过。` : '\n全部通过。');
if (failures) process.exitCode = 1;
