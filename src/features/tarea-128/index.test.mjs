import { test } from 'node:test'
import assert from 'node:assert/strict'
import feature from './index.js'
import { validarFeature, validarResultado } from '../contrato.js'

test('cheapest priced product per category', () => {
  assert.deepEqual(validarFeature({ default: feature }, 'tarea-128'), [])
  const r = feature.calcular({
    productos: { a: { nombre: 'A', categoria: 'fruta' }, b: { nombre: 'B', categoria: 'fruta' }, c: { nombre: 'C', categoria: 'hortaliza' } },
    precios: { a: 2, b: 1.5 },
  })
  assert.deepEqual(validarResultado(r), [])
  assert.deepEqual(r.filas, [['fruta', 'B', '1,50']])
  assert.deepEqual(validarResultado(feature.calcular({ productos: {}, precios: {} })), [])
})
