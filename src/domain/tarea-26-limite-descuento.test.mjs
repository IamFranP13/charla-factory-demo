import { test } from 'node:test'
import assert from 'node:assert/strict'
import { presupuestar } from './presupuesto.js'

const estado = {
  productos: { limon: { nombre: 'Limón', disponible: true } },
  destinos: { hamburgo: { pais: 'Alemania' } },
  precios: { limon: 1 },
  descuentos: { tramos: [{ desdeKg: 1000, porcentaje: 3 }, { desdeKg: 5000, porcentaje: 6 }] },
  transporte: { hamburgo: { eurPorKg: 0, minimo: 0 } },
}
const con = (kg) => presupuestar({ lineas: [{ productoId: 'limon', kg }], destinoId: 'hamburgo' }, estado).descuento.porcentaje

test('the discount applies at exactly the kilos of the tier', () => {
  assert.equal(con(999), 0)
  assert.equal(con(1000), 3)
  assert.equal(con(4999), 3)
  assert.equal(con(5000), 6)
})
