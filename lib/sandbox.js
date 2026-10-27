// Where code written by a model is checked and run. Nothing a model writes is ever imported by the factory:
//   1. staticCheck   a text check, before anything runs (no node:, fetch, eval, process, dynamic import...)
//   2. runSuite      the tests of the domain and the features, in a throwaway copy of the code with
//                    no .git, an EMPTY environment (no secrets), a read-only view of that copy
//                    (Node permission model: no writes, no child processes, no network where Node has a switch),
//                    no code generation from strings, no core dumps, a memory limit and a time limit
//   3. evaluateFeatures  the same isolation, to compute what each feature shows on the site at build time
// The static check is a first filter, not the guarantee: the isolation is.

import { spawn } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, posix } from 'node:path'
import { pathToFileURL } from 'node:url'

export const SANDBOX_TIMEOUT_MS = 60000
export const FEATURE_TIMEOUT_MS = 10000
export const MEMORY_LIMIT_MB = 384
export const MAX_CODE_FILES = 3
export const MAX_FILE_CHARS = 24000
const MAX_OUTPUT = 200000
const COPIED = ['src/domain', 'src/features', 'catalogo', 'data', 'config', 'factory/muestras.json']
const MARKER = '@@FEATURE@@ '

// --- Who may write what ---

const SLUG = /^[a-z0-9][a-z0-9-]*$/

/**
 * The only paths a code request may write: a feature (src/features/<id>/index.js and index.test.mjs: the folder
 * tarea-<n> assigned by the factory, or an existing feature) and the domain (existing src/domain files, or new ones named
 * tarea-<n>[-<topic>].js / .test.mjs).
 * @returns {string|null} why the path is not allowed, or null
 */
export function codePathError(root, taskId, path, scope = ['features', 'domain']) {
  const feature = /^src\/features\/([^/]+)\/(index\.js|index\.test\.mjs)$/.exec(path)
  if (feature) {
    if (!scope.includes('features')) return `${path}: este tipo de petición no puede tocar las features`
    const folder = feature[1]
    if (!SLUG.test(folder)) return `${path}: nombre de carpeta no válido`
    const exists = existsSync(join(root, 'src/features', folder)) && statSync(join(root, 'src/features', folder)).isDirectory()
    if (folder === `tarea-${taskId}` || exists) return null
    return `${path}: una feature nueva va en src/features/tarea-${taskId}/ (la carpeta la pone la factory)`
  }
  const domain = /^src\/domain\/([^/]+)\.(js|test\.mjs)$/.exec(path)
  if (domain) {
    if (!scope.includes('domain')) return `${path}: este tipo de petición no puede tocar el dominio`
    if (!SLUG.test(domain[1]) || path === 'src/domain/estado-node.js') return `${path}: no se puede escribir ahí`
    // An existing domain file can be changed; a new one is named after the task, so the reset can find it.
    if (existsSync(join(root, path)) || new RegExp(`^tarea-${taskId}(-|$)`).test(domain[1])) return null
    return `${path}: un fichero nuevo del dominio se llama tarea-${taskId}.js, tarea-${taskId}-<tema>.js o tarea-${taskId}-<tema>.test.mjs`
  }
  return `${path}: fuera de lo que puede escribir el perfil (src/features/<id>/index.js, index.test.mjs, src/domain/*.js y *.test.mjs)`
}

// --- 1. Static check ---

