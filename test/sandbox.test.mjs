import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { codePathError, staticCheck, runSuite, runIsolated, evaluateFeatures, MAX_FILE_CHARS } from '../lib/sandbox.js'
import { rehearsalCopy } from '../lib/rehearsal.js'
import { cargarEstado } from '../src/domain/estado-node.js'

const repo = new URL('..', import.meta.url).pathname
// A private temp dir: the leftovers check below must not see the copies other test files make in parallel.
const priv = mkdtempSync(join(tmpdir(), 'sandbox-priv-'))
process.env.TMPDIR = priv
const scratches = [priv]
const scratch = () => {
  const root = mkdtempSync(join(tmpdir(), 'sandbox-test-'))
  scratches.push(root)
  rehearsalCopy(repo, root, ['catalogo', 'data', 'config', 'src', 'factory'])
  return root
}
after(() => scratches.forEach((dir) => rmSync(dir, { recursive: true, force: true })))

const file = (path, content) => ({ path, content })
const feature = (id, body = "({ tipo: 'texto', texto: 'hola' })", extra = '') =>
  `${extra}export default { id: '${id}', titulo: 'Prueba', donde: 'inicio', calcular(estado) { return ${body} } }\n`
const testFile = (body, imports = '') => `import { test } from 'node:test'\nimport assert from 'node:assert/strict'\n${imports}\ntest('prueba', async () => {\n${body}\n})\n`
const reasons = (...files) => staticCheck(files).errors.join('\n')

// --- who may write what ---

test('codePathError: only feature files, the assigned new folder, existing features and the domain', () => {
  const root = scratch()
  const allowed = [
    'src/features/tarea-7/index.js',
    'src/features/tarea-7/index.test.mjs',
    'src/features/ordenar-catalogo/index.js',
    'src/domain/presupuesto.js',
    'src/domain/tarea-7.js',
    'src/domain/tarea-7-descuento-extra.test.mjs',
    'src/domain/catalogo.js',
    'src/domain/domain.test.mjs',
  ]
  for (const path of allowed) assert.equal(codePathError(root, 7, path), null, path)
  const denied = [
    'src/features/tarea-8/index.js',       // somebody else's new folder
    'src/features/nueva/index.js',          // a new folder the factory did not name
    'src/features/ordenar-catalogo/otra.js',
    'src/features/contrato.js',
    'src/features/index.js',
    'src/domain/estado-node.js',
    'src/domain/regla-nueva.js',          // a new domain file must carry the task number
    'src/domain/tarea-8-regla.js',
    'src/domain/tarea-70.js',             // tarea-7 is a prefix of tarea-70, not the same task
    'src/domain/sub/x.js',
    'src/domain/a.b.js',
    'src/pages/index.astro',
    'lib/factory.js',
    'policy/risk.yaml',
    'package.json',
    'src/features/../../lib/factory.js',
    'src/features/tarea-7/../../../lib/sandbox.js',
  ]
  for (const path of denied) assert.notEqual(codePathError(root, 7, path), null, path)
})

// --- 1. static check: before anything runs ---

test('staticCheck accepts a plain feature, its test and a domain file', () => {
  const ok = staticCheck([
    file('src/features/tarea-1/index.js', feature('tarea-1', "({ tipo: 'texto', texto: 'x' })", "import { presupuestar } from '../../domain/presupuesto.js'\nimport otra from '../ordenar-catalogo/index.js'\n")),
    file('src/features/tarea-1/index.test.mjs', testFile('assert.ok(true)', "import f from './index.js'")),
    file('src/domain/tarea-1.js', 'export const X = 1\n'),
  ])
  assert.deepEqual(ok, { ok: true, errors: [] })
})

