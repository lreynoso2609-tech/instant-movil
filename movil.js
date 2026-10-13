/* Instant móvil: entras con tu correo, pegas enlaces y se guardan en la lista (Supabase). La descarga la hace la nube.
   Sin librerías: habla directo con Supabase (login + tabla "cola"). */
const $ = (s) => document.querySelector(s);
const CFG = window.INSTANT || {};
const ES_ENLACE = /(tiktok\.com|instagram\.com|facebook\.com|fb\.watch|fb\.com)\//i;
const TEXTO = { pendiente: 'En espera', bajando: 'Descargando…', listo: 'Guardado ✓', error: 'No se pudo', duplicado: 'Ya lo tenías' };
let sesion = null, timer = null;

const guardar = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const leer = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function aviso(texto, mal) {
  const a = $('#aviso'); a.hidden = !texto; a.textContent = texto || ''; a.classList.toggle('mal', !!mal);
}

async function llamar(ruta, { metodo = 'GET', cuerpo, token } = {}) {
  const r = await fetch(CFG.url + ruta, {
    method: metodo,
    headers: { apikey: CFG.clave, Authorization: 'Bearer ' + (token || CFG.clave), 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const txt = await r.text(); let datos = null; try { datos = txt ? JSON.parse(txt) : null; } catch {}
  return { ok: r.ok, status: r.status, datos };
}

async function entrar(correo, clave) {
  const r = await llamar('/auth/v1/token?grant_type=password', { metodo: 'POST', cuerpo: { email: correo, password: clave } });
  if (!r.ok) return false;
  sesion = { token: r.datos.access_token, refresco: r.datos.refresh_token, vence: Date.now() + (r.datos.expires_in - 60) * 1000 };
  guardar('sesion', sesion); return true;
}
async function renovar() {
  if (!sesion) return false;
  if (Date.now() < sesion.vence) return true;
  const r = await llamar('/auth/v1/token?grant_type=refresh_token', { metodo: 'POST', cuerpo: { refresh_token: sesion.refresco } });
  if (!r.ok) { salir(); return false; }
  sesion = { token: r.datos.access_token, refresco: r.datos.refresh_token, vence: Date.now() + (r.datos.expires_in - 60) * 1000 };
  guardar('sesion', sesion); return true;
}
function salir() { sesion = null; guardar('sesion', null); clearInterval(timer); mostrar(); }

function mostrar() {
  $('#login').hidden = !!sesion; $('#panel').hidden = !sesion; $('#salir').hidden = !sesion; $('#app').dataset.vista = sesion ? 'panel' : 'login';
  if (sesion) { cargarLista(); clearInterval(timer); timer = setInterval(cargarLista, 6000); }
}

function hace(f) {
  const min = Math.max(0, Math.round((Date.now() - new Date(f)) / 60000));
  return min < 1 ? 'recién enviado' : min < 60 ? `enviado hace ${min} min` : `enviado hace ${Math.round(min / 60)} h`;
}
function itemHtml(x) {
  const pct = x.estado === 'bajando' ? +((/(\d+) %/.exec(x.mensaje || '') || [])[1] || 0) : null;
  const texto = x.estado === 'pendiente' ? `${hace(x.creado)} · la nube lo recoge en segundos` : (x.mensaje || '');
  const barra = x.estado === 'pendiente' || x.estado === 'bajando'
    ? `<div class="pg ${x.estado === 'pendiente' ? 'busca' : ''}" data-id="${x.id}" data-t="${pct ?? 0}" data-auto="${x.estado === 'pendiente' ? new Date(x.creado).getTime() : ''}"><div class="barra"><i></i>${x.estado === 'pendiente' ? '' : '<s class="cometa"></s>'}</div><b class="pg-n">0 %</b></div>` : '';
  return `<li class="item"><span class="en">${esc(x.enlace)}</span>
    <span class="estado"><span class="pill ${esc(x.estado)}">${TEXTO[x.estado] || esc(x.estado)}</span><span class="txt">${esc(texto)}</span></span>${barra}</li>`;
}

async function cargarLista() {
  if (!(await renovar())) return;
  const r = await llamar('/rest/v1/cola?select=id,enlace,estado,mensaje,creado&order=id.desc&limit=30', { token: sesion.token });
  if (!r.ok) return;
  $('#vacio').hidden = r.datos.length > 0;
  $('#lista').innerHTML = r.datos.map(itemHtml).join('');
}

function enlacesDe(texto) {
  return [...new Set((texto.match(/https?:\/\/[^\s]+/g) || []).map((u) => u.replace(/[)\].,;]+$/, '')).filter((u) => ES_ENLACE.test(u)))];
}

$('#formLogin').addEventListener('submit', async (e) => {
  e.preventDefault(); aviso('Entrando…');
  const ok = await entrar($('#correo').value.trim(), $('#clave').value).catch(() => null);
  if (ok === null) return aviso('No hay conexión. Revisa tu internet e inténtalo otra vez.', true);
  if (!ok) return aviso('Correo o contraseña incorrectos.', true);
  $('#clave').value = ''; aviso(''); mostrar();
});

// ¿Ya lo tienes? Se revisa aquí mismo, al instante, contra tu biblioteca y tus envíos anteriores (sin esperar a la nube).
const limpiar = (u) => u.toLowerCase().replace(/^https?:\/\/(www\.|m\.|web\.)?/, '').split(/[?#]/)[0].replace(/\/+$/, '');
function idDe(u) {
  let m;
  if ((m = /tiktok\.com\/.*\/(?:video|photo)\/(\d+)/i.exec(u))) return 'tiktok:' + m[1];
  if ((m = /instagram\.com\/(?:[^/]+\/)?(?:reels?|p|tv)\/([\w-]+)/i.exec(u))) return 'instagram:' + m[1];
  if ((m = /facebook\.com\/(?:.*\/)?(?:reel|videos?)\/(\d+)/i.exec(u)) || (m = /facebook\.com\/watch\/?\?.*\bv=(\d+)/i.exec(u))) return 'facebook:' + m[1];
  return null;
}
async function repetidos(lista) {
  const [b, c] = await Promise.all([
    llamar('/rest/v1/biblioteca?select=id,enlace,cuenta&limit=2000', { token: sesion.token }),
    llamar('/rest/v1/cola?select=enlace&estado=in.(listo,pendiente,bajando)&limit=1000', { token: sesion.token }),
  ]);
  const porId = new Map(), porEnlace = new Map();
  (b.ok ? b.datos : []).forEach((x) => { porId.set(x.id, x); if (x.enlace) porEnlace.set(limpiar(x.enlace), x); });
  const enviados = new Set((c.ok ? c.datos : []).map((x) => limpiar(x.enlace)));
  const rep = new Map();
  for (const u of lista) {
    const x = porId.get(idDe(u)) || porEnlace.get(limpiar(u));
    if (x) rep.set(u, x.cuenta ? `está en tu biblioteca (@${x.cuenta})` : 'está en tu biblioteca');
    else if (enviados.has(limpiar(u))) rep.set(u, 'ya lo enviaste antes');
  }
  return rep;
}

$('#formEnlaces').addEventListener('submit', async (e) => {
  e.preventDefault();
  const lista = enlacesDe($('#enlaces').value);
  if (!lista.length) return aviso('No encontré ningún enlace de TikTok, Instagram o Facebook. Pégalo completo, empezando con https://', true);
  const b = e.target.querySelector('button'); b.disabled = true;
  try {
    if (!(await renovar())) return;
    const rep = await repetidos(lista).catch(() => new Map());
    const nuevas = lista.filter((u) => !rep.has(u));
    const aviRep = [...rep.values()][0];
    if (!nuevas.length) { $('#enlaces').value = ''; return aviso(lista.length > 1 ? `Ya los tenías: los ${lista.length} enlaces ya estaban guardados.` : `Ya lo tenías: ${aviRep}. No hace falta mandarlo otra vez.`); }
    const r = await llamar('/rest/v1/cola', { metodo: 'POST', token: sesion.token, cuerpo: nuevas.map((enlace) => ({ enlace })) });
    if (!r.ok) return aviso('No se pudo guardar. Inténtalo de nuevo en un momento.', true);
    $('#enlaces').value = '';
    aviso(`Listo: ${nuevas.length} enlace${nuevas.length > 1 ? 's' : ''} en espera. Se descargan solos en unos minutos.` + (rep.size ? ` (${rep.size} ya lo tenías y no se mandó.)` : ''));
    cargarLista();
  } catch { aviso('No hay conexión. Revisa tu internet e inténtalo otra vez.', true); }
  finally { b.disabled = false; }
});
$('#salir').addEventListener('click', salir);

// Si llegas desde "Compartir → Instant" (Android con la app instalada), el enlace ya viene puesto.
const q = new URLSearchParams(location.search);
const compartido = [q.get('url'), q.get('text'), q.get('title')].filter(Boolean).join(' ');
const vienesDeCompartir = enlacesDe(compartido).length > 0;
if (compartido) { $('#enlaces').value = enlacesDe(compartido).join('\n') || compartido; history.replaceState(null, '', location.pathname); }

if (!CFG.url || !CFG.clave) { $('#login').hidden = true; $('#app').dataset.vista = 'login'; aviso('Falta configurar Supabase (archivo config.js).', true); }
else { sesion = leer('sesion'); mostrar(); }
// Si lo mandaste con "Compartir → Instant" y ya habías entrado, se guarda solo (sin pulsar nada).
if (sesion && vienesDeCompartir) $('#formEnlaces').requestSubmit();

// Barras con animación continua (igual que en la PC). Cada envío recuerda su valor mostrado para no retroceder al redibujar la lista.
const vistos = new Map(); let ultimoCuadro = performance.now();
function animarBarras(ahora) {
  const dt = Math.min(0.1, (ahora - ultimoCuadro) / 1000); ultimoCuadro = ahora;
  document.querySelectorAll('.pg[data-id]').forEach((b) => {
    const id = b.dataset.id, auto = +b.dataset.auto;
    // En espera: sube despacio hacia ~90 % según el tiempo desde que lo enviaste; descargando: el % real.
    // El avance real llega a saltos (cada ~4 s): entre avisos la barra sigue avanzando despacio, y los saltos se recorren poco a poco (1, 2, 3…).
    const real = +b.dataset.t || 0, ahoraMs = Date.now();
    if (b._real !== real) { b._real = real; b._cambio = ahoraMs; }
    const meta = auto ? 90 * (1 - Math.exp(-(ahoraMs - auto) / 45000)) : Math.min(99, real + Math.min(12, (ahoraMs - b._cambio) / 1000 * 1.2));
    let v = vistos.has(id) ? vistos.get(id) : 0;
    const paso = Math.min(10, Math.max(0.6, Math.abs(meta - v) * 0.5)) * dt; // velocidad limitada (máx. 10 % por segundo): nunca salta de golpe
    v = v < meta ? Math.min(meta, v + paso) : meta;
    vistos.set(id, v);
    b.querySelector('i').style.transform = 'scaleX(' + v / 100 + ')';
    const c = b.querySelector('.cometa'); if (c) { c.style.left = v + '%'; b.classList.toggle('llego', v >= 99.5); }
    const n = Math.round(v) + ' %', el = b.querySelector('.pg-n'); if (el.textContent !== n) el.textContent = n;
  });
  requestAnimationFrame(animarBarras);
}
requestAnimationFrame(animarBarras);
