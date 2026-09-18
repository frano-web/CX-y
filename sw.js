const CACHE = 'cx-trip-v9-ios-startup-fix';
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
  const url = new URL(e.request.url);

  // Nie przechwytujemy bibliotek/CDN ani API Supabase. Błąd sieci nie może zwrócić HTML jako JavaScript/JSON.
  if (url.origin !== self.location.origin) return;

  // Dla wejścia do PWA: sieć -> cache strony głównej.
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).then(r => {
      if (r && r.ok) caches.open(CACHE).then(c => c.put('./index.html', r.clone())).catch(()=>{});
      return r;
    }).catch(async () => (await caches.match('./index.html')) || (await caches.match('./'))));
    return;
  }

  // Dla lokalnych assetów: sieć -> dokładny plik z cache. Bez fallbacku index.html dla JS/CSS.
  e.respondWith(fetch(e.request).then(r => {
    if (r && r.ok) caches.open(CACHE).then(c => c.put(e.request, r.clone())).catch(()=>{});
    return r;
  }).catch(() => caches.match(e.request)));
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