test('staticCheck rejects every way into the machine, naming what it found', () => {
  const bad = {
    "import('node:fs')": "export const a = () => import('node:fs')",
    'import fs from node:fs': "import fs from 'node:fs'\nexport default {}",
    'node:child_process': "import { execSync } from 'node:child_process'\nexport default {}",
    'fetch(': "export const a = () => fetch('https://example.com')",
    'process.env': 'export const a = process.env.FACTORY_API_KEY',
    'eval(': "export const a = eval('1')",
    'new Function': "export const a = new Function('return 1')",
    'require(': "export const a = require('fs')",
    'globalThis': "export const a = globalThis['fe' + 'tch']",
    'global': 'export const a = global.process',
    'constructor': "export const a = (() => {}).constructor('return 1')",
    '__proto__': 'export const a = ({}).__proto__',
    'Reflect': 'export const a = Reflect.ownKeys({})',
    'WebSocket': "export const a = new WebSocket('wss://x')",
    'import.meta': 'export const a = import.meta.url',
    'import()': "export const a = () => import('./x.js')",
    'bare module': "import yaml from 'yaml'\nexport default {}",
    'out of the folders': "import x from '../../../lib/factory.js'\nexport default {}",
    'Node-only domain loader': "import { cargarEstado } from '../../domain/estado-node.js'\nexport default {}",
    'export from outside': "export * from '../../../lib/sandbox.js'",
    'path trick': "import x from '../../domain/../../lib/factory.js'\nexport default {}",
    'size': `export const a = '${'x'.repeat(MAX_FILE_CHARS)}'`,
  }
  for (const [name, content] of Object.entries(bad)) {
    const result = staticCheck([file('src/features/tarea-1/index.js', content)])
    assert.equal(result.ok, false, name)
    assert.match(result.errors[0], /^src\/features\/tarea-1\/index\.js: \S/, name)
  }
  assert.match(reasons(file('a/index.js', 'process.env')), /«process»/)
  assert.match(reasons(file('a/index.js', "fetch('x')")), /«fetch»/)
  assert.match(reasons(file('a/index.js', "import('node:fs')")), /import dinámico/)
})

test('staticCheck: only test files may import node:test and node:assert', () => {
  const source = file('src/features/tarea-1/index.js', "import { test } from 'node:test'\nexport default {}")
  assert.equal(staticCheck([source]).ok, false)
  const spec = file('src/features/tarea-1/index.test.mjs', "import { test } from 'node:test'\nimport assert from 'node:assert/strict'\nimport a from 'node:assert'\n")
  assert.equal(staticCheck([spec]).ok, true)
  assert.equal(staticCheck([file('src/features/tarea-1/index.test.mjs', "import fs from 'node:fs'")]).ok, false)
})

// --- 2. isolation: nothing leaks in, nothing gets out ---

test('baseline: the repository suite (domain, features, sample orders, contract) passes in the isolation', async () => {
  const result = await runSuite(scratch(), [])
  assert.equal(result.ok, true, result.output)
  assert.match(result.output, /presupuesto de muestra/)
  assert.match(result.output, /feature ordenar-catalogo cumple el contrato/)
})

test('the code under test sees an EMPTY environment: a canary in the parent env never arrives', async () => {
  process.env.T23_CANARY = 'canary-secret'
  process.env.FACTORY_API_KEY = 'canary-key'
  try {
    assert.equal(process.env.T23_CANARY, 'canary-secret', 'the parent does have it')
    const probe = testFile(`
      assert.equal(process.env.T23_CANARY, undefined)
      assert.equal(process.env.FACTORY_API_KEY, undefined)
      assert.equal(process.env.GITHUB_TOKEN, undefined)
      assert.deepEqual(Object.keys(process.env).filter((k) => k !== 'PATH' && !k.startsWith('NODE_TEST_')), [])`)
    const result = await runSuite(scratch(), [file('src/domain/sonda-env.test.mjs', probe)])
    assert.equal(result.ok, true, result.output)
    assert.match(result.output, /prueba/)
    assert.doesNotMatch(result.output, /canary/)
    // The control: the same probe, asserting the opposite, fails: the probe really runs.
    const control = await runSuite(scratch(), [file('src/domain/sonda-env.test.mjs', testFile("assert.equal(process.env.T23_CANARY, 'canary-secret')"))])
    assert.equal(control.ok, false)
    assert.match(control.output, /actual: undefined/)
  } finally {
    delete process.env.T23_CANARY
    delete process.env.FACTORY_API_KEY
  }
})

test('the code under test cannot write, spawn, read outside its copy, generate code or fetch', async () => {
  const probe = testFile(`
    assert.throws(() => fs.writeFileSync('/tmp/t23-escape.txt', 'x'), { code: 'ERR_ACCESS_DENIED' })
    assert.throws(() => fs.writeFileSync('./intento.txt', 'x'), { code: 'ERR_ACCESS_DENIED' })
    assert.throws(() => fs.mkdirSync('./carpeta'), { code: 'ERR_ACCESS_DENIED' })
    assert.throws(() => cp.execSync('echo hola'), { code: 'ERR_ACCESS_DENIED' })
    assert.throws(() => fs.readFileSync('/etc/passwd'), { code: 'ERR_ACCESS_DENIED' })
    assert.throws(() => fs.readdirSync(os.homedir()), { code: 'ERR_ACCESS_DENIED' })
    assert.throws(() => fs.readFileSync('../../../../etc/hostname'), { code: 'ERR_ACCESS_DENIED' })
    assert.throws(() => (0, eval)('1 + 1'), EvalError)
    assert.throws(() => new Function('return 1'), EvalError)
    assert.equal(typeof fetch, 'undefined')
    assert.equal(typeof WebSocket, 'undefined')
    assert.equal(fs.existsSync('.git'), false)
    assert.equal(fs.existsSync('node_modules'), false)
    assert.equal(fs.existsSync('lib'), false)`, "import fs from 'node:fs'\nimport cp from 'node:child_process'\nimport os from 'node:os'")
  const result = await runSuite(scratch(), [file('src/domain/sonda-aislamiento.test.mjs', probe)])
  assert.equal(result.ok, true, result.output)
})

