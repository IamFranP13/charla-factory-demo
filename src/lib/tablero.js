// The board at /factory/: pure mapping from a task (as /api/estado returns it) to what the diagram shows: the node its
// token sits at, the lit connectors, the marks of the nodes, the rows of the panel, the counters and the retention
// of finished requests. No DOM: the page only paints these values, always with textContent.
import { STATIONS, STATION_LABELS } from '../../lib/estado.js'
import { NODOS, REVISORES } from './geometria.js'
import { ESTACIONES, etiquetaQuien, narrativa, quienDe } from './explica.js'

export const GLIFOS = { ok: '✓', en_curso: '●', rechazada: '!', error: '!', pendiente: '–' }
const PALABRAS = { ok: 'hecho', en_curso: 'en curso', rechazada: 'rechazada', error: 'error', pendiente: 'pendiente' }
// The class of a mark (circle at a node, row of the panel) by state.
export const CLASE_MARCA = { ok: 'm-ok', en_curso: 'm-curso', rechazada: 'm-rech', error: 'm-rech', pendiente: 'm-pend' }
const RECHAZO = { rechazada: 'Rechazada', fallida: 'Fallida', bloqueada_tests: 'Bloqueada por los tests', cerrada: 'Cerrada' }
const MENSAJE_RECHAZO = { rechazada: 'La factory ha rechazado tu petición', fallida: 'La factory no ha podido con tu petición', bloqueada_tests: 'Los tests automáticos han bloqueado tu cambio', cerrada: 'Una persona ha cerrado el cambio sin publicarlo' }

// How long a finished task stays on the diagram before it leaves for its counter: the rejections long enough to read why.
export const RETENCION_MS = Object.freeze({ rechazada: 30000, fallida: 30000, cerrada: 30000, bloqueada_tests: 30000, sin_cambios: 4000, desplegada: 4000 })
export const retencion = (resultadoFinal) => RETENCION_MS[resultadoFinal] ?? 0

const estadoDe = (t, estacion) => (PALABRAS[t.estaciones?.[estacion]] ? t.estaciones[estacion] : 'pendiente')

// The node of the diagram where the token of a task sits.
export function ubica(t) {
  const final = t.resultadoFinal
  if (RECHAZO[final]) return 'rechazadas'
  if (final === 'desplegada' || final === 'sin_cambios') return 'produccion'
  if (final === 'esperando_persona') return 'pr'
  const estacion = STATIONS.includes(t.estacion) ? t.estacion : 'entrada'
  if (estacion === 'merge') return 'main'
  if (estacion === 'puerta') return t.ruta === 'human' && t.pr != null ? 'pr' : 'puerta'
  // The last reviewer to finish hands the request over to the approver.
  const revisando = REVISORES.includes(estacion)
  if (revisando && REVISORES.every((r) => estadoDe(t, r) === 'ok') && estadoDe(t, 'approver') === 'pendiente') return 'approver'
  return estacion
}

// --- the token ---

export const claseFicha = (t) => (RECHAZO[t.resultadoFinal] ? 'rech' : t.resultadoFinal === 'desplegada' || t.resultadoFinal === 'sin_cambios' ? 'ok' : t.resultadoFinal === 'esperando_persona' ? 'espera' : 'curso')
export const marcaFicha = (t) => ({ rech: '!', ok: '✓', espera: '–', curso: '●' })[claseFicha(t)]

export function nombreAccesible(t) {
  const nodo = ubica(t)
  const donde = nodo === 'rechazadas' ? 'rechazada' : nodo === 'pr' ? `esperando a una persona (PR #${t.pr})` : `en ${NODOS[nodo].nombre}`
  const motivo = nodo === 'rechazadas' && t.motivo ? `. Motivo: ${t.motivo}` : ''
  return `Petición #${t.numero}: ${t.titulo ?? ''}, ${donde}${motivo}`
}

// Newest first; the followed request first of all.
export const ordenFichas = (numeros, seguida) => [...numeros].sort((a, b) => Number(b === seguida) - Number(a === seguida) || b - a)

// --- marks and lit connectors (the path of the request you follow) ---

