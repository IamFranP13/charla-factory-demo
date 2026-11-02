// What the pages SHOW of a task when a station went by between two reads of /api/estado (the factory is fast: a station can
// start and finish inside the 5 s polling interval). Purely on the client: a station that jumped from `pendiente` to
// `ok`/`rechazada`/`error` is shown `en curso` for a moment (about 1.5 s), in the diagram's order, before its final
// state. Nothing here waits for the factory or touches the polling. No DOM: the pages paint what comes out.
import { STATIONS, MENSAJES } from '../../lib/estado.js'

export const ENCURSO_MS = 1500
// The stations in the order of the talk's diagram; the four reviewers (and the re-check) run at once, so they go together.
const GRUPOS = [['entrada'], ['spec'], ['build'], ['seguridad', 'ux', 'ui', 'codigo'], ['approver'], ['puerta'], ['merge'], ['produccion']]
const GRUPO_DE = Object.fromEntries(GRUPOS.flatMap((grupo, i) => grupo.map((s) => [s, i])))
const PUERTA = GRUPO_DE.puerta
const TERMINAL = ['ok', 'rechazada', 'error']
const valor = (t, s) => t?.estaciones?.[s] ?? 'pendiente'

// The tasks to show before `nueva` (the last read), given the one on screen (`previa`): one per group of stations that went
// from `pendiente` to a final value without being seen working. Empty when nothing was skipped.
export function secuencia(previa, nueva) {
  if (!previa || !nueva) return []
  const saltadas = new Set(STATIONS.filter((s) => valor(previa, s) === 'pendiente' && TERMINAL.includes(valor(nueva, s))))
  const frames = []
  GRUPOS.forEach((grupo, g) => {
    const aqui = grupo.filter((s) => saltadas.has(s))
    if (!aqui.length) return
    const estaciones = Object.fromEntries(STATIONS.map((s) => {
      const i = GRUPO_DE[s]
      if (i < g) return [s, valor(nueva, s)]
      if (i === g) return [s, saltadas.has(s) ? 'en_curso' : valor(nueva, s)]
      return [s, valor(previa, s)]
    }))
    // The route and the pull request are known from the gate on; before it they are what was on screen.
    const desde = g >= PUERTA ? nueva : previa
    frames.push({ ...nueva, estaciones, ruta: desde.ruta ?? null, pr: desde.pr ?? null, resultado: null, resultadoFinal: 'en_curso', mensaje: MENSAJES.en_curso, motivo: null, enlace: null, estacion: aqui[0] })
  })
  return frames
}

// One per task: `recibir(tarea)` with every read; `alMostrar(tarea)` is called with what to paint now. The first read, and a
// read with nothing skipped, are painted at once; otherwise the frames follow every ENCURSO_MS and the read itself comes
// last. A read in the middle of a replay goes on from what is on screen.
export function crearReproductor(alMostrar, { retraso = ENCURSO_MS, poner = setTimeout, quitar = clearTimeout } = {}) {
  let mostrada = null
  let timer = null
  const muestra = (t) => {
    mostrada = t
    alMostrar(t)
  }
  const para = () => {
    if (timer !== null) quitar(timer)
    timer = null
  }
  return {
    recibir(nueva) {
      para()
      const cola = [...secuencia(mostrada, nueva), nueva]
      const avanza = () => {
        timer = null
        muestra(cola.shift())
        if (cola.length) timer = poner(avanza, retraso)
      }
      avanza()
    },
    detener: para,
  }
}
