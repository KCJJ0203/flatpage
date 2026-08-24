/**
 * Offline shell.
 *
 * Cache-first, because every file here is versioned by the cache name: bump
 * VERSION on any release and the whole shell is replaced atomically. Nothing
 * this worker touches is user data — scans never leave the page.
 */
const VERSION = 'flatpage-v7';

/**
 * The OCR engine, cached separately and deliberately without a version.
 *
 * It is about three megabytes and it changes far more rarely than the app, so
 * tying it to VERSION would throw it away and re-download it on every release.
 * It is also not part of SHELL: people who never ask for searchable text should
 * never pay for it, so it is fetched on first use and kept from then on — which
 * is what makes OCR work offline afterwards.
 */
const ENGINE_CACHE = 'flatpage-ocr-engine';
const ENGINE_PATH = '/vendor/tesseract/';

const SHELL = [
  '.',
  'index.html',
  'manifest.webmanifest',
  'src/styles.css',
  'src/ui/corners.css',
  'src/app.js',
  'src/capture.js',
  'src/canvasio.js',
  'src/geometry.js',
  'src/warp.js',
  'src/enhance.js',
  'src/ocr.js',
  'src/detect.js',
  'src/pdfwriter.js',
  'src/document.js',
  'src/batch.js',
  'src/session.js',
  'src/export.js',
  'src/ui/corners.js',
  'src/ui/pagestrip.js',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((k) => k !== VERSION && k !== ENGINE_CACHE)
        .map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;   // we never talk to anyone else

  // The engine is fetched on demand and kept, so the second use of OCR — and
  // every use after that, online or not — costs nothing.
  if (url.pathname.includes(ENGINE_PATH)) {
    event.respondWith(
      caches.open(ENGINE_CACHE).then((cache) => cache.match(event.request).then((hit) => hit
        || fetch(event.request).then((response) => {
          // Only a complete, successful response is worth keeping; caching a
          // partial or failed one would poison every later attempt.
          if (response.ok) cache.put(event.request, response.clone());
          return response;
        }))),
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((hit) => hit || fetch(event.request)),
  );
});
