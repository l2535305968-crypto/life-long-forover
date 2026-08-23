// test/local-asr-check.mjs — /api/asr "本地 FunASR 优先" 路由自检（不需要真的装 FunASR）。
// 起一个假的本地识别服务（接受 {audio,dialect} → 返回 {text}），验证：
//   1. health.hasAsr / hasLocalAsr 认本地地址（不再只认讯飞 Key）；
//   2. /api/asr 走本地并透传识别文本；
//   3. 本地返回空 → 落到讯飞，没配讯飞 Key 时给干净的 503（不是 500）。
// 附带：跑一次 tools/funasr_asr_server.py --self-check 报告真实环境状态（不阻塞测试）。
// 跑法：node test/local-asr-check.mjs
import path from 'node:path';
import http from 'node:http';
import { writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/app.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TMP_ENV = path.join(ROOT, 'test', '.tmp-env-asr.env');

let failures = 0;
function ok(cond, msg) {
  console.log((cond ? '  ✓ ' : '  ✗ ') + msg);
  if (!cond) failures += 1;
}

function startMockAsr({ replyText = '苞米面饼子一年到头都是它' } = {}) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        const body = JSON.parse(raw || '{}');
        // audio === 'EMPTY' 时模拟"本地识别不出内容"（handleAsr 会把 audio 原样转发）
        const data = JSON.stringify({ text: body.audio === 'EMPTY' ? '' : replyText, dialect: body.dialect || '' });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(data);
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

async function startApp(envText) {
  writeFileSync(TMP_ENV, envText, 'utf8');
  const { server } = await createApp({ envPath: TMP_ENV });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, port: server.address().port };
}

async function postAsr(port, body) {
  const res = await fetch('http://127.0.0.1:' + port + '/api/asr', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

let mock;
try {
  // 环境自检（不阻塞：装没装都算过；用 stdio inherit 避免沙箱的管道限制）
  const py = 'D:\\computer-caozuo\\miniconda\\envs\\renshengzhishu\\python.exe';
  console.log('  FunASR 环境自检：');
  try {
    const sc = spawnSync(py, [path.join(ROOT, 'tools', 'funasr_asr_server.py'), '--self-check'], { stdio: 'inherit', timeout: 60000 });
    console.log('  （exit ' + sc.status + '：0=就绪，2=环境没装好，null=跑不起来——都不影响本测试）');
  } catch (err) {
    console.log('  （自检没跑起来：' + (err.message || err) + '）');
  }

  mock = await startMockAsr();
  const mockPort = mock.address().port;
  const app = await startApp(
    'PORT=0\nHOST=127.0.0.1\nLOCAL_ASR_URL=http://127.0.0.1:' + mockPort + '/asr\nDEEPSEEK_API_KEY=test-key\n'
  );
  try {
    const h = await (await fetch('http://127.0.0.1:' + app.port + '/api/health')).json();
    ok(h.hasAsr === true && h.hasLocalAsr === true, 'health.hasAsr/hasLocalAsr=true（只配本地地址也算有 ASR）');

    const r1 = await postAsr(app.port, { audio: 'AAAA', dialect: 'chuanyu' });
    ok(r1.status === 200 && r1.data.ok === true && r1.data.text === '苞米面饼子一年到头都是它', '本地识别文本透传（200）');

    // 本地返回空 → 讯飞兜底；没讯飞 Key → 503 NO_ASR_KEY（干净错误）
    const r2 = await postAsr(app.port, { audio: 'EMPTY' });
    ok(r2.status === 503 && r2.data && r2.data.code === 'NO_ASR_KEY', '本地返回空且没配讯飞 → 503 NO_ASR_KEY');

    // 本地挂了 → 也走讯飞兜底路径（没 Key 同样是 503，而不是 500/挂死）
    mock.close();
    mock = null;
    const r3 = await postAsr(app.port, { audio: 'CCCC' });
    ok(r3.status === 503 && r3.data && r3.data.code === 'NO_ASR_KEY', '本地服务挂掉 → 优雅 503（不 500 不挂死）');
  } finally {
    app.server.close();
  }
} catch (e) {
  console.error('测试自身出错：', e);
  failures += 1;
} finally {
  if (mock) mock.close();
  try { rmSync(TMP_ENV, { force: true }); } catch { /* 忽略 */ }
}

console.log('\n========== local-asr-check：' + (failures ? failures + ' 处失败' : '全部通过') + ' ==========');
process.exitCode = failures ? 1 : 0;
