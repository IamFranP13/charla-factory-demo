#!/usr/bin/env node
// Run before going on stage: checks the live repo is ready for the demo twist.
//
//   node scripts/preflight.mjs [--root <dir>]
//
// Exit codes: 0 all checks pass · 1 some check fails.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parsePolicy, routeFor } from '../lib/policy.js'

const args = process.argv.slice(2)
const rootFlag = args.indexOf('--root')
const root = rootFlag === -1 ? new URL('..', import.meta.url).pathname : args[rootFlag + 1]
const readJson = (file) => JSON.parse(readFileSync(join(root, file), 'utf8'))

const checks = [
  () => {
    const policy = parsePolicy(readFileSync(join(root, 'policy/risk.yaml'), 'utf8'))
    const [file] = routeFor(policy, ['config/entradas.json']).files
    return file.route === 'auto' && file.rule === 'default'
      ? { ok: true, text: 'El agujero está abierto: config/ se auto-fusiona por la regla default' }
      : { ok: false, text: `El agujero NO está abierto: config/ va por «${file.route}» (regla ${file.rule}). Restaura «default: auto» en policy/risk.yaml` }
  },
  () => {
    const policy = parsePolicy(readFileSync(join(root, 'policy/risk.yaml'), 'utf8'))
    return policy.factory
      ? { ok: true, text: `factory configurado: ${policy.factory}` }
      : { ok: false, text: 'factory vacío en policy/risk.yaml: nada se auto-fusionaría' }
  },
  () => {
    const live = readJson('config/entradas.json').precio
    const seed = readJson('factory/seed/config/entradas.json').precio
    return live === seed
      ? { ok: true, text: `El precio es el de partida (${seed}): la petición cambiará algo` }
      : { ok: false, text: `El precio es ${live} y el de partida es ${seed}. Restáuralo: copia factory/seed/config/entradas.json sobre config/entradas.json` }
  },
]

let failed = false
for (const check of checks) {
  let result
  try {
    result = check()
  } catch (error) {
    result = { ok: false, text: `No se pudo comprobar: ${error.message}` }
  }
  console.log(`${result.ok ? '✓' : '✗'} ${result.text}`)
  failed ||= !result.ok
}
process.exit(failed ? 1 : 0)