test('where Node has a network switch the permission model closes it', { skip: !process.allowedNodeEnvironmentFlags.has('--allow-net') && 'this Node has no --allow-net' }, async () => {
  const server = createServer((socket) => socket.end('hola'))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const { port } = server.address()
    const probe = testFile(`
      await assert.rejects(new Promise((resolve, reject) => {
        const socket = net.connect(${port}, '127.0.0.1', resolve)
        socket.on('error', reject)
      }))`, "import net from 'node:net'")
    const result = await runSuite(scratch(), [file('src/domain/sonda-red.test.mjs', probe)])
    assert.equal(result.ok, true, result.output)
  } finally {
    server.close()
  }
})

test('the sandboxed process cannot leave core dumps: its core file limit is 0, soft and hard', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sandbox-test-'))
  scratches.push(dir)
  const result = await runIsolated(dir, ['-e', "console.log('LIMIT ' + JSON.stringify(process.report.getReport().userLimits.core_file_size_blocks))"], { timeoutMs: 10000 })
  assert.equal(result.ok, true, result.output)
  assert.match(result.output, /LIMIT \{"soft":0,"hard":0\}/)
})

test('a test that never ends is killed by the time limit and reported as timed out', async () => {
  const started = Date.now()
  const result = await runSuite(scratch(), [file('src/domain/bucle.test.mjs', testFile('while (true) {}'))], { timeoutMs: 1500 })
  assert.equal(result.timedOut, true)
  assert.equal(result.ok, false)
  assert.ok(Date.now() - started < 15000)
})

test('an infinite loop at import time is also stopped', async () => {
  const loop = await runSuite(scratch(), [file('src/domain/inicio.test.mjs', 'while (true) {}\n')], { timeoutMs: 1500 })
  assert.equal(loop.ok, false)
  assert.equal(loop.timedOut, true)
})

// A process that ran out of memory by itself would abort (SIGABRT): the machine records a crash and, on a desktop, shows a
// notification. So the parent stops a memory hog first, with SIGKILL, which leaves no crash report.
test('a memory hog is killed at the memory limit, long before the time limit, and leaves no crash report', async () => {
  const crashes = () => {
    const list = spawnSync('coredumpctl', ['list', '--no-pager', '--since', since], { encoding: 'utf8' })
    return list.status === 0 ? list.stdout.split('\n').filter((l) => /\/node\b/.test(l)).length : null
  }
  const since = `@${Math.floor(Date.now() / 1000) - 1}`
  const hog = await runSuite(scratch(), [file('src/domain/memoria.test.mjs', testFile('const a = []; while (true) a.push(new Array(1e6).fill(1))'))], { timeoutMs: 30000 })
  assert.equal(hog.ok, false)
  assert.equal(hog.memoryExceeded, true, hog.output.slice(-300))
  assert.equal(hog.timedOut, false)
  assert.doesNotMatch(hog.output, /out of memory|Allocation failed/i, 'V8 never got to abort')
  const after = crashes()
  if (after !== null) assert.equal(after, 0, 'no new crash report for node (coredumpctl)')
})

test('a failing test comes back with its output, and the copy is always removed', async () => {
  const leftovers = () => readdirSync(priv).filter((n) => n.startsWith('sandbox-run-'))
  const result = await runSuite(scratch(), [file('src/domain/roto.test.mjs', testFile("assert.equal(1, 2, 'esto falla a propósito')"))])
  assert.equal(result.ok, false)
  assert.equal(result.timedOut, false)
  assert.match(result.output, /esto falla a propósito/)
  await runSuite(scratch(), [file('src/domain/bucle.test.mjs', testFile('while (true) {}'))], { timeoutMs: 800 })
  assert.deepEqual(leftovers(), [])
})

