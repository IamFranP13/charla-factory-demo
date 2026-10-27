import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateFile } from '../lib/schemas.js'
import { validateCatalog } from '../src/domain/catalogo.js'
import { presupuestar } from '../src/domain/presupuesto.js'
import { cargarEstado } from '../src/domain/estado-node.js'
import { rehearsalCopy } from '../lib/rehearsal.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p, base = root) => readFileSync(join(base, p), 'utf8')
const jsonFiles = (dir, base = root) => readdirSync(join(base, dir)).filter((f) => f.endsWith('.json')).sort().map((f) => `${dir}/${f}`)

// The live repository changes during a talk (new campaigns, destinations without a rate yet,
// a free transport...). Facts about the SEED are checked on a rehearsal copy, which drops the
// audience's files and restores the seed; the live repository only has to stay valid.
const FOLDERS = ['content', 'catalogo', 'data', 'config', 'factory']
function seedOf(base) {
  const copy = mkdtempSync(join(tmpdir(), 'seed-'))
  rehearsalCopy(base, copy, FOLDERS)
  return copy
}
const seed = seedOf(root)

const LIVE = [
  ...jsonFiles('content/campanas'),
  ...jsonFiles('catalogo/productos'),
  ...jsonFiles('catalogo/destinos'),
  'data/precios.json',
  'data/descuentos.json',
  'config/transporte.json',
]

test('there is seed content for every LIMONIA folder', () => {
  assert.ok(jsonFiles('content/campanas', seed).length >= 2)
  assert.ok(jsonFiles('catalogo/productos', seed).length >= 10)
  assert.ok(jsonFiles('catalogo/destinos', seed).length >= 6)
})

test('every live LIMONIA data file validates against its schema', () => {
  for (const path of LIVE) {
    const result = validateFile(path, read(path))
    assert.deepEqual(result, { ok: true, errors: [] }, path)
  }
})

test('seed campaign files are not named like audience files', () => {
  for (const path of jsonFiles('content/campanas', seed)) assert.doesNotMatch(path, /tarea-\d+\.json$/)
})

test('the live catalog is consistent', () => {
  assert.deepEqual(validateCatalog(cargarEstado(root)), { ok: true, errors: [] })
})

test('in the seed, exactly one product has no price and every destination has transport', () => {
  const e = cargarEstado(seed)
  const sinPrecio = Object.keys(e.productos).filter((id) => !(id in e.precios))
  assert.equal(sinPrecio.length, 1)
  for (const id of Object.keys(e.destinos)) assert.ok(e.transporte[id], id)
  assert.ok(Object.values(e.productos).some((p) => p.disponible === false))
})

test('cargarEstado reads ids from file names', () => {
  assert.ok(cargarEstado(root).productos['limon-verna'])
  assert.ok(cargarEstado(root).destinos['alemania-hamburgo'])
  assert.equal(cargarEstado(seed).descuentos.tramos.length, 3, 'the figures are the seed ones: the live ones are what the audience changes')
})

test('every sample order in factory/muestras.json matches its expectation, live and in the seed', () => {
  const muestras = JSON.parse(read('factory/muestras.json'))
  assert.ok(muestras.length >= 5 && muestras.length <= 8)
  for (const base of [root, seed]) {
    const estado = cargarEstado(base)
    for (const m of muestras) {
      assert.ok(['ok', 'error'].includes(m.esperado), m.nombre)
      const r = presupuestar(m.pedido, estado)
      assert.equal(r.ok ? 'ok' : 'error', m.esperado, `${m.nombre}: ${r.errores.join('; ')}`)
      if (r.ok) for (const n of [r.subtotal, r.transporte, r.total]) assert.ok(Number.isFinite(n) && n >= 0, m.nombre)
    }
  }
})

test('in the seed, samples include a product without price and an order at the top discount', () => {
  const muestras = JSON.parse(read('factory/muestras.json'))
  const estado = cargarEstado(seed)
  assert.ok(muestras.some((m) => m.esperado === 'error' && presupuestar(m.pedido, estado).errores.some((e) => e.includes('no tiene precio'))))
  const top = Math.max(...estado.descuentos.tramos.map((t) => t.porcentaje))
  assert.ok(muestras.some((m) => presupuestar(m.pedido, estado).descuento.porcentaje === top))
})

test('every seed file exists and validates', () => {
  for (const path of ['data/precios.json', 'data/descuentos.json', 'config/transporte.json']) {
    assert.ok(existsSync(join(root, 'factory/seed', path)), path)
    assert.deepEqual(validateFile(path, read(`factory/seed/${path}`)), { ok: true, errors: [] }, path)
  }
})

test('after a talk (audience campaign, destination without a rate, free transport) the seed facts still hold on a rehearsal copy', () => {
  const live = mkdtempSync(join(tmpdir(), 'after-talk-'))
  rehearsalCopy(root, live, FOLDERS)
  const write = (path, value) => {
    mkdirSync(join(live, path, '..'), { recursive: true })
    writeFileSync(join(live, path), JSON.stringify(value))
  }
  write('content/campanas/tarea-9.json', { titulo: 'Del público', texto: 'Una campaña', color: 'limon' })
  write('catalogo/destinos/tarea-10.json', { pais: 'Italia', ciudad: 'Milán', diasTransito: 3 })
  const transporte = JSON.parse(read('config/transporte.json', live))
  transporte['alemania-hamburgo'] = { eurPorKg: 0, minimo: 0 }
  write('config/transporte.json', transporte)

  const again = seedOf(live)
  assert.equal(jsonFiles('content/campanas', again).some((p) => p.includes('tarea-')), false)
  assert.equal(existsSync(join(again, 'catalogo/destinos/tarea-10.json')), false)
  assert.deepEqual(cargarEstado(again).transporte, cargarEstado(seed).transporte)
})
