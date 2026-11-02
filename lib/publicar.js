// From the agent's finished copy to a pull request. Nothing the agent left is trusted, its git least of all:
//   1. walkTree/tomar: the files of the copy are read as plain files (no symlink, device, FIFO, huge or odd-named file),
//      compared with a clean clone of the commit the copy started from (made by the host) and applied there; the commit is
//      made in the clone, by the host, without hooks. The copy's .git is never read.
//   2. recheckArgs: a new container with no network runs the tests and the build on the clone.
//   3. pushCommand/publicarNode: the branch goes up with the maintainer's own credentials (in the environment of one git
//      process, never in argv or in a config file); a workflow of main opens the pull request as the factory App (abrirPr).
// Everything that touches the outside is injected or isolated in a `…Node` factory, so the logic is tested with fakes.
import { execFile } from 'node:child_process'
import { constants, closeSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync, chmodSync, readSync } from 'node:fs'
import { join } from 'node:path'
import { parseState } from './estado.js'

export const IMAGE = 'limonia-agente:dev'

export const TAREA_RE = /^[1-9]\d{0,8}$/
export const FACTORY_AUTHOR = { name: 'Fábrica LIMONIA', email: 'fabrica@limonia.invalid' }
const LIMITS = { maxFiles: 1000, maxBytes: 2_000_000, maxDepth: 12, maxChanges: 60 }
// What a copy holds that is not part of the change (the same set the repository ignores or the agent's own folder).
const EXCLUDED_TOP = new Set(['.git', 'node_modules', '.fabrica', 'dist', '.astro', '.factory', '.wrangler', '.env'])
const excluded = (name) => EXCLUDED_TOP.has(name) || name.startsWith('.test-dist-')
const MAX_SUMMARY = 72
const REVIEW_FILE_BYTES = 200_000

export class Refusal extends Error {
  constructor(message) {
    super(message)
    this.name = 'Refusal'
  }
}

// One line of plain text: control and format characters become spaces, runs of spaces collapse.
const oneLine = (value, max) => {
  const chars = Array.from(String(value ?? '').replace(/[\p{Cc}\p{Cf}\u2028\u2029\s]+/gu, ' ').trim())
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : chars.join('')
}

// A path relative to the repository: no empty, `.` or `..` segment, nothing absolute, no `.git` anywhere, no control
// characters, no backslash, nothing that is not valid text.
export function safeRelPath(path) {
  if (typeof path !== 'string' || path.length === 0 || path.length > 200) throw new Refusal('ruta no válida')
  if (path.startsWith('/')) throw new Refusal(`ruta fuera del repositorio: ${oneLine(path, 60)}`)
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.' || segment === '..') throw new Refusal(`ruta no válida: ${oneLine(path, 60)}`)
    if (segment.toLowerCase() === '.git') throw new Refusal(`ruta con .git: ${oneLine(path, 60)}`)
    if (/[\p{Cc}\p{Cf}\u2028\u2029\\\uFFFD]/u.test(segment) || segment !== segment.trim()) throw new Refusal(`nombre no válido: ${oneLine(path, 60)}`)
  }
  return path
}

// The regular files of a tree, sorted. Throws a Refusal on anything else. Never follows a link.
export function walkTree(root, limits = {}) {
  const { maxFiles, maxBytes, maxDepth } = { ...LIMITS, ...limits }
  const found = []
  const visit = (rel, depth) => {
    if (depth > maxDepth) throw new Refusal('árbol demasiado profundo')
    for (const name of readdirSync(rel ? join(root, rel) : root)) {
      if (!rel && excluded(name)) continue
      const path = safeRelPath(rel ? `${rel}/${name}` : name)
      const stat = lstatSync(join(root, path))
      if (stat.isSymbolicLink()) throw new Refusal(`enlace simbólico: ${oneLine(path, 60)}`)
      if (stat.isDirectory()) {
        visit(path, depth + 1)
        continue
      }
      if (!stat.isFile()) throw new Refusal(`no es un archivo regular: ${oneLine(path, 60)}`)
      if (stat.size > maxBytes) throw new Refusal(`archivo demasiado grande: ${oneLine(path, 60)}`)
      if (found.length >= maxFiles) throw new Refusal('demasiados archivos')
      found.push({ path, size: stat.size, exec: (stat.mode & 0o111) !== 0 })
    }
  }
  visit('', 0)
  return found.sort((a, b) => (a.path < b.path ? -1 : 1))
}

