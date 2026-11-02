import { test } from 'node:test'
import assert from 'node:assert/strict'
import feature from './index.js'
import { validarFeature, validarResultado } from '../contrato.js'

test('averages priced products only', () => {
  assert.deepEqual(validarFeature({ default: feature }, 'tarea-122'), [])
  const r = feature.calcular({ productos: { a: {}, b: {}, c: {} }, precios: { a: 1, b: 2 } })
  assert.deepEqual(validarResultado(r), [])
  assert.match(r.texto, /1,50/)
  assert.deepEqual(validarResultado(feature.calcular({ productos: {}, precios: {} })), [])
})
