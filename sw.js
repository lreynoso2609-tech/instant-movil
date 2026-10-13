/* Instant móvil: guarda la "carcasa" de la app para poder abrirla sin internet.
   Nunca guarda datos ni respuestas de Supabase (solo archivos de esta misma página). */
const CACHE = 'instant-movil-1';
self.addEventListener('install', (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  const guardar = (r) => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then((x) => x.put(req, c)); } return r; };
  if (req.mode === 'navigate') {
    // La página: primero internet (máx. 4 s), si no, la última guardada.
    e.respondWith(
      Promise.race([fetch(req).then(guardar), new Promise((_, no) => setTimeout(no, 4000))])
        .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('./')))
    );
  } else {
    // Estilos, scripts, fuentes e íconos: lo guardado primero (cada versión lleva ?v=N distinto).
    e.respondWith(caches.match(req).then((r) => r || fetch(req).then(guardar)));
  }
});
