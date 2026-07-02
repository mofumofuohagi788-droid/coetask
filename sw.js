/* コエ・タスク Service Worker — オフライン対応 */
const CACHE = 'coetask-v3';
const ASSETS = [
  './',
  './index.html',
  './app.js',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-180.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // 自オリジンの静的資産のみ扱う（FirebaseなどのAPIは素通し）
  if (url.origin !== location.origin) return;
  // ナビゲーションは network-first（更新反映）＋オフライン時キャッシュ
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(r => { caches.open(CACHE).then(c => c.put('./index.html', r.clone())); return r; })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }
  // それ以外は cache-first
  e.respondWith(caches.match(req).then(r => r || fetch(req).then(res => {
    caches.open(CACHE).then(c => c.put(req, res.clone()));
    return res;
  })));
});
