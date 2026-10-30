import { test } from 'node:test'
import assert from 'node:assert/strict'
import { STATIONS } from '../lib/estado.js'
import { instantanea, PASOS_DEMO } from '../src/components/demo-datos.js'
import {
  ubica, claseFicha, marcaFicha, nombreAccesible, marcaNodo, aristasEncendidas, filas, panelPeticion, panelEstacion,
  totales, retencion, RETENCION_MS, registrarVistas, visibles, siguiendo, ordenFichas, rechazo, lineaViva,
} from '../src/lib/tablero.js'
import { geometria, camino, slotsDe, NODOS, IDS_NODOS, REVISORES, TOKEN, cx } from '../src/lib/geometria.js'

// A task as /api/estado returns it, every station pending unless told otherwise.
function tarea({ ok = [], estaciones = {}, ...resto } = {}) {
  const todas = Object.fromEntries(STATIONS.map((s) => [s, ok.includes(s) ? 'ok' : 'pendiente']))
  return { numero: 7, titulo: 'Un banner', perfil: 'marketing', tipo: null, fase: 'entrada', ruta: null, pr: null, motivo: null, vueltas: 0, resultadoFinal: 'en_curso', mensaje: 'Tu petición está en la factory', enlace: null, estacion: 'entrada', ...resto, estaciones: { ...todas, ...estaciones } }
}
const HASTA_REVISION = ['entrada', 'spec', 'build']
const HASTA_APPROVER = [...HASTA_REVISION, ...REVISORES, 'approver']

test('the token sits at the node of the station that is working, the gate and the end states', () => {
  assert.equal(ubica(tarea({ estacion: 'spec', estaciones: { spec: 'en_curso' } })), 'spec')
  assert.equal(ubica(tarea({ ok: HASTA_REVISION, estacion: 'ux', estaciones: { ux: 'en_curso' } })), 'ux')
  assert.equal(ubica(tarea({ ok: HASTA_APPROVER, estacion: 'puerta', estaciones: { puerta: 'en_curso' } })), 'puerta')
  assert.equal(ubica(tarea({ ok: HASTA_APPROVER, ruta: 'auto', estacion: 'merge', estaciones: { puerta: 'ok', merge: 'en_curso' } })), 'main')
  assert.equal(ubica(tarea({ ok: HASTA_APPROVER, ruta: 'human', pr: 4, resultadoFinal: 'esperando_persona', estacion: 'puerta' })), 'pr')
  assert.equal(ubica(tarea({ ok: STATIONS, resultadoFinal: 'desplegada', estacion: 'produccion' })), 'produccion')
  assert.equal(ubica(tarea({ resultadoFinal: 'sin_cambios', estacion: 'build' })), 'produccion', 'nothing to change: done')
  assert.equal(ubica(tarea({ estacion: 'inventada' })), 'entrada')
})

test('rejected, failed, closed and test-blocked requests all end in Rechazadas', () => {
  for (const r of ['rechazada', 'fallida', 'cerrada', 'bloqueada_tests']) assert.equal(ubica(tarea({ resultadoFinal: r, estacion: 'seguridad' })), 'rechazadas', r)
})

test('when the last reviewer finishes the token already moves on to the approver', () => {
  const t = tarea({ ok: [...HASTA_REVISION, ...REVISORES], fase: 'codigo', estacion: 'codigo' })
  assert.equal(ubica(t), 'approver')
  assert.equal(ubica({ ...t, estaciones: { ...t.estaciones, codigo: 'en_curso' } }), 'codigo', 'still reviewing')
})

test('a request sent back to Build is at Builder, with the approver and the reviewers pending', () => {
  const t = tarea({ ok: ['entrada', 'spec'], vueltas: 1, estacion: 'build', estaciones: { build: 'en_curso' } })
  assert.equal(ubica(t), 'build')
  assert.equal(marcaNodo(t, 'approver'), 'pendiente')
  assert.ok(aristasEncendidas(t, false).has('e-vuelta'), 'the dashed loop is lit once it has gone back')
  assert.ok(!aristasEncendidas(tarea({ ok: HASTA_REVISION }), false).has('e-vuelta'))
})

