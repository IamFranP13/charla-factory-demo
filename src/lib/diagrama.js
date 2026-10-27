// The factory scheme as data: the ordered steps a request goes through (`PASOS`), a task painted on them (`pintar`) and
// where each task is (`ocupacion`). Pure, no DOM: the pages only draw what this module computes, as a stepper
// (horizontal on wide screens, vertical on phones).

// The stations of the factory as the public sees them. `revision` groups the four reviewers that run in parallel;
// `destino` is Main (auto route) or PR (human route).
export const REVISORES = ['seguridad', 'ux', 'ui', 'codigo']
export const NOMBRES_REVISORES = { seguridad: 'Seguridad', ux: 'UX', ui: 'UI', codigo: 'Código' }
export const PASOS = [
  { id: 'entrada', label: 'Entrada' },
  { id: 'spec', label: 'Spec writer', nota: 'Consulta el Brain' },
  { id: 'build', label: 'Builder' },
  { id: 'revision', label: 'Revisión', subpasos: REVISORES.map((id) => ({ id, label: NOMBRES_REVISORES[id] })) },
  { id: 'approver', label: 'Approver' },
  { id: 'puerta', label: '¿Humano?' },
  { id: 'destino', label: 'Main o PR' },
  { id: 'produccion', label: 'Producción' },
]
export const IDS = PASOS.map((p) => p.id)

const ESTACIONES = ['entrada', 'spec', 'build', 'seguridad', 'ux', 'ui', 'codigo', 'approver', 'puerta', 'merge', 'produccion']
const VALORES = ['pendiente', 'en_curso', 'ok', 'rechazada', 'error']
const MAX_ETIQUETA = 40
const PASO_DE = { seguridad: 'revision', ux: 'revision', ui: 'revision', codigo: 'revision' }

// --- a task painted on the steps ---

export function truncar(texto, max = MAX_ETIQUETA) {
  const letras = Array.from(String(texto ?? '').trim())
  return letras.length > max ? `${letras.slice(0, max - 1).join('')}…` : letras.join('')
}

// The state of a group of stations as one: a refusal or an error wins, then work in progress.
function agrupar(estados) {
  if (estados.includes('error')) return 'error'
  if (estados.includes('rechazada')) return 'rechazada'
  if (estados.every((e) => e === 'ok')) return 'ok'
  if (estados.every((e) => e === 'pendiente')) return 'pendiente'
  return 'en_curso'
}

// `tarea` is one entry of /api/estado. Returns the visual state of every step and the short labels:
//   pasos:     { <paso>: pendiente | en_curso | ok | rechazada | error }
//   revisores: { seguridad|ux|ui|codigo: the same states }
//   etiquetas: { <paso>: TEXT } short label of the steps that refused, failed or have something to say
//   destino:   'Main' | 'PR' | 'Main o PR' (the name of the Main/PR step once the route is known)
export function pintar(tarea = {}) {
  const estaciones = tarea?.estaciones ?? {}
  const estado = (id) => (VALORES.includes(estaciones[id]) ? estaciones[id] : 'pendiente')
  const ruta = tarea?.ruta === 'auto' || tarea?.ruta === 'human' ? tarea.ruta : null
  const final = tarea?.resultadoFinal
  const esperando = final === 'esperando_persona'

  const pasos = Object.fromEntries(['entrada', 'spec', 'build', 'approver', 'produccion'].map((id) => [id, estado(id)]))
  const revisores = Object.fromEntries(REVISORES.map((id) => [id, estado(id)]))
  pasos.revision = agrupar(Object.values(revisores))
  pasos.puerta = esperando ? 'en_curso' : estado('puerta')

  // Main or PR: the merge station, on the branch the route took. Neither is lit before the route is known.
  const merge = estado('merge')
  pasos.destino = 'pendiente'
  if (ruta === 'auto') pasos.destino = merge === 'pendiente' ? (pasos.puerta === 'ok' ? 'en_curso' : 'pendiente') : merge
  if (ruta === 'human') pasos.destino = merge === 'pendiente' ? (esperando || pasos.puerta === 'ok' || tarea.pr ? 'ok' : 'pendiente') : merge
  // Merged and waiting for the deploy to be confirmed.
  if (pasos.produccion === 'pendiente' && merge === 'ok') pasos.produccion = 'en_curso'
  const destino = ruta === 'auto' ? 'Main' : ruta === 'human' ? 'PR' : 'Main o PR'

  const motivo = truncar(tarea?.motivo).toUpperCase()
  const etiquetas = {}
  for (const [id, valor] of Object.entries(pasos)) {
    if (valor === 'rechazada') etiquetas[id] = motivo || (final === 'cerrada' ? 'CERRADA' : 'RECHAZADA')
    if (valor === 'error') etiquetas[id] = motivo || 'ERROR'
  }
  if (pasos.puerta !== 'rechazada' && pasos.puerta !== 'error') {
    if (ruta === 'auto') etiquetas.puerta = 'NO HACE FALTA'
    else if (ruta === 'human' && pasos.puerta === 'ok') etiquetas.puerta = 'APROBADA'
    else if (ruta === 'human' && pasos.puerta === 'en_curso') etiquetas.puerta = 'ESPERANDO A UNA PERSONA'
  }
  if (final === 'sin_cambios') {
    const donde = pasoDe(tarea)
    if (!etiquetas[donde]) etiquetas[donde] = 'SIN CAMBIOS'
  }

  return { pasos, revisores, etiquetas, destino }
}

// The step where a task is right now.
function pasoDe(tarea) {
  const estaciones = tarea?.estaciones ?? {}
  if (tarea?.resultadoFinal === 'desplegada') return 'produccion'
  if (tarea?.resultadoFinal === 'esperando_persona') return 'puerta'
  let estacion = ESTACIONES.includes(tarea?.estacion) ? tarea.estacion : null
  estacion ??= ESTACIONES.find((s) => estaciones[s] === 'en_curso') ?? ESTACIONES.find((s) => ['rechazada', 'error'].includes(estaciones[s]))
  estacion ??= ESTACIONES.includes(tarea?.fase) ? tarea.fase : 'entrada'
  if (estacion === 'merge') return tarea.ruta === 'human' || tarea.ruta === 'auto' ? 'destino' : 'puerta'
  return PASO_DE[estacion] ?? estacion
}

// Per step, the numbers of the tasks that are there now (newest first), for the board.
export function ocupacion(tareas = []) {
  const pasos = Object.fromEntries(IDS.map((id) => [id, []]))
  const por = {}
  for (const tarea of [...(tareas ?? [])].sort((a, b) => b.numero - a.numero)) {
    const id = pasoDe(tarea)
    pasos[id].push(tarea.numero)
    por[tarea.numero] = id
  }
  return { pasos, por }
}
