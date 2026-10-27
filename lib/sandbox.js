// Where code written by a model is checked and run. Nothing a model writes is ever imported by the factory:
//   1. staticCheck   a text check, before anything runs (no node:, fetch, eval, process, dynamic import...)
//   2. runSuite      the tests of the domain and the features, in a throwaway copy of the code with
//                    no .git, an EMPTY environment (no secrets), a read-only view of that copy
//                    (Node permission model: no writes, no child processes, no network where Node has a switch),
//                    no code generation from strings, no core dumps, a memory limit and a time limit
//   3. evaluateFeatures  the same isolation, to compute what each feature shows on the site at build time
// The static check is a first filter, not the guarantee: the isolation is.
// The code of src/domain/ and src/features/ is only ever evaluated here: the platform (lib/, scripts/, the gate, the
// build) never imports it, because a model can change it and those processes have secrets in reach.
// The isolation needs a Node with the network permission switch (--allow-net): on any other Node it refuses to run.

import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, posix, relative } from 'node:path'
import { pathToFileURL } from 'node:url'

export const SANDBOX_TIMEOUT_MS = 60000
export const FEATURE_TIMEOUT_MS = 10000
export const MEMORY_LIMIT_MB = 384
export const MAX_CODE_FILES = 3
export const MAX_FILE_CHARS = 24000
const MAX_OUTPUT = 200000
const COPIED = ['src/domain', 'src/features', 'catalogo', 'data', 'config', 'factory/muestras.json']
// Every run that reads an answer from the output uses a marker nobody can know beforehand. It is NOT in any file of
// the copy: the parent hands it to the trusted runner through stdin, which the runner reads before any code under test
// loads, so the code under test cannot read it, nor forge the answer before or after the real one.
const newMarker = (tag) => `@@${tag}-${randomBytes(12).toString('hex')}@@ `

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
const ESCAPE_RE = /\\[ux]/
const IMPORT_RE = /\bimport\s*(?:[\w$*{}\s,]+?\s*from\s*)?(['"])([^'"\n]+)\1/g
const EXPORT_FROM_RE = /\bexport\s*(?:\*(?:\s*as\s+[\w$]+)?|\{[^}]*\})\s*from\s*(['"])([^'"\n]+)\1/g
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
    // An identifier spelled with an escape (\u0070rocess) would pass the word list below: no escapes at all.
    if (ESCAPE_RE.test(content)) problems.add('escapes \\u o \\x (los identificadores no pueden escribirse con escapes)')
    if (/[^\x00-\x7f]/.test(withoutTextAndComments(content))) problems.add('caracteres no ASCII fuera de textos y comentarios')
    if (/\bimport\b/.test(rest)) problems.add('import dinámico o import.meta')
    // Whatever «from 'x'» the two patterns above did not recognise as an allowed import is out.
    if (/\bfrom(?:\s|\/\*[\s\S]*?\*\/|\/\/[^\n]*)*['"`]/.test(rest)) problems.add('«from» con una forma de import o export que no se reconoce')
    if (/node:/.test(rest)) problems.add('node:')
    for (const word of rest.match(FORBIDDEN_RE) ?? []) problems.add(`«${word}»`)
    if (content.length > MAX_FILE_CHARS) problems.add(`más de ${MAX_FILE_CHARS} caracteres`)

    if (problems.size) errors.push(`${path}: ${[...problems].join(', ')}`)
  }
  return { ok: errors.length === 0, errors }
}

// Best effort (the isolation is the guarantee): the code without its strings, templates and comments.
function withoutTextAndComments(content) {
  return content.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/g, ' ')
}

function importProblem(from, specifier, isTest) {
  if (TEST_MODULES.includes(specifier)) return isTest ? null : `import de «${specifier}» (solo los tests)`
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) return `import de «${specifier}» (solo rutas relativas dentro de src/domain/ y src/features/)`
  // A specifier is a URL: a query, a fragment, a percent escape or a backslash can spell a path the text compare misses.
  if (/[?#%\\]/.test(specifier) || /estado-node/.test(specifier)) return `import de «${specifier}» (no es una ruta válida)`
  const target = posix.normalize(posix.join(posix.dirname(from), specifier))
  if (!(target.startsWith('src/domain/') || target.startsWith('src/features/')) || /(^|\/)estado-node(\.js)?$/.test(target)) {
    return `import de «${specifier}» (fuera de src/domain/ y src/features/)`
  }
  return null
}

// --- 2. Isolated runs ---

// Runs before any code under test: the network globals do not exist and node:assert cannot be patched (the verdict of
// a test run must not depend on an assert a test file or the code under test has emptied). With --frozen-intrinsics
// the built-ins (JSON, RegExp, Array...) cannot be patched either.
const HARDEN = `import assert from 'node:assert'
import strict from 'node:assert/strict'
for (const name of ['fetch', 'WebSocket', 'EventSource', 'XMLHttpRequest']) delete globalThis[name]
for (const target of [assert, strict]) {
  for (const value of Object.values(target)) {
    if (typeof value !== 'function') continue
    if (value.prototype) Object.freeze(value.prototype)
    Object.freeze(value)
  }
  Object.freeze(target)
}
`
// The experimental warning of --frozen-intrinsics is noise in the captured output, not part of any verdict.
const FROZEN_WARNING = /^.*(?:Frozen intristics|--trace-warnings).*\n?/gm

/** Does this Node have the network switch of the permission model (--allow-net)? Without it `--permission` leaves the network open. */
export const networkSwitchAvailable = () => process.allowedNodeEnvironmentFlags.has('--allow-net')

export class SandboxUnavailable extends Error {
  constructor() {
    super(`El aislamiento se niega a ejecutar código de un modelo: este Node (${process.version}) no tiene el interruptor de red del modelo de permisos (--allow-net) y dejaría la red abierta. Usa Node 26 o superior (.node-version).`)
    this.name = 'SandboxUnavailable'
  }
}

/**
 * Runs `node <args>` inside `dir` with nothing but that directory visible (read only) and an empty environment.
 * A crash, a timeout or a failure to start is a result, never a rejection; the one exception is a Node without the
 * network switch: it fails closed (SandboxUnavailable) and nothing runs.
 * `input` goes to the stdin of the process (and nowhere else): that is how a trusted runner receives its secret marker.
 * @returns {Promise<{ ok: boolean, timedOut: boolean, memoryExceeded: boolean, code: number|null, output: string }>}
 */
export function runIsolated(dir, args, { timeoutMs = SANDBOX_TIMEOUT_MS, networkSwitch = networkSwitchAvailable(), input = '' } = {}) {
  if (!networkSwitch) return Promise.reject(new SandboxUnavailable())
  const real = realpathSync(dir)
  writeFileSync(join(real, '__harden.mjs'), HARDEN)
  const flags = [
    '--permission',
    `--allow-fs-read=${real}`,
    '--disallow-code-generation-from-strings',
    '--frozen-intrinsics',
    // Only a backstop: the parent kills the process at MEMORY_LIMIT_MB first (V8 running out of memory aborts the
    // process, and an abort is a crash report on the machine).
    '--max-old-space-size=512',
    '--import', pathToFileURL(join(real, '__harden.mjs')).href,
  ]
  return new Promise((resolve) => {
    // `ulimit -c 0` (soft and hard: the code cannot raise it) so a crash of the code under test leaves no core dump
    // behind; `env -i` because the shell adds variables of its own. Both `exec`, so node is the very process we time out and kill.
    const child = spawn('/bin/sh', ['-c', 'ulimit -c 0; exec env -i PATH=/usr/bin:/bin "$@"', 'sh', process.execPath, ...flags, ...args], { cwd: real, env: { PATH: '/usr/bin:/bin' }, stdio: ['pipe', 'pipe', 'pipe'] })
    child.stdin.on('error', () => {})
    child.stdin.end(input)
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
      resolve({ ok: code === 0 && !timedOut && !memoryExceeded, timedOut, memoryExceeded, code, output: output.replace(FROZEN_WARNING, '') })
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
// `files` (what the model wrote) are laid over it. The Node-only state loader of the platform goes in as a trusted
// helper of the runners (a model can neither import it nor write it).
function makeCopy(root, files = [], entries = COPIED) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'sandbox-run-')))
  for (const entry of entries) {
    if (!existsSync(join(root, entry))) continue
    cpSync(join(root, entry), join(dir, entry), { recursive: true, filter: (src) => src !== join(root, 'src/features/index.js') })
  }
  writeFileSync(join(dir, 'package.json'), '{"type":"module"}\n')
  writeFileSync(join(dir, '__estado-node.js'), readFileSync(new URL('./estado-node.js', import.meta.url)))
  for (const { path, content } of files) {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), content)
  }
  return dir
}

