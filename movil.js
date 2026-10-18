/* Instant móvil: entras con tu correo, pegas enlaces y se guardan en la lista (Supabase). La descarga la hace la nube.
   Sin librerías: habla directo con Supabase (login + tabla "cola"). */
const $ = (s) => document.querySelector(s);
const CFG = window.INSTANT || {};
const ES_ENLACE = /(tiktok\.com|instagram\.com|facebook\.com|fb\.watch|fb\.com)\//i;
const TEXTO = { pendiente: 'En espera', bajando: 'Descargando…', listo: 'Guardado ✓', error: 'No se pudo', duplicado: 'Ya lo tenías' };
let sesion = null, timer = null, proximo = 6000, ultimoHtml = '', listosAntes = null;

// "Guardar inicio rápido": marcado, la sesión queda en el teléfono; sin marcar, se olvida al cerrar la app.
let rapido = true;
const guardar = (k, v) => { try { const s = k === 'sesion' && !rapido ? sessionStorage : localStorage; v == null ? (localStorage.removeItem(k), sessionStorage.removeItem(k)) : s.setItem(k, JSON.stringify(v)); } catch {} };
const leer = (k) => { try { return JSON.parse(localStorage.getItem(k) ?? sessionStorage.getItem(k)); } catch { return null; } };
rapido = leer('rapido') !== false;
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// El aviso flota abajo (zona del pulgar) para verse siempre; los buenos se van solos, los errores se quedan hasta tocarlos.
let avisoT;
function aviso(texto, mal) {
  const a = $('#aviso'); a.hidden = !texto; a.textContent = texto || ''; a.classList.toggle('mal', !!mal);
  clearTimeout(avisoT); if (texto && !mal) avisoT = setTimeout(() => { a.hidden = true; }, 8000);
}
$('#aviso').addEventListener('click', () => aviso(''));

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
  const r = await llamar('/auth/v1/token?grant_type=refresh_token', { metodo: 'POST', cuerpo: { refresh_token: sesion.refresco } }).catch(() => null);
  if (!r) { hayRed(false); return false; } // sin internet: no te saca de tu cuenta
  if (!r.ok) { if (r.status >= 500) return false; salir('Tu sesión venció. Entra otra vez para seguir.'); return false; }
  sesion = { token: r.datos.access_token, refresco: r.datos.refresh_token, vence: Date.now() + (r.datos.expires_in - 60) * 1000 };
  guardar('sesion', sesion); return true;
}
function salir(motivo) { listosAntes = null; sesion = null; guardar('sesion', null); clearTimeout(timer); ultimoHtml = ''; mostrar(); aviso(motivo || '', true); }
// Franja "sin conexión": se muestra cuando falla internet y se quita sola al volver.
function hayRed(si) { $('#sinRed').hidden = si; }
window.addEventListener('offline', () => hayRed(false));
window.addEventListener('online', () => { hayRed(true); if (sesion) cargarLista(); });

function mostrar() {
  $('#login').hidden = !!sesion; $('#panel').hidden = !sesion; $('#salir').hidden = !sesion; $('#app').dataset.vista = sesion ? 'panel' : 'login';
  if (sesion) { cargarLista(); ciclo(); }
}

// Revisa los envíos cada 5 s si hay algo en proceso, cada 20 s si no, y nada mientras la app está en segundo plano.
function ciclo() {
  clearTimeout(timer);
  timer = setTimeout(async () => { if (!sesion) return; if (!document.hidden) await cargarLista(); ciclo(); }, proximo);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && sesion) cargarLista(); });

function hace(f) {
  const min = Math.max(0, Math.round((Date.now() - new Date(f)) / 60000));
  return min < 1 ? 'recién enviado' : min < 60 ? `enviado hace ${min} min` : `enviado hace ${Math.round(min / 60)} h`;
}
// "TikTok · @cuenta" en vez de la dirección larga (la dirección queda abajo, pequeña).
function nombreEnlace(u) {
  const red = /tiktok/i.test(u) ? 'TikTok' : /instagram/i.test(u) ? 'Instagram' : /facebook|fb\./i.test(u) ? 'Facebook' : 'Enlace';
  const c = /tiktok\.com\/(@[^/?]+)/i.exec(u);
  return c ? `${red} · ${c[1]}` : red;
}
function itemHtml(x) {
  const pct = x.estado === 'bajando' ? +((/(\d+) %/.exec(x.mensaje || '') || [])[1] || 0) : null;
  const texto = x.estado === 'pendiente' ? `${hace(x.creado)} · la nube lo recoge en segundos`
    : x.estado === 'error' ? `${x.mensaje || 'No se pudo.'} Si falla otra vez, bájalo desde la PC.` : (x.mensaje || '');
  const barra = x.estado === 'pendiente' || x.estado === 'bajando'
    ? `<div class="pg ${x.estado === 'pendiente' ? 'busca' : ''}" data-id="${x.id}" data-t="${pct ?? 0}" data-auto="${x.estado === 'pendiente' ? new Date(x.creado).getTime() : ''}"><div class="barra"><i></i>${x.estado === 'pendiente' ? '' : '<s class="cometa"></s>'}</div><b class="pg-n">0 %</b></div>` : '';
  return `<li class="item"><span class="en"><b>${esc(nombreEnlace(x.enlace))}</b><small>${esc(x.enlace)}</small></span>
    <span class="estado"><span class="pill ${esc(x.estado)}">${TEXTO[x.estado] || esc(x.estado)}</span><span class="txt">${esc(texto)}</span></span>${barra}${x.estado === 'error' ? `<button type="button" class="reint" data-enlace="${esc(x.enlace)}">Reintentar</button>` : ''}</li>`;
}