// Reads a file that was a regular file a moment ago without ever following a link or blocking on a device.
function readRegular(root, path, maxBytes) {
  const fd = openSync(join(root, path), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const stat = fstatSync(fd)
    if (!stat.isFile() || stat.size > maxBytes) throw new Refusal(`el archivo cambió mientras se leía: ${oneLine(path, 60)}`)
    const buffer = Buffer.alloc(stat.size)
    let at = 0
    while (at < buffer.length) {
      const n = readSync(fd, buffer, at, buffer.length - at, at)
      if (n === 0) break
      at += n
    }
    return buffer.subarray(0, at)
  } finally {
    closeSync(fd)
  }
}

export function commitMessage(numero, resumen) {
  return `Tarea #${numero}: ${oneLine(resumen, MAX_SUMMARY) || 'cambios de la fábrica'}`
}

// --- git run by the host, only ever on a repository the host made ---------------------------------------------------------

// Like execFileSync without blocking the event loop: stdout as a string; a failure (exit code, time limit, SIGKILL) rejects
// with the error carrying `stderr` and `status`.
export function runAsync(command, args, { cwd, env, input, timeout, maxBuffer = 16 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(command, args, { cwd, env, encoding: 'utf8', maxBuffer, timeout, killSignal: 'SIGKILL' }, (error, stdout, stderr) => {
      if (error) reject(Object.assign(error, { stderr, stdout, status: typeof error.code === 'number' ? error.code : null }))
      else resolve(stdout)
    })
    child.stdin.on('error', () => {})
    child.stdin.end(input)
  })
}

// Hooks off, no fsmonitor, no user or system config, a fixed identity, no prompts; every call has a time limit.
export function hostGit(cwd, args, { input, timeoutMs = 30_000, env = {} } = {}) {
  return runAsync('git', ['--no-pager', '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', ...args], {
    cwd, input, timeout: timeoutMs,
    env: {
      PATH: process.env.PATH, HOME: '/nonexistent', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0',
      GIT_AUTHOR_NAME: FACTORY_AUTHOR.name, GIT_AUTHOR_EMAIL: FACTORY_AUTHOR.email, GIT_COMMITTER_NAME: FACTORY_AUTHOR.name, GIT_COMMITTER_EMAIL: FACTORY_AUTHOR.email,
      ...env,
    },
  })
}

const SHA = /^[0-9a-f]{40}$/
const HARDEN = ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false']

// The host-made clone: write through a symlink of the clone (a link main itself tracks) is refused.
function writeInto(clone, path, data, exec) {
  let at = clone
  const segments = path.split('/')
  for (const segment of segments.slice(0, -1)) {
    at = join(at, segment)
    let stat = null
    try { stat = lstatSync(at) } catch { /* new directory */ }
    if (stat && !stat.isDirectory()) throw new Refusal(`el clon tiene un enlace en el camino: ${oneLine(path, 60)}`)
    if (!stat) mkdirSync(at)
  }
  const file = join(clone, path)
  try { unlinkSync(file) } catch { /* new file */ }
  writeFileSync(file, data, { flag: 'wx' })
  chmodSync(file, exec ? 0o755 : 0o644)
}

