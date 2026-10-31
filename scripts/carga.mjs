#!/usr/bin/env node
// Load test of the factory: files N requests as the intake would, follows them to production and reports the times.
//
//   node scripts/carga.mjs --n N [--json] [--timeout-min M] [--repo owner/repo] [--site URL] [--dry-run]
//
// Needs the factory running (the local runner or the workflow) and the owner's `gh` logged in.
// Exit codes: 0 done (or dry run) · 1 bad arguments or GitHub failure.

import { readFileSync } from 'node:fs'
import { gh, ghJson } from '../lib/github.js'
import { planRequests, issuesFor, newTrack, seguir, informe } from '../lib/carga.js'

const DEFAULT_SITE = 'https://charla-factory-demo.pages.dev'
const DEFAULT_TIMEOUT_MIN = 30
const POLL_MS = 5000
const MAX_N = 100
const SHA = /^[0-9a-f]{40}$/

const HELP = `Prueba de carga de la factory.

Uso: node scripts/carga.mjs --n N [opciones]

  --n N             número de peticiones a crear (1-${MAX_N}), perfiles a partes iguales
  --json            salida en JSON en lugar de tabla
  --timeout-min M   minutos máximos de espera (por defecto ${DEFAULT_TIMEOUT_MIN})
  --repo owner/repo repositorio (por defecto GITHUB_REPOSITORY o el de gh)
  --site URL        sitio desplegado, lee URL/deploy.json (por defecto ${DEFAULT_SITE})
  --dry-run         muestra lo que crearía, sin crear nada
  --help            esta ayuda

Crea las issues con tu \`gh\` en el formato exacto de la entrada, con peticiones de la batería
que el replay convierte en cambio, y las sigue hasta que cada una termina o se agota el tiempo:
issue → arranque → PR abierta → fusionada → desplegada (mediana, p90, max).
Necesita la factory en marcha (runner local o workflow). Al terminar, ejecuta
\`npm run reset-demo -- --apply\` para dejar la demo como estaba.
`

function fail(message) {
  console.error(`carga: ${message}`)
  process.exit(1)
}

function parseArgs(argv) {
  const opts = { json: false, dryRun: false, timeoutMin: DEFAULT_TIMEOUT_MIN, site: DEFAULT_SITE, repo: null, n: null }
  const value = (i) => (i + 1 < argv.length ? argv[i + 1] : fail(`falta el valor de ${argv[i]}`))
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') {
      console.log(HELP)
      process.exit(0)
    } else if (arg === '--json') opts.json = true
    else if (arg === '--dry-run') opts.dryRun = true
    else if (arg === '--n') opts.n = value(i++)
    else if (arg === '--timeout-min') opts.timeoutMin = value(i++)
    else if (arg === '--repo') opts.repo = value(i++)
    else if (arg === '--site') opts.site = value(i++)
    else fail(`opción desconocida: ${arg}\n\n${HELP}`)
  }
  if (!/^\d+$/.test(opts.n ?? '') || Number(opts.n) < 1 || Number(opts.n) > MAX_N) fail(`--n debe ser un entero entre 1 y ${MAX_N}`)
  opts.n = Number(opts.n)
  opts.timeoutMin = Number(opts.timeoutMin)
  if (!(opts.timeoutMin > 0)) fail('--timeout-min debe ser un número mayor que 0')
  if (opts.repo !== null && !/^[\w.-]+\/[\w.-]+$/.test(opts.repo)) fail('--repo debe tener la forma owner/repo')
  opts.site = opts.site.replace(/\/+$/, '')
  return opts
}

const opts = parseArgs(process.argv.slice(2))
const battery = JSON.parse(readFileSync(new URL('../test/battery.json', import.meta.url), 'utf8'))
const plan = planRequests(opts.n, battery)
const issues = issuesFor(plan)

if (opts.dryRun) {
  console.log(`Simulación: no se crea nada. Se crearían ${issues.length} issues${opts.repo ? ` en ${opts.repo}` : ''}:`)
  for (const issue of issues) console.log(`  ${issue.title}  [${issue.labels.join(', ')}]`)
  process.exit(0)
}

const repo = opts.repo ?? process.env.GITHUB_REPOSITORY ?? gh(['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner']).trim()
const api = `repos/${repo}`

console.error(`Creando ${issues.length} issues en ${repo}…`)
const created = issues.map((issue) => JSON.parse(gh(['api', '-X', 'POST', `${api}/issues`, '--input', '-'], { input: JSON.stringify(issue) })))
const numbers = new Set(created.map((i) => i.number))
console.error(`Creadas: ${created.map((i) => `#${i.number}`).join(' ')}. Siguiéndolas (máx. ${opts.timeoutMin} min)…`)

const deployedCommit = async () => {
  const response = await fetch(`${opts.site}/deploy.json`, { signal: AbortSignal.timeout(10_000), cache: 'no-store' })
  const commit = response.ok ? (await response.json())?.commit : null
  return typeof commit === 'string' && SHA.test(commit) ? commit : null
}

// The deployed commit contains the merge when it is the merge or ahead of it.
const contains = async (merge, deployed) => {
  if (merge === deployed) return true
  const { status } = ghJson(`${api}/compare/${merge}...${deployed}`)
  return status === 'identical' || status === 'ahead'
}

const tracks = await seguir({
  tracks: created.map(newTrack),
  repo,
  // Issues and pulls come newest first: a single page of 100 covers a run of up to 100 requests.
  listIssues: async () => ghJson(`${api}/issues?labels=entrada&state=all&sort=created&direction=desc&per_page=100`).filter((i) => numbers.has(i.number)),
  listPulls: async () => ghJson(`${api}/pulls?state=all&sort=created&direction=desc&per_page=100`),
  deployedCommit,
  contains,
  now: Date.now,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  pollMs: POLL_MS,
  timeoutMs: opts.timeoutMin * 60_000,
})

const report = informe(tracks)
console.log(opts.json ? JSON.stringify({ repo, filas: report.filas, estados: report.estados, etapas: report.etapas }) : report.texto)
console.error('\nRecuerda: ejecuta `npm run reset-demo -- --apply` para limpiar lo que ha creado la factory.')
