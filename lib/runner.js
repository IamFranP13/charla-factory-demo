// The local runner: what .github/workflows/factory.yml does for one issue, on the maintainer's PC and in parallel.
// The decisions (which issues, how many, what to do with a result) are pure; the side effects (git, gh, node, the
// App token, the clock) are injected, so the tests run without a network. Platform code: it never imports src/.

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const DEFAULT_PARALELO = 6
export const MAX_PARALELO = 20
export const FACTORY_TIMEOUT_MS = 15 * 60 * 1000
const COMMAND_TIMEOUT_MS = 2 * 60 * 1000
const MAX_OUTPUT = 200000
const BASE = 'main'
const STATE_MARKER = '<!-- factory:state '
// The only settings the config file may hand to the factory child.
export const MODEL_KEYS = [
  'FACTORY_PROVIDER', 'FACTORY_API_URL', 'FACTORY_MODEL', 'FACTORY_CODE_MODEL', 'FACTORY_REVIEW_MODEL', 'FACTORY_REVIEW_API_URL',
  'FACTORY_API_KEY', 'FACTORY_REVIEW_API_KEY', 'FACTORY_BROWSER',
]

// --- Arguments ---

export function parseArgs(argv) {
  const out = { paralelo: DEFAULT_PARALELO, help: false, config: undefined, repo: undefined, intervalo: 5 }
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    if (flag === '--help' || flag === '-h') out.help = true
    else if (flag === '--paralelo' || flag === '--intervalo') {
      const value = argv[++i]
      const n = Number(value)
      const max = flag === '--paralelo' ? MAX_PARALELO : 300
      if (!/^\d+$/.test(String(value ?? '')) || n < 1 || n > max) throw new Error(`${flag} necesita un entero entre 1 y ${max}`)
      out[flag === '--paralelo' ? 'paralelo' : 'intervalo'] = n
    } else if (flag === '--config' || flag === '--repo') {
      const value = argv[++i]
      if (!value) throw new Error(`${flag} necesita un valor`)
      out[flag.slice(2)] = value
    } else throw new Error(`argumento desconocido: ${flag}`)
  }
  return out
}

/** "owner/repo" from a GitHub remote URL (ssh or https), or null. */
export function repoFromRemote(url) {
  return /github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/.exec(String(url))?.[1] ?? null
}

/** The key=value lines scripts/factory.mjs appends to $GITHUB_OUTPUT. */
export function parseOutputs(text) {
  const values = {}
  for (const line of String(text ?? '').split('\n')) {
    const i = line.indexOf('=')
    if (i > 0) values[line.slice(0, i)] = line.slice(i + 1)
  }
  return values
}

// --- Which issues are the runner's, and what to do with a result ---

/**
 * Open issues labelled "entrada", filed by the owner, that the factory has not started (no state marker, no tarea/N
 * branch) and that this runner does not already hold. Oldest first.
 */
export function eligibleIssues(issues, { owner, taken = new Set(), hasBranch = () => false }) {
  return issues
    .filter((i) => !i.pull_request && i.state === 'open'
      && i.labels?.some((l) => l.name === 'entrada')
      && typeof i.user?.login === 'string' && i.user.login.toLowerCase() === String(owner).toLowerCase()
      && !String(i.body ?? '').includes(STATE_MARKER)
      && !taken.has(i.number) && !hasBranch(i.number))
    .sort((a, b) => a.number - b.number)
}

export const freeSlots = (max, active) => Math.max(0, max - active)

/** Same as the workflow: ok opens the PR, ignored (not our author) is left alone, anything else closes the issue. */
export function nextStep(status) {
  if (status === 'ok') return 'pr'
  if (status === 'ignored') return 'none'
  return 'close'
}

export const closeComment = (status) => `La factory no ha podido convertir esta petición en un cambio (resultado: ${status ?? 'error'}). Cierro la tarea.`

// --- One mode at a time ---

