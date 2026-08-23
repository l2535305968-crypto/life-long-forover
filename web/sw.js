// Service Worker。这里不负责"离线"（联网是产品命脉），只负责：
// 1. 让 PWA 能"添加到主屏幕"（满足安装条件）。
// 2. 断网时给个缓存兜底，页面不至于白屏。
const VERSION = 'rss-v1';

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION).then((c) => c.addAll(['/', '/manifest.webmanifest']).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});
