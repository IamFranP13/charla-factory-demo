import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { STATIONS } from '../lib/estado.js'
import { ESTACIONES, QUIEN, RECORRIDO, narrativa, texto, etiquetaQuien } from '../src/lib/explica.js'
import { IDS_NODOS, NODOS, geometria, envuelve, CARACTERES_POR_PX, LINEAS_NODO } from '../src/lib/geometria.js'
import { instantanea, PASOS_DEMO } from '../src/components/demo-datos.js'
import { panelEstacion } from '../src/lib/tablero.js'

// A task as /api/estado returns it, every station pending unless told otherwise.
function tarea({ ok = [], estaciones = {}, ...resto } = {}) {
  const todas = Object.fromEntries(STATIONS.map((s) => [s, ok.includes(s) ? 'ok' : 'pendiente']))
  return { numero: 7, titulo: 'Un banner', perfil: 'marketing', tipo: null, fase: 'entrada', ruta: null, pr: null, motivo: null, vueltas: 0, resultadoFinal: 'en_curso', mensaje: 'Tu petición está en la factory', enlace: null, estacion: 'entrada', ...resto, estaciones: { ...todas, ...estaciones } }
}
const REV = ['seguridad', 'ux', 'ui', 'codigo']
const HASTA_REVISION = ['entrada', 'spec', 'build']
const HASTA_APPROVER = [...HASTA_REVISION, ...REV, 'approver']

// Every string the module can say: the stations (with and without a route), the tour and a narrative of each kind.
function todosLosTextos() {
  const salida = []
  for (const id of Object.keys(ESTACIONES)) {
    for (const campo of ['quien', 'linea', 'largo', 'en_curso', 'hecho', 'rechazada']) {
      for (const ctx of [{}, { ruta: 'auto' }, { ruta: 'human', pr: 3, tipo: 'precios', vueltas: 1 }]) salida.push(texto(id, campo, ctx))
    }
  }
  for (const paso of RECORRIDO) salida.push(paso.titulo, paso.texto)
  for (let p = 0; p < PASOS_DEMO; p++) {
    for (const t of instantanea(p).tareas) {
      const n = narrativa(t)
      salida.push(n.titulo, n.texto, n.motivo ?? '', n.vueltas ?? '', ...n.pasos.map((x) => x.frase))
    }
  }
  return salida.filter((s) => typeof s === 'string')
}

test('every node says who does it and its one line; every station says what is happening now', () => {
  assert.deepEqual(Object.keys(ESTACIONES).sort(), [...IDS_NODOS].sort())
  for (const [id, e] of Object.entries(ESTACIONES)) {
    assert.ok(QUIEN[e.quien], `${id}: quien`)
    assert.ok(e.linea && e.linea.length <= 36, `${id}: a short line (${e.linea?.length})`)
    assert.ok(e.largo.length > 20, `${id}: the longer explanation`)
    if (id !== 'rechazadas') for (const campo of ['en_curso', 'hecho', 'rechazada']) assert.ok(texto(id, campo, { ruta: 'auto' }), `${id}: ${campo}`)
  }
  assert.deepEqual(['seguridad', 'ux', 'ui', 'spec', 'build'].map((s) => ESTACIONES[s].quien), Array(5).fill('modelo'))
  assert.deepEqual(['codigo', 'approver', 'puerta'].map((s) => ESTACIONES[s].quien), Array(3).fill('codigo'), 'Código, Approver and the gate are code')
  assert.equal(ESTACIONES.pr.quien, 'persona')
  assert.equal(etiquetaQuien('codigo'), 'CÓDIGO')
  assert.equal(NODOS.spec.hace, ESTACIONES.spec.largo, 'the panel reads the same texts')
})

test('the gate texts depend on the route', () => {
  assert.notEqual(texto('puerta', 'en_curso', { ruta: 'auto' }), texto('puerta', 'en_curso', { ruta: 'human' }))
  assert.match(texto('puerta', 'hecho', { ruta: 'auto' }), /AUTO/)
  assert.match(texto('puerta', 'hecho', { ruta: 'human' }), /PERSONA/)
})

