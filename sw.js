const CACHE = 'cx-trip-v6-push';
const APP_SHELL = ['./','./index.html','./styles.css','./app.js','./config.js','./manifest.webmanifest','./icons/icon.svg','./icons/icon-192.png','./icons/icon-512.png'];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(APP_SHELL)));
});
self.addEventListener('activate', e => e.waitUntil(Promise.all([
  self.clients.claim(),
  caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
])));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request).then(r => {
    const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r;
  }).catch(() => caches.match(e.request).then(r => r || caches.match('./index.html'))));
});

self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data?.text() || 'Nowa zmiana w CX Trip' }; }
  const title = data.title || 'CX Trip';
  const options = {
    body: data.body || 'Ktoś wprowadził zmianę w aplikacji.',
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    tag: data.tag || 'cx-trip-update',
    renotify: true,
    data: { url: data.url || './#activity' }
  };
  event.waitUntil((async()=>{
    await self.registration.showNotification(title, options);
    if (self.registration.setAppBadge) {
      try { await self.registration.setAppBadge(); } catch {}
    }
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || './#activity', self.location.origin + self.location.pathname).href;
  event.waitUntil((async()=>{
    const list = await clients.matchAll({type:'window',includeUncontrolled:true});
    for (const client of list) {
      if ('focus' in client) { try { await client.navigate(target); } catch {} return client.focus(); }
    }
    return clients.openWindow(target);
  })());
});
