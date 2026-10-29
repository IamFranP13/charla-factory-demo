import { test } from 'node:test'
import assert from 'node:assert/strict'
import { STATIONS } from '../lib/estado.js'
import { celdas, retencion, rechazo, ahora, siguiendo, puertas, RETENCION_MS } from '../src/lib/tablero.js'

// A task as /api/estado returns it, every station pending unless told otherwise.
function tarea({ ok = [], estaciones = {}, ...resto } = {}) {
  const todas = Object.fromEntries(STATIONS.map((s) => [s, ok.includes(s) ? 'ok' : 'pendiente']))
  return { numero: 7, titulo: 'Un banner', fase: 'entrada', ruta: null, pr: null, motivo: null, resultadoFinal: 'en_curso', estacion: 'entrada', ...resto, estaciones: { ...todas, ...estaciones } }
}
const HASTA_APPROVER = ['entrada', 'spec', 'build', 'seguridad', 'ux', 'ui', 'codigo', 'approver']

test('a task is 11 cells, in the order of the stations, named as the board names them', () => {
  const c = celdas(tarea({ ok: ['entrada'] }))
  assert.deepEqual(c.map((x) => x.estacion), STATIONS)
  assert.deepEqual(c.map((x) => x.etiqueta), ['Entrada', 'Spec writer', 'Builder', 'Seguridad', 'UX', 'UI', 'Código', 'Approver', '¿Humano?', 'Main o PR', 'Producción'])
})

test('a cell shows ✓ ● ! – by state, never only by colour, and reads "<station>: <state>"', () => {
  const c = celdas(tarea({ ok: ['entrada', 'spec'], estaciones: { build: 'en_curso', seguridad: 'rechazada', ux: 'error' } }))
  const por = Object.fromEntries(c.map((x) => [x.estacion, x]))
  assert.deepEqual([por.entrada.glifo, por.entrada.estado, por.entrada.lectura], ['✓', 'ok', 'Entrada: ok'])
  assert.deepEqual([por.build.glifo, por.build.estado, por.build.lectura], ['●', 'en_curso', 'Builder: en curso'])
  assert.deepEqual([por.seguridad.glifo, por.seguridad.lectura], ['!', 'Seguridad: rechazada'])
  assert.deepEqual([por.ux.glifo, por.ux.lectura], ['!', 'UX: error'])
  assert.deepEqual([por.ui.glifo, por.ui.estado, por.ui.lectura], ['–', 'pendiente', 'UI: pendiente'])
  assert.equal(por.build.texto, null)
})

test('¿Humano? says auto or persona from the route once the gate has chosen one', () => {
  const antes = celdas(tarea({ ok: HASTA_APPROVER })).find((x) => x.estacion === 'puerta')
  assert.equal(antes.texto, null)
  assert.equal(antes.estado, 'pendiente')
  const auto = celdas(tarea({ ok: [...HASTA_APPROVER, 'puerta'], ruta: 'auto' })).find((x) => x.estacion === 'puerta')
  assert.deepEqual([auto.texto, auto.estado, auto.lectura], ['auto', 'ok', '¿Humano?: automático'])
  const persona = celdas(tarea({ ok: HASTA_APPROVER, ruta: 'human', pr: 22, resultadoFinal: 'esperando_persona' })).find((x) => x.estacion === 'puerta')
  assert.deepEqual([persona.texto, persona.estado, persona.lectura], ['persona', 'en_curso', '¿Humano?: una persona'])
})

test('Main o PR says "Main ✓" once merged and "PR #n" while the pull request is open', () => {
  const abierto = celdas(tarea({ ok: HASTA_APPROVER, ruta: 'human', pr: 57, resultadoFinal: 'esperando_persona' })).find((x) => x.estacion === 'merge')
  assert.deepEqual([abierto.texto, abierto.estado, abierto.lectura], ['PR #57', 'pendiente', 'Main o PR: PR #57'])
  const unido = celdas(tarea({ ok: [...HASTA_APPROVER, 'puerta', 'merge'], ruta: 'auto', pr: 21 })).find((x) => x.estacion === 'merge')
  assert.deepEqual([unido.texto, unido.estado, unido.lectura], ['Main ✓', 'ok', 'Main o PR: Main ✓'])
  const nada = celdas(tarea({ ok: ['entrada'] })).find((x) => x.estacion === 'merge')
  assert.equal(nada.texto, null)
})

test('rejections stay 30 s, deployed and unchanged requests 4 s, a request in progress never leaves', () => {
  for (const r of ['rechazada', 'fallida', 'bloqueada_tests', 'cerrada']) assert.equal(retencion(r), 30000, r)
  assert.equal(retencion('desplegada'), 4000)
  assert.equal(retencion('sin_cambios'), 4000)
  assert.equal(retencion('en_curso'), 0)
  assert.equal(retencion('esperando_persona'), 0)
  assert.equal(retencion(undefined), 0)
  assert.equal(Object.isFrozen(RETENCION_MS), true)
})

