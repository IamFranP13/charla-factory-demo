// The features of one page, from the registry generated at build time (src/features/index.js).
// The registry is data computed in the isolation; here each entry is checked again, so one that is malformed
// is left out instead of breaking the page.
import { DONDE, normalizarResultado, validarResultado } from '../features/contrato.js'

const plain = (v) => typeof v === 'string' && v.trim() !== '' && [...v].length <= 60 && !/[<>]|:\/\/|www\./i.test(v)

/** @returns {{ id: string, titulo: string, resultado: object }[]} */
export function paraPagina(registro, donde) {
  if (!Array.isArray(registro) || !DONDE.includes(donde)) return []
  const pintables = []
  for (const feature of registro) {
    try {
      if (!feature || feature.donde !== donde || !/^[a-z0-9][a-z0-9-]*$/.test(String(feature.id)) || !plain(feature.titulo)) continue
      if (validarResultado(feature.resultado).length) continue
      pintables.push({ id: feature.id, titulo: feature.titulo, resultado: normalizarResultado(feature.resultado) })
    } catch {
      // A feature that cannot even be read is not painted.
    }
  }
  return pintables
}
