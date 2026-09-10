// Service worker — cacheia a casca do app; dados de mercado nunca são cacheados aqui.
const VERSION = 'painel-v1';
const SHELL = ['./', './index.html', './app.css', './app.js', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;                 // proxy, fontes etc: direto na rede
  if (url.pathname.endsWith('/data/tesouro.json')) return;          // dado diário: sempre rede
  // casca do app: rede primeiro, cache como fallback (facilita atualizar)
  e.respondWith(
    fetch(e.request).then(res => {
      const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); return res;
    }).catch(() => caches.match(e.request).then(r => r || caches.match('./index.html')))
  );
});
