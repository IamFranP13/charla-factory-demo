// DEMO MODE: fake data for rehearsing and screenshots without GitHub. Only active with `?demo=1` in the URL;
// `?demo=1&paso=N` freezes the sequence at step N. The tasks are built with the factory's own state helpers
// (lib/estado.js), so the pages receive exactly what /api/estado would return.
import { initialState, applyEvent, finishState, derivar } from '../../lib/estado.js'

export const esDemo = () => new URLSearchParams(location.search).get('demo') === '1'

const REV = ['seguridad', 'ux', 'ui', 'codigo']
const trabajando = (...estaciones) => estaciones.map((station) => ({ station, status: 'en_curso' }))
const hechas = (...estaciones) => estaciones.map((station) => ({ station, status: 'ok' }))

// One array of events per step; a step moves the task one station on.
const hastaApprover = [
  trabajando('spec'),
  [...hechas('spec'), ...trabajando('build')],
  [...hechas('build'), ...trabajando(...REV)],
  [...hechas(...REV), ...trabajando('approver')],
  [...hechas('approver'), { finish: 'ok' }],
]

const GUIONES = [
  {
    numero: 1, desde: 0, perfil: 'marketing', titulo: 'Un banner de limones de temporada',
    pasos: [...hastaApprover, [{ set: { ruta: 'auto', pr: 21 } }, ...hechas('puerta'), ...trabajando('merge')], hechas('merge'), hechas('produccion')],
  },
  {
    numero: 2, desde: 1, perfil: 'negocio', titulo: 'Baja el precio del limón a 1 euro',
    pasos: [...hastaApprover, [{ set: { ruta: 'human', pr: 22 } }], [], [], [], [], [], [], hechas('puerta', 'merge'), hechas('produccion')],
  },
  {
    numero: 3, desde: 2, perfil: 'producto', titulo: 'Añade un producto con enlaces a otra web',
    pasos: [
      trabajando('spec'),
      [...hechas('spec'), ...trabajando('build')],
      [...hechas('build'), ...trabajando(...REV)],
      [...hechas('ux', 'ui', 'codigo'), { station: 'seguridad', status: 'rejected' }, { finish: 'rejected', motivo: 'Lleva un enlace a una web externa' }],
    ],
  },
  {
    numero: 4, desde: 4, perfil: 'producto', titulo: 'Nuevo destino: Alemania',
    pasos: [
      trabajando('spec'),
      [...hechas('spec'), ...trabajando('build')],
      [...hechas('build'), ...trabajando(...REV)],
      [...hechas(...REV), ...trabajando('approver')],
      [{ station: 'approver', status: 'retry' }],
      trabajando('build'),
      [...hechas('build'), ...trabajando(...REV)],
      [...hechas(...REV), ...trabajando('approver')],
      [...hechas('approver'), { finish: 'ok' }],
      [{ set: { ruta: 'auto', pr: 23 } }, ...hechas('puerta', 'merge')],
      hechas('produccion'),
    ],
  },
]

export const PASOS_DEMO = 24
const AHORA = '2026-01-01T00:00:00.000Z'

function estadoEn(guion, paso) {
  let estado = initialState(guion.perfil, AHORA)
  for (const evento of guion.pasos.slice(0, Math.max(0, paso - guion.desde)).flat()) {
    if (evento.set) estado = applyEvent({ ...estado, ...evento.set }, { station: 'puerta', status: 'noop' }, AHORA)
    else if (evento.finish) estado = finishState(estado, evento.finish, AHORA, evento.motivo)
    else estado = applyEvent(estado, evento, AHORA)
  }
  return estado
}

// What /api/estado returns at a step of the sequence.
export function instantanea(paso) {
  const actuales = GUIONES.filter((g) => paso >= g.desde).map((g) => ({ guion: g, estado: estadoEn(g, paso) }))
  const cola = new Set(actuales.filter(({ estado }) => estado.ruta === 'human' && estado.estaciones.puerta !== 'ok' && estado.resultado === 'ok').map(({ estado }) => estado.pr))
  const tareas = actuales.map(({ guion, estado }) => derivar(
    { number: guion.numero, title: guion.titulo, labels: [{ name: `perfil:${guion.perfil}` }], updated_at: AHORA },
    { cola, estado },
  )).sort((a, b) => b.numero - a.numero)
  const cuenta = (r) => tareas.filter((t) => t.resultadoFinal === r).length
  return {
    tareas,
    cola: tareas.filter((t) => t.resultadoFinal === 'esperando_persona').map((t) => ({ pr: t.pr, tarea: t.numero, titulo: t.titulo, url: '#demo' })),
    contadores: { peticiones: tareas.length, desplegadas: cuenta('desplegada'), esperando: cuenta('esperando_persona'), rechazadas: cuenta('rechazada'), fallidas: cuenta('fallida'), cerradas: cuenta('cerrada'), sin_cambios: cuenta('sin_cambios'), en_curso: cuenta('en_curso') },
  }
}

// Same contract as `sondear`: calls `alRecibir(body)` every `cadaMs` and returns the function that stops it.
// The sequence loops, so the demo never ends.
export function sondearDemo(alRecibir, { cadaMs = 2500 } = {}) {
  const fijo = new URLSearchParams(location.search).get('paso')
  if (fijo !== null && /^\d{1,3}$/.test(fijo)) {
    alRecibir(instantanea(Number(fijo)))
    return () => {}
  }
  let paso = 0
  const vuelta = () => {
    alRecibir(instantanea(paso))
    paso = (paso + 1) % PASOS_DEMO
  }
  vuelta()
  const timer = setInterval(vuelta, cadaMs)
  return () => clearInterval(timer)
}
