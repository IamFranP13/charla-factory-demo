// Loads the LIMONIA state from the repository files. Node only: the browser gets its state from the build.
// Platform code (it lives in lib/, not in src/domain/): the factory and the build read it, a model never writes it.

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const readJson = (root, path) => JSON.parse(readFileSync(join(root, path), 'utf8'))

function readFolder(root, folder) {
  const entries = {}
  for (const name of readdirSync(join(root, folder)).filter((n) => n.endsWith('.json')).sort()) {
    entries[name.slice(0, -'.json'.length)] = readJson(root, `${folder}/${name}`)
  }
  return entries
}

/**
 * @param {string} root repository root
 * @returns {{ productos: object, destinos: object, precios: object, descuentos: object, transporte: object }}
 */
export function cargarEstado(root) {
  return {
    productos: readFolder(root, 'catalogo/productos'),
    destinos: readFolder(root, 'catalogo/destinos'),
    precios: readJson(root, 'data/precios.json'),
    descuentos: readJson(root, 'data/descuentos.json'),
    transporte: readJson(root, 'config/transporte.json'),
  }
}