// git: (cwd, args, options) → stdout (or a promise of it). Injectable so a test can see every call.
export function trabajoNode({ source, copias, git = hostGit, limits = {} }) {
  const caps = { ...LIMITS, ...limits }
  const dir = (numero) => join(copias, `t${numero}.limpio`)
  return {
    dir,
    // → { clone, files }: files is what the commit changed (empty: the agent changed nothing, no commit was made).
    async tomar({ dir: copy, base, numero, resumen }) {
      if (!SHA.test(base)) throw new Error('base no válida')
      // Plain files only, read from the copy's tree. The copy's .git is excluded and never opened.
      const taken = walkTree(copy, caps)
      const clone = dir(numero)
      rmSync(clone, { recursive: true, force: true })
      mkdirSync(clone, { recursive: true })
      await git(clone, [...HARDEN, 'init', '-q', '-b', `tarea/${numero}`])
      await git(clone, [...HARDEN, 'fetch', '-q', '--no-tags', source, base])
      await git(clone, [...HARDEN, 'checkout', '-q', '-B', `tarea/${numero}`, base])
      const tracked = (await git(clone, [...HARDEN, 'ls-files', '-z'])).split('\0').filter(Boolean)
      const keep = new Set(taken.map((f) => f.path))
      const deleted = tracked.filter((path) => !excluded(path.split('/')[0]) && !keep.has(path))
      const changed = []
      for (const file of taken) {
        const there = join(clone, file.path)
        let same = false
        try {
          const stat = lstatSync(there)
          same = stat.isFile() && ((stat.mode & 0o111) !== 0) === file.exec && readFileSync(there).equals(readRegular(copy, file.path, caps.maxBytes))
        } catch (error) {
          if (error instanceof Refusal) throw error
        }
        if (!same) changed.push(file)
      }
      if (changed.length + deleted.length > caps.maxChanges) throw new Refusal('demasiados cambios')
      for (const path of deleted) {
        let at = clone
        for (const segment of path.split('/').slice(0, -1)) {
          at = join(at, segment)
          if (lstatSync(at).isSymbolicLink()) throw new Refusal('el clon tiene un enlace en el camino')
        }
        rmSync(join(clone, path), { force: true })
      }
      for (const file of changed) writeInto(clone, file.path, readRegular(copy, file.path, caps.maxBytes), file.exec)
      await git(clone, [...HARDEN, 'add', '-A'])
      const files = (await git(clone, [...HARDEN, 'diff', '--cached', '--name-only', '-z', '--no-renames'])).split('\0').filter(Boolean)
      if (files.length === 0) return { clone, files }
      await git(clone, [...HARDEN, 'commit', '-q', '--no-verify', '--no-gpg-sign', '-m', commitMessage(numero, resumen)])
      return { clone, files }
    },
    // What the reviewers read: the diff of the commit over its base and, for each changed file, the text before and after
    // (null: it did not exist / is not a small regular text file). Read from the host-made clone, never from the copy.
    async cambios({ clone, base, files }) {
      if (!SHA.test(base)) throw new Error('base no válida')
      let diff
      try {
        diff = await git(clone, [...HARDEN, 'diff', '--no-color', '--no-ext-diff', '--no-textconv', '--no-renames', '-U3', base, 'HEAD'])
      } catch {
        diff = '[el diff es demasiado grande para mostrarlo]'
      }
      const antes = {}
      const despues = []
      for (const path of files.slice(0, caps.maxChanges)) {
        try { antes[path] = await git(clone, [...HARDEN, 'show', `${base}:${path}`]) } catch { antes[path] = null }
        try {
          const stat = lstatSync(join(clone, path))
          if (stat.isFile() && stat.size <= REVIEW_FILE_BYTES) despues.push({ path, content: readFileSync(join(clone, path), 'utf8') })
        } catch { /* deleted */ }
      }
      return { diff, antes, despues }
    },
  }
}

// --- the re-check -----------------------------------------------------------------------------------------------------------

export const RECHECK_MIN = 10

// The same image, a new container, no network at all and no credential: the tests and the build of the clone.
export function recheckArgs({ numero, dir, ids }) {
  return [
    'run', '--rm', '-i',
    '--name', `limonia-verif-t${numero}`,
    '--network', 'none',
    '--user', `${ids.uid}:${ids.gid}`,
    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '--cpus', '2', '--memory', '2g', '--memory-swap', '2g', '--pids-limit', '512', '--shm-size', '256m',
    // exec: the tests write small helper scripts to /tmp and run them (docker mounts a tmpfs noexec by default).
    '--tmpfs', '/tmp:rw,exec,size=512m,mode=1777',
    '--tmpfs', `/home/agente:rw,size=256m,uid=${ids.uid},gid=${ids.gid},mode=0700`,
    '--mount', `type=bind,source=${dir},target=/work`,
    '-e', 'HOME=/home/agente',
    IMAGE,
    'sh', '-c', 'npm test && npm run build',
  ]
}

// --- the push ---------------------------------------------------------------------------------------------------------------

const REPO_RE = /^[\w.-]+\/[\w.-]+$/