const list = (dir) => (existsSync(dir) ? readdirSync(dir) : [])

// The line a trusted runner printed with this run's marker, as JSON; null when there is none or it is not JSON.
function markedAnswer(output, marker) {
  const line = String(output).split('\n').find((l) => l.startsWith(marker))
  try {
    return line ? JSON.parse(line.slice(marker.length)) : null
  } catch {
    return null
  }
}

// The head of every trusted runner: it takes the marker from stdin and the output primitives it will need BEFORE any
// code under test is loaded (the runners only import that code dynamically, afterwards), so the code can neither read
// them nor swap them.
const RUNNER_HEAD = `import { readFileSync, writeSync } from 'node:fs'
const marker = readFileSync(0, 'utf8')
const stringify = JSON.stringify
const exit = process.exit.bind(process)
`
// Prints the answer and ends the process, so nothing the code under test scheduled can print after it.
const ANSWER = `writeSync(1, marker + stringify(out) + '\\n')
exit(0)
`

// The sample orders of factory/muestras.json must keep behaving as they say, with the code under test.
const MUESTRAS_TEST = `import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { presupuestar } from './src/domain/presupuesto.js'
import { cargarEstado } from './__estado-node.js'

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
import { cargarEstado } from './__estado-node.js'
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

// The verdict of a suite is NOT the exit code of the process (the tests run in the same process as the code under
// test, which can end it early with code 0). This reporter, written fresh for every run, prints one line with the
// run's marker once the whole run is over, with what ran and passed in each file; no line, no pass.
const REPORTER = `import { inspect } from 'node:util'
import { readFileSync, writeSync } from 'node:fs'
const marker = readFileSync(0, 'utf8')
const stringify = JSON.stringify
export default async function* (source) {
  const files = {}
  for await (const { type, data } of source) {
    if (type !== 'test:pass' && type !== 'test:fail') continue
    if (data.details?.type === 'suite') continue
    const failed = type === 'test:fail'
    // A file that registers no test still reports one "pass" named after itself: that is not a test.
    if (!failed && data.nesting === 0 && String(data.file ?? '').endsWith('/' + data.name)) continue
    const skipped = !failed && ((data.skip !== undefined && data.skip !== false) || (data.todo !== undefined && data.todo !== false))
    const stats = (files[String(data.file ?? '')] ??= { pass: 0, fail: 0, skip: 0 })
    stats[failed ? 'fail' : skipped ? 'skip' : 'pass']++
    yield (failed ? '✖ ' : skipped ? '- ' : '✔ ') + data.name + '\\n'
    if (failed) {
      const error = data.details?.error
      const text = inspect(error?.cause ?? error ?? 'fallo', { depth: 2 })
      yield text.split('\\n').filter((line) => !/^\\s+at /.test(line)).slice(0, 40).map((line) => '    ' + line).join('\\n') + '\\n'
    }
  }
  writeSync(1, marker + stringify({ files }) + '\\n')
}
`

/**
 * Runs the whole suite of the domain and the features (the tests of the repository plus the patch the model wrote,
 * the sample orders and the feature contract) inside the isolation. It passes only when the process ended well AND
 * its reporter says every test file ran to the end with tests that passed (the exact number for the generated ones).
 * Two runs, two processes: the trusted tests (the repository's own, the sample orders, the contract) share their process
 * with nothing but the code under test; the test files a model wrote (the patch, and the tarea-* tests merged before)
 * run apart, so a test that patches what it shares cannot touch the verdict of the trusted ones.
 */
export async function runSuite(root, files, { timeoutMs = SANDBOX_TIMEOUT_MS, networkSwitch } = {}) {
  if (networkSwitch === false) throw new SandboxUnavailable()
  const dir = makeCopy(root, files)
  try {
    writeFileSync(join(dir, '__muestras.test.mjs'), MUESTRAS_TEST)
    writeFileSync(join(dir, '__features.test.mjs'), FEATURES_TEST)
    writeFileSync(join(dir, '__reporter.mjs'), REPORTER)
    const written = new Set(files.map((f) => f.path))
    const isModel = (path) => written.has(path) || /(^|\/)tarea-[^/]*(\.test\.mjs|\/index\.test\.mjs)$/.test(path)
    const found = [
      ...list(join(dir, 'src/domain')).filter((n) => n.endsWith('.test.mjs')).map((n) => `src/domain/${n}`),
      ...list(join(dir, 'src/features')).filter((n) => existsSync(join(dir, 'src/features', n, 'index.test.mjs'))).map((n) => `src/features/${n}/index.test.mjs`),
    ]
    // How many tests the generated files must run: one per sample order and one per feature.
    const muestras = existsSync(join(dir, 'factory/muestras.json')) ? JSON.parse(readFileSync(join(dir, 'factory/muestras.json'), 'utf8')).length : 0
    const features = list(join(dir, 'src/features')).filter((n) => existsSync(join(dir, 'src/features', n, 'index.js'))).length
    const runs = [
      { tests: [...found.filter((t) => !isModel(t)), '__muestras.test.mjs', '__features.test.mjs'], exact: { '__muestras.test.mjs': muestras, '__features.test.mjs': features } },
      { tests: found.filter(isModel), exact: {} },
    ].filter((r) => r.tests.length)
    let last
    let output = ''
    for (const { tests, exact } of runs) {
      const marker = newMarker('SUITE')
      const run = await runIsolated(dir, ['--test', '--test-isolation=none', '--test-reporter=./__reporter.mjs', '--test-reporter-destination=stdout', ...tests], { timeoutMs, networkSwitch, input: marker })
      last = judgeSuite(run, marker, dir, tests, exact)
      output += `${last.output}\n`
      if (!last.ok) break
    }
    return { ...last, output: output.trimEnd() }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function judgeSuite(run, marker, dir, tests, exact) {
  const output = run.output.split('\n').filter((line) => !line.startsWith(marker)).join('\n')
  if (!run.ok) return { ...run, output }
  const report = markedAnswer(run.output, marker)
  const byFile = {}
  for (const [file, stats] of Object.entries(report?.files ?? {})) byFile[relative(dir, file.replace(/^file:\/\//, ''))] = stats
  const problems = []
  if (!report) problems.push('la ejecución terminó antes de tiempo, sin informe de resultados: no cuenta como aprobada')
  else {
    for (const file of tests) {
      const stats = byFile[file]
      const wanted = exact[file]
      if (wanted === 0) continue
      if (!stats || stats.pass < 1) problems.push(`${file}: no ha ejecutado ningún test que pase`)
      else if (stats.fail > 0) problems.push(`${file}: ${stats.fail} test(s) fallan`)
      else if (wanted !== undefined && stats.pass !== wanted) problems.push(`${file}: debían pasar ${wanted} tests y han pasado ${stats.pass}`)
    }
    for (const [file, stats] of Object.entries(byFile)) if (stats.fail > 0 && !tests.includes(file)) problems.push(`${file}: ${stats.fail} test(s) fallan`)
  }
  return problems.length ? { ...run, ok: false, output: `${output}\n${problems.join('\n')}` } : { ...run, output }
}

// --- 3. What the platform asks the code of the domain and the features ---

// validateCatalog and presupuestar of the domain on a state, as data. The answer of the code under test is only
// ever read as JSON; nothing of it is imported.
const CHECK_RUNNER = `${RUNNER_HEAD}import { existsSync } from 'node:fs'

