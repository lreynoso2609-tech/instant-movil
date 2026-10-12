// Instant nube: lee la lista de enlaces (Supabase), descarga y sube a Google Drive ("Instant nube").
// Corre en GitHub Actions. El repo es PÚBLICO: aquí NUNCA se imprimen enlaces, cuentas ni claves (solo conteos).
// Uso: node nube/procesar.js --revisar   (solo avisa si hay pendientes)   |   node nube/procesar.js
const { spawnSync, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const E = process.env;
const faltan = ['SUPABASE_URL', 'SUPABASE_KEY', 'INSTANT_EMAIL', 'INSTANT_PASSWORD', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN']
  .filter((k) => !E[k]);
if (faltan.length) { console.log('Faltan Secrets: ' + faltan.join(', ')); process.exit(1); }

// ---------- Supabase ----------
let jwt = '';
async function sb(ruta, { metodo = 'GET', cuerpo } = {}) {
  const r = await fetch(E.SUPABASE_URL + ruta, {
    method: metodo,
    headers: { apikey: E.SUPABASE_KEY, Authorization: 'Bearer ' + (jwt || E.SUPABASE_KEY), 'Content-Type': 'application/json' },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  if (!r.ok) throw new Error('Supabase respondió ' + r.status);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}
async function entrar() {
  const r = await fetch(E.SUPABASE_URL + '/auth/v1/token?grant_type=password', {
    method: 'POST', headers: { apikey: E.SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: E.INSTANT_EMAIL, password: E.INSTANT_PASSWORD }),
  });
  if (!r.ok) throw new Error('No se pudo iniciar sesión en Supabase (' + r.status + '). Revisa INSTANT_EMAIL e INSTANT_PASSWORD.');
  jwt = (await r.json()).access_token;
}
const marcar = (id, estado, mensaje) => sb('/rest/v1/cola?id=eq.' + id, {
  metodo: 'PATCH', cuerpo: { estado, mensaje: mensaje || null, actualizado: new Date().toISOString() },
});

// ---------- Google Drive ----------
let token = '';
async function tokenGoogle() {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: E.GOOGLE_CLIENT_ID, client_secret: E.GOOGLE_CLIENT_SECRET,
      refresh_token: E.GOOGLE_REFRESH_TOKEN, grant_type: 'refresh_token',
    }),
  });
  if (!r.ok) throw new Error('Google no aceptó el permiso guardado (' + r.status + '). Hay que repetir la autorización.');
  token = (await r.json()).access_token;
}
async function drive(url, opciones = {}) {
  const r = await fetch(url, { ...opciones, headers: { Authorization: 'Bearer ' + token, ...(opciones.headers || {}) } });
  if (!r.ok) throw new Error('Drive respondió ' + r.status);
  return r;
}
const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
async function buscarCarpeta(nombre, padre, contiene = false) {
  const q = `mimeType='application/vnd.google-apps.folder' and trashed=false and name ${contiene ? 'contains' : '='} '${esc(nombre)}'` +
    (padre ? ` and '${padre}' in parents` : '');
  const r = await drive('https://www.googleapis.com/drive/v3/files?fields=files(id,name)&pageSize=10&q=' + encodeURIComponent(q));
  return (await r.json()).files[0] || null;
}
async function carpeta(nombre, padre) {
  const hay = await buscarCarpeta(nombre, padre);
  if (hay) return hay.id;
  const r = await drive('https://www.googleapis.com/drive/v3/files?fields=id', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: nombre, mimeType: 'application/vnd.google-apps.folder', ...(padre ? { parents: [padre] } : {}) }),
  });
  return (await r.json()).id;
}
async function subir(archivo, padre) {
  const datos = fs.readFileSync(archivo);
  const ini = await drive('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id', {
    method: 'POST', headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({ name: path.basename(archivo), parents: [padre] }),
  });
  await drive(ini.headers.get('location'), { method: 'PUT', body: datos });
}
async function subirArbol(dir, padre) {
  for (const n of fs.readdirSync(dir)) {
    const p = path.join(dir, n);
    if (fs.statSync(p).isDirectory()) await subirArbol(p, await carpeta(n, padre));
    else await subir(p, padre);
  }
}

// ---------- Descarga ----------
const red = (u) => (/tiktok\.com/i.test(u) ? 'tiktok' : /instagram\.com/i.test(u) ? 'instagram' : /facebook\.com|fb\.watch/i.test(u) ? 'facebook' : null);

