/* Instant móvil · pestaña "Biblioteca" (solo lectura). Los datos los sube la PC (sincronizar-movil.js) a la tabla "biblioteca".
   Usa llamar(), renovar() y sesion de movil.js. */
const REDES = { tiktok: 'TikTok', instagram: 'Instagram', facebook: 'Facebook' };
let todas = [], cargada = false, firma = '';
const portadas = new Map(); // portadas ya bajadas (no se vuelven a pedir)
const COLUMNAS = 'id,red,cuenta,enlace,copy,hook,etiquetas,coleccion,estado,favorito,vistas,likes,comentarios,compartidos,guardados,duracion,fecha_publicacion,descargado,sonido,audio';
const LOGO_DRIVE = '<svg viewBox="0 0 87.3 78" width="20" height="18" aria-hidden="true"><path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/><path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0-1.2 4.5h27.5z" fill="#00ac47"/><path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.5l5.85 11.5z" fill="#ea4335"/><path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d"/><path d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc"/><path d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00"/></svg>';

const fmt = (n) => n == null ? '–' : n >= 1e6 ? (n / 1e6).toFixed(1).replace('.0', '') + ' M' : n >= 1e3 ? (n / 1e3).toFixed(1).replace('.0', '') + ' mil' : String(n);
const fechaTxt = (f) => /^\d{8}$/.test(f || '') ? `${f.slice(6)}/${f.slice(4, 6)}/${f.slice(0, 4)}` : '';

function pestana(nombre) {
  $('#vistaEnviar').hidden = nombre !== 'enviar';
  $('#vistaBib').hidden = nombre !== 'biblioteca';
  document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === nombre)));
  guardar('pestana', nombre); // al recargar, vuelve a la pestaña donde estabas
  clearInterval(refrescoBib);
  if (nombre === 'biblioteca') { cargarBiblioteca(); refrescoBib = setInterval(() => { if (!document.hidden) cargarBiblioteca(); }, 120000); } // revisa si hay algo nuevo (no baja nada si no cambió)
}
let refrescoBib = null;

// Primero una consulta liviana ("¿cambió algo?"). Solo si cambió se bajan las fichas, y las portadas (lo más pesado) solo las que faltan.
async function cargarBiblioteca() {
  if (!(await renovar())) return;
  if (!cargada) { $('#bibEstado').hidden = false; $('#bibEstado').textContent = 'Cargando tu biblioteca…'; }
  const lig = await llamar('/rest/v1/biblioteca?select=id,estado,favorito,coleccion,vistas,audio,descargado&order=descargado.desc&limit=2000', { token: sesion.token }).catch(() => null);
  if (!lig) { hayRed(false); if (!cargada) $('#bibEstado').textContent = 'Sin conexión. Revisa tu internet y toca "Biblioteca" otra vez.'; return; }
  hayRed(true);
  if (!lig.ok) {
    $('#bibEstado').textContent = lig.status === 404
      ? 'Todavía no hay biblioteca en el celular. En la PC abre Instant → Más → "Actualizar celular".'
      : 'No se pudo cargar. Revisa tu internet y toca "Biblioteca" otra vez.';
    return;
  }
  const nueva = JSON.stringify(lig.datos);
  if (cargada && nueva === firma) return;
  const r = await llamar('/rest/v1/biblioteca?select=' + COLUMNAS + '&order=descargado.desc&limit=2000', { token: sesion.token }).catch(() => null);
  if (!r || !r.ok) return;
  firma = nueva; cargada = true;
  todas = r.datos.map((x) => ({ ...x, portada: portadas.get(x.id) || '' }));
  llenarFiltros(); pintar();
  traerPortadas();
}
async function traerPortadas() {
  const faltan = todas.filter((x) => !portadas.has(x.id)).map((x) => x.id);
  for (let i = 0; i < faltan.length; i += 30) {
    const lote = faltan.slice(i, i + 30);
    const r = await llamar('/rest/v1/biblioteca?select=id,portada&id=in.(' + lote.map(encodeURIComponent).join(',') + ')', { token: sesion.token }).catch(() => null);
    if (!r || !r.ok) return;
    for (const p of r.datos) {
      portadas.set(p.id, p.portada || '');
      const x = todas.find((y) => y.id === p.id); if (x) x.portada = p.portada || '';
      const foto = p.portada && $('#rejilla .tarjeta[data-id="' + CSS.escape(p.id) + '"] .foto');
      if (foto && !foto.querySelector('img')) foto.insertAdjacentHTML('afterbegin', '<img src="' + esc(p.portada) + '" alt="" loading="lazy">');
    }
  }
}

