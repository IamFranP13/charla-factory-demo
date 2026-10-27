import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PASOS, IDS, REVISORES, pintar, ocupacion, truncar } from '../src/lib/diagrama.js'

const ESTACIONES = ['entrada', 'spec', 'build', 'seguridad', 'ux', 'ui', 'codigo', 'approver', 'puerta', 'merge', 'produccion']

// A task as /api/estado returns it, with every station pending unless told otherwise.
function tarea({ ok = [], ...resto } = {}) {
  const estaciones = Object.fromEntries(ESTACIONES.map((s) => [s, ok.includes(s) ? 'ok' : 'pendiente']))
  Object.assign(estaciones, resto.estaciones)
  return { numero: 1, fase: 'entrada', ruta: null, pr: null, motivo: null, resultadoFinal: 'en_curso', ...resto, estaciones }
}
const HASTA_APPROVER = ['entrada', 'spec', 'build', 'seguridad', 'ux', 'ui', 'codigo', 'approver']

// --- the steps ---

test('the steps are the ones of the talk, in order, with the four reviewers grouped in "Revisión"', () => {
  assert.deepEqual(PASOS.map((p) => p.label), ['Entrada', 'Spec writer', 'Builder', 'Revisión', 'Approver', '¿Humano?', 'Main o PR', 'Producción'])
  assert.deepEqual(IDS, ['entrada', 'spec', 'build', 'revision', 'approver', 'puerta', 'destino', 'produccion'])
  assert.deepEqual(PASOS.find((p) => p.id === 'revision').subpasos.map((s) => s.label), ['Seguridad', 'UX', 'UI', 'Código'])
  assert.deepEqual(PASOS.find((p) => p.id === 'revision').subpasos.map((s) => s.id), REVISORES)
  assert.match(PASOS.find((p) => p.id === 'spec').nota, /Brain/)
})

// --- pintar: task state → steps and labels ---

test('marker-less new task: Entrada ok, the rest pending, no label', () => {
  const p = pintar(tarea({ ok: ['entrada'] }))
  assert.equal(p.pasos.entrada, 'ok')
  for (const id of IDS.filter((c) => c !== 'entrada')) assert.equal(p.pasos[id], 'pendiente', id)
  assert.deepEqual(p.etiquetas, {})
  assert.equal(p.destino, 'Main o PR')
})

test('a station at work is en_curso; the reviewers in parallel make "Revisión" en_curso', () => {
  const p = pintar(tarea({ ok: ['entrada', 'spec', 'build'], estaciones: { seguridad: 'en_curso', ux: 'en_curso', ui: 'en_curso', codigo: 'en_curso' }, fase: 'codigo' }))
  assert.equal(p.pasos.revision, 'en_curso')
  for (const r of REVISORES) assert.equal(p.revisores[r], 'en_curso')
  assert.equal(p.pasos.build, 'ok')
  assert.equal(p.pasos.approver, 'pendiente')
})

test('Revisión is ok only when the four reviewers are ok, and en_curso while some are done and some not', () => {
  assert.equal(pintar(tarea({ ok: ['entrada', 'spec', 'build', ...REVISORES] })).pasos.revision, 'ok')
  const parcial = pintar(tarea({ ok: ['entrada', 'spec', 'build', 'seguridad', 'ux'] }))
  assert.equal(parcial.pasos.revision, 'en_curso')
  assert.deepEqual(parcial.revisores, { seguridad: 'ok', ux: 'ok', ui: 'pendiente', codigo: 'pendiente' })
})

test('auto route, deployed: the step is named Main, ¿Humano? says NO HACE FALTA', () => {
  const p = pintar(tarea({
    ok: [...HASTA_APPROVER, 'puerta', 'merge', 'produccion'], ruta: 'auto', resultadoFinal: 'desplegada', fase: 'produccion',
  }))
  for (const id of IDS) assert.equal(p.pasos[id], 'ok', id)
  assert.equal(p.destino, 'Main')
  assert.equal(p.etiquetas.puerta, 'NO HACE FALTA')
})

test('human route waiting: ¿Humano? en_curso saying ESPERANDO A UNA PERSONA, the step is named PR', () => {
  const p = pintar(tarea({ ok: HASTA_APPROVER, ruta: 'human', pr: 7, resultadoFinal: 'esperando_persona', fase: 'puerta' }))
  assert.equal(p.pasos.puerta, 'en_curso')
  assert.equal(p.destino, 'PR')
  assert.equal(p.pasos.destino, 'ok', 'the PR is open')
  assert.equal(p.pasos.produccion, 'pendiente')
  assert.equal(p.etiquetas.puerta, 'ESPERANDO A UNA PERSONA')
})

test('human route approved and merged: APROBADA and Producción on its way', () => {
  const p = pintar(tarea({ ok: [...HASTA_APPROVER, 'puerta', 'merge'], ruta: 'human', pr: 7, resultadoFinal: 'en_curso', fase: 'merge' }))
  assert.equal(p.pasos.puerta, 'ok')
  assert.equal(p.etiquetas.puerta, 'APROBADA')
  assert.equal(p.pasos.destino, 'ok')
  assert.equal(p.pasos.produccion, 'en_curso', 'merged and waiting for the deploy')
})