async function cargarLista() {
  if (!(await renovar())) return;
  const r = await llamar('/rest/v1/cola?select=id,enlace,estado,mensaje,creado&order=id.desc&limit=30', { token: sesion.token }).catch(() => null);
  if (!r) return hayRed(false);
  hayRed(true);
  if (!r.ok) return;
  const enProceso = r.datos.filter((x) => x.estado === 'pendiente' || x.estado === 'bajando').length;
  proximo = enProceso ? 5000 : 20000;
  const n = $('#nEnv'); n.hidden = !enProceso; n.textContent = enProceso; n.setAttribute('aria-label', enProceso + ' en proceso');
  // Aviso cuando algo termina de guardarse (se ve en cualquier pestaña).
  const listos = new Set(r.datos.filter((x) => x.estado === 'listo').map((x) => x.id));
  if (listosAntes) { const nuevos = [...listos].filter((id) => !listosAntes.has(id)).length; if (nuevos) aviso(nuevos > 1 ? `Ya se guardaron ${nuevos} videos en tu biblioteca ✓` : 'Ya se guardó un video en tu biblioteca ✓'); }
  listosAntes = listos;
  $('#vacio').hidden = r.datos.length > 0;
  const html = r.datos.map(itemHtml).join('');
  if (html !== ultimoHtml) { $('#lista').innerHTML = html; ultimoHtml = html; } // solo se redibuja si algo cambió
}

function enlacesDe(texto) {
  return [...new Set((texto.match(/https?:\/\/[^\s]+/g) || []).map((u) => u.replace(/[)\].,;]+$/, '')).filter((u) => ES_ENLACE.test(u)))];
}

$('#formLogin').addEventListener('submit', async (e) => {
  e.preventDefault(); aviso('');
  let usuario = $('#correo').value.trim(); if (!usuario.includes('@')) usuario += '@instant.com'; // basta con escribir el usuario
  rapido = $('#rapido').checked; guardar('rapido', rapido);
  const b = $('#entrar'); b.classList.add('cargando'); b.disabled = true; b.textContent = 'Entrando…';
  const ok = await entrar(usuario, $('#clave').value).catch(() => null);
  b.classList.remove('cargando'); b.disabled = false; b.textContent = 'Entrar';
  if (ok === null) return aviso('No hay conexión. Revisa tu internet e inténtalo otra vez.', true);
  if (!ok) return aviso('Usuario o contraseña incorrectos. Toca el ojo para ver lo que escribiste.', true);
  guardar('usuario', rapido ? $('#correo').value.trim() : null);
  $('#clave').value = ''; aviso(''); mostrar();
});
// El usuario se recuerda si dejaste marcado "Guardar inicio rápido".
$('#rapido').checked = rapido; { const u = leer('usuario'); if (u && rapido) $('#correo').value = u; }
$('#ojo').addEventListener('click', (e) => {
  const ver = $('#clave').type === 'password'; $('#clave').type = ver ? 'text' : 'password';
  e.currentTarget.setAttribute('aria-pressed', String(ver)); e.currentTarget.setAttribute('aria-label', ver ? 'Ocultar contraseña' : 'Mostrar contraseña');
});

// Botón de pegar: lee lo que copiaste, lo pone y lo guarda (sin mantener pulsado ni elegir "Pegar").
$('#pegar').addEventListener('click', async () => {
  let t = '';
  try { t = await navigator.clipboard.readText(); } catch { return aviso('No pude leer lo copiado. Permite "Pegar" cuando el teléfono lo pida, o mantén pulsado el cuadro y elige Pegar.', true); }
  const l = enlacesDe(t);
  if (!l.length) return aviso('No hay ningún enlace de TikTok, Instagram o Facebook copiado. Copia el enlace del video y vuelve a tocar este botón.', true);
  $('#enlaces').value = l.join('\n'); $('#formEnlaces').requestSubmit();
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
// "Reintentar": vuelve a mandar el enlace que falló (si ya está en tu biblioteca, te lo dice).
$('#lista').addEventListener('click', async (e) => {
  const b = e.target.closest('.reint'); if (!b) return;
  b.disabled = true; b.textContent = 'Enviando…';
  try {
    if (!(await renovar())) return;
    const rep = await repetidos([b.dataset.enlace]).catch(() => new Map());
    if (rep.size) { aviso(`Ya lo tenías: ${[...rep.values()][0]}.`); return; }
    const r = await llamar('/rest/v1/cola', { metodo: 'POST', token: sesion.token, cuerpo: [{ enlace: b.dataset.enlace }] });
    if (!r.ok) throw 0;
    aviso('Listo: lo mandé otra vez. Se descarga solo en unos minutos.'); cargarLista();
  } catch { aviso('No se pudo reenviar. Revisa tu internet e inténtalo de nuevo.', true); }
  finally { b.disabled = false; b.textContent = 'Reintentar'; }
});
$('#salir').addEventListener('click', () => { if (confirm('¿Cerrar la sesión? Tendrás que volver a entrar.')) salir(); });

// Si llegas desde "Compartir → Instant" (Android con la app instalada), el enlace ya viene puesto.
const q = new URLSearchParams(location.search);
const compartido = [q.get('url'), q.get('text'), q.get('title')].filter(Boolean).join(' ');
const vienesDeCompartir = enlacesDe(compartido).length > 0;
if (compartido) { $('#enlaces').value = enlacesDe(compartido).join('\n') || compartido; history.replaceState(null, '', location.pathname); }

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {}); // permite abrir la app sin internet

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