const FORBIDDEN = ['process', 'globalThis', 'global', 'require', 'eval', 'Function', 'fetch', 'WebSocket', 'EventSource', 'XMLHttpRequest', 'WebAssembly', 'constructor', '__proto__', 'Reflect']
const FORBIDDEN_RE = new RegExp(`\\b(${FORBIDDEN.join('|')})\\b`, 'g')
const IMPORT_RE = /\bimport\s+(?:[\w$*{}\s,]+?\s+from\s+)?(['"])([^'"\n]+)\1/g
const EXPORT_FROM_RE = /\bexport\s+(?:\*(?:\s+as\s+[\w$]+)?|\{[^}]*\})\s+from\s+(['"])([^'"\n]+)\1/g
const TEST_MODULES = ['node:test', 'node:assert', 'node:assert/strict']

/**
 * Text check of the files a model wrote. Imports may only point inside src/domain/ and src/features/ (never the
 * Node-only estado-node.js); test files may also import node:test and node:assert. Anything dynamic is out.
 * @param {{ path: string, content: string }[]} files
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function staticCheck(files) {
  const errors = []
  for (const { path, content } of files) {
    const isTest = path.endsWith('.test.mjs')
    const problems = new Set()
    let rest = content

    for (const re of [IMPORT_RE, EXPORT_FROM_RE]) {
      rest = rest.replace(re, (_, __, specifier) => {
        const problem = importProblem(path, specifier, isTest)
        if (problem) problems.add(problem)
        return ' '
      })
    }
    if (/\bimport\b/.test(rest)) problems.add('import dinámico o import.meta')
    if (/node:/.test(rest)) problems.add('node:')
    for (const word of rest.match(FORBIDDEN_RE) ?? []) problems.add(`«${word}»`)
    if (content.length > MAX_FILE_CHARS) problems.add(`más de ${MAX_FILE_CHARS} caracteres`)

    if (problems.size) errors.push(`${path}: ${[...problems].join(', ')}`)
  }
  return { ok: errors.length === 0, errors }
}

function importProblem(from, specifier, isTest) {
  if (TEST_MODULES.includes(specifier)) return isTest ? null : `import de «${specifier}» (solo los tests)`
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) return `import de «${specifier}» (solo rutas relativas dentro de src/domain/ y src/features/)`
  const target = posix.normalize(posix.join(posix.dirname(from), specifier))
  if (!(target.startsWith('src/domain/') || target.startsWith('src/features/')) || target === 'src/domain/estado-node.js') {
    return `import de «${specifier}» (fuera de src/domain/ y src/features/)`
  }
  return null
}

// --- 2. Isolated runs ---

// Runs before any code under test: the network globals do not exist.
const HARDEN = `for (const name of ['fetch', 'WebSocket', 'EventSource', 'XMLHttpRequest']) delete globalThis[name]\n`

/**
 * Runs `node <args>` inside `dir` with nothing but that directory visible (read only) and an empty environment.
 * Never rejects: a crash, a timeout or a failure to start is a result.
 * @returns {Promise<{ ok: boolean, timedOut: boolean, memoryExceeded: boolean, code: number|null, output: string }>}
 */
export function runIsolated(dir, args, { timeoutMs = SANDBOX_TIMEOUT_MS } = {}) {
  const real = realpathSync(dir)
  writeFileSync(join(real, '__harden.mjs'), HARDEN)
  const flags = [
    '--permission',
    `--allow-fs-read=${real}`,
    '--disallow-code-generation-from-strings',
    // Only a backstop: the parent kills the process at MEMORY_LIMIT_MB first (V8 running out of memory aborts the
    // process, and an abort is a crash report on the machine).
    '--max-old-space-size=512',
    '--import', pathToFileURL(join(real, '__harden.mjs')).href,
  ]
  return new Promise((resolve) => {
    // `ulimit -c 0` (soft and hard: the code cannot raise it) so a crash of the code under test leaves no core dump
    // behind; `env -i` because the shell adds variables of its own. Both `exec`, so node is the very process we time out and kill.
    const child = spawn('/bin/sh', ['-c', 'ulimit -c 0; exec env -i PATH=/usr/bin:/bin "$@"', 'sh', process.execPath, ...flags, ...args], { cwd: real, env: { PATH: '/usr/bin:/bin' }, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    let timedOut = false
    let memoryExceeded = false
    const collect = (chunk) => {
      if (output.length < MAX_OUTPUT) output += chunk
    }
    child.stdout.on('data', collect)
    child.stderr.on('data', collect)
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, timeoutMs)
    // Memory: the resident size of the process, read from /proc every 50 ms (Linux; elsewhere only the V8 backstop).
    const watchdog = setInterval(() => {
      if (residentMb(child.pid) > MEMORY_LIMIT_MB) {
        memoryExceeded = true
        child.kill('SIGKILL')
      }
    }, 50)
    child.on('error', (error) => {
      clearTimeout(timer)
      clearInterval(watchdog)
      resolve({ ok: false, timedOut: false, memoryExceeded: false, code: null, output: `no se pudo arrancar el aislamiento: ${error.message}` })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      clearInterval(watchdog)
      resolve({ ok: code === 0 && !timedOut && !memoryExceeded, timedOut, memoryExceeded, code, output })
    })
  })
}

function residentMb(pid) {
  try {
    const kb = /^VmRSS:\s+(\d+) kB/m.exec(readFileSync(`/proc/${pid}/status`, 'utf8'))?.[1]
    return kb ? Number(kb) / 1024 : 0
  } catch {
    return 0
  }
}

// A throwaway copy of the code and the data it needs: no .git, no node_modules, no secrets, nothing else.
// `files` (what the model wrote) are laid over it.
function makeCopy(root, files = []) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'sandbox-run-')))
  for (const entry of COPIED) {
    if (!existsSync(join(root, entry))) continue
    cpSync(join(root, entry), join(dir, entry), { recursive: true, filter: (src) => src !== join(root, 'src/features/index.js') })
  }
  writeFileSync(join(dir, 'package.json'), '{"type":"module"}\n')
  for (const { path, content } of files) {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), content)
  }
  return dir
}

const list = (dir) => (existsSync(dir) ? readdirSync(dir) : [])

// The sample orders of factory/muestras.json must keep behaving as they say, with the code under test.
const MUESTRAS_TEST = `import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { presupuestar } from './src/domain/presupuesto.js'
import { cargarEstado } from './src/domain/estado-node.js'

const estado = cargarEstado(new URL('.', import.meta.url).pathname)
const muestras = JSON.parse(readFileSync(new URL('./factory/muestras.json', import.meta.url), 'utf8'))
for (const m of muestras) {
  test('presupuesto de muestra: ' + m.nombre, () => {
    const r = presupuestar(m.pedido, estado)
    if (m.esperado === 'ok') {
      const importes = [r.subtotal, r.descuento.importe, r.transporte, r.total, ...r.lineas.map((l) => l.importe)]
      assert.ok(r.ok && importes.every((n) => Number.isFinite(n) && n >= 0), 'debía salir bien y ahora falla: ' + r.errores.join(', '))
    } else {
      assert.equal(r.ok, false, 'debía dar error y ahora se presupuesta')
    }
  })
}
`

