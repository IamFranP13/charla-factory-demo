#!/usr/bin/env node
// The agent lane on this PC: a full coding agent (Pi) per Linear ticket, in a throwaway git worktree.
//
//   npm run agente -- [--paralelo N] [--intervalo S] [--repo owner/repo] [--config DIR]
//
// Separate from `npm run runner` (the constrained factory for the audience's form): this one is fed only by the owner's
// Linear team. The agent gets no GitHub token; this process re-runs `npm test`, pushes the agent's final commit and
// opens the pull request with the factory App token, so the same risk gate and CI judge it.
// Config in ~/.config/charla-factory-demo/ (override: --config or CHARLA_FACTORY_CONFIG), every file mode 600:
//   linear.env     LINEAR_API_KEY, LINEAR_TEAM (team key), optional LINEAR_LABEL (default factory), AGENTE_MODEL
//   app-id, app-key.pem   the factory App (the same files `npm run runner` uses)
// Needs `pi` installed and logged in, `gh`, and the Node of .node-version. Ctrl+C: the runs in progress finish, no new
// one starts. A second Ctrl+C quits at once.

import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { mintInstallationToken, REQUIRED_PERMISSIONS } from '../lib/app-token.js'
import { createAgent, defaultPiDir, loadLinearConfig, parseArgs, spawnStreaming } from '../lib/agente.js'
import { createLinear } from '../lib/linear.js'
import { acquireLock, loadConfig, repoFromRemote, runCommand } from '../lib/runner.js'

const root = new URL('..', import.meta.url).pathname
const HELP = `Uso: npm run agente -- [--paralelo N] [--intervalo S] [--repo owner/repo] [--config DIR]

  --paralelo N    tareas a la vez (por defecto 2)
  --intervalo S   segundos entre consultas a Linear (por defecto 5)
  --repo          owner/repo (por defecto, el remoto origin)
  --config DIR    carpeta de secretos (por defecto ~/.config/charla-factory-demo), todos con permisos 600:
                  linear.env  LINEAR_API_KEY, LINEAR_TEAM (clave del equipo) y, opcional, LINEAR_LABEL
                              (por defecto factory) y AGENTE_MODEL (modelo de Pi)
                  app-id y app-key.pem  la GitHub App de la factory (los mismos que usa npm run runner)

Coge las tareas del equipo con la etiqueta (por defecto factory) en un estado sin empezar: las pasa a In Progress,
escribe un comentario de progreso que va editando, y lanza a Pi en un worktree propio con factory/agente.md.
Si Pi pregunta, la pregunta sale como comentario y el agente sigue cuando respondes con otro comentario.
Al terminar, este proceso (no el agente) repite npm test, sube la rama agente/<CLAVE> y abre la PR con la App
(borrador si el agente no está seguro): la puerta de riesgo decide. Tarea en In Review; PR fusionada, Done.
Si falla: vuelve a Todo con el motivo y la etiqueta cambiada a factory-fallida.
Solo una instancia a la vez (bloqueo). Necesita pi (con su sesión iniciada), gh y git.`

const log = (message) => console.log(`${new Date().toTimeString().slice(0, 8)} ${message}`)

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) return console.log(HELP)

  const configDir = args.config ?? process.env.CHARLA_FACTORY_CONFIG ?? join(homedir(), '.config', 'charla-factory-demo')
  const linearConfig = loadLinearConfig(configDir)
  const repo = args.repo ?? process.env.GITHUB_REPOSITORY ?? repoFromRemote(execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: root, encoding: 'utf8' }).trim())
  if (!repo) throw new Error('no sé cuál es el repositorio: usa --repo owner/repo')

  let release
  try {
    release = acquireLock(join(configDir, 'agente.lock'))
  } catch (error) {
    throw new Error(error.message.replace('un runner', 'un agente'))
  }
  try {
    const app = loadConfig(configDir)
    const pi = await runCommand('pi', ['--version'], { env: { PATH: process.env.PATH, HOME: process.env.HOME } })
    if (pi.code !== 0) throw new Error('no encuentro pi (el agente): instálalo e inicia sesión con él')

    // Fails closed before any ticket: the installation must grant what the push and the PR need.
    const mintToken = async () => (await mintInstallationToken({ appId: app.appId, privateKey: app.privateKey, repo, needs: REQUIRED_PERMISSIONS })).token
    await mintToken()

    const linear = createLinear({ apiKey: linearConfig.apiKey })
    const setup = await linear.setup({ team: linearConfig.team, label: linearConfig.label })
    const prStatus = async (number) => {
      const env = { PATH: process.env.PATH, HOME: process.env.HOME, GH_TOKEN: await mintToken(), GH_PROMPT_DISABLED: '1' }
      const result = await runCommand('gh', ['api', `repos/${repo}/pulls/${number}`], { env })
      if (result.code !== 0) throw new Error(`gh api falló: ${result.stderr.trim().slice(-200)}`)
      const pr = JSON.parse(result.stdout)
      return pr.merged ? 'merged' : pr.state === 'closed' ? 'closed' : 'open'
    }

    const agent = createAgent({
      linear, setup, team: linearConfig.team, label: linearConfig.label, paralelo: args.paralelo, root, repo, run: runCommand,
      spawnAgent: spawnStreaming, mintToken, prStatus, playbook: join(root, 'factory', 'agente.md'), model: linearConfig.model,
      piDir: process.env.PI_CODING_AGENT_DIR ?? defaultPiDir(), log,
    })

    let stopping = false
    process.on('SIGINT', () => {
      if (stopping) process.exit(130)
      stopping = true
      log('parando: termino las tareas en curso y no empiezo ninguna más (Ctrl+C otra vez para salir ya)')
    })
    process.on('SIGTERM', () => { stopping = true })

    log(`agente de ${repo} (equipo ${linearConfig.team}, etiqueta ${linearConfig.label}): hasta ${args.paralelo} tareas a la vez, consulta cada ${args.intervalo} s`)
    while (!stopping) {
      try {
        await agent.tick()
      } catch (error) {
        log(`no se pudo consultar: ${error.message}`)
      }
      await new Promise((resolve) => setTimeout(resolve, args.intervalo * 1000))
    }
    await agent.shutdown()
    log('agente parado')
  } finally {
    release()
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`agente: ${error.message}`)
    process.exit(2)
  })
}
