import { test } from 'node:test'
import assert from 'node:assert/strict'
import { presupuestar } from './presupuesto.js'
import { validateCatalog } from './catalogo.js'

const estado = () => ({
  productos: {
    limon: { nombre: 'Limón Verna', disponible: true },
    naranja: { nombre: 'Naranja Navel', disponible: true },
    agotado: { nombre: 'Uva de mesa', disponible: false },
    sinprecio: { nombre: 'Alcachofa', disponible: true },
  },
  destinos: { hamburgo: { pais: 'Alemania' }, londres: { pais: 'Reino Unido' }, gratis: { pais: 'Nada' } },
  precios: { limon: 1.2, naranja: 0.8, agotado: 2 },
  descuentos: { tramos: [{ desdeKg: 1000, porcentaje: 3 }, { desdeKg: 5000, porcentaje: 6 }, { desdeKg: 20000, porcentaje: 10 }] },
  transporte: { hamburgo: { eurPorKg: 0.1, minimo: 150 }, londres: { eurPorKg: 0.2, minimo: 50 }, gratis: { eurPorKg: 0, minimo: 0 } },
})
const pedir = (lineas, destinoId = 'hamburgo', e = estado()) => presupuestar({ lineas, destinoId }, e)
const una = (kg) => pedir([{ productoId: 'limon', kg }])

test('a valid order returns the full shape', () => {
  const r = pedir([{ productoId: 'limon', kg: 100 }, { productoId: 'naranja', kg: 50 }])
  assert.deepEqual(r, {
    ok: true,
    errores: [],
    lineas: [
      { productoId: 'limon', nombre: 'Limón Verna', kg: 100, precioKg: 1.2, importe: 120 },
      { productoId: 'naranja', nombre: 'Naranja Navel', kg: 50, precioKg: 0.8, importe: 40 },
    ],
    kgTotal: 150,
    subtotal: 160,
    descuento: { porcentaje: 0, importe: 0 },
    transporte: 150,
    total: 310,
  })
})

test('kg boundaries: 1 and 100000 are valid', () => {
  assert.equal(una(1).ok, true)
  assert.equal(una(100000).ok, true)
})

test('kg boundaries: 0, 100001, 1.5, negative, text and NaN are invalid', () => {
  for (const kg of [0, 100001, 1.5, -3, '10', NaN, Infinity, undefined]) {
    const r = una(kg)
    assert.equal(r.ok, false, String(kg))
    assert.deepEqual(r.errores, ['Los kilos deben ser un número entero entre 1 y 100.000'])
  }
})

test('an invalid order has zeroed amounts and no lines', () => {
  const r = una(0)
  assert.deepEqual([r.lineas, r.kgTotal, r.subtotal, r.descuento, r.transporte, r.total], [[], 0, 0, { porcentaje: 0, importe: 0 }, 0, 0])
})

test('an order needs at least one line and a valid shape', () => {
  assert.equal(pedir([]).ok, false)
  assert.deepEqual(pedir([]).errores, ['Añade al menos un producto'])
  assert.equal(presupuestar({}, estado()).ok, false)
  assert.equal(presupuestar(null, estado()).ok, false)
})

test('unknown product, unavailable product and product without price fail with Spanish messages', () => {
  assert.deepEqual(pedir([{ productoId: 'fantasma', kg: 10 }]).errores, ['El producto «fantasma» no existe'])
  assert.deepEqual(pedir([{ productoId: 'agotado', kg: 10 }]).errores, ['El producto «Uva de mesa» no está disponible'])
  assert.deepEqual(pedir([{ productoId: 'sinprecio', kg: 10 }]).errores, ['El producto «Alcachofa» no tiene precio'])
})

test('unavailable products fail even with a price', () => {
  assert.equal(estado().precios.agotado, 2)
  assert.equal(pedir([{ productoId: 'agotado', kg: 10 }]).ok, false)
})

test('unknown destination and destination without transport fail', () => {
  assert.deepEqual(pedir([{ productoId: 'limon', kg: 10 }], 'marte').errores, ['El destino «marte» no existe'])
  const e = estado()
  delete e.transporte.londres
  assert.deepEqual(pedir([{ productoId: 'limon', kg: 10 }], 'londres', e).errores, ['No hay tarifa de transporte para «Reino Unido»'])
})

test('every error is reported, not only the first', () => {
  const r = pedir([{ productoId: 'fantasma', kg: 0 }, { productoId: 'sinprecio', kg: 5 }], 'marte')
  assert.equal(r.errores.length, 3)
})

