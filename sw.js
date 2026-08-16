/* ============================================================================
   Carte Restaurant — service worker
   ----------------------------------------------------------------------------
   Objectif : que la carte reste consultable dans un restaurant où le réseau
   est mauvais, ce qui est fréquent dans une médina aux murs épais.

   Trois régimes :
     · la page et le manifeste  → réseau d'abord, cache en secours
       (une nouvelle version doit arriver dès qu'elle est déployée)
     · les icônes et les photos → cache d'abord
       (elles ne changent pas, inutile de les redemander)
     · Supabase et WhatsApp     → jamais interceptés
       (des données fraîches, ou rien)

   ⚠️ Incrémenter VERSION à chaque modification, sinon les appareils
   conservent l'ancienne version en cache.
   ========================================================================= */
const VERSION = 'cr-v1';
const SHELL   = VERSION + '-shell';
const MEDIA   = VERSION + '-media';

const CORE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(SHELL)
      .then(c => c.addAll(CORE).catch(() => {}))   // un fichier absent ne doit pas tout faire échouer
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(
        ks.filter(k => !k.startsWith(VERSION)).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  /* Supabase, WhatsApp, Pexels : toujours le réseau. Mettre en cache des
     réglages ou une carte périmés causerait plus de dégâts qu'une panne. */
  if (url.origin !== location.origin) return;

  /* Icônes et photos : le cache d'abord, elles ne bougent pas. */
  if (url.pathname.startsWith('/icons/') || url.pathname.startsWith('/photos/')) {
    e.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(MEDIA).then(c => c.put(req, copy)); }
        return res;
      }).catch(() => hit))
    );
    return;
  }

  /* Tout le reste — la page, le manifeste, photos.json : le réseau d'abord.
     Le cache ne sert qu'en cas de coupure. Un chemin de restaurant inconnu
     du cache retombe sur la page d'accueil, qui est la même application. */
  e.respondWith(
    fetch(req)
      .then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(SHELL).then(c => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req).then(hit => hit || caches.match('/index.html')))
  );
});
