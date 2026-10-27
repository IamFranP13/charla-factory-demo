// The Spec writer classifies every request into a KIND; the kind (not the profile) decides what may be written.
// The profile is only who asked: it shows in the trail and on the pages, and is the fallback when the spec names no kind.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse } from 'yaml'
import { runFactory, loadProfiles, loadKinds } from '../lib/factory.js'
import { rehearsalCopy } from '../lib/rehearsal.js'
import { replayProvider } from '../lib/providers.js'
import { TIPOS } from '../lib/estado.js'

const repo = new URL('..', import.meta.url).pathname
const scratches = []
const scratch = () => {
  const root = mkdtempSync(join(tmpdir(), 'kinds-'))
  scratches.push(root)
  rehearsalCopy(repo, root, ['content', 'catalogo', 'data', 'config', 'brain', 'src', 'factory', 'policy', 'AGENTS.md'])
  return root
}
after(() => scratches.forEach((dir) => rmSync(dir, { recursive: true, force: true })))

const ALL = ['campana', 'producto', 'destino', 'precios', 'descuentos', 'transporte', 'bug', 'feature', 'cambio']

test('there are exactly three profiles (who asked) and no profile writes code', () => {
  const profiles = loadProfiles(repo)
  assert.deepEqual(Object.keys(profiles), ['marketing', 'producto', 'negocio'])
  for (const profile of Object.values(profiles)) {
    assert.ok(profile.label && profile.description)
    assert.equal('code' in profile, false)
    assert.equal('folders' in profile || 'files' in profile, false, 'what may be written belongs to the kinds')
  }
})

test('the kinds are the nine of the contract, each with the surface the code enforces', () => {
  const kinds = loadKinds(repo)
  assert.deepEqual(Object.keys(kinds), ALL)
  assert.deepEqual(TIPOS, ALL)
  assert.deepEqual([kinds.campana.folders, kinds.campana.newFile], [['content/campanas/'], true])
  assert.deepEqual([kinds.producto.folders, kinds.producto.newFile], [['catalogo/productos/'], true])
  assert.deepEqual([kinds.destino.folders, kinds.destino.newFile], [['catalogo/destinos/'], true])
  assert.deepEqual([kinds.precios.files, kinds.precios.newFile], [['data/precios.json'], false])
  assert.deepEqual([kinds.descuentos.files, kinds.descuentos.newFile], [['data/descuentos.json'], false])
  assert.deepEqual([kinds.transporte.files, kinds.transporte.newFile], [['config/transporte.json'], false])
  for (const code of ['bug', 'feature', 'cambio']) assert.equal(kinds[code].code, true, code)
  assert.deepEqual([kinds.bug.scope, kinds.feature.scope, kinds.cambio.scope], [['features', 'domain'], ['features'], ['domain']])
  for (const data of ['campana', 'producto', 'destino', 'precios', 'descuentos', 'transporte']) assert.notEqual(kinds[data].code, true, data)
  for (const kind of Object.values(kinds)) assert.ok(kind.description.length > 10)
})

test('each profile names default kinds that exist: what it may write when the spec names none', () => {
  const kinds = loadKinds(repo)
  const profiles = parse(readFileSync(join(repo, 'factory/profiles.yaml'), 'utf8'))
  assert.deepEqual(profiles.marketing.kinds, ['campana'])
  assert.deepEqual(profiles.producto.kinds, ['producto', 'destino'])
  assert.deepEqual(profiles.negocio.kinds, ['precios', 'descuentos', 'transporte'])
  for (const profile of Object.values(profiles)) for (const kind of profile.kinds) assert.ok(kind in kinds, kind)
})

// A model that answers each station from a script.
function scripted(answers) {
  const prompts = {}
  return {
    prompts,
    name: 'scripted',
    async complete({ station, messages }) {
      prompts[station] = [...(prompts[station] ?? []), messages[0].content]
      const queue = answers[station]
      const next = Array.isArray(queue) ? (queue.length > 1 ? queue.shift() : queue[0]) : queue
      return { text: typeof next === 'string' ? next : JSON.stringify(next), usage: { input: 1, output: 1 } }
    },
  }
}
const ok = { aprobado: true, motivo: 'bien' }
const approving = { seguridad: ok, ux: ok, ui: ok }
const spec = (tipo) => ({ ...(tipo !== undefined && { tipo }), resumen: 'x', criterios: [] })
const campaign = (ruta) => ({ ficheros: [{ ruta, contenido: { titulo: 'Hola', texto: 'Texto', color: 'oliva' } }] })
const price = { ficheros: [{ ruta: 'data/precios.json', contenido: { 'limon-verna': 1.31 } }] }