test('the box lines fit their boxes in both layouts: at most two lines, wrapped on whole words', () => {
  assert.deepEqual(envuelve('uno dos tres', 8), ['uno dos', 'tres'])
  assert.deepEqual(envuelve('corto', 20), ['corto'])
  for (const vertical of [false, true]) {
    const { N } = geometria(vertical)
    for (const id of IDS_NODOS) {
      const lineas = envuelve(ESTACIONES[id].linea, Math.floor(((N[id].dec ? 150 : N[id].w - 24)) * CARACTERES_POR_PX))
      assert.ok(lineas.length <= LINEAS_NODO, `${vertical ? 'v' : 'h'}/${id}: ${lineas.join(' | ')}`)
      assert.equal(lineas.join(' '), ESTACIONES[id].linea)
    }
  }
})

test('the tour has 8 steps: the four reviewers as one and the gate as one, every node of the diagram once', () => {
  assert.equal(RECORRIDO.length, 8)
  assert.deepEqual(RECORRIDO.map((p) => p.titulo), ['Entrada', 'Spec writer', 'Builder', 'Cuatro revisores a la vez', 'Approver', '¿Humano?', 'Main o PR', 'Producción'])
  assert.deepEqual(RECORRIDO.flatMap((p) => p.nodos).sort(), IDS_NODOS.filter((n) => n !== 'rechazadas').sort())
  for (const p of RECORRIDO) assert.ok(p.texto.length > 40 && p.quien, p.id)
})

test('narrative: in progress at each station, in plain words addressed to "tu petición"', () => {
  const dichas = new Set()
  const espera = (estacion, previas, extra = {}) => narrativa(tarea({ ok: previas, estacion, estaciones: { [estacion]: 'en_curso' }, ...extra }))
  const casos = [
    ['entrada', [], /entrado|entrar/i],
    ['spec', ['entrada'], /Spec writer.*tipo/],
    ['build', ['entrada', 'spec'], /Builder escribe/],
    ['approver', [...HASTA_REVISION, ...REV], /Approver.*cuatro/],
  ]
  for (const [estacion, previas, patron] of casos) {
    const n = espera(estacion, previas)
    assert.match(n.texto, patron, estacion)
    assert.match(n.titulo, /^En curso/)
    dichas.add(n.texto)
  }
  for (const r of REV) {
    const n = espera(r, HASTA_REVISION)
    assert.match(n.texto, /tu cambio/, r)
    dichas.add(n.texto)
  }
  assert.equal(dichas.size, 8, 'each one says something of its own')
  const todos = narrativa(tarea({ ok: HASTA_REVISION, estaciones: Object.fromEntries(REV.map((r) => [r, 'en_curso'])) }))
  assert.match(todos.texto, /Cuatro revisores miran tu cambio a la vez/)
  assert.equal(todos.titulo, 'En curso · Revisión en paralelo')
  const puerta = narrativa(tarea({ ok: HASTA_APPROVER, estacion: 'puerta' }))
  assert.match(puerta.texto, /puerta/i, 'the gate is working once the approver is done')
  assert.equal(puerta.pasos.find((p) => p.estacion === 'puerta').estado, 'en_curso')
  const main = narrativa(tarea({ ok: [...HASTA_APPROVER, 'puerta'], ruta: 'auto', pr: 4, estacion: 'merge', estaciones: { merge: 'en_curso' } }))
  assert.match(main.texto, /main/)
  const prod = narrativa(tarea({ ok: [...HASTA_APPROVER, 'puerta', 'merge'], ruta: 'auto', estacion: 'produccion', estaciones: { produccion: 'en_curso' } }))
  assert.match(prod.texto, /Cloudflare/)
})

test('narrative: the steps keep ✓ ● ! – and each has its phrase', () => {
  const n = narrativa(tarea({ ok: ['entrada', 'spec'], tipo: 'campana', estacion: 'build', estaciones: { build: 'en_curso', ux: 'rechazada', ui: 'error' } }))
  assert.deepEqual(n.pasos.map((p) => p.estacion), STATIONS)
  const por = Object.fromEntries(n.pasos.map((p) => [p.estacion, p]))
  assert.deepEqual([por.entrada.estado, por.build.estado, por.ux.estado, por.ui.estado, por.seguridad.estado], ['ok', 'en_curso', 'rechazada', 'error', 'pendiente'])
  assert.match(por.spec.frase, /«campana»/)
  assert.match(por.seguridad.frase, /^Después: /)
  assert.match(por.ui.frase, /falló/)
  for (const p of n.pasos) assert.ok(p.frase.length > 5, p.estacion)
})

