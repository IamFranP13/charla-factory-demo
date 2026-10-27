import { test } from 'node:test'
import assert from 'node:assert/strict'
import feature from './index.js'

const estado = {
  productos: {
    limon: { nombre: 'Limón', categoria: 'fruta', disponible: true },
    naranja: { nombre: 'Naranja', categoria: 'fruta', disponible: true },
    lechuga: { nombre: 'Lechuga', categoria: 'hortaliza', disponible: true },
    uva: { nombre: 'Uva', categoria: 'fruta', disponible: false },
  },
  precios: { limon: 1.3, naranja: 0.78, lechuga: 0.65, uva: 0.1 },
}

test('shows the cheapest available product of each category', () => {
  assert.deepEqual(feature.calcular(estado).filas, [['Fruta', 'Naranja', '0,78 €/kg'], ['Hortaliza', 'Lechuga', '0,65 €/kg']])
})