export async function checkWorkflowDisabled({ run, repo }) {
  let state
  try {
    const result = await run('gh', ['api', `repos/${repo}/actions/workflows/factory.yml`])
    if (result.code !== 0) throw new Error(result.stderr)
    state = JSON.parse(result.stdout).state
  } catch {
    throw new Error('no se pudo comprobar si el workflow factory.yml está desactivado (el runner no arranca sin saberlo)')
  }
  if (state === 'active') throw new Error('el workflow de la factory está activado: dos modos a la vez procesarían cada petición dos veces.\nDesactívalo con: gh workflow disable factory.yml')
  if (!['disabled_manually', 'disabled_inactivity'].includes(state)) throw new Error(`estado inesperado del workflow factory.yml (${state}): el runner no arranca`)
}

const processAlive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code === 'EPERM'
  }
}

/** A lock file holding the pid. Returns the function that releases it. */
export function acquireLock(path, { pid = process.pid, isAlive = processAlive } = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(path, String(pid), { flag: 'wx', mode: 0o600 })
      return () => {
        if (existsSync(path) && readFileSync(path, 'utf8') === String(pid)) rmSync(path, { force: true })
      }
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      const holder = Number(readFileSync(path, 'utf8'))
      if (Number.isInteger(holder) && holder > 0 && holder !== pid && isAlive(holder)) throw new Error(`ya hay un runner en marcha (pid ${holder})`)
      rmSync(path, { force: true })
    }
  }
  throw new Error('no se pudo tomar el bloqueo del runner')
}

// --- Secrets stay on the PC ---

function privateFile(path) {
  let stat
  try {
    stat = statSync(path)
  } catch {
    return null
  }
  if ((stat.mode & 0o077) !== 0 || (typeof process.getuid === 'function' && stat.uid !== process.getuid())) {
    throw new Error(`${path} debe ser tuyo y tener permisos 600 (chmod 600 ${path})`)
  }
  return readFileSync(path, 'utf8')
}

/** The App id, the App private key and the optional model settings, read from a directory of mode-600 files. */
export function loadConfig(dir) {
  const appId = privateFile(join(dir, 'app-id'))?.trim()
  if (!appId) throw new Error(`falta ${join(dir, 'app-id')} (el id de la GitHub App de la factory)`)
  const privateKey = privateFile(join(dir, 'app-key.pem'))
  if (!privateKey) throw new Error(`falta ${join(dir, 'app-key.pem')} (la clave privada de la App)`)
  const model = {}
  for (const line of (privateFile(join(dir, 'modelo.env')) ?? '').split('\n')) {
    const match = /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line)
    if (match && MODEL_KEYS.includes(match[1])) model[match[1]] = match[2].replace(/^(["'])(.*)\1$/, '$2')
  }
  return { appId, privateKey, model }
}

/** The environment of a child: an allowlist, never a copy of the parent's. */
export function childEnv({ parent = process.env, home, token, repo, output, model = {} }) {
  return {
    PATH: parent.PATH ?? '/usr/bin:/bin',
    HOME: home,
    TMPDIR: join(home, 'tmp'),
    GH_TOKEN: token,
    GH_PROMPT_DISABLED: '1',
    GITHUB_REPOSITORY: repo,
    GITHUB_OUTPUT: output,
    ...Object.fromEntries(Object.entries(model).filter(([k]) => MODEL_KEYS.includes(k))),
  }
}

// --- Running things ---

/** Runs a command; never rejects. `env` defaults to the parent's, so callers handling secrets always pass one. */
export function runCommand(command, args, { cwd, env, input, timeoutMs = COMMAND_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const child = spawn(command, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], detached: true })
    const keep = (text, chunk) => (text + chunk).slice(-MAX_OUTPUT)
    child.stdout.on('data', (chunk) => { stdout = keep(stdout, chunk) })
    child.stderr.on('data', (chunk) => { stderr = keep(stderr, chunk) })
    const timer = setTimeout(() => {
      timedOut = true
      try { process.kill(-child.pid, 'SIGKILL') } catch { child.kill('SIGKILL') }
    }, timeoutMs)
    child.on('error', (error) => { stderr += error.message })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr, timedOut })
    })
    child.stdin.on('error', () => {})
    child.stdin.end(input)
  })
}