test('the discount applies to the subtotal and uses the total kilos across lines', () => {
  const r = pedir([{ productoId: 'limon', kg: 700 }, { productoId: 'naranja', kg: 400 }])
  assert.equal(r.kgTotal, 1100)
  assert.equal(r.subtotal, 1160)
  assert.deepEqual(r.descuento, { porcentaje: 3, importe: 34.8 })
})

test('discount tiers work even when listed out of order', () => {
  const e = estado()
  e.descuentos.tramos.reverse()
  assert.equal(pedir([{ productoId: 'limon', kg: 5001 }], 'hamburgo', e).descuento.porcentaje, 6)
})

test('transport is the minimum when per-kg is lower, and per-kg when higher', () => {
  assert.equal(una(1000).transporte, 150)
  assert.equal(una(1500).transporte, 150)
  assert.equal(una(1501).transporte, 150.1)
  assert.equal(una(3000).transporte, 300)
})

test('zero-cost transport is allowed', () => {
  assert.equal(pedir([{ productoId: 'limon', kg: 10 }], 'gratis').transporte, 0)
})

test('amounts are rounded to cents', () => {
  const e = estado()
  e.precios.limon = 0.333
  const r = pedir([{ productoId: 'limon', kg: 10 }], 'hamburgo', e)
  assert.equal(r.lineas[0].importe, 3.33)
  assert.equal(r.subtotal, 3.33)
  e.precios.limon = 1.005
  assert.equal(pedir([{ productoId: 'limon', kg: 1 }], 'hamburgo', e).lineas[0].importe, Math.round(1.005 * 100) / 100)
})

test('total = subtotal - discount + transport', () => {
  const r = una(25000)
  assert.equal(r.subtotal, 30000)
  assert.equal(r.descuento.importe, 3000)
  assert.equal(r.transporte, 2500)
  assert.equal(r.total, 29500)
})

test('amounts are never negative', () => {
  const e = estado()
  e.descuentos.tramos = [{ desdeKg: 0, porcentaje: 50 }]
  e.transporte.gratis = { eurPorKg: 0, minimo: 0 }
  const r = pedir([{ productoId: 'limon', kg: 1 }], 'gratis', e)
  for (const n of [r.subtotal, r.descuento.importe, r.transporte, r.total]) assert.ok(n >= 0)
  e.descuentos.tramos = [{ desdeKg: 0, porcentaje: 500 }]
  const r2 = pedir([{ productoId: 'limon', kg: 1 }], 'gratis', e)
  assert.ok(r2.total >= 0 && r2.descuento.importe >= 0)
})

test('an empty or missing discount table means no discount', () => {
  const e = estado()
  e.descuentos = { tramos: [] }
  assert.equal(pedir([{ productoId: 'limon', kg: 5000 }], 'hamburgo', e).descuento.porcentaje, 0)
})

test('presupuestar does not mutate its inputs', () => {
  const e = estado()
  const p = { lineas: [{ productoId: 'limon', kg: 1200 }], destinoId: 'hamburgo' }
  const before = JSON.stringify([e, p])
  presupuestar(p, e)
  assert.equal(JSON.stringify([e, p]), before)
})

test('validateCatalog accepts a consistent state', () => {
  assert.deepEqual(validateCatalog(estado()), { ok: true, errors: [] })
})

test('validateCatalog rejects a price for an unknown product', () => {
  const e = estado()
  e.precios.fantasma = 3
  const r = validateCatalog(e)
  assert.equal(r.ok, false)
  assert.deepEqual(r.errors, ['data/precios.json: hay precio para «fantasma», que no es un producto del catálogo'])
})

test('validateCatalog rejects transport for an unknown destination', () => {
  const e = estado()
  e.transporte.marte = { eurPorKg: 1, minimo: 1 }
  assert.deepEqual(validateCatalog(e).errors, ['config/transporte.json: hay tarifa para «marte», que no es un destino del catálogo'])
})

test('validateCatalog rejects tiers that are not strictly increasing', () => {
  for (const tramos of [
    [{ desdeKg: 100, porcentaje: 1 }, { desdeKg: 100, porcentaje: 2 }],
    [{ desdeKg: 500, porcentaje: 1 }, { desdeKg: 100, porcentaje: 2 }],
  ]) {
    const e = estado()
    e.descuentos = { tramos }
    const r = validateCatalog(e)
    assert.equal(r.ok, false)
    assert.deepEqual(r.errors, ['data/descuentos.json: los tramos deben tener desdeKg estrictamente creciente'])
  }
})

test('validateCatalog reports every problem', () => {
  const e = estado()
  e.precios.a = 1
  e.transporte.b = { eurPorKg: 1, minimo: 1 }
  e.descuentos = { tramos: [{ desdeKg: 5, porcentaje: 1 }, { desdeKg: 5, porcentaje: 1 }] }
  assert.equal(validateCatalog(e).errors.length, 3)
})