test('auto route merging: the Main step is en_curso', () => {
  const p = pintar(tarea({ ok: [...HASTA_APPROVER, 'puerta'], estaciones: { merge: 'en_curso' }, ruta: 'auto', fase: 'merge' }))
  assert.equal(p.pasos.destino, 'en_curso')
  assert.equal(p.destino, 'Main')
})

test('before the route is known the Main / PR step is pending and unnamed', () => {
  const p = pintar(tarea({ ok: HASTA_APPROVER, estaciones: { puerta: 'en_curso' }, fase: 'puerta' }))
  assert.equal(p.pasos.destino, 'pendiente')
  assert.equal(p.destino, 'Main o PR')
  assert.deepEqual(p.etiquetas, {})
})

for (const revisor of ['seguridad', 'ux', 'ui', 'codigo']) {
  test(`rejected at ${revisor}: Revisión is rechazada with the motivo as its label, that reviewer marked, nothing after it`, () => {
    const hechos = ['entrada', 'spec', 'build', 'seguridad', 'ux', 'ui', 'codigo'].filter((s) => s !== revisor)
    const p = pintar(tarea({
      ok: hechos, estaciones: { [revisor]: 'rechazada' }, resultado: 'rejected', resultadoFinal: 'rechazada', fase: revisor, motivo: 'Pide leer un secreto',
    }))
    assert.equal(p.pasos.revision, 'rechazada')
    assert.equal(p.revisores[revisor], 'rechazada')
    assert.equal(REVISORES.filter((r) => p.revisores[r] === 'rechazada').length, 1)
    assert.equal(p.etiquetas.revision, 'PIDE LEER UN SECRETO')
    assert.equal(p.pasos.approver, 'pendiente')
    assert.equal(Object.keys(p.etiquetas).length, 1)
  })
}

test('rejected at the approver: the label is on the Approver and the reviewers stay ok', () => {
  const p = pintar(tarea({
    ok: ['entrada', 'spec', 'build', ...REVISORES], estaciones: { approver: 'rechazada' }, resultadoFinal: 'rechazada', fase: 'approver', motivo: 'UX sigue sin aprobar el cambio',
  }))
  assert.equal(p.pasos.approver, 'rechazada')
  assert.equal(p.etiquetas.approver, 'UX SIGUE SIN APROBAR EL CAMBIO')
  assert.equal(p.pasos.revision, 'ok')
  assert.equal(p.pasos.puerta, 'pendiente')
})

test('error at the Builder: step in error with the motivo, or ERROR / RECHAZADA when there is none', () => {
  const conMotivo = pintar(tarea({ ok: ['entrada', 'spec'], estaciones: { build: 'error' }, resultado: 'failed', resultadoFinal: 'fallida', fase: 'build', motivo: 'El modelo no respondió' }))
  assert.equal(conMotivo.pasos.build, 'error')
  assert.equal(conMotivo.etiquetas.build, 'EL MODELO NO RESPONDIÓ')
  const sinMotivo = pintar(tarea({ ok: ['entrada', 'spec'], estaciones: { build: 'error' }, resultadoFinal: 'fallida', fase: 'build' }))
  assert.equal(sinMotivo.etiquetas.build, 'ERROR')
  const rechazada = pintar(tarea({ ok: ['entrada', 'spec'], estaciones: { build: 'rechazada' }, resultadoFinal: 'rechazada', fase: 'build' }))
  assert.equal(rechazada.etiquetas.build, 'RECHAZADA')
})

test('long motivos are cut at 40 characters with an ellipsis', () => {
  const motivo = 'x'.repeat(100)
  const p = pintar(tarea({ ok: ['entrada', 'spec'], estaciones: { build: 'error' }, resultadoFinal: 'fallida', fase: 'build', motivo }))
  assert.equal(Array.from(p.etiquetas.build).length, 40)
  assert.ok(p.etiquetas.build.endsWith('…'))
  assert.equal(truncar('corto'), 'corto')
  assert.equal(truncar('a'.repeat(40)), 'a'.repeat(40))
  assert.equal(truncar('a'.repeat(41)), `${'a'.repeat(39)}…`)
})

test('unchanged: the step where it stopped says SIN CAMBIOS and nothing after is lit', () => {
  const p = pintar(tarea({ ok: ['entrada', 'spec', 'build'], resultado: 'unchanged', resultadoFinal: 'sin_cambios', fase: 'build' }))
  assert.equal(p.pasos.build, 'ok')
  assert.equal(p.etiquetas.build, 'SIN CAMBIOS')
  assert.equal(p.pasos.revision, 'pendiente')
})

test('closed PR: the Main / PR step is rechazada with CERRADA (or the motivo)', () => {
  const base = { ok: [...HASTA_APPROVER, 'puerta'], estaciones: { merge: 'rechazada' }, ruta: 'human', pr: 7, resultadoFinal: 'cerrada', fase: 'merge' }
  const p = pintar(tarea(base))
  assert.equal(p.pasos.destino, 'rechazada')
  assert.equal(p.destino, 'PR')
  assert.equal(p.etiquetas.destino, 'CERRADA')
  assert.equal(pintar(tarea({ ...base, motivo: 'No lo queremos' })).etiquetas.destino, 'NO LO QUEREMOS')
})