function createMutex() {
  let tail = Promise.resolve()
  return (task) => {
    const result = tail.then(task, task)
    tail = result.catch(() => {})
    return result
  }
}
// Git's own locks (FETCH_HEAD, worktrees) do not like parallel use of one repository: serialise those calls.
const withRepoLock = createMutex()

/** The scheduler: polls, starts up to `paralelo` requests at once, never starts one twice, drains on stop. */
export async function runLoop({ paralelo, poll, start, eligible, sleep, isStopping, log }) {
  const active = new Map()
  const taken = new Set()
  while (!isStopping()) {
    try {
      const slots = freeSlots(paralelo, active.size)
      if (slots > 0) {
        for (const issue of eligible(await poll(), taken).slice(0, slots)) {
          const n = issue.number
          if (isStopping()) break
          taken.add(n)
          log(`#${n}: empieza`)
          active.set(n, Promise.resolve().then(() => start(n)).catch((error) => log(`#${n}: error: ${error.message}`)).finally(() => active.delete(n)))
        }
      }
    } catch (error) {
      log(`no se pudo consultar GitHub: ${error.message}`)
    }
    await sleep()
  }
  await Promise.all(active.values())
}

const GIT = ['-c', 'core.hooksPath=/dev/null', '-c', 'credential.helper=']
const PROFILE = /^[a-z][a-z0-9_-]{0,29}$/

function reportedFiles(text) {
  const files = String(text ?? '').split(',')
  const bad = files.find((f) => !f || f.startsWith('-') || f.startsWith('/') || f.split('/').some((part) => part === '..' || part === '' || part === '.git'))
  if (!files.length || bad !== undefined) throw new Error(`el resultado de la factory lista un fichero no válido (${bad ?? 'ninguno'})`)
  return files
}

/**
 * One request, the way the workflow does it, in its own throwaway worktree of a freshly fetched origin/main.
 * Context: root (the main checkout), repo, run, mintToken('issues' | 'full'), model, remoteUrl(repo), log, tmpBase.
 * `issues` token: issues write + contents read, for the factory child (its comments are the App bot's, which is who
 * the closing numbers trust); `full` (push and PR) is minted only when there is something to push.
 */
