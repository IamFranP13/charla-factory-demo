// Cross-file rules of the LIMONIA catalog. Single-file shape lives in lib/schemas.js;
// this checks that the files agree with each other.

/**
 * @param {import('./presupuesto.js').Estado} estado
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateCatalog(estado) {
  const errors = []
  for (const id of Object.keys(estado.precios ?? {})) {
    if (!Object.hasOwn(estado.productos ?? {}, id)) errors.push(`data/precios.json: hay precio para «${id}», que no es un producto del catálogo`)
  }
  for (const id of Object.keys(estado.transporte ?? {})) {
    if (!Object.hasOwn(estado.destinos ?? {}, id)) errors.push(`config/transporte.json: hay tarifa para «${id}», que no es un destino del catálogo`)
  }
  const tramos = estado.descuentos?.tramos ?? []
  if (tramos.some((t, i) => i > 0 && !(t.desdeKg > tramos[i - 1].desdeKg))) {
    errors.push('data/descuentos.json: los tramos deben tener desdeKg estrictamente creciente')
  }
  return { ok: errors.length === 0, errors }
}
