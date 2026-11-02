import { test } from 'node:test'
import assert from 'node:assert/strict'
import feature from './index.js'
import { validarFeature, validarResultado } from '../contrato.js'

const estado = {
  destinos: {
    a: { pais: 'Francia', ciudad: 'Rungis', diasTransito: 2 },
    b: { pais: 'Alemania', ciudad: 'Hamburgo', diasTransito: 3 },
  },
}

test('follows the contract and sorts by days', () => {
  assert.deepEqual(validarFeature({ default: feature }, 'tarea-116'), [])
  const r = feature.calcular(estado)
  assert.deepEqual(validarResultado(r), [])
  assert.equal(r.filas[0][0], 'Rungis, Francia')
})