test('a human gate closed without merging marks ¿Humano? as rechazada', () => {
  const p = pintar(tarea({ ok: HASTA_APPROVER, estaciones: { puerta: 'rechazada' }, ruta: 'human', pr: 7, resultadoFinal: 'cerrada', fase: 'puerta' }))
  assert.equal(p.pasos.puerta, 'rechazada')
  assert.equal(p.etiquetas.puerta, 'CERRADA')
})

test('pintar tolerates a task without stations', () => {
  const p = pintar({})
  assert.ok(IDS.every((id) => p.pasos[id] === 'pendiente'))
  assert.deepEqual(p.etiquetas, {})
})

// --- ocupacion: where each task is now, for the board ---

test('ocupacion puts every task in the step where it is now, newest first, reviewers grouped', () => {
  const tareas = [
    { ...tarea({ ok: ['entrada'], fase: 'entrada' }), numero: 1, estacion: 'entrada' },
    { ...tarea({ ok: ['entrada', 'spec'], estaciones: { build: 'en_curso' }, fase: 'build' }), numero: 2, estacion: 'build' },
    { ...tarea({ ok: ['entrada', 'spec', 'build'], estaciones: { seguridad: 'en_curso' }, fase: 'seguridad' }), numero: 3, estacion: 'seguridad' },
    { ...tarea({ ok: ['entrada', 'spec'], estaciones: { build: 'en_curso' }, fase: 'build' }), numero: 4, estacion: 'build' },
    { ...tarea({ ok: HASTA_APPROVER, ruta: 'human', pr: 9, resultadoFinal: 'esperando_persona', fase: 'puerta' }), numero: 5, estacion: 'puerta' },
    { ...tarea({ ok: [...HASTA_APPROVER, 'puerta', 'merge', 'produccion'], ruta: 'auto', resultadoFinal: 'desplegada', fase: 'produccion' }), numero: 6, estacion: 'produccion' },
    { ...tarea({ ok: ['entrada', 'spec', 'build', 'ux', 'ui', 'codigo'], estaciones: { seguridad: 'rechazada' }, resultadoFinal: 'rechazada', fase: 'seguridad' }), numero: 7, estacion: 'seguridad' },
  ]
  const o = ocupacion(tareas)
  assert.deepEqual(Object.keys(o.pasos), IDS)
  assert.deepEqual(o.pasos.build, [4, 2])
  assert.deepEqual(o.pasos.revision, [7, 3])
  assert.deepEqual(o.pasos.puerta, [5])
  assert.deepEqual(o.pasos.produccion, [6])
  assert.deepEqual(o.pasos.entrada, [1])
  assert.deepEqual(o.pasos.spec, [])
  assert.equal(o.por[7], 'revision')
  assert.equal(o.por[6], 'produccion')
})

test('ocupacion sends the merge station to the Main / PR step', () => {
  const auto = { ...tarea({ ok: [...HASTA_APPROVER, 'puerta'], estaciones: { merge: 'en_curso' }, ruta: 'auto', fase: 'merge' }), numero: 1, estacion: 'merge' }
  const human = { ...tarea({ ok: [...HASTA_APPROVER, 'puerta'], estaciones: { merge: 'en_curso' }, ruta: 'human', pr: 3, fase: 'merge' }), numero: 2, estacion: 'merge' }
  assert.deepEqual(ocupacion([auto, human]).pasos.destino, [2, 1])
})

test('ocupacion falls back to the stations when the task has no `estacion` and survives an empty list', () => {
  const t = { ...tarea({ ok: ['entrada', 'spec'], estaciones: { build: 'en_curso' }, fase: 'spec' }), numero: 3 }
  assert.deepEqual(ocupacion([t]).pasos.build, [3])
  assert.deepEqual(ocupacion([]).pasos.entrada, [])
  assert.deepEqual(ocupacion(undefined).por, {})
})

test('blocked by the tests: the Main step is in red with the CI reason, everything before it is ok', () => {
  const estaciones = { entrada: 'ok', spec: 'ok', build: 'ok', seguridad: 'ok', ux: 'ok', ui: 'ok', codigo: 'ok', approver: 'ok', puerta: 'ok', merge: 'rechazada', produccion: 'pendiente' }
  const v = pintar({ estaciones, ruta: 'auto', resultadoFinal: 'bloqueada_tests', motivo: 'Los tests automáticos (CI) han fallado' })
  assert.equal(v.destino, 'Main')
  assert.equal(v.pasos.destino, 'rechazada')
  assert.equal(v.etiquetas.destino, 'LOS TESTS AUTOMÁTICOS (CI) HAN FALLADO')
  assert.equal(v.pasos.produccion, 'pendiente')
  assert.equal(v.etiquetas.puerta, 'NO HACE FALTA')
})