test('the token is a pill with a mark and a class by outcome, and an accessible name that says where it is', () => {
  const curso = tarea({ estacion: 'spec', estaciones: { spec: 'en_curso' } })
  assert.deepEqual([claseFicha(curso), marcaFicha(curso)], ['curso', '●'])
  const espera = tarea({ resultadoFinal: 'esperando_persona', estacion: 'puerta', pr: 12, ruta: 'human' })
  assert.deepEqual([claseFicha(espera), marcaFicha(espera)], ['espera', '–'])
  const ok = tarea({ resultadoFinal: 'desplegada', estacion: 'produccion' })
  assert.deepEqual([claseFicha(ok), marcaFicha(ok)], ['ok', '✓'])
  const rech = tarea({ resultadoFinal: 'rechazada', motivo: 'Lleva un enlace externo' })
  assert.deepEqual([claseFicha(rech), marcaFicha(rech)], ['rech', '!'])
  assert.equal(nombreAccesible(curso), 'Petición #7: Un banner, en Spec writer')
  assert.equal(nombreAccesible(espera), 'Petición #7: Un banner, esperando a una persona (PR #12)')
  assert.equal(nombreAccesible(ok), 'Petición #7: Un banner, en Producción')
  assert.equal(nombreAccesible(rech), 'Petición #7: Un banner, rechazada. Motivo: Lleva un enlace externo')
})

test('the marks of the nodes and the lit connectors follow the request: AUTO or PERSONA by the route', () => {
  const auto = tarea({ ok: [...HASTA_APPROVER, 'puerta'], ruta: 'auto', pr: 21, estacion: 'merge', estaciones: { merge: 'en_curso' } })
  assert.equal(marcaNodo(auto, 'main'), 'en_curso')
  assert.equal(marcaNodo(auto, 'pr'), 'pendiente')
  assert.equal(marcaNodo(auto, 'puerta'), 'ok')
  const on = aristasEncendidas(auto, false)
  assert.ok(on.has('e-auto') && !on.has('e-per'))
  for (const id of ['e1', 'e2', 'f-seguridad', 'j-codigo', 'e-ap']) assert.ok(on.has(id), id)

  const persona = tarea({ ok: HASTA_APPROVER, ruta: 'human', pr: 22, resultadoFinal: 'esperando_persona', estacion: 'puerta' })
  assert.equal(marcaNodo(persona, 'puerta'), 'en_curso', 'the gate waits for a person')
  assert.equal(marcaNodo(persona, 'pr'), 'en_curso')
  assert.equal(marcaNodo(persona, 'main'), 'pendiente')
  const onP = aristasEncendidas(persona, false)
  assert.ok(onP.has('e-per') && !onP.has('e-auto') && !onP.has('e-prm'))
  const aprobada = tarea({ ok: [...HASTA_APPROVER, 'puerta'], ruta: 'human', pr: 22, estacion: 'merge', estaciones: { merge: 'en_curso' } })
  assert.ok(aristasEncendidas(aprobada, false).has('e-prm'), 'after approval the PR goes on to Main')
})

test('a rejected request lights the way to Rechazadas and marks it; the vertical layout lights its own connectors', () => {
  const rech = tarea({ ok: [...HASTA_REVISION, 'ux', 'ui', 'codigo'], estaciones: { seguridad: 'rechazada', approver: 'rechazada' }, resultadoFinal: 'rechazada', estacion: 'approver', motivo: 'x' })
  assert.equal(marcaNodo(rech, 'rechazadas'), 'rechazada')
  assert.equal(marcaNodo(rech, 'seguridad'), 'rechazada')
  assert.ok(aristasEncendidas(rech, false).has('e-rech'))
  const spec = tarea({ ok: ['entrada'], estaciones: { spec: 'ok', build: 'ok', seguridad: 'ok' } })
  assert.ok(aristasEncendidas(spec, true).has('f-in'), 'vertical: the frame entry')
  assert.ok(!aristasEncendidas(spec, false).has('f-in'))
  assert.ok(aristasEncendidas(tarea({ ok: HASTA_APPROVER }), true).has('j-out'))
})

