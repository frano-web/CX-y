const APP_VERSION = 'v13';
const CACHE_PREFIX = 'cx-trip-';

self.addEventListener('install', event => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // Usuń wszystkie stare cache CX Trip. Aplikacja działa online-first,
    // a service worker służy przede wszystkim do Web Push.
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith(CACHE_PREFIX)).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Celowo NIE przechwytujemy fetch(). Dzięki temu stare pliki PWA nie mogą
// nadpisać nowego logowania, config.js ani app.js.

self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; }
  catch { data = { body: event.data?.text() || 'Nowa zmiana w CX Trip' }; }
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
  const target = new URL(event.notification.data?.url || './#activity', self.registration.scope).href;
  event.waitUntil((async()=>{
    const list = await clients.matchAll({type:'window', includeUncontrolled:true});
    for (const client of list) {
      if ('focus' in client) {
        try { await client.navigate(target); } catch {}
        return client.focus();
      }
    }
    return clients.openWindow(target);
  })());
});