test('narrative: waiting for a person, deployed and nothing to change', () => {
  const espera = narrativa(tarea({ ok: HASTA_APPROVER, ruta: 'human', pr: 22, resultadoFinal: 'esperando_persona', estacion: 'puerta' }))
  assert.equal(espera.titulo, 'Esperando a una persona')
  assert.match(espera.texto, /PR #22.*persona/)
  assert.match(espera.pasos.find((p) => p.estacion === 'merge').frase, /^Después: espera a una persona/)
  const hecha = narrativa(tarea({ ok: STATIONS, ruta: 'auto', resultadoFinal: 'desplegada', estacion: 'produccion' }))
  assert.deepEqual([hecha.titulo, hecha.texto], ['En producción', 'Tu cambio ya está en la web.'])
  assert.equal(hecha.motivo, null)
  assert.match(narrativa(tarea({ resultadoFinal: 'sin_cambios' })).texto, /No hacía falta cambiar nada/)
})

test('narrative: rejected and failed name the station and carry the final motivo; nothing per-station is invented', () => {
  const rech = narrativa(tarea({ ok: [...HASTA_REVISION, 'ux', 'ui', 'codigo'], estaciones: { seguridad: 'rechazada' }, resultadoFinal: 'rechazada', motivo: 'Lleva un enlace a una web externa' }))
  assert.equal(rech.titulo, 'Rechazada')
  assert.match(rech.texto, /^Seguridad ha rechazado tu petición\. No se publica nada\.$/)
  assert.equal(rech.motivo, 'Lleva un enlace a una web externa')
  assert.ok(!rech.pasos.some((p) => p.frase.includes('enlace')), 'the motivo is the final one, never put on a step')
  const fallida = narrativa(tarea({ ok: ['entrada', 'spec'], estaciones: { build: 'error' }, resultadoFinal: 'fallida', motivo: 'El modelo no respondió' }))
  assert.match(fallida.texto, /no ha podido con tu petición \(falló en Builder\)/)
  assert.equal(fallida.motivo, 'El modelo no respondió')
  assert.match(narrativa(tarea({ resultadoFinal: 'bloqueada_tests', motivo: 'Fallan los tests' })).texto, /tests automáticos/)
  assert.match(narrativa(tarea({ resultadoFinal: 'cerrada' })).texto, /cerrado el PR/)
  assert.equal(narrativa(tarea({ resultadoFinal: 'en_curso', motivo: 'ruido' })).motivo, null, 'only a finished refusal shows a motivo')
})

test('narrative: a request the approver sent back says so, and Builder is redoing it', () => {
  const n = narrativa(tarea({ ok: ['entrada', 'spec'], vueltas: 1, estacion: 'build', estaciones: { build: 'en_curso' } }))
  assert.match(n.vueltas, /^El Approver la devolvió a Build una vez: /)
  assert.match(n.texto, /Builder rehace tu cambio/)
  assert.equal(narrativa(tarea({ vueltas: 2 })).vueltas.includes('dos veces'), true)
  assert.equal(narrativa(tarea()).vueltas, null)
})

test('narrative: it reads only the fields the API returns and survives a task with nothing in it', () => {
  const n = narrativa({ numero: 1, resultadoFinal: 'en_curso' })
  assert.equal(n.pasos.length, STATIONS.length)
  assert.ok(n.texto)
  const fuente = readFileSync(new URL('../src/lib/explica.js', import.meta.url), 'utf8')
  const campos = new Set([...fuente.matchAll(/\bt\.([a-zA-Z_]+)/g)].map((m) => m[1]))
  assert.deepEqual([...campos].sort(), ['estaciones', 'motivo', 'pr', 'resultadoFinal', 'ruta', 'tipo', 'vueltas'])
  assert.ok(!fuente.includes('innerHTML'))
})

test('the texts speak to "tú", never in voseo, and say no HTML', () => {
  const voseo = /\b(tenés|podés|mirá|querés|sabés|hacé|decí|fijate|pedí|escribí|vos|sos|tocá|seguí|esperá|entrá|aprobá)\b/i
  const textos = todosLosTextos()
  assert.ok(textos.length > 200)
  for (const s of textos) {
    assert.doesNotMatch(s, voseo, s)
    assert.doesNotMatch(s, /[<>]/, s)
  }
})

test('the panel of a station reuses the long text and says who does it', () => {
  const p = panelEstacion('codigo', [])
  assert.equal(p.hace, ESTACIONES.codigo.largo)
  assert.equal(p.quien, 'CÓDIGO')
  assert.equal(p.linea, ESTACIONES.codigo.linea)
})
