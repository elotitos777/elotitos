/* Service worker de Elotitos: la página funciona sin conexión, pero SIEMPRE intenta
   primero la red, para que los precios nuevos (catalog.json) lleguen de inmediato. */
const CACHE_NAME = 'elotitos-shell-v10';
const APP_FILES = [
  './', './index.html', './styles.css', './motion.css', './app.js', './motion.js',
  './catalog.json', './manifest.webmanifest',
  './privacidad.html', './terminos.html', './legal.css', './legal.js',
  './assets/fonts/dm-sans-latin-wght-normal.woff2', './assets/fonts/fraunces-latin-opsz-normal.woff2',
  './assets/elote.svg', './assets/esquites.svg',
  './assets/gal-elote.svg', './assets/gal-esquites.svg', './assets/gal-limon.svg',
  './assets/gal-chile.svg', './assets/gal-queso.svg', './assets/gal-maiz.svg',
  './assets/elote-hero.webp', './assets/elote-card.webp', './assets/esquites-card.webp',
  './assets/icon-192.png', './assets/icon-512.png'
];
/* Los archivos del panel de administrador (admin.js, publish.js, poster.js) no se precargan:
   los clientes no los necesitan. Se guardan solos la primera vez que el administrador los usa. */

self.addEventListener('install', event => {
  // Se guardan uno por uno: si falta algún archivo, el resto sí se guarda.
  event.waitUntil(caches.open(CACHE_NAME).then(cache => Promise.all(APP_FILES.map(file => cache.add(file).catch(() => null)))));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Se guarda sin parámetros (?x=…) para que la caché no crezca sin control
        if (response.ok) { const copy = response.clone(); caches.open(CACHE_NAME).then(cache => cache.put(url.origin + url.pathname, copy)); }
        return response;
      })
      .catch(() => caches.match(event.request, { ignoreSearch: true }).then(hit => hit || (event.request.mode === 'navigate' ? caches.match('./index.html') : undefined)))
  );
});
