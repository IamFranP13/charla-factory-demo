// LIMONIA quote calculator. Pure business rules: no Node APIs, so the browser calculator,
// the Código reviewer and the tests all run this same file.

/**
 * @typedef {{ productoId: string, kg: number }} Linea
 * @typedef {{ lineas: Linea[], destinoId: string }} Pedido
 * @typedef {{ nombre: string, disponible: boolean }} Producto
 * @typedef {{ pais: string, ciudad?: string }} Destino
 * @typedef {{ desdeKg: number, porcentaje: number }} Tramo
 * @typedef {{
 *   productos: Record<string, Producto>,
 *   destinos?: Record<string, Destino>,
 *   precios: Record<string, number>,
 *   descuentos: { tramos: Tramo[] },
 *   transporte: Record<string, { eurPorKg: number, minimo: number }>,
 * }} Estado
 * @typedef {{
 *   ok: boolean,
 *   errores: string[],
 *   lineas: { productoId: string, nombre: string, kg: number, precioKg: number, importe: number }[],
 *   kgTotal: number,
 *   subtotal: number,
 *   descuento: { porcentaje: number, importe: number },
 *   transporte: number,
 *   total: number,
 * }} Presupuesto
 */

export const MAX_KG = 100000

const cents = (x) => Math.round(x * 100) / 100
const positive = (x) => Math.max(0, x)
const has = (object, key) => Object.hasOwn(object ?? {}, key)

/**
 * Prices an order against the current state.
 * @param {Pedido} pedido
 * @param {Estado} estado
 * @returns {Presupuesto}
 */
export function presupuestar(pedido, estado) {
  const errores = []
  const lineas = []
  const raw = Array.isArray(pedido?.lineas) ? pedido.lineas : []
  if (raw.length === 0) errores.push('Añade al menos un producto')

  let kgInvalido = false
  for (const { productoId, kg } of raw) {
    if (!Number.isInteger(kg) || kg < 1 || kg > MAX_KG) {
      kgInvalido = true
      continue
    }
    const producto = has(estado.productos, productoId) ? estado.productos[productoId] : null
    if (!producto) errores.push(`El producto «${productoId}» no existe`)
    else if (!producto.disponible) errores.push(`El producto «${producto.nombre}» no está disponible`)
    else if (!has(estado.precios, productoId) || !(estado.precios[productoId] > 0)) errores.push(`El producto «${producto.nombre}» no tiene precio`)
    else {
      const precioKg = estado.precios[productoId]
      lineas.push({ productoId, nombre: producto.nombre, kg, precioKg, importe: cents(kg * precioKg) })
    }
  }
  if (kgInvalido) errores.unshift('Los kilos deben ser un número entero entre 1 y 100.000')

  const destinoId = pedido?.destinoId
  const destino = has(estado.destinos, destinoId) ? estado.destinos[destinoId] : null
  const tarifa = has(estado.transporte, destinoId) ? estado.transporte[destinoId] : null
  if (!destino && estado.destinos) errores.push(`El destino «${destinoId}» no existe`)
  else if (!tarifa) errores.push(`No hay tarifa de transporte para «${destino?.pais ?? destinoId}»`)

  if (errores.length > 0) {
    return { ok: false, errores, lineas: [], kgTotal: 0, subtotal: 0, descuento: { porcentaje: 0, importe: 0 }, transporte: 0, total: 0 }
  }

  const kgTotal = lineas.reduce((sum, l) => sum + l.kg, 0)
  const subtotal = cents(lineas.reduce((sum, l) => sum + l.importe, 0))
  const tramo = (estado.descuentos?.tramos ?? [])
    .filter((t) => t.desdeKg <= kgTotal)
    .reduce((best, t) => (!best || t.desdeKg > best.desdeKg ? t : best), null)
  const porcentaje = tramo ? tramo.porcentaje : 0
  const descuento = positive(cents((subtotal * porcentaje) / 100))
  const transporte = positive(cents(Math.max(tarifa.minimo, tarifa.eurPorKg * kgTotal)))
  const total = positive(cents(subtotal - descuento + transporte))
  return { ok: true, errores, lineas, kgTotal, subtotal, descuento: { porcentaje, importe: descuento }, transporte, total }
}