function llenarFiltros() {
  const opciones = (sel, valores, todo) => {
    const actual = sel.value;
    sel.innerHTML = `<option value="">${todo}</option>` + [...new Set(valores.filter(Boolean))].sort().map((v) => `<option>${esc(v)}</option>`).join('');
    sel.value = actual;
  };
  opciones($('#fEstado'), todas.map((x) => x.estado), 'Todos los estados');
  opciones($('#fColeccion'), todas.map((x) => x.coleccion), 'Todas las marcas');
  const redes = [...new Set(todas.map((x) => x.red))];
  $('#fRed').innerHTML = '<option value="">Todas las redes</option>' + redes.map((x) => `<option value="${esc(x)}">${esc(REDES[x] || x)}</option>`).join('');
}

function filtradas() {
  const q = $('#buscar').value.trim().toLowerCase(), est = $('#fEstado').value, red = $('#fRed').value, col = $('#fColeccion').value, fav = $('#fFav').getAttribute('aria-pressed') === 'true';
  return todas.filter((x) =>
    (!est || x.estado === est) && (!red || x.red === red) && (!col || x.coleccion === col) && (!fav || x.favorito) &&
    (!q || [x.cuenta, x.copy, x.hook, x.coleccion, x.sonido, ...(x.etiquetas || [])].join(' ').toLowerCase().includes(q)));
}

function pintar() {
  const l = filtradas();
  $('#bibEstado').hidden = l.length > 0;
  $('#bibEstado').textContent = todas.length ? 'Nada coincide con tu búsqueda. Prueba quitar algún filtro.' : 'Tu biblioteca está vacía.';
  $('#bibCuenta').textContent = todas.length ? `${l.length} de ${todas.length}` : '';
  $('#rejilla').innerHTML = l.map((x) => `<li><button class="tarjeta" data-id="${esc(x.id)}">
    <span class="foto">${x.portada ? `<img src="${esc(x.portada)}" alt="" loading="lazy">` : ''}<em class="r-${esc(x.red)}">${esc(REDES[x.red] || x.red)}</em>${x.favorito ? '<b aria-label="Favorito">★</b>' : ''}</span>
    <span class="cuenta">@${esc(x.cuenta || '')}</span><span class="gancho">${esc(x.hook || x.copy || '')}</span>
    ${x.vistas ? `<span class="vistas">${fmt(x.vistas)} vistas</span>` : ''}</button></li>`).join('');
}