async function run(profile, answers, id = 50) {
  const events = []
  const result = await runFactory({ task: { id, profile, request: 'x' }, root: scratch(), provider: scripted(answers), trace: (e) => events.push(e) })
  return { result, events }
}

test('any profile may ask for any kind: the surface follows the kind the spec names', async () => {
  // marketing asking for a price, producto asking for a campaign, negocio asking for a destination
  const price1 = await run('marketing', { spec: spec('precios'), build: { ficheros: [{ ruta: 'data/precios.json', contenido: Object.fromEntries(Object.entries(JSON.parse(readFileSync(join(repo, 'factory/seed/data/precios.json'), 'utf8'))).map(([k, v]) => [k, k === 'limon-verna' ? 1.31 : v])) }] }, ...approving })
  assert.equal(price1.result.status, 'ok', JSON.stringify(price1.events))
  assert.deepEqual(price1.result.files.map((f) => f.path), ['data/precios.json'])
  assert.equal(price1.events.find((e) => e.station === 'spec' && e.status === 'ok').tipo, 'precios')

  const camp = await run('producto', { spec: spec('campana'), build: campaign('content/campanas/tarea-50.json'), ...approving })
  assert.equal(camp.result.status, 'ok', JSON.stringify(camp.events))

  const dest = await run('negocio', { spec: spec('destino'), build: { ficheros: [{ ruta: 'catalogo/destinos/tarea-50.json', contenido: { pais: 'Italia', ciudad: 'Milán', diasTransito: 3 } }] }, ...approving })
  assert.equal(dest.result.status, 'ok', JSON.stringify(dest.events))
})

test('code enforces the surface of the kind named: nothing outside it, whoever asked', async () => {
  const wrong = [
    ['precios', campaign('content/campanas/tarea-50.json')],
    ['campana', price],
    ['transporte', price],
    ['producto', { ficheros: [{ ruta: 'catalogo/destinos/tarea-50.json', contenido: { pais: 'Italia', ciudad: 'Milán', diasTransito: 3 } }] }],
    ['feature', price],
    ['bug', campaign('content/campanas/tarea-50.json')],
    ['cambio', { ficheros: [{ ruta: 'lib/factory.js', contenido: 'export const x = 1\n' }] }],
    ['campana', { ficheros: [{ ruta: 'src/domain/presupuesto.js', contenido: 'export const x = 1\n' }] }],
  ]
  for (const profile of ['marketing', 'producto', 'negocio']) {
    for (const [kind, build] of wrong) {
      const { result, events } = await run(profile, { spec: spec(kind), build, ...approving })
      assert.equal(result.status, 'failed', `${profile} / ${kind}`)
      assert.deepEqual(result.files, [])
      assert.ok(events.find((e) => e.station === 'build' && e.status === 'error'), `${profile} / ${kind}`)
    }
  }
})

test('a kind that does not exist fails the task before building; no kind falls back to what the profile may write', async () => {
  const unknown = await run('marketing', { spec: spec('mejora'), build: campaign('content/campanas/tarea-50.json'), ...approving })
  assert.equal(unknown.result.status, 'failed')
  assert.match(unknown.events.find((e) => e.station === 'spec' && e.status === 'error').detail, /bug, feature, cambio|campana/)
  for (const bad of [7, 'BUG', ['bug'], '']) {
    assert.equal((await run('marketing', { spec: spec(bad), build: campaign('content/campanas/tarea-50.json'), ...approving })).result.status, 'failed', JSON.stringify(bad))
  }

  const none = await run('marketing', { spec: spec(undefined), build: campaign('content/campanas/tarea-50.json'), ...approving })
  assert.equal(none.result.status, 'ok')
  assert.equal(none.events.find((e) => e.station === 'spec' && e.status === 'ok').tipo, 'campana', 'a profile with one default kind reports it')
  const wrongForProfile = await run('marketing', { spec: spec(undefined), build: price, ...approving })
  assert.equal(wrongForProfile.result.status, 'failed', 'without a kind the old limits of the profile still apply')
})

