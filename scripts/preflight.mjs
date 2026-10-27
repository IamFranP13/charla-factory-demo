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
    const [file] = routeFor(policy, ['config/transporte.json']).files
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
    const live = readJson('config/transporte.json')['alemania-hamburgo']
    const seed = readJson('factory/seed/config/transporte.json')['alemania-hamburgo']
    const show = (t) => `${t.eurPorKg} €/kg, mínimo ${t.minimo} €`
    return live?.eurPorKg === seed.eurPorKg && live?.minimo === seed.minimo
      ? { ok: true, text: `El transporte a alemania-hamburgo es el de partida (${show(seed)}): la petición cambiará algo` }
      : { ok: false, text: `El transporte a alemania-hamburgo es ${show(live)} y el de partida es ${show(seed)}. Restáuralo: copia factory/seed/config/transporte.json sobre config/transporte.json` }
  },
  () => {
    // The two planted bugs (S15) must be on main, byte for byte as the seed has them; a merged fix leaves them different.
    const bugs = ['src/domain/presupuesto.js', 'src/features/ordenar-catalogo/index.js']
    const fixed = bugs.filter((file) => readFileSync(join(root, file), 'utf8') !== readFileSync(join(root, 'factory/seed', file), 'utf8'))
    return fixed.length === 0
      ? { ok: true, text: 'Los dos bugs sembrados siguen ahí (descuento en el límite del tramo, orden del catálogo)' }
      : { ok: false, text: `${fixed.join(', ')} ya no es el de partida (un arreglo ya se ha fusionado). Restáuralo: npm run reset-demo -- --apply` }
  },
  () => {
    const policy = parsePolicy(readFileSync(join(root, 'policy/risk.yaml'), 'utf8'))
    const via = (file) => routeFor(policy, [file]).route
    const [feature, domain, platform] = [via('src/features/tarea-1/index.js'), via('src/domain/presupuesto.js'), via('src/pages/index.astro')]
    return feature === 'auto' && domain === 'human' && platform === 'human'
      ? { ok: true, text: 'Política de código: las features van solas, el dominio y el resto de src/ esperan a una persona' }
      : { ok: false, text: `Política de código rota: feature ${feature} (debe ser auto), dominio ${domain} y resto de src/ ${platform} (deben ser human)` }
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
