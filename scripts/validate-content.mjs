#!/usr/bin/env node
// Validates every data file the factory can write, plus the rules that span files.
// Usage: node scripts/validate-content.mjs [root]   (exit 1 listing every failing file)
// The cross-file rules are code of src/domain/ (a model can change it), and this runs in the Cloudflare build with
// secrets in the environment: they are evaluated in the isolation of lib/sandbox.js, never imported here.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateFile } from '../lib/schemas.js'
import { cargarEstado } from '../lib/estado-node.js'
import { checkState } from '../lib/sandbox.js'

const FOLDERS = ['content/campanas', 'catalogo/productos', 'catalogo/destinos']
const FILES = ['data/precios.json', 'data/descuentos.json', 'config/transporte.json']

export async function validateContent(root, options = {}) {
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
  if (errors.length === 0) {
    const state = await checkState(root, cargarEstado(root), options)
    if (state.error) errors.push(`reglas del catálogo: no se pudieron comprobar (${state.error})`)
    else errors.push(...state.catalogo.errors)
  }
  return { ok: errors.length === 0, errors }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = process.argv[2] ?? fileURLToPath(new URL('..', import.meta.url))
  const { ok, errors } = await validateContent(root).catch((error) => ({ ok: false, errors: [error.message] }))
  if (!ok) {
    console.error('Contenido no válido:\n' + errors.map((e) => `  - ${e}`).join('\n'))
    process.exit(1)
  }
  console.log('Contenido válido.')
}
