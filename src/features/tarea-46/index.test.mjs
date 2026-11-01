import { test } from 'node:test'
import assert from 'node:assert/strict'
import feature from './index.js'

const estado = {
  destinos: {
    a: { pais: 'Alemania', ciudad: 'Hamburgo', diasTransito: 4 },
    b: { pais: 'Francia', ciudad: 'Rungis', diasTransito: 1 },
  },
}

test('lists every destination with its days, nearest first', () => {
  assert.deepEqual(feature.calcular(estado).items, [{ texto: 'Rungis, Francia', valor: '1 día' }, { texto: 'Hamburgo, Alemania', valor: '4 días' }])
})
