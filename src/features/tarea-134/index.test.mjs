import { test } from 'node:test'
import assert from 'node:assert/strict'
import feature from './index.js'
import { validarFeature, validarResultado } from '../contrato.js'

const estado = {
  destinos: {
    a: { pais: 'Suecia', ciudad: 'Estocolmo' },
    b: { pais: 'Francia', ciudad: 'Rungis' },
    c: { pais: 'Italia', ciudad: 'Milán' },
  },
  transporte: { a: { eurPorKg: 0.22, minimo: 300 }, b: { eurPorKg: 0.1, minimo: 120 } },
}

test('follows the contract and sorts by price', () => {
  assert.deepEqual(validarFeature({ default: feature }, 'tarea-134'), [])
  const r = feature.calcular(estado)
  assert.deepEqual(validarResultado(r), [])
  assert.equal(r.filas.length, 2)
  assert.equal(r.filas[0][0], 'Rungis, Francia')
})
