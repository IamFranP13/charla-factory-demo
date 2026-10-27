#!/usr/bin/env node
// Validates every data file the factory can write, plus the rules that span files.
// Usage: node scripts/validate-content.mjs [root]   (exit 1 listing every failing file)
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateFile } from '../lib/schemas.js'
import { validateCatalog } from '../src/domain/catalogo.js'
import { cargarEstado } from '../src/domain/estado-node.js'

const FOLDERS = ['content/campanas', 'catalogo/productos', 'catalogo/destinos']
const FILES = ['data/precios.json', 'data/descuentos.json', 'config/transporte.json']

export function validateContent(root) {
  const errors = []
  const check = (path) => {
    const result = validateFile(path, readFileSync(join(root, path), 'utf8'))
    if (!result.ok) errors.push(...result.errors)
  }

  for (const folder of FOLDERS) {
    if (!existsSync(join(root, folder))) {
      errors.push(`${folder}/: la carpeta no existe`)
      continue
    }
    for (const name of readdirSync(join(root, folder)).filter((n) => n.endsWith('.json')).sort()) check(`${folder}/${name}`)
  }
  for (const path of FILES) {
    if (existsSync(join(root, path))) check(path)
    else errors.push(`${path}: el fichero no existe`)
  }

  // Cross-file rules only make sense once every file has the right shape.
  if (errors.length === 0) errors.push(...validateCatalog(cargarEstado(root)).errors)
  return { ok: errors.length === 0, errors }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = process.argv[2] ?? fileURLToPath(new URL('..', import.meta.url))
  const { ok, errors } = validateContent(root)
  if (!ok) {
    console.error('Contenido no válido:\n' + errors.map((e) => `  - ${e}`).join('\n'))
    process.exit(1)
  }
  console.log('Contenido válido.')
}
