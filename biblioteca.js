/* Instant móvil · pestaña "Biblioteca" (solo lectura). Los datos los sube la PC (sincronizar-movil.js) a la tabla "biblioteca".
   Usa llamar(), renovar() y sesion de movil.js. */
const REDES = { tiktok: 'TikTok', instagram: 'Instagram', facebook: 'Facebook' };
let todas = [], cargada = false;

const fmt = (n) => n == null ? '–' : n >= 1e6 ? (n / 1e6).toFixed(1).replace('.0', '') + ' M' : n >= 1e3 ? (n / 1e3).toFixed(1).replace('.0', '') + ' mil' : String(n);
const fechaTxt = (f) => /^\d{8}$/.test(f || '') ? `${f.slice(6)}/${f.slice(4, 6)}/${f.slice(0, 4)}` : '';

function pestana(nombre) {
  $('#vistaEnviar').hidden = nombre !== 'enviar';
  $('#vistaBib').hidden = nombre !== 'biblioteca';
  document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === nombre)));
  guardar('pestana', nombre); // al recargar, vuelve a la pestaña donde estabas
  clearInterval(refrescoBib);
  if (nombre === 'biblioteca') { cargarBiblioteca(); refrescoBib = setInterval(cargarBiblioteca, 30000); } // siempre trae lo último
}
let refrescoBib = null;

async function cargarBiblioteca() {
  if (!(await renovar())) return;
  if (!cargada) { $('#bibEstado').hidden = false; $('#bibEstado').textContent = 'Cargando tu biblioteca…'; }
  const r = await llamar('/rest/v1/biblioteca?select=*&order=descargado.desc&limit=1000', { token: sesion.token }).catch(() => null);
  if (!r || !r.ok) {
    $('#bibEstado').textContent = r && r.status === 404
      ? 'Todavía no hay biblioteca en el celular. En la PC abre Instant → Más → "Actualizar celular".'
      : 'No se pudo cargar. Revisa tu internet y toca "Biblioteca" otra vez.';
    return;
  }
  todas = r.datos; cargada = true;
  llenarFiltros(); pintar();
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
    <span class="foto">${x.portada ? `<img src="${esc(x.portada)}" alt="" loading="lazy">` : ''}<em>${esc(REDES[x.red] || x.red)}</em>${x.favorito ? '<b aria-label="Favorito">★</b>' : ''}</span>
    <span class="cuenta">@${esc(x.cuenta || '')}</span><span class="gancho">${esc(x.hook || x.copy || '')}</span>
    <span class="vistas">${fmt(x.vistas)} vistas</span></button></li>`).join('');
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
    ${/^https:\/\//.test(x.enlace || '') ? `<a class="btn" href="${esc(x.enlace)}" target="_blank" rel="noopener noreferrer">Ver original</a>` : ''}
    <a class="enlaceChico" href="https://drive.google.com/drive/search?q=${encodeURIComponent(String(x.id).split(':')[1] || '')}" target="_blank" rel="noopener noreferrer">Ver en Drive</a>
    <p class="soft nota">El video completo está en tu PC (Instant). Aquí solo se ve la ficha.</p>`;
  $('#ficha').hidden = false; document.body.style.overflow = 'hidden'; $('#fichaCerrar').focus();
}
function cerrarFicha() { $('#ficha').hidden = true; document.body.style.overflow = ''; }

document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => pestana(b.dataset.tab)));
['buscar', 'fEstado', 'fRed', 'fColeccion'].forEach((id) => $('#' + id).addEventListener('input', pintar));
$('#fFav').addEventListener('click', (e) => { e.currentTarget.setAttribute('aria-pressed', String(e.currentTarget.getAttribute('aria-pressed') !== 'true')); pintar(); });
$('#rejilla').addEventListener('click', (e) => { const t = e.target.closest('.tarjeta'); if (t) ficha(t.dataset.id); });
$('#fichaCerrar').addEventListener('click', cerrarFicha);
$('#ficha').addEventListener('click', (e) => { if (e.target.id === 'ficha') cerrarFicha(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#ficha').hidden) cerrarFicha(); });

// Al abrir o recargar la página, vuelve a la pestaña que estabas viendo.
if (sesion && !vienesDeCompartir && leer("pestana") === "biblioteca") pestana("biblioteca");
