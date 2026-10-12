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
  const texto = x.estado === 'pendiente' ? `${hace(x.creado)} · la nube lo recoge en unos minutos` : (x.mensaje || '');
  const barra = x.estado === 'pendiente' ? '<div class="barra espera"><i></i></div>'
    : x.estado === 'bajando' ? `<div class="barra"><i style="width:${Math.max(4, pct)}%"></i></div>` : '';
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

$('#formEnlaces').addEventListener('submit', async (e) => {
  e.preventDefault();
  const lista = enlacesDe($('#enlaces').value);
  if (!lista.length) return aviso('No encontré ningún enlace de TikTok, Instagram o Facebook. Pégalo completo, empezando con https://', true);
  const b = e.target.querySelector('button'); b.disabled = true;
  try {
    if (!(await renovar())) return;
    const r = await llamar('/rest/v1/cola', { metodo: 'POST', token: sesion.token, cuerpo: lista.map((enlace) => ({ enlace })) });
    if (!r.ok) return aviso('No se pudo guardar. Inténtalo de nuevo en un momento.', true);
    $('#enlaces').value = ''; aviso(`Listo: ${lista.length} enlace${lista.length > 1 ? 's' : ''} en espera. Se descargan solos en unos minutos.`);
    cargarLista();
  } catch { aviso('No hay conexión. Revisa tu internet e inténtalo otra vez.', true); }
  finally { b.disabled = false; }
});
$('#salir').addEventListener('click', salir);

// Si llegas desde "Compartir → Instant" (Android con la app instalada), el enlace ya viene puesto.
const q = new URLSearchParams(location.search);
const compartido = [q.get('url'), q.get('text'), q.get('title')].filter(Boolean).join(' ');
if (compartido) { $('#enlaces').value = enlacesDe(compartido).join('\n') || compartido; history.replaceState(null, '', location.pathname); }

if (!CFG.url || !CFG.clave) { $('#login').hidden = true; $('#app').dataset.vista = 'login'; aviso('Falta configurar Supabase (archivo config.js).', true); }
else { sesion = leer('sesion'); mostrar(); }