test('the patch is laid over a COPY: the repository tree is never touched', async () => {
  const root = scratch()
  await runSuite(root, [file('src/domain/nuevo.test.mjs', testFile('assert.ok(true)'))])
  assert.equal(readdirSync(join(root, 'src/domain')).includes('nuevo.test.mjs'), false)
})

test('a feature that breaks the contract fails the suite; so does a domain change that breaks a sample order', async () => {
  const root = scratch()
  const badFeature = await runSuite(root, [file('src/features/tarea-3/index.js', feature('tarea-3', "({ tipo: 'html', texto: '<b>x</b>' })"))])
  assert.equal(badFeature.ok, false)
  assert.match(badFeature.output, /feature tarea-3 cumple el contrato/)
  const presupuesto = (await import('node:fs')).readFileSync(join(root, 'src/domain/presupuesto.js'), 'utf8')
  const broken = presupuesto.replace('const total = positive(cents(subtotal - descuento + transporte))', 'const total = -1')
  assert.notEqual(broken, presupuesto)
  const badDomain = await runSuite(root, [file('src/domain/presupuesto.js', broken)])
  assert.equal(badDomain.ok, false)
  assert.match(badDomain.output, /presupuesto de muestra/)
})

test('runIsolated reports a failure to start instead of throwing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sandbox-test-'))
  scratches.push(dir)
  const result = await runIsolated(dir, ['no-existe.mjs'], { timeoutMs: 5000 })
  assert.equal(result.ok, false)
})

// --- 3. features at build time ---

test('evaluateFeatures computes the features with the contract and leaves the broken ones out', async () => {
  const root = scratch()
  const write = (id, content) => {
    mkdirSync(join(root, 'src/features', id), { recursive: true })
    writeFileSync(join(root, 'src/features/', id, 'index.js'), content)
  }
  write('tarea-1', feature('tarea-1', "({ tipo: 'tabla', columnas: ['A', 'B'], filas: [['x', 1], ['y', 2]] })"))
  write('tarea-2', feature('tarea-2', "(() => { throw new Error('me rompo') })()"))
  write('tarea-3', feature('tarea-3', "({ tipo: 'texto', texto: '<script>' })"))
  write('tarea-4', feature('tarea-4', '(() => { while (true) {} })()'))
  write('tarea-5', 'export default { id: "otro", titulo: "x", donde: "inicio", calcular() { return { tipo: "texto", texto: "x" } } }\n')
  write('tarea-6', 'this is not javascript')
  write('tarea-7', "export default { id: 'tarea-7', titulo: 'Entorno', donde: 'inicio', calcular() { return { tipo: 'texto', texto: String(typeof process.env.HOME) } } }\n")
  const estado = cargarEstado(root)
  const { features, omitidas } = await evaluateFeatures(root, estado, { timeoutMs: 1500 })
  assert.deepEqual(features.map((f) => f.id), ['ordenar-catalogo', 'tarea-1', 'tarea-7'])
  assert.deepEqual(features.find((f) => f.id === 'tarea-1').resultado, { tipo: 'tabla', columnas: ['A', 'B'], filas: [['x', '1'], ['y', '2']] })
  assert.equal(features.find((f) => f.id === 'tarea-7').resultado.texto, 'undefined', 'no environment inside')
  assert.deepEqual(omitidas.map((o) => o.id), ['tarea-2', 'tarea-3', 'tarea-4', 'tarea-5', 'tarea-6'])
  assert.match(omitidas.find((o) => o.id === 'tarea-2').motivo, /me rompo/)
  assert.equal(omitidas.find((o) => o.id === 'tarea-4').motivo, 'tardó demasiado')
})

test('evaluateFeatures: a forged result line from a feature cannot replace the real one', async () => {
  const root = scratch()
  mkdirSync(join(root, 'src/features/tarea-9'), { recursive: true })
  const forged = `console.log('@@FEATURE@@ ' + JSON.stringify({ ok: true, id: 'tarea-9', titulo: 'Falsa', donde: 'inicio', resultado: { tipo: 'texto', texto: 'falsa' } }))\nexport default { id: 'tarea-9', titulo: 'Real', donde: 'inicio', calcular() { return { tipo: 'texto', texto: 'real' } } }\n`
  writeFileSync(join(root, 'src/features/tarea-9/index.js'), forged)
  const { features } = await evaluateFeatures(root, cargarEstado(root))
  assert.equal(features.find((f) => f.id === 'tarea-9').resultado.texto, 'real')
})
