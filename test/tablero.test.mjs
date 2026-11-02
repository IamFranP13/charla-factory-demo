import { test } from 'node:test'
import assert from 'node:assert/strict'
import { STATIONS } from '../lib/estado.js'
import { instantanea, PASOS_DEMO } from '../src/components/demo-datos.js'
import {
  ubica, ficha, claseFicha, marcaFicha, nombreAccesible, marcaNodo, aristasEncendidas, filas, panelPeticion, panelEstacion,
  totales, retencion, RETENCION_MS, registrarVistas, visibles, siguiendo, ordenFichas, rechazo, lineaViva,
} from '../src/lib/tablero.js'
import { geometria, slotsDe, envuelve, CARACTERES_POR_PX, NODOS, IDS_NODOS, REVISORES, TOKEN, cx, cy } from '../src/lib/geometria.js'
import { ESTACIONES } from '../src/lib/explica.js'
import { vistaAhora, frescura } from '../src/lib/ahora.js'

// A task as /api/estado returns it, every station pending unless told otherwise.
function tarea({ ok = [], estaciones = {}, ...resto } = {}) {
  const todas = Object.fromEntries(STATIONS.map((s) => [s, ok.includes(s) ? 'ok' : 'pendiente']))
  return { numero: 7, titulo: 'Un banner', perfil: 'marketing', tipo: null, fase: 'entrada', ruta: null, pr: null, motivo: null, vueltas: 0, resultadoFinal: 'en_curso', mensaje: 'Tu petición está en la factory', enlace: null, estacion: 'entrada', ...resto, estaciones: { ...todas, ...estaciones } }
}
const HASTA_REVISION = ['entrada', 'spec', 'build']
const HASTA_APPROVER = [...HASTA_REVISION, ...REVISORES, 'approver']