export function marcaNodo(t, nodo) {
  const humana = t.ruta === 'human'
  const merge = estadoDe(t, 'merge')
  if (nodo === 'main') return humana && merge === 'pendiente' ? 'pendiente' : merge
  if (nodo === 'pr') return !humana ? 'pendiente' : merge === 'pendiente' ? (estadoDe(t, 'puerta') === 'ok' ? 'ok' : 'en_curso') : 'ok'
  if (nodo === 'rechazadas') return ubica(t) === 'rechazadas' ? 'rechazada' : 'pendiente'
  if (nodo === 'puerta' && estadoDe(t, 'puerta') === 'pendiente' && (humana || ubica(t) === 'puerta')) return 'en_curso'
  return estadoDe(t, nodo)
}

// The connectors to light for a task. In the vertical layout the reviewers' own connectors are not drawn: the frame is.
export function aristasEncendidas(t, vertical) {
  const visto = (s) => estadoDe(t, s) !== 'pendiente'
  const on = new Set()
  const add = (...ids) => ids.forEach((id) => on.add(id))
  if (visto('spec')) add('e1')
  if (visto('build')) add('e2')
  const revisores = REVISORES.filter(visto)
  if (revisores.length) {
    add(vertical ? 'f-in' : 'e2')
    revisores.forEach((r) => add(`f-${r}`))
  }
  if (REVISORES.every((r) => estadoDe(t, r) === 'ok') || visto('approver')) {
    REVISORES.filter((r) => estadoDe(t, r) === 'ok').forEach((r) => add(`j-${r}`))
    add('j-out')
  }
  if (estadoDe(t, 'approver') === 'ok' || visto('puerta')) add('e-ap')
  if (t.ruta === 'auto' && (visto('merge') || estadoDe(t, 'puerta') === 'ok')) add('e-auto')
  if (t.ruta === 'human' && t.pr != null) add('e-per')
  if (t.ruta === 'human' && visto('merge')) add('e-prm')
  if (visto('produccion') || (t.ruta === 'auto' && visto('merge'))) add('e-mp')
  if (ubica(t) === 'rechazadas' && (visto('approver') || revisores.length)) add('e-rech')
  if ((t.vueltas ?? 0) > 0) add('e-vuelta')
  return on
}

// --- the panels ---

// Why a finished task did not make it: { titulo, motivo }, or null. The station that refused or failed is named when known.
export function rechazo(t) {
  const salida = RECHAZO[t.resultadoFinal]
  if (!salida) return null
  const fallo = STATIONS.find((s) => ['rechazada', 'error'].includes(t.estaciones?.[s]))
  const union = t.resultadoFinal === 'rechazada' ? 'por' : t.resultadoFinal === 'fallida' ? 'en' : null
  const titulo = fallo && union ? `${salida} ${union} ${STATION_LABELS[fallo]}:` : `${salida}:`
  return { titulo, motivo: t.motivo || MENSAJE_RECHAZO[t.resultadoFinal] || '' }
}

// The station the request is "at" in the list of 11: the one working, the one that refused it, or its token's.
function estacionAqui(t) {
  const nodo = ubica(t)
  if (nodo === 'rechazadas') return STATIONS.find((s) => ['rechazada', 'error'].includes(t.estaciones?.[s])) ?? (STATIONS.includes(t.estacion) ? t.estacion : null)
  if (nodo === 'main' || nodo === 'pr') return 'merge'
  return nodo
}

// The 11 stations of a request, in order: { estacion, etiqueta, estado, glifo, palabra, texto, aqui }.
// `texto` is the short word besides ¿Humano? (auto / persona) and Main o PR (Main ✓ / PR #n).
export function filas(t) {
  const aqui = estacionAqui(t)
  return STATIONS.map((estacion) => {
    let estado = estadoDe(t, estacion)
    let texto = null
    if (estacion === 'puerta' && (t.ruta === 'auto' || t.ruta === 'human')) {
      texto = t.ruta === 'human' ? 'persona' : 'auto'
    }
    // The request reached the gate (approved, waiting for it to decide) or a person has to look at it: the gate is working.
    if (estacion === 'puerta' && estado === 'pendiente' && (t.ruta === 'human' || ubica(t) === 'puerta')) estado = 'en_curso'
    if (estacion === 'merge') texto = estado === 'ok' ? 'Main ✓' : t.pr != null ? `PR #${t.pr}` : null
    return { estacion, etiqueta: STATION_LABELS[estacion], estado, glifo: GLIFOS[estado], palabra: PALABRAS[estado], texto, aqui: estacion === aqui }
  })
}

