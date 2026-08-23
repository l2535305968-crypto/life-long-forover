// recorder.js — 录音留原声。
// 老人的声音是书的一部分。这里只负责录，转文字由家人用手机输入法听写完成，
// 方言 ASR 留待接入专业服务后再替换。

export function supported() {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
}

// 把录音 Blob 转成 dataURL 字符串。这样原声能进 IndexedDB，也能随书加密导出
// （Blob 会被 JSON.stringify 丢掉，dataURL 是字符串，不会丢）。
export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error || new Error('读音频失败'));
    r.readAsDataURL(blob);
  });
}

export async function startRecording() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : 'audio/webm';
  const rec = new MediaRecorder(stream, { mimeType: mime });
  const chunks = [];
  const startedAt = Date.now();

  rec.addEventListener('dataavailable', (e) => {
    if (e.data && e.data.size) chunks.push(e.data);
  });

  rec.start(250);

  return {
    stream,
    stop: () =>
      new Promise((resolve) => {
        rec.addEventListener('stop', () => {
          stream.getTracks().forEach((t) => t.stop());
          const blob = new Blob(chunks, { type: rec.mimeType || mime });
          resolve({
            blob,
            mime: rec.mimeType || mime,
            durationMs: Date.now() - startedAt,
            size: blob.size
          });
        });
        try {
          rec.stop();
        } catch {
          resolve(null);
        }
      })
  };
}
