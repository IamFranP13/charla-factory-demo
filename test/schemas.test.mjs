import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateFile } from '../lib/schemas.js'

const json = (value) => JSON.stringify(value)

test('file names are lowercase slugs ending in .json', () => {
  assert.equal(validateFile('content/campanas/Hola Sala.json', json({ titulo: 'a', texto: 'b', color: 'oliva' })).ok, false)
  assert.equal(validateFile('content/campanas/../../x.json', json({ titulo: 'a', texto: 'b', color: 'oliva' })).ok, false)
})

test('files outside the data folders have no schema', () => {
  const result = validateFile('policy/risk.yaml', 'default: auto')
  assert.equal(result.ok, false)
  assert.match(result.errors[0], /no schema/)
})

test('invalid JSON is reported, not thrown', () => {
  const result = validateFile('content/campanas/a.json', '{nope')
  assert.equal(result.ok, false)
  assert.match(result.errors[0], /JSON/)
})

// --- LIMONIA schemas ---

const campana = { titulo: 'Temporada de limón', texto: 'Limón Verna recién cortado.', color: 'limon' }
const producto = { nombre: 'Limón Verna', categoria: 'fruta', origen: 'Vega del Segura', descripcion: 'Jugoso.', emoji: '🍋', disponible: true }
const destino = { pais: 'Alemania', ciudad: 'Hamburgo', diasTransito: 3 }

test('campaigns: valid example, optional fields, limits and colors', () => {
  const f = (v) => validateFile('content/campanas/temporada.json', json(v))
  assert.deepEqual(f(campana), { ok: true, errors: [] })
  assert.equal(f({ ...campana, emoji: '🍋', cta: 'Ver catálogo' }).ok, true)
  assert.equal(f({ ...campana, titulo: 'x'.repeat(60) }).ok, true)
  assert.equal(f({ ...campana, titulo: 'x'.repeat(61) }).ok, false)
  assert.equal(f({ ...campana, texto: 'x'.repeat(160) }).ok, true)
  assert.equal(f({ ...campana, texto: 'x'.repeat(161) }).ok, false)
  assert.equal(f({ ...campana, cta: 'x'.repeat(30) }).ok, true)
  assert.equal(f({ ...campana, cta: 'x'.repeat(31) }).ok, false)
  assert.equal(f({ ...campana, emoji: 'x'.repeat(9) }).ok, false)
  for (const color of ['oliva', 'limon', 'tierra', 'blanco']) assert.equal(f({ ...campana, color }).ok, true, color)
  assert.equal(f({ ...campana, color: 'rosa' }).ok, false)
  assert.equal(f({ ...campana, extra: 1 }).ok, false)
  assert.equal(f({ ...campana, titulo: 5 }).ok, false)
  assert.equal(f({ ...campana, texto: 'mira https://x.com' }).ok, false)
  assert.equal(f({ titulo: 'a', texto: 'b' }).ok, false)
})

test('products: valid example, limits, category and types', () => {
  const f = (v) => validateFile('catalogo/productos/limon-verna.json', json(v))
  assert.deepEqual(f(producto), { ok: true, errors: [] })
  assert.equal(f({ ...producto, nombre: 'x'.repeat(40) }).ok, true)
  assert.equal(f({ ...producto, nombre: 'x'.repeat(41) }).ok, false)
  assert.equal(f({ ...producto, origen: 'x'.repeat(41) }).ok, false)
  assert.equal(f({ ...producto, descripcion: 'x'.repeat(160) }).ok, true)
  assert.equal(f({ ...producto, descripcion: 'x'.repeat(161) }).ok, false)
  assert.equal(f({ ...producto, emoji: 'x'.repeat(9) }).ok, false)
  assert.equal(f({ ...producto, categoria: 'fruta' }).ok, true)
  assert.equal(f({ ...producto, categoria: 'hortaliza' }).ok, true)
  assert.equal(f({ ...producto, categoria: 'carne' }).ok, false)
  assert.equal(f({ ...producto, disponible: 'si' }).ok, false)
  assert.equal(f({ ...producto, disponible: false }).ok, true)
  assert.equal(f({ ...producto, extra: 1 }).ok, false)
  const { emoji, ...sinEmoji } = producto
  assert.equal(f(sinEmoji).ok, false)
})

test('destinations: valid example, limits and integer days 1..30', () => {
  const f = (v) => validateFile('catalogo/destinos/alemania-hamburgo.json', json(v))
  assert.deepEqual(f(destino), { ok: true, errors: [] })
  assert.equal(f({ ...destino, pais: 'x'.repeat(41) }).ok, false)
  assert.equal(f({ ...destino, ciudad: 'x'.repeat(40) }).ok, true)
  assert.equal(f({ ...destino, ciudad: 'x'.repeat(41) }).ok, false)
  assert.equal(f({ ...destino, diasTransito: 1 }).ok, true)
  assert.equal(f({ ...destino, diasTransito: 30 }).ok, true)
  assert.equal(f({ ...destino, diasTransito: 0 }).ok, false)
  assert.equal(f({ ...destino, diasTransito: 31 }).ok, false)
  assert.equal(f({ ...destino, diasTransito: 2.5 }).ok, false)
  assert.equal(f({ ...destino, diasTransito: '3' }).ok, false)
  assert.equal(f({ ...destino, extra: 1 }).ok, false)
})