test('the spec prompt lists the kinds; the build prompt shows only the surface of the kind chosen', async () => {
  const model = scripted({ spec: spec('precios'), build: price, ...approving })
  await runFactory({ task: { id: 51, profile: 'marketing', request: 'x' }, root: scratch(), provider: model, trace: () => {} })
  for (const kind of ALL) assert.match(model.prompts.spec[0], new RegExp(`- ${kind}: `))
  assert.match(model.prompts.build[0], /data\/precios\.json/)
  assert.doesNotMatch(model.prompts.build[0], /content\/campanas\/tarea-51\.json/)
  assert.doesNotMatch(model.prompts.build[0], /src\/domain\/presupuesto\.js:/)

  const code = scripted({ spec: spec('feature'), build: { ficheros: [{ ruta: 'src/features/tarea-52/index.js', contenido: 'export default {}\n' }] }, ...approving })
  await runFactory({ task: { id: 52, profile: 'producto', request: 'x' }, root: scratch(), provider: code, trace: () => {} })
  assert.match(code.prompts.build[0], /src\/domain\/presupuesto\.js:/)
  assert.match(code.prompts.build[0], /src\/features\/tarea-52\//)
})

// The replay model classifies by keywords; the same request gets the same kind whoever asks.
const CLASSIFIED = [
  ['Una campaña oliva que diga «Limones de temporada»', 'campana'],
  ['Un banner para anunciar las rebajas de primavera en tomate', 'campana'],
  ['Una campaña que diga «descuento en transporte para ti»', 'campana'],
  ['Añade mango al catálogo', 'producto'],
  ['Queremos vender calabacín de Almería', 'producto'],
  ['Quiero poder exportar a Italia, a Milán', 'destino'],
  ['Nuevo destino de exportación: Lisboa, en Portugal', 'destino'],
  ['Pon el precio del limón a 1,30', 'precios'],
  ['Sube el precio del tomate un 10%', 'precios'],
  ['Descuento del 8% desde 2.000 kg', 'descuentos'],
  ['Pon el transporte a Alemania gratis', 'transporte'],
  ['Transporte a Francia a 0,08 euros por kilo con mínimo de 100', 'transporte'],
  ['El listado «Del más barato al más caro» sale al revés, arréglalo', 'bug'],
  ['La lista de productos ordena mal por precio', 'bug'],
  ['Con 1.000 kg exactos no se aplica el descuento por volumen, es un bug', 'bug'],
  ['El descuento por volumen no funciona en el límite del tramo', 'bug'],
  ['Muestra el producto más barato de cada categoría', 'feature'],
  ['Quiero ver los días de tránsito de cada destino', 'feature'],
  ['Enseña el precio medio por kilo del catálogo', 'feature'],
  ['Cambia la regla: descuento del 15 % a partir de 50.000 kg', 'cambio'],
]

test('replay: the same request gets the same kind from every profile', async () => {
  for (const [request, kind] of CLASSIFIED) {
    for (const profile of ['marketing', 'producto', 'negocio']) {
      const events = []
      await runFactory({ task: { id: 60, profile, request }, root: scratch(), provider: replayProvider(), trace: (e) => events.push(e) })
      assert.equal(events.find((e) => e.station === 'spec' && e.status === 'ok')?.tipo, kind, `${profile}: ${request}`)
    }
  }
})

test('replay: requests the factory does not do are refused by the spec writer, whoever asks', async () => {
  for (const request of ['Cambia el logo y la tipografía de toda la web', 'Pon los estilos de la web en azul', 'Rediseña el css de la página']) {
    for (const profile of ['marketing', 'producto', 'negocio']) {
      const events = []
      const result = await runFactory({ task: { id: 61, profile, request }, root: scratch(), provider: replayProvider(), trace: (e) => events.push(e) })
      assert.equal(result.status, 'rejected', `${profile}: ${request}`)
      assert.match(events.find((e) => e.station === 'spec' && e.status === 'rejected').detail, /campañas|código/)
    }
  }
})
