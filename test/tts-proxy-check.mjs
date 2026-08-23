// test/tts-proxy-check.mjs — /api/tts 代理链路自检（不需要真的 Qwen3-TTS）。
// 起一个假的本地配音服务（返回 wav / JSON 包装，用变量切换，不换端口），验证：
//   health.hasTts、音频透传、JSON 包装解码、缺 text/超长、上游挂掉时的优雅错误。
// 跑法：node test/tts-proxy-check.mjs（run-all 会自动带）
import path from 'node:path';
import http from 'node:http';
import { writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/app.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TMP_ENV = path.join(ROOT, 'test', '.tmp-env-tts.env');

// 假 wav：RIFF + 1 秒 24k 静音
const FAKE_WAV = Buffer.concat([
  Buffer.from('RIFF'), Buffer.from([0x24, 0x00, 0x00, 0x00]), Buffer.from('WAVE'),
  Buffer.from('fmt '), Buffer.from([16, 0, 0, 0]), Buffer.from([1, 0]), Buffer.from([1, 0]),
  Buffer.from([0x40, 0x1f, 0x00, 0x00]), Buffer.from([0x80, 0x3e, 0x00, 0x00]),
  Buffer.from([2, 0]), Buffer.from([16, 0]), Buffer.from('data'),
  Buffer.from([0x00, 0x80, 0x00, 0x00]), Buffer.alloc(48000 * 2, 0)
]);

let failures = 0;
function ok(cond, msg) {
  console.log((cond ? '  ✓ ' : '  ✗ ') + msg);
  if (!cond) failures += 1;
}

let mockMode = 'wav'; // 'wav' | 'json'，切换不换端口
function startMockTts() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        const mode = mockMode;
        if (mode === 'json') {
          const data = JSON.stringify({ audio: FAKE_WAV.toString('base64'), format: 'audio/wav' });
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(data);
        } else {
          res.writeHead(200, { 'content-type': 'audio/wav' });
          res.end(FAKE_WAV);
        }
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

function startApp(envText) {
  writeFileSync(TMP_ENV, envText, 'utf8');
  return createApp({ envPath: TMP_ENV }).then(({ server }) => {
    return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port });
    }));
  });
}

async function postJson(port, url, obj) {
  const res = await fetch('http://127.0.0.1:' + port + url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(obj)
  });
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, ctype: res.headers.get('content-type') || '', buf };
}

let mock;
try {
  mock = await startMockTts();
  const mockPort = mock.address().port;
  const app = await startApp(
    'PORT=0\nHOST=127.0.0.1\nTTS_URL=http://127.0.0.1:' + mockPort + '/tts\nDEEPSEEK_API_KEY=test-key\n'
  );
  const { server, port } = app;
  try {
    const h = await (await fetch('http://127.0.0.1:' + port + '/api/health')).json();
    ok(h.hasTts === true, 'health.hasTts=true（配了 TTS_URL）');

    const r1 = await postJson(port, '/api/tts', { text: '姥爷，您慢慢说。' });
    ok(r1.status === 200 && r1.ctype.includes('audio/wav') && r1.buf.equals(FAKE_WAV), '音频字节原样透传（200 audio/wav）');

    const r2 = await postJson(port, '/api/tts', {});
    ok(r2.status === 400, '缺 text → 400');
    const r2b = await postJson(port, '/api/tts', { text: '   ' });
    ok(r2b.status === 400, '空白 text → 400');

    const r3 = await postJson(port, '/api/tts', { text: '啊'.repeat(2001) });
    ok(r3.status === 413, '超过 2000 字 → 413');

    // 上游切到 JSON 包装模式（同端口）
    mockMode = 'json';
    const r4 = await postJson(port, '/api/tts', { text: '暖和的声音' });
    ok(r4.status === 200 && r4.ctype.includes('audio/wav') && r4.buf.equals(FAKE_WAV), 'JSON 包装（base64 audio）也能解码成 wav');
    mockMode = 'wav';

    // 上游挂了 → 优雅 502（不是 500 也不是挂死）
    mock.close();
    mock = null;
    const r5 = await postJson(port, '/api/tts', { text: '试试上游不在' });
    ok(r5.status === 502 || r5.status === 504, '上游不可达 → 502/504 优雅报错（实际 ' + r5.status + '）');
  } finally {
    server.close();
  }

  // 明确 TTS_URL= 关掉 → 503 NO_TTS
  const app2 = await startApp('PORT=0\nHOST=127.0.0.1\nTTS_URL=\nDEEPSEEK_API_KEY=test-key\n');
  try {
    const r6 = await postJson(app2.port, '/api/tts', { text: '没有配音服务' });
    const data = JSON.parse(r6.buf.toString('utf8'));
    ok(r6.status === 503 && data.code === 'NO_TTS', 'TTS_URL= 为空 → 503 NO_TTS');
  } finally {
    app2.server.close();
  }
} catch (e) {
  console.error('测试自身出错：', e);
  failures += 1;
} finally {
  if (mock) mock.close();
  try { rmSync(TMP_ENV, { force: true }); } catch { /* 忽略 */ }
}

console.log('\n========== tts-proxy-check：' + (failures ? failures + ' 处失败' : '全部通过') + ' ==========');
process.exitCode = failures ? 1 : 0;