// Every feature must follow the contract and give a valid result on the current state.
const FEATURES_TEST = `import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, existsSync } from 'node:fs'
import { cargarEstado } from './src/domain/estado-node.js'
import { validarFeature, validarResultado } from './src/features/contrato.js'

const estado = cargarEstado(new URL('.', import.meta.url).pathname)
const ids = readdirSync(new URL('./src/features/', import.meta.url), { withFileTypes: true })
  .filter((e) => e.isDirectory() && existsSync(new URL('./src/features/' + e.name + '/index.js', import.meta.url)))
  .map((e) => e.name)
for (const id of ids) {
  test('feature ' + id + ' cumple el contrato', async () => {
    const modulo = await import('./src/features/' + id + '/index.js')
    assert.deepEqual(validarFeature(modulo, id), [])
    assert.deepEqual(validarResultado(await modulo.default.calcular(structuredClone(estado))), [])
  })
}
`

/**
 * Runs the whole suite of the domain and the features (the tests of the repository plus the patch the model wrote,
 * the sample orders and the feature contract) inside the isolation.
 */
export async function runSuite(root, files, { timeoutMs = SANDBOX_TIMEOUT_MS } = {}) {
  const dir = makeCopy(root, files)
  try {
    writeFileSync(join(dir, '__muestras.test.mjs'), MUESTRAS_TEST)
    writeFileSync(join(dir, '__features.test.mjs'), FEATURES_TEST)
    const tests = [
      ...list(join(dir, 'src/domain')).filter((n) => n.endsWith('.test.mjs')).map((n) => `src/domain/${n}`),
      ...list(join(dir, 'src/features')).filter((n) => existsSync(join(dir, 'src/features', n, 'index.test.mjs'))).map((n) => `src/features/${n}/index.test.mjs`),
      '__muestras.test.mjs',
      '__features.test.mjs',
    ]
    return await runIsolated(dir, ['--test', '--test-isolation=none', ...tests], { timeoutMs })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// --- 3. What each feature shows on the site ---

const RUNNER = `import { readFileSync } from 'node:fs'
import { validarFeature, validarResultado, normalizarResultado } from './src/features/contrato.js'

const id = process.argv[2]
const answer = async () => {
  const estado = JSON.parse(readFileSync(new URL('./__estado.json', import.meta.url), 'utf8'))
  const modulo = await import('./src/features/' + id + '/index.js')
  const errores = validarFeature(modulo, id)
  if (errores.length) return { ok: false, motivo: errores.join('; ') }
  const resultado = await modulo.default.calcular(estado)
  const mal = validarResultado(resultado)
  if (mal.length) return { ok: false, motivo: mal.join('; ') }
  const { titulo, donde } = modulo.default
  return { ok: true, id, titulo, donde, resultado: normalizarResultado(resultado) }
}
let out
try {
  out = await answer()
} catch (error) {
  out = { ok: false, motivo: String(error?.message ?? error).slice(0, 200) }
}
console.log('${MARKER}' + JSON.stringify(out))
`

/**
 * Computes every feature of src/features/ on `estado`, each in its own isolated run. A feature that does not load,
 * breaks the contract, throws or hangs is left out and reported; it never stops the others.
 * @returns {Promise<{ features: { id: string, titulo: string, donde: string, resultado: object }[], omitidas: { id: string, motivo: string }[] }>}
 */
export async function evaluateFeatures(root, estado, { timeoutMs = FEATURE_TIMEOUT_MS } = {}) {
  const features = []
  const omitidas = []
  const folder = join(root, 'src/features')
  const ids = list(folder).filter((n) => existsSync(join(folder, n, 'index.js'))).sort()
  if (ids.length === 0) return { features, omitidas }

  const dir = makeCopy(root)
  try {
    writeFileSync(join(dir, '__estado.json'), JSON.stringify(estado))
    writeFileSync(join(dir, '__run.mjs'), RUNNER)
    for (const id of ids) {
      const run = await runIsolated(dir, ['__run.mjs', id], { timeoutMs })
      const line = run.output.split('\n').reverse().find((l) => l.startsWith(MARKER))
      let answer = null
      try {
        answer = line ? JSON.parse(line.slice(MARKER.length)) : null
      } catch {
        answer = null
      }
      if (run.ok && answer?.ok) features.push({ id: answer.id, titulo: answer.titulo, donde: answer.donde, resultado: answer.resultado })
      else omitidas.push({ id, motivo: run.timedOut ? 'tardó demasiado' : (answer?.motivo ?? 'no se pudo ejecutar') })
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  return { features, omitidas }
}