let out
try {
  const { validateCatalog } = await import('./src/domain/catalogo.js')
  const { presupuestar } = await import('./src/domain/presupuesto.js')
  const estado = JSON.parse(readFileSync(new URL('./__estado.json', import.meta.url), 'utf8'))
  const catalogo = validateCatalog(estado)
  const path = new URL('./factory/muestras.json', import.meta.url)
  const muestras = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : []
  out = {
    catalogo: { ok: catalogo.ok === true, errors: catalogo.errors ?? [] },
    muestras: muestras.map((m) => {
      const r = presupuestar(m.pedido, estado)
      return { nombre: m.nombre, esperado: m.esperado, ok: r.ok === true, errores: r.errores ?? [], porcentaje: r.descuento?.porcentaje, importes: [r.subtotal, r.descuento.importe, r.transporte, r.total, ...r.lineas.map((l) => l.importe)] }
    }),
  }
} catch (error) {
  out = { error: String(error?.message ?? error).slice(0, 200) }
}
${ANSWER}`

/**
 * The cross-file rules of the catalogue and the sample orders, computed by the code of src/domain/ on `estado` inside
 * the isolation.
 * @returns {Promise<{ catalogo: { ok: boolean, errors: string[] }, muestras: { nombre: string, esperado: string, ok: boolean, errores: string[], porcentaje: number, importes: number[] }[] } | { error: string }>}
 */
export async function checkState(root, estado, { timeoutMs = FEATURE_TIMEOUT_MS, networkSwitch } = {}) {
  if (networkSwitch === false) throw new SandboxUnavailable()
  const dir = makeCopy(root, [], ['src/domain', 'factory/muestras.json'])
  try {
    const marker = newMarker('CHECK')
    writeFileSync(join(dir, '__estado.json'), JSON.stringify(estado))
    writeFileSync(join(dir, '__check.mjs'), CHECK_RUNNER)
    const run = await runIsolated(dir, ['__check.mjs'], { timeoutMs, networkSwitch, input: marker })
    const answer = markedAnswer(run.output, marker)
    if (run.ok && answer && !answer.error) return answer
    return { error: run.timedOut ? 'tardó demasiado' : run.memoryExceeded ? 'superó el límite de memoria' : (answer?.error ?? 'no se pudo ejecutar') }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// What each feature shows on the site.
const RUNNER = `${RUNNER_HEAD}import { validarFeature, validarResultado, normalizarResultado } from './src/features/contrato.js'

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
${ANSWER}`

/**
 * Computes every feature of src/features/ on `estado`, each in its own isolated run. A feature that does not load,
 * breaks the contract, throws or hangs is left out and reported; it never stops the others.
 * @returns {Promise<{ features: { id: string, titulo: string, donde: string, resultado: object }[], omitidas: { id: string, motivo: string }[] }>}
 */
export async function evaluateFeatures(root, estado, { timeoutMs = FEATURE_TIMEOUT_MS, networkSwitch } = {}) {
  if (networkSwitch === false) throw new SandboxUnavailable()
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
      const marker = newMarker('FEATURE')
      const run = await runIsolated(dir, ['__run.mjs', id], { timeoutMs, networkSwitch, input: marker })
      const answer = markedAnswer(run.output, marker)
      if (run.ok && answer?.ok && answer.id === id) features.push({ id: answer.id, titulo: answer.titulo, donde: answer.donde, resultado: answer.resultado })
      else omitidas.push({ id, motivo: run.timedOut ? 'tardó demasiado' : (answer?.motivo ?? 'no se pudo ejecutar') })
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  return { features, omitidas }
}
