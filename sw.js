// Ausgaben – Service Worker (offline cache, stale-while-revalidate)
// v2: + Beleg-Scan (parser.js, ocr.js) und ein eigener, dauerhafter Cache für die Texterkennung (ocr/…, ca. 8 MB, wird erst bei Bedarf geladen)
const CACHE = 'ausgaben-v2';
const OCR_CACHE = 'ausgaben-ocr-v1';   // bleibt bei App-Updates erhalten (Dateien ändern sich nie)
const ASSETS = ['./', './index.html', './manifest.webmanifest', './parser.js', './ocr.js',
  './icon-192.png', './icon-512.png', './icon-maskable-512.png', './apple-touch-icon.png'];
const OCR_FILES = ['ocr/tesseract.min.js', 'ocr/worker.min.js', 'ocr/tesseract-core-simd-lstm.wasm.js',
  'ocr/lang/deu.traineddata.gz', 'ocr/lang/eng.traineddata.gz'];
const OCR_SCOPE = new URL('ocr/', self.registration.scope).pathname;

self.addEventListener('install', e => {
  // cache:'reload' umgeht den HTTP-Cache, damit wirklich die neue Version geladen wird
  e.waitUntil(caches.open(CACHE)
    .then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE && k !== OCR_CACHE).map(k => caches.delete(k)))
  ).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  // Texterkennung: Cache zuerst (Dateien sind versioniert/unveränderlich), sonst laden und für offline merken
  if (url.pathname.startsWith(OCR_SCOPE)) {
    e.respondWith(caches.open(OCR_CACHE).then(cache => cache.match(url.href).then(hit => hit ||
      fetch(req).then(res => { if (res && res.ok && res.status === 200) cache.put(url.href, res.clone()); return res; }))));
    return;
  }
  // Sofort aus dem Cache (schnell, auch ohne Netz), im Hintergrund aktualisieren
  e.respondWith(caches.open(CACHE).then(cache =>
    cache.match(req, { ignoreSearch: true }).then(cached => {
      const net = fetch(req, { cache: 'no-cache' }).then(res => {
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      }).catch(() => cached || cache.match('./index.html'));
      return cached || net;
    })
  ));
});
// Seite bittet darum, die Texterkennung vorab zu laden (damit sie auch offline klappt)
self.addEventListener('message', e => {
  if (!e.data || e.data.type !== 'prefetch-ocr') return;
  e.waitUntil(caches.open(OCR_CACHE).then(cache => Promise.all(OCR_FILES.map(f => {
    const u = new URL(f, self.registration.scope).href;
    return cache.match(u).then(hit => hit || fetch(u).then(r => { if (r && r.ok && r.status === 200) return cache.put(u, r); }));
  }))).catch(() => {}));
});