test('the panel lists the 11 stations with ✓ ● ! – and the word, the one the request is at marked', () => {
  const t = tarea({ ok: ['entrada', 'spec'], estacion: 'build', estaciones: { build: 'en_curso', seguridad: 'rechazada', ux: 'error' } })
  const f = filas(t)
  assert.deepEqual(f.map((x) => x.estacion), STATIONS)
  assert.deepEqual(f.map((x) => x.etiqueta), ['Entrada', 'Spec writer', 'Builder', 'Seguridad', 'UX', 'UI', 'Código', 'Approver', '¿Humano?', 'Main o PR', 'Producción'])
  const por = Object.fromEntries(f.map((x) => [x.estacion, x]))
  assert.deepEqual([por.entrada.glifo, por.entrada.palabra], ['✓', 'hecho'])
  assert.deepEqual([por.build.glifo, por.build.palabra, por.build.aqui], ['●', 'en curso', true])
  assert.deepEqual([por.seguridad.glifo, por.seguridad.palabra], ['!', 'rechazada'])
  assert.deepEqual([por.ux.glifo, por.ux.palabra], ['!', 'error'])
  assert.deepEqual([por.ui.glifo, por.ui.palabra, por.ui.aqui], ['–', 'pendiente', false])
})

test('a request that has passed the approver and waits for the gate shows the gate working, in the node and in the panel', () => {
  const t = tarea({ ok: HASTA_APPROVER, resultado: 'ok', fase: 'puerta', estacion: 'puerta' })
  assert.equal(marcaNodo(t, 'puerta'), 'en_curso')
  assert.equal(filas(t).find((f) => f.estacion === 'puerta').estado, 'en_curso')
  assert.equal(marcaNodo(tarea({ ok: ['entrada'], estacion: 'spec' }), 'puerta'), 'pendiente', 'not there yet')
})

test('the panel says auto or persona at the gate and Main ✓ or PR #n at the merge', () => {
  const por = (t) => Object.fromEntries(filas(t).map((x) => [x.estacion, x]))
  const persona = por(tarea({ ok: HASTA_APPROVER, ruta: 'human', pr: 57, resultadoFinal: 'esperando_persona', estacion: 'puerta' }))
  assert.deepEqual([persona.puerta.estado, persona.puerta.texto, persona.merge.texto], ['en_curso', 'persona', 'PR #57'])
  const auto = por(tarea({ ok: [...HASTA_APPROVER, 'puerta', 'merge'], ruta: 'auto', pr: 21, estacion: 'merge' }))
  assert.deepEqual([auto.puerta.estado, auto.puerta.texto, auto.merge.texto], ['ok', 'auto', 'Main ✓'])
  assert.equal(por(tarea())['puerta'].texto, null)
})

test('the panel of a request: title, profile, kind, state, motivo of a refusal, links only to safe places', () => {
  const cola = [{ pr: 22, tarea: 7, titulo: 'Un banner', url: 'https://github.com/o/r/pull/22' }, { pr: 23, tarea: 8, titulo: 'x', url: 'javascript:alert(1)' }]
  const espera = tarea({ perfil: 'negocio', tipo: 'precios', ruta: 'human', pr: 22, resultadoFinal: 'esperando_persona', mensaje: 'Tu petición espera a una persona que la revise', estacion: 'puerta' })
  const p = panelPeticion(espera, cola)
  assert.deepEqual([p.numero, p.titulo, p.mensaje], [7, 'Un banner', 'Tu petición espera a una persona que la revise'])
  assert.deepEqual(p.etiquetas, ['perfil · negocio', 'tipo · precios', 'estación · PR'])
  assert.deepEqual(p.pr, { numero: 22, url: 'https://github.com/o/r/pull/22' })
  assert.equal(p.motivo, null)
  assert.equal(p.filas.length, 11)
  assert.equal(panelPeticion({ ...espera, pr: 23 }, cola).pr.url, null, 'an unknown or unsafe address is not a link')
  assert.equal(panelPeticion({ ...espera, pr: 99 }, cola).pr.url, null)
  assert.equal(panelPeticion({ ...espera, enlace: '//evil.example' }, cola).enlace, null)
  assert.equal(panelPeticion({ ...espera, enlace: '/catalogo/' }, cola).enlace, '/catalogo/')
  const rech = panelPeticion(tarea({ resultadoFinal: 'rechazada', estaciones: { seguridad: 'rechazada' }, motivo: 'Lleva un enlace externo', estacion: 'seguridad' }), [])
  assert.deepEqual(rech.motivo, { titulo: 'Rechazada por Seguridad:', motivo: 'Lleva un enlace externo' })
  assert.equal(rech.etiquetas[1], 'estación · Rechazadas')
  assert.equal(rech.pr, null)
})