function ficha(id) {
  const x = todas.find((y) => y.id === id); if (!x) return;
  const met = [['Vistas', x.vistas], ['Likes', x.likes], ['Comentarios', x.comentarios], ['Compartidos', x.compartidos], ['Guardados', x.guardados]]
    .filter((m) => m[1] != null).map((m) => `<div><b>${fmt(m[1])}</b><span>${m[0]}</span></div>`).join('');
  const datos = [x.coleccion && `Marca: ${x.coleccion}`, x.estado, x.duracion && `${x.duracion} s`, fechaTxt(x.fecha_publicacion)].filter(Boolean).map(esc).join(' · ');
  $('#fichaCuerpo').innerHTML = `
    ${x.portada ? `<img class="fichaImg" src="${esc(x.portada)}" alt="">` : ''}
    <h3>@${esc(x.cuenta || '')} <small>${esc(REDES[x.red] || x.red)}</small></h3>
    <p class="soft">${datos}</p>
    ${x.hook ? `<h4>Gancho</h4><p>${esc(x.hook)}</p>` : ''}
    <div class="metricas">${met}</div>
    ${(x.etiquetas || []).length ? `<div class="chips">${x.etiquetas.map((t) => `<span>${esc(t)}</span>`).join('')}</div>` : ''}
    ${x.copy ? `<h4>Texto original</h4><p class="copy">${esc(x.copy)}</p>` : ''}
    ${x.sonido ? `<p class="soft">♪ ${esc(x.sonido)}</p>` : ''}
    ${x.audio ? `<button type="button" class="btnAudio" data-ruta="${esc(x.audio)}">♪ Escuchar la pista de audio</button><div class="cajaAudio"></div>` : ''}
    ${/^https:\/\//.test(x.enlace || '') ? `<a class="btn" href="${esc(x.enlace)}" target="_blank" rel="noopener noreferrer">Ver original</a>` : ''}
    <a class="enlaceChico" href="https://drive.google.com/drive/search?q=${encodeURIComponent(String(x.id).split(':')[1] || '')}" target="_blank" rel="noopener noreferrer">${LOGO_DRIVE}<span>Ver en Drive</span></a>
    <p class="soft nota">${x.estado === 'En la nube' ? 'El video está en tu Drive (carpeta "Instant nube"). Aquí solo se ve la ficha.' : 'El video completo está en tu PC (Instant). Aquí solo se ve la ficha.'}</p>`;
  $('#ficha').hidden = false; document.body.style.overflow = 'hidden'; $('#fichaCerrar').focus();
}
// La pista de audio se baja solo al tocar el botón (privada: solo con tu sesión).
$('#fichaCuerpo').addEventListener('click', async (e) => {
  const btn = e.target.closest('.btnAudio'); if (!btn) return;
  const caja = btn.nextElementSibling; btn.disabled = true; btn.textContent = 'Cargando audio…';
  try {
    if (!(await renovar())) throw 0;
    const r = await fetch(CFG.url + '/storage/v1/object/authenticated/audios/' + encodeURIComponent(btn.dataset.ruta), { headers: { apikey: CFG.clave, Authorization: 'Bearer ' + sesion.token } });
    if (!r.ok) throw 0;
    caja.innerHTML = `<audio controls autoplay src="${URL.createObjectURL(await r.blob())}"></audio>`; btn.hidden = true;
  } catch { btn.disabled = false; btn.textContent = 'No se pudo cargar. Toca para reintentar'; }
});
function cerrarFicha() { $('#ficha').hidden = true; document.body.style.overflow = ''; }

document.addEventListener('visibilitychange', () => { if (!document.hidden && sesion && !$('#vistaBib').hidden) cargarBiblioteca(); });
document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => pestana(b.dataset.tab)));
['buscar', 'fEstado', 'fRed', 'fColeccion'].forEach((id) => $('#' + id).addEventListener('input', pintar));
$('#fFav').addEventListener('click', (e) => { e.currentTarget.setAttribute('aria-pressed', String(e.currentTarget.getAttribute('aria-pressed') !== 'true')); pintar(); });
$('#rejilla').addEventListener('click', (e) => { const t = e.target.closest('.tarjeta'); if (t) ficha(t.dataset.id); });
$('#fichaCerrar').addEventListener('click', cerrarFicha);
$('#ficha').addEventListener('click', (e) => { if (e.target.id === 'ficha') cerrarFicha(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#ficha').hidden) cerrarFicha(); });

// Al abrir o recargar la página, vuelve a la pestaña que estabas viendo.
if (sesion && !vienesDeCompartir && leer("pestana") === "biblioteca") pestana("biblioteca");
