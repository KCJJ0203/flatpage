/**
 * Offline shell.
 *
 * Cache-first, because every file here is versioned by the cache name: bump
 * VERSION on any release and the whole shell is replaced atomically. Nothing
 * this worker touches is user data — scans never leave the page.
 */
const VERSION = 'flatpage-v4';

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
  'src/detect.js',

  'src/pdfwriter.js',
  'src/document.js',
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
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;   // we never talk to anyone else

  event.respondWith(
    caches.match(event.request).then((hit) => hit || fetch(event.request)),
  );
});
