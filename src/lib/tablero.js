// The "sala de control" at /factory/: pure mapping from a task (as /api/estado returns it) to what a row shows.
// The page only paints these values with textContent.
import { STATIONS, STATION_LABELS, MENSAJES } from '../../lib/estado.js'

const GLIFOS = { ok: '✓', en_curso: '●', rechazada: '!', error: '!', pendiente: '–' }
const PALABRAS = { ok: 'ok', en_curso: 'en curso', rechazada: 'rechazada', error: 'error', pendiente: 'pendiente' }
const SALIDA = { rechazada: 'Rechazada', fallida: 'Fallida', bloqueada_tests: 'Bloqueada por los tests', cerrada: 'Cerrada' }

// How long a finished task stays in the table before it leaves for its counter: the rejections long enough to read why.
export const RETENCION_MS = Object.freeze({ rechazada: 30000, fallida: 30000, cerrada: 30000, bloqueada_tests: 30000, sin_cambios: 4000, desplegada: 4000 })
export const retencion = (resultadoFinal) => RETENCION_MS[resultadoFinal] ?? 0

const estadoDe = (tarea, estacion) => (PALABRAS[tarea.estaciones?.[estacion]] ? tarea.estaciones[estacion] : 'pendiente')

// The stations of the table, in order: { estacion, etiqueta }.
export const CELDAS = STATIONS.map((estacion) => ({ estacion, etiqueta: STATION_LABELS[estacion] }))

// The 11 cells of a row, in the order of the stations: { estacion, etiqueta, estado, glifo, texto, lectura }.
// `texto` is the short word the wide table prints besides the symbol (¿Humano?: route; Main o PR: where it went).
export function celdas(tarea) {
  return STATIONS.map((estacion) => {
    let estado = estadoDe(tarea, estacion)
    let texto = null
    let lectura = PALABRAS[estado]
    if (estacion === 'puerta' && (tarea.ruta === 'auto' || tarea.ruta === 'human')) {
      const humana = tarea.ruta === 'human'
      texto = humana ? 'persona' : 'auto'
      lectura = humana ? 'una persona' : 'automático'
      if (humana && estado === 'pendiente') estado = 'en_curso'
    }
    if (estacion === 'merge') {
      if (estado === 'ok') texto = 'Main ✓'
      else if (tarea.pr != null) texto = `PR #${tarea.pr}`
      if (texto) lectura = texto
    }
    return { estacion, etiqueta: STATION_LABELS[estacion], estado, glifo: GLIFOS[estado], texto, lectura: `${STATION_LABELS[estacion]}: ${lectura}` }
  })
}

// Why a finished task did not make it: { titulo, motivo }, or null. The station that refused or failed is named when known.
export function rechazo(tarea) {
  const salida = SALIDA[tarea.resultadoFinal]
  if (!salida) return null
  const fallo = STATIONS.find((s) => ['rechazada', 'error'].includes(tarea.estaciones?.[s]))
  const union = tarea.resultadoFinal === 'rechazada' ? 'por' : tarea.resultadoFinal === 'fallida' ? 'en' : null
  const titulo = fallo && union ? `${salida} ${union} ${STATION_LABELS[fallo]}:` : `${salida}:`
  return { titulo, motivo: tarea.motivo || MENSAJES[tarea.resultadoFinal] || '' }
}

// The station the task is at now, with its state.
export function ahora(tarea) {
  const estacion = STATIONS.includes(tarea.estacion) ? tarea.estacion : 'entrada'
  const { estado } = celdas(tarea).find((c) => c.estacion === estacion)
  return { estacion, etiqueta: STATION_LABELS[estacion], estado, glifo: GLIFOS[estado], palabra: PALABRAS[estado] }
}

// The line under "Sigue tu petición #".
export function siguiendo(numero, tarea) {
  if (!numero) return ''
  if (!tarea) return `Todavía no vemos la petición #${numero}.`
  const final = SALIDA[tarea.resultadoFinal] || tarea.resultadoFinal === 'sin_cambios'
  const donde = final ? MENSAJES[tarea.resultadoFinal] : `ahora en ${ahora(tarea).etiqueta}`
  return `Siguiendo #${numero}: «${tarea.titulo ?? ''}» · ${donde}`
}

// How many tasks the gate sent each way.
export function puertas(tareas = []) {
  return { auto: tareas.filter((t) => t.ruta === 'auto').length, persona: tareas.filter((t) => t.ruta === 'human').length }
}