export async function runTask(number, context) {
  const { root, repo, run, mintToken, model = {}, log = () => {}, tmpBase = tmpdir() } = context
  const remoteUrl = context.remoteUrl ?? ((slug) => `https://github.com/${slug}.git`)
  const scratch = mkdtempSync(join(tmpBase, 'runner-'))
  const home = join(scratch, 'home')
  const worktree = join(scratch, 'wt')
  let added = false
  try {
    mkdirSync(join(home, 'tmp'), { recursive: true })
    const narrow = await mintToken('issues')
    const gitEnv = (token) => ({
      PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: home, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1',
      // The token travels in the environment of this one command: not on the command line, not in any .git/config.
      GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
      GIT_CONFIG_VALUE_0: `Authorization: Basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`,
    })
    const ghEnv = (token) => childEnv({ home, token, repo, output: join(scratch, 'gh-out') })
    const git = async (args, options) => {
      const result = await run('git', [...GIT, ...args], options)
      if (result.code !== 0) throw new Error(`git ${args[0]} falló: ${String(result.stderr).trim().slice(-300)}`)
      return result.stdout
    }

    // Idempotency, like the workflow's guard: only an open issue whose branch does not exist yet.
    const state = await run('gh', ['issue', 'view', String(number), '--repo', repo, '--json', 'state', '--jq', '.state'], { env: ghEnv(narrow) })
    const branch = await run('git', [...GIT, 'ls-remote', '--exit-code', '--heads', remoteUrl(repo), `tarea/${number}`], { env: gitEnv(narrow) })
    if (state.code !== 0 || state.stdout.trim() !== 'OPEN' || branch.code === 0) return { number, outcome: 'skipped' }

    await withRepoLock(async () => {
      await git(['fetch', 'origin', BASE], { cwd: root })
      await git(['worktree', 'add', '--detach', worktree, `origin/${BASE}`], { cwd: root })
      added = true
    })
    if (existsSync(join(root, 'node_modules'))) symlinkSync(join(root, 'node_modules'), join(worktree, 'node_modules'), 'dir')

    const output = join(scratch, 'outputs')
    writeFileSync(output, '')
    const child = await run(process.execPath, ['scripts/factory.mjs', '--issue', String(number)], {
      cwd: worktree, env: childEnv({ home, token: narrow, repo, output, model }), timeoutMs: FACTORY_TIMEOUT_MS,
    })
    for (const line of `${child.stdout}\n${child.stderr}`.split('\n').filter(Boolean).slice(-20)) log(`#${number}: ${line}`)
    const outputs = child.timedOut ? {} : parseOutputs(readFileSync(output, 'utf8'))
    const status = outputs.status
    const step = nextStep(status)

    if (step === 'close') {
      await run('gh', ['issue', 'close', String(number), '--repo', repo, '--reason', 'not planned', '--comment', closeComment(status)], { env: ghEnv(narrow) })
      return { number, status: status ?? 'error', outcome: 'closed' }
    }
    if (step === 'none') return { number, status, outcome: 'ignored' }

    // ok: commit only what the factory reported, push the branch, open the PR as the App.
    const profile = outputs.profile
    if (!PROFILE.test(String(profile))) throw new Error(`perfil no válido en el resultado de la factory: ${profile}`)
    const files = reportedFiles(outputs.files)
    const full = await mintToken('full')
    await git(['add', '--', ...files], { cwd: worktree, env: gitEnv(full) })
    const staged = (await git(['diff', '--cached', '--name-only'], { cwd: worktree, env: gitEnv(full) })).split('\n').filter(Boolean)
    if (staged.length !== files.length || !files.every((f) => staged.includes(f))) throw new Error(`lo que se iba a commitear (${staged.join(', ')}) no coincide con lo que la factory informó (${files.join(', ')})`)
    await git(['-c', 'user.name=factory[bot]', '-c', 'user.email=factory[bot]@users.noreply.github.com', 'commit', '--no-verify', '--no-gpg-sign', '-m', `Tarea #${number} (${profile})`], { cwd: worktree, env: gitEnv(full) })
    await git(['push', remoteUrl(repo), `HEAD:refs/heads/tarea/${number}`], { cwd: worktree, env: gitEnv(full) })

    const env = ghEnv(full)
    await run('gh', ['label', 'create', `perfil:${profile}`, '--force', '--repo', repo], { env })
    const created = await run('gh', [
      'pr', 'create', '--repo', repo, '--base', BASE, '--head', `tarea/${number}`,
      '--title', `Tarea #${number} · ${profile}`, '--body', `Closes #${number}`, '--label', `perfil:${profile}`,
    ], { cwd: worktree, env })
    const pr = Number(created.stdout.trim().split('/').pop())
    if (created.code !== 0 || !Number.isInteger(pr) || pr < 1) throw new Error(`no se pudo abrir la PR: ${String(created.stderr).trim().slice(-300)}`)

    // The task state is only ever written by the scripts: this records the PR and puts the task at the gate.
    await run(process.execPath, ['scripts/factory.mjs', '--issue', String(number), '--pr', String(pr)], {
      cwd: worktree, env: childEnv({ home, token: narrow, repo, output: join(scratch, 'pr-out') }), timeoutMs: COMMAND_TIMEOUT_MS,
    })
    return { number, status, outcome: 'pr', pr }
  } finally {
    try {
      if (added) await withRepoLock(() => run('git', [...GIT, 'worktree', 'remove', '--force', worktree], { cwd: root }))
    } catch (error) {
      log(`#${number}: no se pudo quitar el worktree: ${error.message}`)
    }
    rmSync(scratch, { recursive: true, force: true })
    try {
      await withRepoLock(() => run('git', [...GIT, 'worktree', 'prune'], { cwd: root }))
    } catch {}
  }
}