const urlSegura = (url) => (typeof url === 'string' && /^https:\/\/github\.com\//.test(url) ? url : null)
const rutaDelSitio = (ruta) => (typeof ruta === 'string' && /^\/(?!\/)/.test(ruta) ? ruta : null)

// What the side panel shows for a tapped request. `cola`: the pull requests waiting for a person (they carry the address).
export function panelPeticion(t, cola = []) {
  const nodo = ubica(t)
  const pr = t.pr != null ? { numero: t.pr, url: urlSegura(cola.find((q) => q.pr === t.pr)?.url) } : null
  return {
    numero: t.numero,
    titulo: t.titulo ?? '',
    etiquetas: [`perfil · ${t.perfil}`, ...(t.tipo ? [`tipo · ${t.tipo}`] : []), `estación · ${nodo === 'rechazadas' ? 'Rechazadas' : NODOS[nodo].nombre}`],
    mensaje: t.mensaje ?? '',
    motivo: rechazo(t),
    pr,
    enlace: rutaDelSitio(t.enlace),
    vueltas: t.vueltas ?? 0,
    narrativa: narrativa(t),
    filas: filas(t),
  }
}

// What the side panel shows for a tapped station: what it does and the requests in it (newest first).
export function panelEstacion(nodo, tareas = []) {
  const { nombre, paso, hace } = NODOS[nodo]
  return { titulo: nombre, paso: paso ? `Estación ${paso} de 11` : 'Estación final', hace, quien: etiquetaQuien(nodo), quienClave: quienDe(nodo), linea: ESTACIONES[nodo].linea, aqui: tareas.filter((t) => ubica(t) === nodo).sort((a, b) => b.numero - a.numero) }
}

// --- counters, retention, the follow line ---

export function totales(c = {}) {
  return { peticiones: c.peticiones ?? 0, desplegadas: c.desplegadas ?? 0, esperando: c.esperando ?? 0, rechazadas: (c.rechazadas ?? 0) + (c.fallidas ?? 0) + (c.cerradas ?? 0) + (c.bloqueadas_tests ?? 0) }
}

// `vistas` remembers when each finished task was first seen. A task already finished when the page opened goes straight
// to the counters (`alAbrir`), except in the demo, which must show what it rehearses. Gone from the list: forgotten.
export function registrarVistas(vistas, tareas, ahoraMs, { alAbrir = false, demo = false } = {}) {
  const vivas = new Set(tareas.map((t) => t.numero))
  for (const n of [...vistas.keys()]) if (!vivas.has(n)) vistas.delete(n)
  for (const t of tareas) {
    if (retencion(t.resultadoFinal) && !vistas.has(t.numero)) vistas.set(t.numero, { desde: ahoraMs, retirada: alAbrir && !demo })
  }
}

// The tasks that stay on the diagram: a finished one leaves for good once its time is up; the followed one never leaves.
export function visibles(tareas, vistas, seguida, ahoraMs) {
  return tareas.filter((t) => {
    const espera = retencion(t.resultadoFinal)
    if (!espera || t.numero === seguida) return true
    const vista = vistas.get(t.numero)
    if (!vista || vista.retirada) return false
    if (ahoraMs - vista.desde >= espera) vista.retirada = true
    return !vista.retirada
  })
}

// The sentence the polite live region announces when the followed request moves: what is happening to it now.
export function lineaViva(numero, t) {
  if (!numero) return ''
  if (!t) return siguiendo(numero, null)
  const n = narrativa(t)
  return `Petición #${numero}: ${n.texto}${n.motivo ? ` Motivo: ${n.motivo}` : ''}`
}

// The line under "Sigue tu petición #".
export function siguiendo(numero, t) {
  if (!numero) return ''
  if (!t) return `Todavía no vemos la petición #${numero}.`
  const final = RECHAZO[t.resultadoFinal] || t.resultadoFinal === 'sin_cambios'
  const donde = final ? t.mensaje : `ahora en ${NODOS[ubica(t)].nombre}`
  return `Siguiendo #${numero}: «${t.titulo ?? ''}» · ${donde}`
}