async function resolver(u) { // enlaces cortos de TikTok (vt/vm) -> enlace largo
  if (!/\/\/(vt|vm)\.tiktok\.com\//i.test(u)) return u;
  try { const r = await fetch(u, { redirect: 'follow' }); return r.url.split('?')[0] || u; } catch { return u; }
}
function explicar(r, texto) {
  const t = texto.toLowerCase();
  if (/login|private|privad|sign in|cookies/.test(t)) return 'Este contenido no es público (pide iniciar sesión). Instant solo guarda contenido público.';
  if (/unsupported url|no video|no media/.test(t)) return 'El enlace no tiene un video descargable. Los carruseles de fotos todavía no se bajan desde el celular.';
  if (/404|not found|unavailable|removed/.test(t)) return 'La publicación ya no existe o fue borrada.';
  if (/429|403|blocked|rate.?limit|too many/.test(t)) return r + ' bloqueó a la nube por un momento. Prueba más tarde o bájalo desde la PC.';
  return 'No se pudo descargar este enlace desde la nube.';
}
const yt = (args) => spawnSync('yt-dlp', args, { encoding: 'utf8', maxBuffer: 1 << 26 });
// yt-dlp sin bloquear, leyendo su porcentaje (la salida NO se imprime: puede traer enlaces).
function ytAvance(args, alPct) {
  return new Promise((ok) => {
    const h = spawn('yt-dlp', args);
    let salida = '', resto = '';
    const leer = (d) => { salida += d; resto += d; const ls = resto.split(/\r?\n|\r/); resto = ls.pop(); ls.forEach(alPct); };
    h.stdout.on('data', leer); h.stderr.on('data', (d) => { salida += d; });
    h.on('close', (status) => ok({ status, stdout: salida, stderr: '' }));
    h.on('error', () => ok({ status: 1, stdout: '', stderr: 'no se pudo abrir yt-dlp' }));
  });
}
const hayMp4 = (x) => fs.readdirSync(x).some((n) => {
  const p = path.join(x, n);
  return fs.statSync(p).isDirectory() ? hayMp4(p) : n.endsWith('.mp4');
});

async function procesar(fila) {
  let ultimo = 0, mayor = 5;
  const avance = (pct, texto) => { // se guarda en la lista cada ~4 s para que el celular lo muestre
    if (Date.now() - ultimo < 4000) return;
    ultimo = Date.now();
    return marcar(fila.id, 'bajando', `${texto} ${Math.round(pct)} %`).catch(() => {});
  };
  const url = await resolver(String(fila.enlace).trim());
  const r = red(url);
  if (!r) return ['error', 'Enlace no reconocido. Instant acepta TikTok, Instagram y Facebook.'];

  const q = yt(['--no-playlist', '--skip-download', '--print', '%(id)s', url]);
  const id = (q.stdout || '').trim().split('\n')[0];
  if (q.status !== 0 || !id) return ['error', explicar(r, (q.stderr || '') + (q.stdout || ''))];

  // ¿Ya se bajó antes? (la carpeta de la publicación termina en _<id>)
  if (await buscarCarpeta('_' + id, null, true)) return ['duplicado', 'Ya lo tenías: este video ya se había enviado antes desde el celular.'];

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'instant-'));
  try {
    const plantilla = path.join(tmp, r, '%(uploader,channel,uploader_id|desconocido)s', '%(upload_date|0000)s_%(id)s', '%(id)s.%(ext)s');
    await avance(5, 'Descargando…');
    let flujo = 0, dos = false;
    const d = await ytAvance(['--no-playlist', '-f', 'bv*+ba/b', '--merge-output-format', 'mp4', '--write-info-json', '--write-thumbnail',
      '--convert-thumbnails', 'jpg', '--windows-filenames', '--trim-filenames', '120', '--quiet', '--progress', '--newline', '--no-warnings', '-o', plantilla, url], (l) => {
      if (/^\[download\] Destination:/.test(l)) flujo++;
      const fm = /Downloading \d+ format\(s\): (.+)/.exec(l); if (fm) dos = fm[1].includes('+');
      const m = /^\[download\]\s+([\d.]+)%/.exec(l);
      if (m) { // video y audio por separado: cada uno es la mitad de la barra (hasta el 80 %)
        const parte = dos ? (flujo >= 2 ? 50 : 0) + +m[1] / 2 : +m[1];
        mayor = Math.max(mayor, 5 + parte * 0.75);
        avance(Math.min(mayor, 80), 'Descargando…');
      }
    });
    if (d.status !== 0) return ['error', explicar(r, (d.stderr || '') + (d.stdout || ''))];
    if (!hayMp4(tmp)) return ['error', 'El enlace no tiene un video descargable. Los carruseles de fotos todavía no se bajan desde el celular.'];
    ultimo = 0; await avance(85, 'Subiendo a tu Drive…');
    await subirArbol(tmp, await carpeta('Instant nube', null));
    return ['listo', 'Guardado en "Instant nube". La PC lo traerá a tu biblioteca.'];
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

async function main() {
  await entrar();
  // Si una corrida anterior se cortó, sus filas quedaron "bajando": se devuelven a la lista tras 30 min.
  const viejo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  await sb('/rest/v1/cola?estado=eq.bajando&actualizado=lt.' + encodeURIComponent(viejo), { metodo: 'PATCH', cuerpo: { estado: 'pendiente' } });
  const filas = await sb('/rest/v1/cola?estado=eq.pendiente&order=id&limit=10');

  if (process.argv.includes('--revisar')) {
    if (E.GITHUB_OUTPUT) fs.appendFileSync(E.GITHUB_OUTPUT, 'hay=' + (filas.length > 0) + '\n');
    console.log('Pendientes: ' + filas.length);
    return;
  }
  if (!filas.length) { console.log('Nada pendiente.'); return; }
  await tokenGoogle();
  let listos = 0, errores = 0;
  for (const f of filas) {
    await marcar(f.id, 'bajando');
    try {
      const [estado, mensaje] = await procesar(f);
      await marcar(f.id, estado, mensaje);
      if (estado === 'error') errores++; else listos++;
    } catch (e) {
      await marcar(f.id, 'error', 'Falló en la nube: ' + String(e.message).slice(0, 120));
      errores++;
    }
  }
  console.log(`Procesados: ${listos} bien, ${errores} con error.`);
}
main().catch((e) => { console.log('Error: ' + e.message); process.exit(1); });
