// キャッシュを使わずネットワーク直接アクセス（安定性優先）
self.addEventListener('install',  () => self.skipWaiting());
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))))
  );
  self.clients.claim();
});
