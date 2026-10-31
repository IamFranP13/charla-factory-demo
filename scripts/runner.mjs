#!/usr/bin/env node
// The factory on this PC: polls GitHub for requests and runs the pipeline for each one, in parallel.
//
//   npm run runner -- [--paralelo N] [--intervalo S] [--repo owner/repo] [--config DIR]
//
// It does exactly what .github/workflows/factory.yml does, so only one of the two may be on: it refuses to start while
// the workflow is enabled (gh workflow disable factory.yml) and while another runner is running.
// Secrets live in ~/.config/charla-factory-demo/ (override: --config or CHARLA_FACTORY_CONFIG), outside the repository,
// every file mode 600:
//   app-id         the id of the factory GitHub App
//   app-key.pem    its private key
//   modelo.env     optional, KEY=VALUE lines: FACTORY_PROVIDER, FACTORY_API_URL, FACTORY_MODEL, FACTORY_CODE_MODEL,
//                  FACTORY_REVIEW_MODEL, FACTORY_REVIEW_API_URL, FACTORY_API_KEY, FACTORY_REVIEW_API_KEY, FACTORY_BROWSER
//                  (FACTORY_BROWSER: the Chrome/Chromium for the screenshots of a visual change)
// Needs `gh` logged in as the repository owner (to read the requests) and the Node of .node-version.
// Ctrl+C: the requests running finish, no new one starts. A second Ctrl+C quits at once.

import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { mintInstallationToken, REQUIRED_PERMISSIONS } from '../lib/app-token.js'
import { ghJson } from '../lib/github.js'
import { acquireLock, checkWorkflowDisabled, eligibleIssues, loadConfig, parseArgs, repoFromRemote, runCommand, runLoop, runTask } from '../lib/runner.js'

const root = new URL('..', import.meta.url).pathname
const HELP = `Uso: npm run runner -- [--paralelo N] [--intervalo S] [--repo owner/repo] [--config DIR]

  --paralelo N    peticiones a la vez (por defecto 6)
  --intervalo S   segundos entre consultas a GitHub (por defecto 5)
  --repo          owner/repo (por defecto, el remoto origin)
  --config DIR    carpeta de secretos (por defecto ~/.config/charla-factory-demo): app-id, app-key.pem y
                  modelo.env (opcional), todos con permisos 600

Antes de arrancar: gh workflow disable factory.yml (un solo modo a la vez).
Para volver a Actions: parar el runner (Ctrl+C) y gh workflow enable factory.yml.`

const log = (message) => console.log(`${new Date().toTimeString().slice(0, 8)} ${message}`)

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) return console.log(HELP)

  const configDir = args.config ?? process.env.CHARLA_FACTORY_CONFIG ?? join(homedir(), '.config', 'charla-factory-demo')
  const config = loadConfig(configDir)
  const repo = args.repo ?? process.env.GITHUB_REPOSITORY ?? repoFromRemote(execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: root, encoding: 'utf8' }).trim())
  if (!repo) throw new Error('no sé cuál es el repositorio: usa --repo owner/repo')
  const owner = repo.split('/')[0]

  await checkWorkflowDisabled({ run: runCommand, repo })
  const release = acquireLock(join(configDir, 'runner.lock'))
  try {
    // Fails closed here, before any request: the installation must grant what the pipeline needs.
    const mint = (permissions, needs) => mintInstallationToken({ appId: config.appId, privateKey: config.privateKey, repo, permissions, needs })
    await mint(undefined, REQUIRED_PERMISSIONS)
    const mintToken = async (scope) => (scope === 'full' ? await mint(undefined, REQUIRED_PERMISSIONS) : await mint({ issues: 'write', contents: 'read' })).token

    let stopping = false
    process.on('SIGINT', () => {
      if (stopping) process.exit(130)
      stopping = true
      log('parando: termino las peticiones en curso y no empiezo ninguna más (Ctrl+C otra vez para salir ya)')
    })
    process.on('SIGTERM', () => { stopping = true })

    log(`runner de ${repo}: hasta ${args.paralelo} peticiones a la vez, consulta cada ${args.intervalo} s`)
    let lastCheck = Date.now()
    await runLoop({
      paralelo: args.paralelo,
      poll: async () => {
        // Someone enabling the workflow meanwhile would double every request: stop taking new ones.
        if (Date.now() - lastCheck > 60000) {
          lastCheck = Date.now()
          try {
            await checkWorkflowDisabled({ run: runCommand, repo })
          } catch (error) {
            stopping = true
            throw error
          }
        }
        return ghJson(`repos/${repo}/issues?labels=entrada&state=open&creator=${owner}&per_page=100`, { paginate: true })
      },
      eligible: (issues, taken) => eligibleIssues(issues, { owner, taken }),
      start: async (number) => {
        const result = await runTask(number, { root, repo, run: runCommand, mintToken, model: config.model, log })
        log(`#${number}: ${result.outcome}${result.pr ? ` (PR #${result.pr})` : ''}${result.status ? ` · ${result.status}` : ''}`)
      },
      sleep: () => new Promise((resolve) => setTimeout(resolve, args.intervalo * 1000)),
      isStopping: () => stopping,
      log,
    })
    log('runner parado')
  } finally {
    release()
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`runner: ${error.message}`)
    process.exit(2)
  })
}