test('catalog file names must be lowercase slugs', () => {
  assert.equal(validateFile('catalogo/productos/Limon Verna.json', json(producto)).ok, false)
  assert.equal(validateFile('catalogo/destinos/x/y.json', json(destino)).ok, false)
})

test('data/precios.json: price per product id, > 0 and <= 100', () => {
  const f = (v) => validateFile('data/precios.json', json(v))
  assert.deepEqual(f({ 'limon-verna': 1.2, brocoli: 2 }), { ok: true, errors: [] })
  assert.equal(f({ a: 100 }).ok, true)
  assert.equal(f({ a: 0.01 }).ok, true)
  assert.equal(f({ a: 100.01 }).ok, false)
  assert.equal(f({ a: 0 }).ok, false)
  assert.equal(f({ a: -1 }).ok, false)
  assert.equal(f({ a: '1' }).ok, false)
  assert.equal(f({ 'Bad Key': 1 }).ok, false)
  assert.equal(f([1]).ok, false)
})

test('data/descuentos.json: 1-5 tiers, integer desdeKg >= 0 increasing, percentage 0..50', () => {
  const f = (v) => validateFile('data/descuentos.json', json(v))
  const t = (desdeKg, porcentaje) => ({ desdeKg, porcentaje })
  assert.deepEqual(f({ tramos: [t(1000, 3), t(5000, 6)] }), { ok: true, errors: [] })
  assert.equal(f({ tramos: [t(0, 0)] }).ok, true)
  assert.equal(f({ tramos: [t(0, 50)] }).ok, true)
  assert.equal(f({ tramos: [t(0, 50.5)] }).ok, false)
  assert.equal(f({ tramos: [t(0, -1)] }).ok, false)
  assert.equal(f({ tramos: [t(-1, 5)] }).ok, false)
  assert.equal(f({ tramos: [t(1.5, 5)] }).ok, false)
  assert.equal(f({ tramos: [] }).ok, false)
  assert.equal(f({ tramos: [1, 2, 3, 4, 5].map((n) => t(n, n)) }).ok, true)
  assert.equal(f({ tramos: [1, 2, 3, 4, 5, 6].map((n) => t(n, n)) }).ok, false)
  assert.equal(f({ tramos: [t(100, 1), t(100, 2)] }).ok, false)
  assert.equal(f({ tramos: [t(500, 1), t(100, 2)] }).ok, false)
  assert.equal(f({ tramos: [{ desdeKg: 1 }] }).ok, false)
  assert.equal(f({ tramos: [{ desdeKg: 1, porcentaje: 1, x: 1 }] }).ok, false)
  assert.equal(f({ tramos: 'no' }).ok, false)
  assert.equal(f({ tramos: [t(1, 1)], extra: 1 }).ok, false)
  assert.equal(f({}).ok, false)
})

test('config/transporte.json: eurPorKg 0..10 and minimo 0..5000 per destination id', () => {
  const f = (v) => validateFile('config/transporte.json', json(v))
  const r = (eurPorKg, minimo) => ({ 'alemania-hamburgo': { eurPorKg, minimo } })
  assert.deepEqual(f(r(0.1, 150)), { ok: true, errors: [] })
  assert.equal(f(r(0, 0)).ok, true)
  assert.equal(f(r(10, 5000)).ok, true)
  assert.equal(f(r(10.01, 0)).ok, false)
  assert.equal(f(r(0, 5000.01)).ok, false)
  assert.equal(f(r(-1, 0)).ok, false)
  assert.equal(f(r(0, -1)).ok, false)
  assert.equal(f(r('1', 0)).ok, false)
  assert.equal(f({ x: { eurPorKg: 1 } }).ok, false)
  assert.equal(f({ x: { eurPorKg: 1, minimo: 1, extra: 1 } }).ok, false)
  assert.equal(f({ x: 5 }).ok, false)
  assert.equal(f({ 'Bad Key': { eurPorKg: 1, minimo: 1 } }).ok, false)
})

test('the retired folders have no schema any more: wall, sections, figures and ticket config', () => {
  for (const path of ['content/muro/a.json', 'content/secciones/a.json', 'data/cifras.json', 'config/entradas.json']) {
    const result = validateFile(path, json({ texto: 'hola' }))
    assert.equal(result.ok, false, path)
  }
  assert.match(validateFile('content/muro/a.json', json({ texto: 'hola' })).errors[0], /no schema/)
})

test('data/ and config/ only accept their named files', () => {
  assert.equal(validateFile('data/otro.json', json({ a: 1 })).ok, false)
  assert.equal(validateFile('config/otro.json', json({ a: { eurPorKg: 1, minimo: 1 } })).ok, false)
})