// The credential rides in the environment of the one git process (a config entry made of environment variables): not in
// argv, not in .git/config. The url is explicit: the clone has no remote.
export function pushCommand({ repo, numero, token, base = process.env }) {
  if (!REPO_RE.test(String(repo))) throw new Error('repo no válido')
  if (!Number.isInteger(numero) || numero < 1) throw new Error('tarea no válida')
  const basic = Buffer.from(`x-access-token:${token}`).toString('base64')
  return {
    args: ['-c', 'core.hooksPath=/dev/null', 'push', '--no-verify', '-q', `https://github.com/${repo}.git`, `+refs/heads/tarea/${numero}:refs/heads/tarea/${numero}`],
    env: {
      PATH: base.PATH, HOME: '/nonexistent', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0',
      GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader', GIT_CONFIG_VALUE_0: `Authorization: Basic ${basic}`,
    },
  }
}

// A message that may repeat a credential: neither the token nor its encoded form leaves.
export function scrub(text, token) {
  let out = String(text ?? '')
  for (const secret of [token, Buffer.from(`x-access-token:${token}`).toString('base64')]) if (secret) out = out.replaceAll(secret, '***')
  return out
}

// token: () → the maintainer's gh token; gh(args) → stdout (the maintainer's gh); sleep(ms)
export function publicarNode({ repo, owner = repo.split('/')[0], token = async () => (await runAsync('gh', ['auth', 'token'])).trim(), gh = (args) => runAsync('gh', args), push, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), polls = 40, pollMs = 4000 }) {
  const run = push ?? ((cwd, { args, env }) => runAsync('git', args, { cwd, env, timeout: 120_000 }))
  return {
    // → { pr }: the number of the pull request the workflow opened, or null if it did not show up in time.
    async publicar({ clone, numero }) {
      const secret = await token()
      try {
        await run(clone, pushCommand({ repo, numero, token: secret }))
      } catch (error) {
        throw new Error(`git push: ${oneLine(scrub(`${error.stderr ?? ''} ${error.message}`, secret), 160)}`)
      }
      try {
        await gh(['workflow', 'run', 'abrir-pr.yml', '--ref', 'main', '-f', `tarea=${numero}`])
      } catch (error) {
        throw new Error(`gh workflow run: ${oneLine(scrub(`${error.stderr ?? ''} ${error.message}`, secret), 160)}`)
      }
      for (let i = 0; i < polls; i++) {
        await sleep(pollMs)
        try {
          const pulls = JSON.parse(await gh(['api', `repos/${repo}/pulls?state=all&head=${owner}:tarea/${numero}&per_page=5`]))
          const number = pulls.find((p) => Number.isInteger(p?.number))?.number
          if (number) return { pr: number }
        } catch { /* try again */ }
      }
      return { pr: null }
    },
  }
}

// --- the workflow's script: open the pull request ------------------------------------------------------------------------------

// github: { issue(n), branchExists(ref), openPulls(head), createPull({title, head, base, body}) → { number },
//           ensureLabel(name), addLabels(number, labels), recordPull(n, pr) }
// Runs from the code of main, with the factory App token, and reads only data about the branch: it never runs its code.
export async function abrirPr({ tarea, owner, github }) {
  if (typeof tarea !== 'string' || !TAREA_RE.test(tarea)) throw new Error('tarea: debe ser un número de tarea')
  const n = Number(tarea)
  const issue = await github.issue(n)
  if (!issue || issue.state !== 'open' || issue.pull_request) throw new Error('la tarea no es una issue abierta')
  if (String(issue.user?.login ?? '').toLowerCase() !== String(owner).toLowerCase()) throw new Error('la tarea no es del dueño del repositorio')
  if (!(issue.labels ?? []).some((l) => (typeof l === 'string' ? l : l?.name) === 'entrada')) throw new Error('la tarea no está en la cola (entrada)')
  const state = parseState(issue.body)
  if (!state) throw new Error('la tarea no tiene estado')
  const branch = `tarea/${n}`
  if (!(await github.branchExists(branch))) throw new Error(`no existe la rama ${branch}`)
  const existing = (await github.openPulls(`${owner}:${branch}`))[0]
  if (existing) {
    await github.recordPull(n, existing.number)
    return existing.number
  }
  if (state.pr !== null) throw new Error('la tarea ya tuvo un pull request')
  const label = `perfil:${state.perfil}`
  const pull = await github.createPull({ title: `Tarea #${n} · ${state.perfil}`, head: branch, base: 'main', body: `Closes #${n}` })
  await github.ensureLabel(label)
  await github.addLabels(pull.number, [label])
  await github.recordPull(n, pull.number)
  return pull.number
}