test('the panel of a station: what it does and the requests that are in it', () => {
  const a = tarea({ numero: 3, estacion: 'spec', estaciones: { spec: 'en_curso' } })
  const b = tarea({ numero: 9, estacion: 'spec', estaciones: { spec: 'en_curso' } })
  const c = tarea({ numero: 5, estacion: 'build', estaciones: { build: 'en_curso' } })
  const p = panelEstacion('spec', [a, b, c])
  assert.deepEqual([p.titulo, p.paso, p.hace], ['Spec writer', 'Estación 2 de 11', NODOS.spec.hace])
  assert.deepEqual(p.aqui.map((t) => t.numero), [9, 3], 'newest first')
  assert.equal(panelEstacion('rechazadas', []).paso, 'Estación final')
  assert.deepEqual(panelEstacion('puerta', []).aqui, [])
})

test('the counters add the ways a request can end badly under "Rechazadas"', () => {
  assert.deepEqual(totales({ peticiones: 9, desplegadas: 4, esperando: 2, rechazadas: 1, fallidas: 1, cerradas: 1, bloqueadas_tests: 2 }), { peticiones: 9, desplegadas: 4, esperando: 2, rechazadas: 5 })
  assert.deepEqual(totales(undefined), { peticiones: 0, desplegadas: 0, esperando: 0, rechazadas: 0 })
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

test('retention: finished requests leave after their time, the one you follow stays, those already finished on arrival never show', () => {
  const fin = tarea({ numero: 1, resultadoFinal: 'rechazada' })
  const prod = tarea({ numero: 2, resultadoFinal: 'desplegada' })
  const viva = tarea({ numero: 3 })
  const vistas = new Map()
  registrarVistas(vistas, [fin, prod, viva], 1000, { alAbrir: true })
  assert.deepEqual(visibles([fin, prod, viva], vistas, null, 1000).map((t) => t.numero), [3], 'finished before the page opened: only in the counters')
  registrarVistas(vistas, [fin, prod, viva], 2000, { alAbrir: true })
  assert.deepEqual(visibles([fin, prod, viva], vistas, 1, 2000).map((t) => t.numero), [1, 3], 'the followed one stays')
  const nueva = tarea({ numero: 4, resultadoFinal: 'rechazada' })
  const nueva2 = tarea({ numero: 5, resultadoFinal: 'desplegada' })
  registrarVistas(vistas, [fin, prod, viva, nueva, nueva2], 10000, { alAbrir: false })
  assert.deepEqual(visibles([nueva, nueva2, viva], vistas, null, 10000).map((t) => t.numero), [4, 5, 3])
  assert.deepEqual(visibles([nueva, nueva2, viva], vistas, null, 14001).map((t) => t.numero), [4, 3], 'deployed leaves after 4 s')
  assert.deepEqual(visibles([nueva, nueva2, viva], vistas, null, 40001).map((t) => t.numero), [3], 'rejected leaves after 30 s')
  assert.deepEqual(visibles([nueva, nueva2, viva], vistas, null, 11000).map((t) => t.numero), [3], 'and never comes back')
  registrarVistas(vistas, [viva], 50000, { alAbrir: false })
  assert.deepEqual([...vistas.keys()], [], 'gone from the list: forgotten')
  const demo = new Map()
  registrarVistas(demo, [fin], 0, { alAbrir: true, demo: true })
  assert.equal(visibles([fin], demo, null, 0).length, 1, 'the demo shows what it rehearses')
})

test('the follow line names the request, its title and where it is; otherwise it says it is not visible yet', () => {
  const t = tarea({ numero: 43, titulo: 'El botón del hero no se ve bien', estaciones: { spec: 'en_curso' }, estacion: 'spec' })
  assert.equal(siguiendo(43, t), 'Siguiendo #43: «El botón del hero no se ve bien» · ahora en Spec writer')
  assert.equal(siguiendo(43, null), 'Todavía no vemos la petición #43.')
  assert.equal(siguiendo(null, null), '')
  const rechazada = tarea({ numero: 3, titulo: 'X', estacion: 'seguridad', resultadoFinal: 'rechazada', mensaje: 'La factory ha rechazado tu petición', estaciones: { seguridad: 'rechazada' } })
  assert.equal(siguiendo(3, rechazada), 'Siguiendo #3: «X» · La factory ha rechazado tu petición')
  assert.equal(rechazo(tarea({ resultadoFinal: 'fallida', estaciones: { build: 'error' }, motivo: 'Sin respuesta' })).titulo, 'Fallida en Builder:')
})

test('tokens are ordered newest first, the followed one first of all', () => {
  assert.deepEqual(ordenFichas([3, 9, 5], 5), [5, 9, 3])
  assert.deepEqual(ordenFichas([3, 9, 5], null), [9, 5, 3])
})

// --- geometry ---

test('both layouts have the 13 nodes, every connector joins existing nodes and stays on the canvas', () => {
  for (const vertical of [false, true]) {
    const g = geometria(vertical)
    assert.deepEqual(Object.keys(g.N).sort(), [...IDS_NODOS].sort(), `nodes (${vertical ? 'vertical' : 'horizontal'})`)
    for (const e of g.E) {
      assert.ok(g.N[e.a] || e.a === 'marco', `${e.id} from ${e.a}`)
      assert.ok(g.N[e.b] || e.b === 'marco', `${e.id} to ${e.b}`)
      for (const p of e.pts) assert.ok(p.x >= 0 && p.x <= g.W && p.y >= 0 && p.y <= g.H, `${e.id} inside the canvas`)
    }
    for (const id of ['e-auto', 'e-per', 'e-prm', 'e-rech', 'e-vuelta', 'e-ap']) assert.ok(g.E.some((e) => e.id === id), id)
    assert.equal(g.E.find((e) => e.id === 'e-vuelta').vuelta, true, 'the loop is the dashed one')
    assert.equal(g.E.find((e) => e.id === 'e-auto').lab, 'AUTO')
    assert.equal(g.E.find((e) => e.id === 'e-per').lab, 'PERSONA')
  }
  assert.ok(geometria(false).W > geometria(true).W)
})

test('a token travels the connectors: along the flow, the AUTO or PERSONA edge, and the dashed loop when it went back', () => {
  const g = geometria(false)
  const ids = (a, b, o) => camino(g, a, b, o)?.aristas.map((e) => e.id)
  assert.deepEqual(ids('entrada', 'spec'), ['e1'])
  assert.deepEqual(ids('approver', 'puerta'), ['e-ap'])
  assert.deepEqual(ids('puerta', 'main'), ['e-auto'])
  assert.deepEqual(ids('puerta', 'pr'), ['e-per'])
  assert.deepEqual(ids('pr', 'main'), ['e-prm'])
  assert.deepEqual(ids('approver', 'rechazadas'), ['e-rech'])
  assert.deepEqual(ids('seguridad', 'ui'), ['t-seguridad-ui'], 'between reviewers, along the bus')
  assert.deepEqual(ids('approver', 'build'), ['e-vuelta'])
  assert.deepEqual(ids('approver', 'build', { conVuelta: true }), ['e-vuelta'])
  assert.deepEqual(ids('ui', 'build', { conVuelta: true }), ['j-ui', 'e-vuelta'])
  assert.deepEqual(ids('build', 'build', { conVuelta: true }), ['f-seguridad', 'j-seguridad', 'e-vuelta'], 'a whole round missed between two polls still shows the loop')
  assert.equal(camino(g, 'spec', 'spec'), null)
  assert.equal(camino(g, 'spec', 'rechazadas'), null, 'refused early: it slides straight')
  const puntos = camino(g, 'entrada', 'build').puntos
  assert.ok(puntos.length >= 4)
})

test('the slots of a node: one row, newest first, and "+N" when they do not fit', () => {
  const g = geometria(false)
  const s = slotsDe(g.N.spec, [9, 5])
  assert.deepEqual(s.out.map((o) => o.numero), [9, 5])
  assert.equal(s.out[1].x - s.out[0].x, TOKEN.paso)
  assert.equal(s.colapsa, false)
  const lleno = slotsDe(g.N.spec, [1, 2, 3, 4, 5])
  assert.equal(lleno.colapsa, true)
  assert.deepEqual(lleno.out.map((o) => o.visible), [true, true, false, false, false])
  assert.equal(lleno.resto, 3)
  assert.equal(lleno.masX, lleno.out[2].x)
  const puerta = slotsDe(g.N.puerta, [1])
  assert.ok(Math.abs(puerta.out[0].x + (TOKEN.ancho - 0) / 2 - cx(g.N.puerta)) < TOKEN.paso, 'the gate centres its tokens in the diamond')
})

// --- the demo feeds the board with what the API returns ---

test('every step of the demo gives each request a node, a panel and a path (the board never gets lost)', () => {
  const vistos = new Set()
  for (let paso = 0; paso < PASOS_DEMO; paso++) {
    const datos = instantanea(paso)
    for (const t of datos.tareas) {
      const nodo = ubica(t)
      vistos.add(nodo)
      assert.ok(NODOS[nodo], `#${t.numero} step ${paso}: ${nodo}`)
      assert.equal(panelPeticion(t, datos.cola).filas.length, 11)
      assert.ok(aristasEncendidas(t, false) instanceof Set)
      assert.ok(Number.isInteger(t.vueltas) && t.vueltas >= 0 && t.vueltas <= 2)
    }
    const c = totales(datos.contadores)
    assert.ok(c.peticiones === datos.tareas.length)
  }
  for (const nodo of ['spec', 'build', 'seguridad', 'approver', 'puerta', 'pr', 'main', 'produccion', 'rechazadas']) assert.ok(vistos.has(nodo), `the demo passes through ${nodo}`)
  assert.ok(instantanea(PASOS_DEMO - 1).tareas.some((t) => t.vueltas === 1), 'the demo has a request that went back to Build')
})

test('the live region says what is happening to the followed request, with the motivo of a refusal', () => {
  const t = tarea({ ok: HASTA_REVISION, estaciones: Object.fromEntries(REVISORES.map((r) => [r, 'en_curso'])) })
  assert.equal(lineaViva(7, t), 'Petición #7: Cuatro revisores miran tu cambio a la vez: Seguridad, UX y UI son modelos; Código es código.')
  const rech = tarea({ ok: HASTA_REVISION, estaciones: { seguridad: 'rechazada' }, resultadoFinal: 'rechazada', motivo: 'Lleva un enlace externo' })
  assert.equal(lineaViva(7, rech), 'Petición #7: Seguridad ha rechazado tu petición. No se publica nada. Motivo: Lleva un enlace externo')
  assert.equal(lineaViva(9, undefined), 'Todavía no vemos la petición #9.', 'a request the board does not list yet keeps the old line')
  assert.equal(lineaViva(null, t), '')
  assert.equal(panelPeticion(t).narrativa.pasos.length, 11, 'the panel carries the narrative')
})
