import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateFile } from '../lib/schemas.js'
import { validateCatalog } from '../src/domain/catalogo.js'
import { presupuestar } from '../src/domain/presupuesto.js'
import { cargarEstado } from '../src/domain/estado-node.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')
const jsonFiles = (dir) => readdirSync(join(root, dir)).filter((f) => f.endsWith('.json')).sort().map((f) => `${dir}/${f}`)

const LIVE = [
  ...jsonFiles('content/campanas'),
  ...jsonFiles('catalogo/productos'),
  ...jsonFiles('catalogo/destinos'),
  'data/precios.json',
  'data/descuentos.json',
  'config/transporte.json',
]

test('there is seed content for every LIMONIA folder', () => {
  assert.ok(jsonFiles('content/campanas').length >= 2)
  assert.ok(jsonFiles('catalogo/productos').length >= 10)
  assert.ok(jsonFiles('catalogo/destinos').length >= 6)
})

test('every live LIMONIA data file validates against its schema', () => {
  for (const path of LIVE) {
    const result = validateFile(path, read(path))
    assert.deepEqual(result, { ok: true, errors: [] }, path)
  }
})

test('campaign files are not named like audience files', () => {
  for (const path of jsonFiles('content/campanas')) assert.doesNotMatch(path, /tarea-\d+\.json$/)
})

test('the live catalog is consistent', () => {
  assert.deepEqual(validateCatalog(cargarEstado(root)), { ok: true, errors: [] })
})

test('exactly one product has no price, and every destination has transport', () => {
  const e = cargarEstado(root)
  const sinPrecio = Object.keys(e.productos).filter((id) => !(id in e.precios))
  assert.equal(sinPrecio.length, 1)
  for (const id of Object.keys(e.destinos)) assert.ok(e.transporte[id], id)
  assert.ok(Object.values(e.productos).some((p) => p.disponible === false))
})

test('cargarEstado reads ids from file names', () => {
  const e = cargarEstado(root)
  assert.ok(e.productos['limon-verna'])
  assert.ok(e.destinos['alemania-hamburgo'])
  assert.equal(e.descuentos.tramos.length, 3)
})

test('every sample order in factory/muestras.json matches its expectation', () => {
  const muestras = JSON.parse(read('factory/muestras.json'))
  const estado = cargarEstado(root)
  assert.ok(muestras.length >= 5 && muestras.length <= 8)
  for (const m of muestras) {
    assert.ok(['ok', 'error'].includes(m.esperado), m.nombre)
    const r = presupuestar(m.pedido, estado)
    assert.equal(r.ok ? 'ok' : 'error', m.esperado, `${m.nombre}: ${r.errores.join('; ')}`)
    if (r.ok) for (const n of [r.subtotal, r.transporte, r.total]) assert.ok(Number.isFinite(n) && n >= 0, m.nombre)
  }
})

test('samples include a product without price and an order at the top discount', () => {
  const muestras = JSON.parse(read('factory/muestras.json'))
  const estado = cargarEstado(root)
  assert.ok(muestras.some((m) => m.esperado === 'error' && presupuestar(m.pedido, estado).errores.some((e) => e.includes('no tiene precio'))))
  const top = Math.max(...estado.descuentos.tramos.map((t) => t.porcentaje))
  assert.ok(muestras.some((m) => presupuestar(m.pedido, estado).descuento.porcentaje === top))
})

test('seed copies equal the live files', () => {
  for (const path of ['data/precios.json', 'data/descuentos.json', 'config/transporte.json']) {
    assert.ok(existsSync(join(root, 'factory/seed', path)), path)
    assert.deepEqual(JSON.parse(read(`factory/seed/${path}`)), JSON.parse(read(path)), path)
  }
})
