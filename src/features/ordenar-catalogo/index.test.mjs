import { test } from 'node:test'
import assert from 'node:assert/strict'
import feature from './index.js'
import { validarFeature, validarResultado } from '../contrato.js'

const estado = {
  productos: {
    limon: { nombre: 'Limón Verna', disponible: true },
    tomate: { nombre: 'Tomate Raf', disponible: true },
    uva: { nombre: 'Uva de mesa', disponible: false },
    alcachofa: { nombre: 'Alcachofa', disponible: true },
  },
  precios: { limon: 1.3, tomate: 2.4, uva: 2.1 },
}

test('the feature follows the contract', () => {
  assert.deepEqual(validarFeature({ default: feature }, 'ordenar-catalogo'), [])
  assert.deepEqual(validarResultado(feature.calcular(estado)), [])
})

test('only products that are available and priced are listed', () => {
  const nombres = feature.calcular(estado).items.map((i) => i.texto)
  assert.deepEqual([...nombres].sort(), ['Limón Verna', 'Tomate Raf'])
})
