// The contract of a feature, in one pure file (no Node APIs).
// A feature is src/features/<id>/index.js with `export default { id, titulo, donde, calcular }`.
// `calcular(estado)` is pure and returns data, never markup: a generic component paints it.
// The build, the Código reviewer and the tests all check features with this same file.
// Only humans change it (the factory may write src/features/<id>/index*.js and nothing else).

export const DONDE = ['inicio', 'catalogo', 'presupuesto']
export const TIPOS = ['lista', 'tabla', 'texto']
export const MAX_FILAS = 40

const UNSAFE = /[<>]|:\/\/|www\./i
const plain = (v, max) => typeof v === 'string' && v.trim().length > 0 && [...v].length <= max && !UNSAFE.test(v)
const cell = (v, max) => (typeof v === 'number' ? Number.isFinite(v) : plain(v, max))

/** @returns {string[]} what is wrong with the module of feature `id` (empty: it follows the contract) */
export function validarFeature(modulo, id) {
  const f = modulo?.default
  if (!f || typeof f !== 'object') return ['export default debe ser un objeto { id, titulo, donde, calcular }']
  const errores = []
  if (f.id !== id) errores.push(`id debe ser «${id}», el nombre de su carpeta`)
  if (!plain(f.titulo, 60)) errores.push('titulo debe ser texto plano de 1 a 60 caracteres')
  if (!DONDE.includes(f.donde)) errores.push(`donde debe ser uno de: ${DONDE.join(', ')}`)
  if (typeof f.calcular !== 'function') errores.push('calcular debe ser una función')
  return errores
}

/** @returns {string[]} what is wrong with a result of `calcular` */
export function validarResultado(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return ['el resultado debe ser un objeto']
  if (r.tipo === 'lista') {
    if (!Array.isArray(r.items) || r.items.length > MAX_FILAS) return [`items debe ser una lista de hasta ${MAX_FILAS}`]
    const mal = r.items.findIndex((i) => !i || !plain(i.texto, 200) || (i.valor !== undefined && !cell(i.valor, 60)))
    return mal === -1 ? [] : [`items[${mal}] debe ser { texto, valor? } en texto plano`]
  }
  if (r.tipo === 'tabla') {
    if (!Array.isArray(r.columnas) || r.columnas.length < 1 || r.columnas.length > 6 || !r.columnas.every((c) => plain(c, 40))) return ['columnas debe ser una lista de 1 a 6 textos']
    if (!Array.isArray(r.filas) || r.filas.length > MAX_FILAS) return [`filas debe ser una lista de hasta ${MAX_FILAS}`]
    const mal = r.filas.findIndex((f) => !Array.isArray(f) || f.length !== r.columnas.length || !f.every((c) => cell(c, 100)))
    return mal === -1 ? [] : [`filas[${mal}] debe tener ${r.columnas.length} celdas de texto plano o número`]
  }
  if (r.tipo === 'texto') return plain(r.texto, 500) ? [] : ['texto debe ser texto plano de 1 a 500 caracteres']
  return [`tipo debe ser uno de: ${TIPOS.join(', ')}`]
}

/** A valid result with every cell as a string, ready to paint. */
export function normalizarResultado(r) {
  if (r.tipo === 'lista') return { tipo: 'lista', items: r.items.map((i) => ({ texto: i.texto, ...(i.valor !== undefined && { valor: String(i.valor) }) })) }
  if (r.tipo === 'tabla') return { tipo: 'tabla', columnas: [...r.columnas], filas: r.filas.map((f) => f.map(String)) }
  return { tipo: 'texto', texto: r.texto }
}