test('a rejected row names the station that refused and gives its motivo', () => {
  const t = tarea({ ok: ['entrada', 'spec', 'build'], estaciones: { seguridad: 'rechazada' }, resultadoFinal: 'rechazada', motivo: 'Lleva un enlace externo' })
  assert.deepEqual(rechazo(t), { titulo: 'Rechazada por Seguridad:', motivo: 'Lleva un enlace externo' })
  const sinEstacion = tarea({ resultadoFinal: 'rechazada', motivo: 'No procede' })
  assert.deepEqual(rechazo(sinEstacion), { titulo: 'Rechazada:', motivo: 'No procede' })
  const sinMotivo = tarea({ estaciones: { approver: 'rechazada' }, resultadoFinal: 'rechazada' })
  assert.equal(rechazo(sinMotivo).motivo, 'La factory ha rechazado tu petición')
  assert.deepEqual(rechazo(tarea({ estaciones: { build: 'error' }, resultadoFinal: 'fallida', motivo: 'Sin respuesta' })), { titulo: 'Fallida en Builder:', motivo: 'Sin respuesta' })
  assert.deepEqual(rechazo(tarea({ resultadoFinal: 'bloqueada_tests', motivo: 'Los tests automáticos (CI) han fallado' })), { titulo: 'Bloqueada por los tests:', motivo: 'Los tests automáticos (CI) han fallado' })
  assert.equal(rechazo(tarea()), null)
  assert.equal(rechazo(tarea({ resultadoFinal: 'desplegada' })), null)
})

test('"ahora" is the station the request is at, with its state', () => {
  assert.deepEqual(ahora(tarea({ ok: ['entrada'], estaciones: { spec: 'en_curso' }, estacion: 'spec' })), { estacion: 'spec', etiqueta: 'Spec writer', estado: 'en_curso', glifo: '●', palabra: 'en curso' })
  assert.deepEqual(ahora(tarea({ ok: STATIONS, estacion: 'produccion', resultadoFinal: 'desplegada' })), { estacion: 'produccion', etiqueta: 'Producción', estado: 'ok', glifo: '✓', palabra: 'ok' })
  assert.equal(ahora(tarea({ estacion: 'inventada' })).etiqueta, 'Entrada')
})

test('"ahora" agrees with the cell: a request waiting for a person is at ¿Humano? en curso', () => {
  const t = tarea({ ok: HASTA_APPROVER, ruta: 'human', pr: 22, resultadoFinal: 'esperando_persona', estacion: 'puerta' })
  assert.deepEqual([ahora(t).estado, ahora(t).palabra], ['en_curso', 'en curso'])
})

test('a request the gate routed to a person is at ¿Humano? en curso until it is approved, even before the queue lists it', () => {
  const t = tarea({ ok: HASTA_APPROVER, ruta: 'human', pr: 22, resultadoFinal: 'en_curso', estacion: 'puerta' })
  assert.equal(celdas(t)[8].estado, 'en_curso')
  assert.equal(ahora(t).estado, 'en_curso')
  assert.equal(celdas({ ...t, estaciones: { ...t.estaciones, puerta: 'ok' } })[8].estado, 'ok', 'approved')
  assert.equal(celdas({ ...t, estaciones: { ...t.estaciones, puerta: 'rechazada' } })[8].estado, 'rechazada', 'refused')
  assert.equal(celdas({ ...t, ruta: 'auto' })[8].estado, 'pendiente', 'auto is unchanged')
})

test('the follow line names the request, its title and where it is; otherwise it says it is not visible yet', () => {
  const t = tarea({ numero: 43, titulo: 'El botón del hero no se ve bien', estaciones: { spec: 'en_curso' }, estacion: 'spec' })
  assert.equal(siguiendo(43, t), 'Siguiendo #43: «El botón del hero no se ve bien» · ahora en Spec writer')
  assert.equal(siguiendo(43, null), 'Todavía no vemos la petición #43.')
  assert.equal(siguiendo(null, null), '')
  const rechazada = tarea({ numero: 3, titulo: 'X', estacion: 'seguridad', resultadoFinal: 'rechazada', estaciones: { seguridad: 'rechazada' } })
  assert.equal(siguiendo(3, rechazada), 'Siguiendo #3: «X» · La factory ha rechazado tu petición')
})

test('the gate counts the tasks by route', () => {
  assert.deepEqual(puertas([tarea({ ruta: 'auto' }), tarea({ ruta: 'auto' }), tarea({ ruta: 'human' }), tarea()]), { auto: 2, persona: 1 })
  assert.deepEqual(puertas(undefined), { auto: 0, persona: 0 })
})
