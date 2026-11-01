#!/usr/bin/env node
// Switches the factory on: works the queue (open issues of the owner labelled `entrada`) with Claude Code agents, each
// one in its own container. The logic lives in lib/fabrica.js; this only wires the real Docker, git, gh and proxy.
//
//   npm run fabrica -- [--origen prueba|web|todas] [--paralelo N] [--modelo M] [--esfuerzo E] [--tiempo MIN] [--turnos N] [--conservar] [--una-vez]
//
// After an agent finishes `ok` the three reviewers (seguridad, ux, ui: one model call each, in parallel) judge its diff and the
// approver (code) lets it through, sends it back to the agent once, or refuses it; then the work is re-checked in a container with no network, pushed as `tarea/<n>` with the
// maintainer's own `gh` credentials, and the workflow abrir-pr.yml (on main) opens the pull request as the factory App.
// Needs the model proxy running (`npm run proxy`), the image (`npm run agente:imagen`) and `gh` logged in as the owner.
// Ctrl+C: stop taking tasks and let the running ones finish; a second Ctrl+C kills them and returns them to the queue.
// Exit codes: 0 done · 1 the factory could not run · 2 usage error.
import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  acquireLock, createFabrica, dockerNode, filesNode, githubNode, gitNode, parseArgs, proxyNode,
} from '../lib/fabrica.js'
import { publicarNode, trabajoNode } from '../lib/publicar.js'

const USAGE = `Usage: npm run fabrica -- [options]
  --origen O     whose requests to take: prueba (yours, filed with \`npm run tarea\`; default), web (the public's)
                 or todas (both). An issue with no origin label, or an unknown one, counts as web
  --paralelo N   agents at once, 1 to 6 (default 3)
  --modelo M     model (default claude-haiku-4-5)
  --esfuerzo E   model effort for the agent and the reviewers: low, medium, high, xhigh or max (default low)
  --tiempo MIN   wall-clock limit per task in minutes (default 10)
  --turnos N     max turns per agent (default 30)
  --sondeo S     seconds between queue checks (default 10)
  --conservar    keep each task's copy and clean clone when it ends (for debugging; removed by default)
  --una-vez      stop when the queue is empty and nothing is running`

let options
try {
  options = parseArgs(process.argv.slice(2))
} catch (error) {
  console.error(`fabrica: ${error.message}\n${USAGE}`)
  process.exit(2)
}
if (options.ayuda) {
  console.log(USAGE)
  process.exit(0)
}

const root = join(import.meta.dirname, '..')
const runtime = join(process.env.XDG_RUNTIME_DIR ?? `/tmp/limonia-${process.getuid()}`, 'limonia')
const copias = join(process.env.XDG_STATE_HOME ?? join(homedir(), '.local/state'), 'limonia', 'tareas')

try {
  // The maintainer's own `gh`: the repository and its owner come from it unless the environment already says.
  process.env.GITHUB_REPOSITORY ||= execFileSync('gh', ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'], { encoding: 'utf8', cwd: root }).trim()
  const repo = process.env.GITHUB_REPOSITORY
  const trabajo = trabajoNode({ source: root, copias })
  const publicacion = publicarNode({ repo })
  const fabrica = createFabrica({
    owner: repo.split('/')[0],
    ids: { uid: process.getuid(), gid: process.getgid() },
    lock: () => acquireLock({ dir: runtime }),
    github: githubNode({ repo }),
    proxy: proxyNode({ socket: join(runtime, 'proxy-admin.sock') }),
    docker: dockerNode(),
    git: gitNode({ source: root, copias }),
    trabajo: { dir: trabajo.dir, tomar: trabajo.tomar, cambios: trabajo.cambios, publicar: publicacion.publicar },
    files: filesNode({ playbook: join(root, 'factory/agente/playbook.md'), copias, root }),
    root,
    clock: {
      now: () => new Date().toISOString(),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      timeout: (ms, fn) => { const t = setTimeout(fn, ms); return () => clearTimeout(t) },
    },
    log: (line) => console.log(`${new Date().toTimeString().slice(0, 8)} ${line}`),
  }, options)
  process.on('SIGINT', () => fabrica.interrupt())
  await fabrica.start()
} catch (error) {
  console.error(`fabrica: ${error.message}`)
  process.exit(1)
}