test('the token sits at the node of the station that is working, the gate and the end states', () => {
  assert.equal(ubica(tarea({ estacion: 'spec', estaciones: { spec: 'en_curso' } })), 'spec')
  assert.equal(ubica(tarea({ ok: HASTA_REVISION, estacion: 'ux', estaciones: { ux: 'en_curso' } })), 'seguridad', 'one token for the whole review, it does not hop between reviewers')
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

test('where the token sits and in which state: working, done-and-waiting for the next station, waiting for a person, the end states', () => {
  const f = (t) => [ficha(t).nodo, ficha(t).estado]
  assert.deepEqual(f(tarea({ ok: ['entrada'], estacion: 'spec', estaciones: { spec: 'en_curso' } })), ['spec', 'trabajando'])
  assert.deepEqual(f(tarea({ ok: ['entrada', 'spec'], fase: 'spec', estacion: 'spec' })), ['spec', 'hecho'], 'Spec writer finished, Builder has not started: the ✓ stays in Spec writer')
  assert.deepEqual(f(tarea({ ok: HASTA_REVISION, fase: 'build', estacion: 'build' })), ['build', 'hecho'])
  assert.deepEqual(f(tarea({ ok: ['entrada', 'spec'], estacion: 'build', estaciones: { build: 'en_curso' } })), ['build', 'trabajando'])
  // the four reviewers: one token, working until all four are done, then ✓ in the same place
  const revisando = tarea({ ok: [...HASTA_REVISION, 'seguridad', 'ux'], estacion: 'ui', estaciones: { ui: 'en_curso', codigo: 'en_curso' } })
  assert.deepEqual(f(revisando), ['seguridad', 'trabajando'])
  assert.deepEqual(f({ ...revisando, estacion: 'codigo', estaciones: { ...revisando.estaciones, ui: 'ok' } }), ['seguridad', 'trabajando'], 'one reviewer still working')
  const revisados = tarea({ ok: [...HASTA_REVISION, ...REVISORES], fase: 'codigo', estacion: 'codigo' })
  assert.deepEqual(f(revisados), ['seguridad', 'hecho'], 'the four approved, the approver has not started')
  assert.deepEqual(f({ ...revisados, estacion: 'approver', estaciones: { ...revisados.estaciones, approver: 'en_curso' } }), ['approver', 'trabajando'])
  // approver → gate → merge → production
  assert.deepEqual(f(tarea({ ok: HASTA_APPROVER, fase: 'approver', estacion: 'approver' })), ['approver', 'hecho'], 'approved, the gate has not started')
  assert.deepEqual(f(tarea({ ok: HASTA_APPROVER, resultado: 'ok', fase: 'puerta', estacion: 'puerta' })), ['puerta', 'trabajando'], 'the gate is deciding')
  assert.deepEqual(f(tarea({ ok: [...HASTA_APPROVER, 'puerta'], ruta: 'auto', pr: 21, fase: 'puerta', estacion: 'puerta' })), ['puerta', 'hecho'], 'gate said auto, merge has not started')
  assert.deepEqual(f(tarea({ ok: [...HASTA_APPROVER, 'puerta'], ruta: 'auto', pr: 21, estacion: 'merge', estaciones: { merge: 'en_curso' } })), ['main', 'trabajando'])
  assert.deepEqual(f(tarea({ ok: [...HASTA_APPROVER, 'puerta', 'merge'], ruta: 'auto', pr: 21, fase: 'merge', estacion: 'merge' })), ['main', 'hecho'], 'merged, waiting for the deploy')
  assert.deepEqual(f(tarea({ ok: [...HASTA_APPROVER, 'puerta', 'merge'], ruta: 'auto', pr: 21, estacion: 'produccion', estaciones: { produccion: 'en_curso' } })), ['produccion', 'trabajando'])
  // waiting for a person
  assert.deepEqual(f(tarea({ ok: HASTA_APPROVER, ruta: 'human', pr: 4, resultadoFinal: 'esperando_persona', estacion: 'puerta' })), ['pr', 'espera'])
  assert.deepEqual(f(tarea({ ok: [...HASTA_APPROVER, 'puerta'], ruta: 'human', pr: 4, fase: 'puerta', estacion: 'puerta' })), ['pr', 'hecho'], 'a person approved, merge has not started')
  // end states
  assert.deepEqual(f(tarea({ ok: STATIONS, resultadoFinal: 'desplegada', estacion: 'produccion' })), ['produccion', 'desplegada'])
  assert.deepEqual(f(tarea({ resultadoFinal: 'sin_cambios', estacion: 'build' })), ['produccion', 'desplegada'])
  assert.deepEqual(f(tarea({ resultadoFinal: 'rechazada', estacion: 'seguridad' })), ['rechazadas', 'rechazada'])
  // sent back to Build: working there again
  assert.deepEqual(f(tarea({ ok: ['entrada', 'spec'], vueltas: 1, estacion: 'build', estaciones: { build: 'en_curso' } })), ['build', 'trabajando'])
})

test('a request sent back to Build is at Builder, with the approver and the reviewers pending', () => {
  const t = tarea({ ok: ['entrada', 'spec'], vueltas: 1, estacion: 'build', estaciones: { build: 'en_curso' } })
  assert.equal(ubica(t), 'build')
  assert.equal(marcaNodo(t, 'approver'), 'pendiente')
  assert.ok(aristasEncendidas(t, false).has('e-vuelta'), 'the dashed loop is lit once it has gone back')
  assert.ok(!aristasEncendidas(tarea({ ok: HASTA_REVISION }), false).has('e-vuelta'))
})

test('the token is a pill with a mark and a class by state, and an accessible name that says where it is and what it is doing', () => {
  const curso = tarea({ estacion: 'spec', estaciones: { spec: 'en_curso' } })
  assert.deepEqual([claseFicha(curso), marcaFicha(curso)], ['curso', ''], 'working: the spinner is drawn by the style, the mark has no glyph')
  const hecho = tarea({ ok: ['entrada', 'spec'], fase: 'spec', estacion: 'spec' })
  assert.deepEqual([claseFicha(hecho), marcaFicha(hecho)], ['hecho', '✓'])
  const espera = tarea({ resultadoFinal: 'esperando_persona', estacion: 'puerta', pr: 12, ruta: 'human' })
  assert.deepEqual([claseFicha(espera), marcaFicha(espera)], ['espera', '–'])
  const ok = tarea({ resultadoFinal: 'desplegada', estacion: 'produccion' })
  assert.deepEqual([claseFicha(ok), marcaFicha(ok)], ['ok', '✓'])
  const rech = tarea({ resultadoFinal: 'rechazada', motivo: 'Lleva un enlace externo' })
  assert.deepEqual([claseFicha(rech), marcaFicha(rech)], ['rech', '!'])
  assert.equal(nombreAccesible(curso), 'Petición #7: Un banner, trabajando en Spec writer')
  assert.equal(nombreAccesible(hecho), 'Petición #7: Un banner, Spec writer hecho, esperando a la siguiente estación')
  assert.equal(nombreAccesible(espera), 'Petición #7: Un banner, esperando a una persona (PR #12)')
  assert.equal(nombreAccesible(ok), 'Petición #7: Un banner, en Producción')
  assert.equal(nombreAccesible(rech), 'Petición #7: Un banner, rechazada. Motivo: Lleva un enlace externo')
  const revision = tarea({ ok: [...HASTA_REVISION, 'seguridad'], estacion: 'ux', estaciones: { ux: 'en_curso' } })
  assert.equal(nombreAccesible(revision), 'Petición #7: Un banner, trabajando en la revisión en paralelo')
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

test('the demo shows the gap: a station done and the next one not started, with the ✓ and no travel', () => {
  const huecos = new Set()
  for (let paso = 0; paso < PASOS_DEMO; paso++) {
    for (const t of instantanea(paso).tareas) if (ficha(t).estado === 'hecho') huecos.add(ficha(t).nodo)
  }
  for (const nodo of ['spec', 'build', 'seguridad', 'approver', 'puerta', 'main']) assert.ok(huecos.has(nodo), `a ✓ waits in ${nodo}`)
  // Builder → Revisión, Approver → ¿Humano?, Main → Producción
  const recorrido = Array.from({ length: PASOS_DEMO }, (_, p) => instantanea(p).tareas.find((t) => t.numero === 1)).filter(Boolean).map((t) => `${ficha(t).nodo}:${ficha(t).estado}`)
  for (const par of [['build:hecho', 'seguridad:trabajando'], ['approver:hecho', 'puerta:trabajando'], ['main:hecho', 'produccion:trabajando']]) {
    const i = recorrido.indexOf(par[0])
    assert.ok(i >= 0 && recorrido[i + 1] === par[1], `#1: ${par.join(' → ')}`)
  }
})

test('in both layouts the token slots of every node sit below its last description line', () => {
  for (const vertical of [false, true]) {
    const g = geometria(vertical)
    for (const id of IDS_NODOS) {
      const n = g.N[id]
      // The same metrics as DiagramaFactory.astro: first baseline at +69 (gate: centre + 14), 16 px between lines, ~4 px of descent.
      const lineas = envuelve(ESTACIONES[id].linea, Math.floor((n.dec ? 150 : n.w - 24) * CARACTERES_POR_PX)).length
      const ultima = (n.dec ? cy(n) + 14 : n.y + 69) + 16 * (lineas - 1) + 4
      assert.ok(n.y + n.dy >= ultima, `${vertical ? 'vertical' : 'horizontal'} ${id}: tokens at ${n.y + n.dy}, text ends at ${ultima}`)
    }
  }
})

// --- S3: a station that jumped between two reads is seen en curso, in the diagram's order ---------------------------------

import { secuencia, crearReproductor, ENCURSO_MS } from '../src/lib/secuencia.js'

const marcas = (t) => STATIONS.filter((s) => t.estaciones[s] !== 'pendiente').map((s) => `${s}:${t.estaciones[s]}`)
const enCurso = (t) => STATIONS.filter((s) => t.estaciones[s] === 'en_curso')

test('S3: nothing skipped (or nothing seen before) means nothing to replay', () => {
  const antes = tarea({ ok: ['entrada'], estaciones: { spec: 'en_curso' } })
  assert.deepEqual(secuencia(null, antes), [])
  assert.deepEqual(secuencia(antes, antes), [])
  assert.deepEqual(secuencia(antes, tarea({ ok: ['entrada', 'spec'], estaciones: { build: 'en_curso' } })), [], 'spec was seen en curso; build is en curso now')
  assert.deepEqual(secuencia(tarea({ ok: ['entrada', 'spec', 'build'] }), tarea({ ok: ['entrada'] })), [], 'a task sent back to the start is not replayed')
})

test('S3: a station that went from pendiente to ok between two reads is shown en curso first, with the earlier ones done and the later ones waiting', () => {
  const antes = tarea({ ok: ['entrada'], estaciones: { spec: 'en_curso' } })
  const despues = tarea({ ok: ['entrada', 'spec', 'build'], estaciones: { seguridad: 'en_curso', ux: 'en_curso', ui: 'en_curso', codigo: 'en_curso' } })
  const frames = secuencia(antes, despues)
  assert.equal(frames.length, 1)
  assert.deepEqual(marcas(frames[0]), ['entrada:ok', 'spec:ok', 'build:en_curso'])
  assert.deepEqual(marcas(antes), ['entrada:ok', 'spec:en_curso'], 'the input is not touched')
})

test('S3: several skipped stations come one by one in the diagram\'s order; the four reviewers share one frame', () => {
  const antes = tarea({ ok: ['entrada'] })
  const despues = tarea({ ok: ['entrada', 'spec', 'build', 'seguridad', 'ux', 'ui', 'codigo', 'approver'], estaciones: { puerta: 'en_curso' } })
  const frames = secuencia(antes, despues)
  assert.deepEqual(frames.map(enCurso), [['spec'], ['build'], ['seguridad', 'ux', 'ui', 'codigo'], ['approver']])
  assert.deepEqual(marcas(frames[2]), ['entrada:ok', 'spec:ok', 'build:ok', 'seguridad:en_curso', 'ux:en_curso', 'ui:en_curso', 'codigo:en_curso'])
  assert.deepEqual(marcas(frames[3]), ['entrada:ok', 'spec:ok', 'build:ok', 'seguridad:ok', 'ux:ok', 'ui:ok', 'codigo:ok', 'approver:en_curso'])
})

test('S3: a station that refused or failed between two reads is first shown en curso, then ends as it ended', () => {
  const antes = tarea({ ok: ['entrada', 'spec', 'build'] })
  const despues = tarea({ ok: ['entrada', 'spec', 'build', 'ux', 'ui', 'codigo'], estaciones: { seguridad: 'rechazada' }, resultadoFinal: 'rechazada', motivo: 'Lleva un enlace', estacion: 'seguridad' })
  const frames = secuencia(antes, despues)
  assert.deepEqual(frames.map(enCurso), [['seguridad', 'ux', 'ui', 'codigo']])
  const error = secuencia(antes, tarea({ ok: ['entrada', 'spec', 'build', 'seguridad', 'ux', 'ui'], estaciones: { codigo: 'error' }, resultadoFinal: 'fallida' }))
  assert.deepEqual(error.map(enCurso), [['seguridad', 'ux', 'ui', 'codigo']])
})

test('S3: a replay frame is a task in progress: no final result, reason or link yet', () => {
  const antes = tarea({ ok: ['entrada'] })
  const despues = tarea({ ok: ['entrada', 'spec', 'build', 'seguridad', 'ux', 'ui', 'codigo', 'approver', 'puerta', 'merge', 'produccion'], resultadoFinal: 'desplegada', mensaje: 'Ya está en la web', enlace: '/', ruta: 'auto', pr: 9, motivo: null, resultado: 'ok' })
  const frames = secuencia(antes, despues)
  assert.deepEqual(frames.map(enCurso), [['spec'], ['build'], ['seguridad', 'ux', 'ui', 'codigo'], ['approver'], ['puerta'], ['merge'], ['produccion']])
  for (const f of frames) {
    assert.equal(f.resultadoFinal, 'en_curso')
    assert.equal(f.resultado, null)
    assert.equal(f.enlace, null)
    assert.equal(f.motivo, null)
    assert.equal(f.estacion, enCurso(f)[0], 'the token sits at the station that is en curso')
    assert.equal(f.numero, despues.numero)
  }
  assert.equal(frames[0].ruta, null, 'the route is not known before the gate')
  assert.equal(frames[5].ruta, 'auto')
})

test('S3: the player shows each frame for about 1.5 s, in order, and the final state last, without delaying anything else', () => {
  assert.equal(ENCURSO_MS, 1500)
  const timers = []
  const shown = []
  const player = crearReproductor((t) => shown.push(t), { poner: (fn, ms) => { timers.push({ fn, ms }); return timers.length }, quitar: (id) => { timers[id - 1].off = true } })
  const antes = tarea({ ok: ['entrada'], estaciones: { spec: 'en_curso' } })
  player.recibir(antes)
  assert.equal(shown.length, 1, 'the first read is shown at once')
  const despues = tarea({ ok: ['entrada', 'spec', 'build', 'seguridad', 'ux', 'ui', 'codigo'], estaciones: { approver: 'en_curso' } })
  player.recibir(despues)
  assert.deepEqual(shown.slice(1).map(enCurso), [['build']], 'the first frame is shown at once')
  assert.deepEqual(timers.map((t) => t.ms), [1500])
  timers.at(-1).fn()
  assert.deepEqual(shown.slice(2).map(enCurso), [['seguridad', 'ux', 'ui', 'codigo']])
  timers.at(-1).fn()
  assert.equal(shown.at(-1), despues, 'the final state is exactly the last read')
  assert.equal(timers.length, 2, 'no timer after the final state')
})

test('S3: a new read in the middle of a replay goes on from what is on screen; the final read is never lost', () => {
  const timers = []
  const shown = []
  const player = crearReproductor((t) => shown.push(t), { poner: (fn, ms) => { timers.push({ fn, ms }); return timers.length }, quitar: (id) => { timers[id - 1].off = true } })
  player.recibir(tarea({ ok: ['entrada'] }))
  const uno = tarea({ ok: ['entrada', 'spec', 'build'], estaciones: { seguridad: 'en_curso' } })
  player.recibir(uno)
  assert.deepEqual(enCurso(shown.at(-1)), ['spec'])
  const dos = tarea({ ok: ['entrada', 'spec', 'build', 'seguridad', 'ux', 'ui', 'codigo', 'approver'], resultadoFinal: 'rechazada', resultado: 'rejected' })
  player.recibir(dos)
  assert.ok(timers[0].off, 'the pending step of the old replay is cancelled')
  assert.deepEqual(enCurso(shown.at(-1)), ['build'], 'spec is on screen as en curso; it is not skipped, build is')
  while (timers.some((t) => !t.off && !t.done)) {
    const next = timers.find((t) => !t.off && !t.done)
    next.done = true
    next.fn()
  }
  assert.equal(shown.at(-1), dos)
  player.detener()
})

// --- S4 on the board: the activity line of a task in progress ---------------------------------------------------------------

test('S4: the board shows the activity line only for a task in progress, as short plain text', async () => {
  const { actividadViva, panelPeticion } = await import('../src/lib/tablero.js')
  const viva = tarea({ ok: ['entrada', 'spec'], estaciones: { build: 'en_curso' }, estacion: 'build', actividad: 'Edita src/a.js' })
  assert.equal(actividadViva(viva), 'Edita src/a.js')
  assert.equal(panelPeticion(viva).actividad, 'Edita src/a.js')
  assert.equal(actividadViva(tarea({ actividad: null })), '')
  assert.equal(actividadViva(tarea({})), '', 'an old state without the field renders fine')
  assert.equal(panelPeticion(tarea({})).actividad, '')
  assert.equal(actividadViva({ ...viva, resultadoFinal: 'rechazada' }), '', 'a finished task has no "now"')
  assert.equal(actividadViva({ ...viva, resultadoFinal: 'esperando_persona' }), '')
  assert.equal(actividadViva({ ...viva, actividad: 42 }), '')
  const largo = actividadViva({ ...viva, actividad: 'x'.repeat(500) })
  assert.ok(Array.from(largo).length <= 160)
})

// --- /tarea/: the strip, the "ahora" card and its text per phase (S5) ---

const ESTADOS = (t) => vistaAhora(t).segmentos.map((s) => s.estado)
const ACCS = [{ tipo: 'edita', texto: 'Edita data/precios.json' }, { tipo: 'busca', texto: 'Busca en el repositorio' }, { tipo: 'lee', texto: 'Lee data/precios.json' }, { tipo: 'comando', texto: 'Ejecuta un comando' }]

test('the strip has the seven segments of the artboard, in order, and shows each phase', () => {
  const v = vistaAhora(tarea({ ok: ['entrada', 'spec'], estaciones: { build: 'en_curso' }, estacion: 'build' }))
  assert.deepEqual(v.segmentos.map((s) => s.nombre), ['Entrada', 'Agente', 'Revisión', 'Approver', 'Puerta', 'Main o PR', 'Producción'])
  assert.deepEqual(ESTADOS(tarea({ ok: ['entrada', 'spec'], estaciones: { build: 'en_curso' } })), ['ok', 'en_curso', 'pendiente', 'pendiente', 'pendiente', 'pendiente', 'pendiente'])
  assert.equal(v.donde, 'Paso 2 de 7: Agente')
  assert.deepEqual(ESTADOS(tarea({ ok: HASTA_REVISION, estaciones: { ux: 'en_curso', seguridad: 'ok' } })), ['ok', 'ok', 'en_curso', 'pendiente', 'pendiente', 'pendiente', 'pendiente'])
  assert.deepEqual(ESTADOS(tarea({ ok: HASTA_APPROVER, estaciones: { puerta: 'en_curso' } })), ['ok', 'ok', 'ok', 'ok', 'en_curso', 'pendiente', 'pendiente'])
  assert.deepEqual(ESTADOS(tarea({ ok: [...HASTA_APPROVER, 'puerta'], ruta: 'auto', estaciones: { merge: 'en_curso' } })).slice(4), ['ok', 'en_curso', 'pendiente'])
  assert.deepEqual(ESTADOS(tarea({ ok: [...HASTA_APPROVER, 'puerta', 'merge'], ruta: 'auto' })).slice(4), ['ok', 'ok', 'en_curso'], 'merged, waiting for the deploy')
  assert.equal(v.segmentos[1].palabra, 'En curso')
})

test('waiting for a person: the gate is "espera" and Main o PR has not started', () => {
  const t = tarea({ ok: HASTA_APPROVER, ruta: 'human', pr: 42, resultadoFinal: 'esperando_persona', estacion: 'puerta' })
  const v = vistaAhora(t, { cola: [{ pr: 42, url: 'https://github.com/o/r/pull/42' }] })
  assert.deepEqual(v.segmentos.map((s) => s.estado), ['ok', 'ok', 'ok', 'ok', 'espera', 'pendiente', 'pendiente'])
  assert.equal(v.segmentos[4].palabra, 'Espera a una persona')
  assert.equal(v.donde, 'Paso 5 de 7: Puerta')
  assert.equal(v.final, 'esperando_persona')
  assert.equal(v.titulo, 'Tu petición espera a una persona que la revise')
  assert.match(v.detalle, /PR #42 abierto/)
  assert.deepEqual(v.enlace, { texto: 'Ver el PR #42', href: 'https://github.com/o/r/pull/42' })
  assert.equal(v.linea, '')
  assert.equal(vistaAhora(t, { cola: [{ pr: 42, url: 'https://evil.example/x' }] }).enlace, null, 'only GitHub addresses')
  assert.equal(vistaAhora(t).enlace, null)
})

test('the phase text is computed from the state: every phase says its own thing', () => {
  const linea = (t) => vistaAhora(t).linea
  assert.equal(linea(tarea({})), 'Tu petición está en la cola')
  assert.equal(linea(tarea({ ok: ['entrada'], estaciones: { spec: 'en_curso' } })), 'El agente lee tu petición')
  assert.equal(linea(tarea({ ok: ['entrada', 'spec'], estaciones: { build: 'en_curso' } })), 'El agente está escribiendo el cambio')
  assert.match(linea(tarea({ ok: ['entrada', 'spec'], vueltas: 1, estaciones: { build: 'en_curso' } })), /otra vuelta/)
  assert.equal(linea(tarea({ ok: HASTA_REVISION, estaciones: { ux: 'en_curso' } })), 'UX mira las capturas de la web con tu cambio')
  assert.equal(linea(tarea({ ok: HASTA_REVISION, estaciones: { seguridad: 'en_curso', codigo: 'en_curso' } })), 'Trabajando: Seguridad y Código')
  assert.equal(linea(tarea({ ok: [...HASTA_REVISION, 'seguridad', 'ux', 'ui', 'codigo'] })), 'El approver pesa las cuatro opiniones')
  assert.equal(linea(tarea({ ok: HASTA_APPROVER, estaciones: { approver: 'en_curso' } })), 'El approver pesa las cuatro opiniones')
  assert.equal(linea(tarea({ ok: HASTA_APPROVER })), 'La puerta revisa qué toca el cambio')
  assert.equal(linea(tarea({ ok: [...HASTA_APPROVER, 'puerta'], ruta: 'auto', estaciones: { merge: 'en_curso' } })), 'Fusionando en main')
  assert.equal(linea(tarea({ ok: [...HASTA_APPROVER, 'puerta', 'merge'], ruta: 'auto' })), 'Publicando en la web')
})

test('the stored activity line never reaches the phase text: a stale line cannot be shown in another phase', () => {
  for (const t of [tarea({ ok: HASTA_APPROVER, actividad: 'Cambio enviado: ahora decide la puerta' }), tarea({ ok: [...HASTA_APPROVER, 'puerta', 'merge'], ruta: 'auto', actividad: 'Edita src/a.js' }), tarea({ ok: ['entrada', 'spec'], estaciones: { build: 'en_curso' }, actividad: 'Pruebas y build ok' })]) {
    const v = vistaAhora(t)
    assert.ok(!/Cambio enviado|Edita src|Pruebas y build/.test(JSON.stringify(v)), JSON.stringify(v))
  }
})

test('the agent phase shows its last 3 actions with a known kind; no other phase shows any, finals neither', () => {
  const agente = tarea({ ok: ['entrada', 'spec'], estaciones: { build: 'en_curso' }, acciones: ACCS })
  const v = vistaAhora(agente)
  assert.equal(v.acciones.length, 3)
  assert.deepEqual(v.acciones[0], { tipo: 'edita', verbo: 'Edita', resto: 'data/precios.json' })
  assert.deepEqual(v.acciones[1], { tipo: 'busca', verbo: 'Busca', resto: 'en el repositorio' })
  assert.deepEqual(vistaAhora(tarea({ ok: ['entrada', 'spec'], estaciones: { build: 'en_curso' } })).acciones, [], 'an old state without them')
  assert.deepEqual(vistaAhora({ ...agente, acciones: [{ tipo: 'hackea', texto: 'x' }, { tipo: 'lee' }, null, 'Lee x', { tipo: 'lee', texto: 'Lee src/a.js' }] }).acciones, [{ tipo: 'lee', verbo: 'Lee', resto: 'src/a.js' }])
  assert.deepEqual(vistaAhora({ ...agente, acciones: 'Lee x' }).acciones, [])
  for (const t of [tarea({ ok: HASTA_REVISION, estaciones: { ux: 'en_curso' }, acciones: ACCS }), tarea({ ok: HASTA_APPROVER, acciones: ACCS }), tarea({ ok: STATIONS, resultadoFinal: 'desplegada', acciones: ACCS }), tarea({ ok: ['entrada'], resultadoFinal: 'fallida', estaciones: { spec: 'error' }, acciones: ACCS })]) {
    assert.deepEqual(vistaAhora(t).acciones, [])
  }
})

test('the four reviewers finish on their own: each item has its state, word and own reason', () => {
  const t = tarea({
    ok: HASTA_REVISION, estaciones: { seguridad: 'ok', ux: 'en_curso', ui: 'ok', codigo: 'ok' },
    motivos: { seguridad: 'Solo toca data/precios.json', ui: 'No cambia la vista', codigo: 'Pruebas y build ok', ux: 'texto viejo de una ronda anterior' },
  })
  const { revisores } = vistaAhora(t)
  assert.deepEqual(revisores.map((r) => r.nombre), ['Seguridad', 'UX', 'UI', 'Código'])
  assert.deepEqual(revisores.map((r) => r.estado), ['ok', 'en_curso', 'ok', 'ok'])
  assert.deepEqual(revisores.map((r) => r.palabra), ['Aprueba', 'Trabajando', 'Aprueba', 'Aprueba'])
  assert.equal(revisores[0].texto, 'Solo toca data/precios.json')
  assert.equal(revisores[1].texto, 'Mira las capturas de la web…', 'a working reviewer has no reason yet: a reason of an old round is not shown')
  assert.equal(revisores[3].texto, 'Pruebas y build ok')
  const pend = vistaAhora(tarea({ ok: HASTA_REVISION, estaciones: { seguridad: 'en_curso', ux: 'en_curso', ui: 'en_curso', codigo: 'en_curso' } })).revisores
  assert.deepEqual(pend.map((r) => r.palabra), ['Trabajando', 'Trabajando', 'Trabajando', 'Trabajando'])
  assert.equal(vistaAhora(tarea({ ok: ['entrada', 'spec'], estaciones: { build: 'en_curso' } })).revisores, null, 'only while reviewing (and on a refusal)')
  assert.equal(vistaAhora(tarea({ ok: HASTA_APPROVER })).revisores, null)
})

test('a refusal ends with the stop, the reason and the four reviewers; nothing is invented', () => {
  const t = tarea({
    ok: HASTA_REVISION, estaciones: { seguridad: 'rechazada', ux: 'ok', ui: 'ok', codigo: 'ok' }, resultadoFinal: 'rechazada', estacion: 'seguridad', resultado: 'rejected',
    motivo: 'Toca también data/transporte.json', motivos: { seguridad: 'Toca también data/transporte.json', ux: 'Se lee bien' },
  })
  const v = vistaAhora(t)
  assert.equal(v.titulo, 'La factory ha rechazado tu petición')
  assert.equal(v.detalle, 'Se detuvo en: Seguridad. Motivo: Toca también data/transporte.json. Nadie ha tocado la web.')
  assert.deepEqual(v.segmentos.map((s) => s.estado), ['ok', 'ok', 'rechazada', 'pendiente', 'pendiente', 'pendiente', 'pendiente'])
  assert.equal(v.donde, 'Se detuvo en el paso 3 de 7: Revisión')
  assert.deepEqual(v.revisores.map((r) => r.palabra), ['Rechaza', 'Aprueba', 'Aprueba', 'Aprueba'])
  assert.equal(v.revisores[2].texto, '', 'no reason stored: nothing is made up')
  assert.equal(v.linea, '')
  assert.equal(v.enlace, null)
})

test('the other finals: deployed with its link, failed, blocked by the tests, closed, unchanged; none has an activity line', () => {
  const desplegada = vistaAhora(tarea({ ok: STATIONS, resultadoFinal: 'desplegada', estacion: 'produccion', perfil: 'negocio', enlace: '/presupuesto/' }))
  assert.equal(desplegada.titulo, 'Ya está en la web')
  assert.deepEqual(desplegada.enlace, { texto: 'Ver el cambio en la web', href: '/presupuesto/' })
  assert.equal(desplegada.donde, 'Los 7 pasos, hechos')
  assert.ok(desplegada.segmentos.every((s) => s.estado === 'ok'))
  assert.equal(vistaAhora(tarea({ ok: STATIONS, resultadoFinal: 'desplegada', enlace: '//evil.example' })).enlace.href, '/', 'only addresses of the site')
  const fallida = vistaAhora(tarea({ ok: ['entrada'], estaciones: { spec: 'error' }, resultadoFinal: 'fallida', estacion: 'spec', motivo: 'el agente no ha terminado a tiempo' }))
  assert.equal(fallida.titulo, 'La factory no ha podido con tu petición')
  assert.equal(fallida.detalle, 'Se detuvo en: Agente. Motivo: el agente no ha terminado a tiempo. Nadie ha tocado la web.')
  assert.deepEqual(fallida.segmentos.map((s) => s.estado).slice(0, 3), ['ok', 'error', 'pendiente'])
  assert.equal(fallida.revisores, null)
  const tests = vistaAhora(tarea({ ok: [...HASTA_APPROVER, 'puerta'], estaciones: { merge: 'rechazada' }, ruta: 'auto', pr: 5, resultadoFinal: 'bloqueada_tests', estacion: 'merge', motivo: 'Los tests automáticos (CI) han fallado' }))
  assert.equal(tests.titulo, 'Los tests automáticos han bloqueado tu cambio')
  assert.equal(tests.detalle, 'Se detuvo en: Main o PR. Motivo: Los tests automáticos (CI) han fallado')
  assert.equal(tests.donde, 'Se detuvo en el paso 6 de 7: Main o PR')
  assert.equal(vistaAhora(tarea({ ok: HASTA_APPROVER, estaciones: { puerta: 'rechazada' }, resultadoFinal: 'cerrada', estacion: 'puerta' })).titulo, 'Una persona ha cerrado el cambio sin publicarlo')
  assert.equal(vistaAhora(tarea({ ok: HASTA_REVISION, resultadoFinal: 'sin_cambios', estacion: 'build' })).titulo, 'No hacía falta cambiar nada: la web ya era así')
  for (const r of ['desplegada', 'rechazada', 'fallida', 'bloqueada_tests', 'cerrada', 'sin_cambios', 'esperando_persona']) assert.equal(vistaAhora(tarea({ ok: STATIONS, resultadoFinal: r, actividad: 'Edita src/a.js' })).linea, '', r)
})

test('model-derived text is returned as plain strings; control and bidi characters are gone; an odd or empty task does not break', () => {
  const v = vistaAhora(tarea({ ok: HASTA_REVISION, estaciones: { seguridad: 'ok' }, motivos: { seguridad: 'Bien‮\u0007<b>x</b>'.padEnd(400, 'y') }, resultadoFinal: 'rechazada', estacion: 'seguridad', motivo: '<img src=x>‮mal' }))
  assert.ok(!/[‮\u0007<>]/.test(JSON.stringify(v.revisores) + v.detalle))
  assert.ok(v.revisores.every((r) => Array.from(r.texto).length <= 160))
  assert.doesNotThrow(() => vistaAhora({}))
  assert.doesNotThrow(() => vistaAhora(null))
  assert.equal(vistaAhora({}).final, 'en_curso')
})

test('the live light: "actualizado hace n s", then "Terminada", and no connection after 20 s without a read', () => {
  assert.deepEqual(frescura({ ultima: 1000, ahora: 4000, terminada: false }), { texto: 'En vivo · actualizado hace 3 s', luz: true, fin: false })
  assert.equal(frescura({ ultima: 0, ahora: 0, terminada: false }).texto, 'En vivo · actualizado hace 0 s')
  assert.equal(frescura({ ultima: 0, ahora: 125_000, terminada: false }).texto, 'Sin conexión con la factory. Reintentando…')
  assert.equal(frescura({ ultima: 0, ahora: 125_000, terminada: false }).luz, false)
  assert.equal(frescura({ ultima: 0, ahora: 20_000, terminada: false }).luz, true, '20 s exactly is still live')
  assert.equal(frescura({ ultima: 0, ahora: 21_000, terminada: false }).luz, false)
  assert.deepEqual(frescura({ ultima: 0, ahora: 40_000, terminada: true }), { texto: 'Terminada · última lectura hace 40 s', luz: false, fin: true })
  assert.equal(frescura({ ultima: 0, ahora: 180_000, terminada: true }).texto, 'Terminada · última lectura hace 3 min')
  assert.equal(frescura({ ultima: null, ahora: 5000, terminada: false }).texto, 'Buscando tu petición…')
})
