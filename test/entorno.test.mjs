import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { comprobaciones, formatear, passed, runtimeDir } from '../lib/entorno.js'

const uid = process.getuid()
const TOKEN = 'sk-ant-oat01-SECRETSECRETSECRET'

// A scratch HOME with a good credential, and a fake exec where everything works unless a test breaks one command.
function world({ credential = `${TOKEN}\n`, mode = 0o600, exec = {}, env = {}, root = '/home/u/charla', nodeVersion = 'v26.7.0', alive = false } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'entorno-test-'))
  const rootDir = mkdtempSync(join(tmpdir(), 'entorno-root-'))
  writeFileSync(join(rootDir, '.node-version'), '26\n')
  if (credential !== null) {
    mkdirSync(join(home, '.config/limonia'), { recursive: true })
    const file = join(home, '.config/limonia/claude-credencial')
    writeFileSync(file, credential)
    fs.chmodSync(file, mode)
  }
  const calls = []
  const answers = {
    'docker version': { status: 0, stdout: '29.9.1\n' },
    'docker image': { status: 0, stdout: '' },
    'docker network': { status: 0, stdout: '' },
    'gh auth': { status: 0, stdout: '' },
    'gh api': { status: 0, stdout: 'maria\n' },
    'gh repo': { status: 0, stdout: 'maria/charla\n' },
    ...exec,
  }
  const fakeExec = (cmd, args) => {
    calls.push([cmd, ...args])
    return answers[`${cmd} ${args[0]}`] ?? { status: 127, stdout: '' }
  }
  const deps = {
    env: { WSL_DISTRO_NAME: 'Ubuntu', XDG_RUNTIME_DIR: home, ...env }, fs, exec: fakeExec, root: root === null ? rootDir : root, uid, home, nodeVersion,
    proxyAlive: async () => alive, tmp: home,
  }
  // .node-version is read from the root: point it at a real directory unless the test sets a path on purpose
  if (root === '/home/u/charla') deps.root = rootDir
  return { deps, calls, rootDir, home, cleanup: () => { rmSync(home, { recursive: true, force: true }); rmSync(rootDir, { recursive: true, force: true }) } }
}
const byId = (results, id) => results.find((r) => r.id === id)

test('everything fine: every check ✓, passes, one line each, WSL and proxy informative', async () => {
  const w = world()
  try {
    const results = await comprobaciones(w.deps)
    assert.deepEqual(results.map((r) => r.id), ['node', 'wsl', 'repo', 'docker', 'imagen', 'red', 'credencial', 'gh', 'runtime', 'proxy'])
    assert.ok(passed(results.filter((r) => r.id !== 'proxy')))
    assert.equal(byId(results, 'wsl').ok, true)
    assert.equal(byId(results, 'proxy').ok, false)
    assert.equal(byId(results, 'proxy').required, false)
    assert.ok(passed(results)) // the proxy not running never fails
    const lines = formatear(results)
    assert.equal(lines.length, 10) // no fix lines: only the proxy is not ok and it has none
    assert.ok(lines.slice(0, 9).every((l) => l.startsWith('✓')))
    assert.match(byId(results, 'docker').mensaje, /29\.9\.1/)
  } finally { w.cleanup() }
})

test('node: a different major fails with the exact fix', async () => {
  const w = world({ nodeVersion: 'v22.1.0' })
  try {
    const r = byId(await comprobaciones(w.deps), 'node')
    assert.equal(r.ok, false)
    assert.equal(r.required, true)
    assert.match(r.mensaje, /Node 22\.1\.0, pero el proyecto usa 26/)
    assert.match(r.arreglo, /nvm install 26/)
  } finally { w.cleanup() }
})

test('wsl: not WSL is informative, never a failure', async () => {
  const w = world({ env: { WSL_DISTRO_NAME: '' } })
  try {
    const r = byId(await comprobaciones(w.deps), 'wsl')
    assert.equal(r.required, false)
    assert.ok(passed([r]))
    assert.ok(formatear([r])[0].startsWith('–'))
  } finally { w.cleanup() }
})

test('repo under /mnt/c fails (any drive letter); a path that only looks similar passes', async () => {
  for (const root of ['/mnt/c/Users/ana/charla', '/mnt/d/charla']) {
    const w = world({ root })
    try {
      const r = byId(await comprobaciones({ ...w.deps, fs: { ...fs, readFileSync: (p, e) => (String(p).endsWith('.node-version') ? '26\n' : fs.readFileSync(p, e)) } }), 'repo')
      assert.equal(r.ok, false, root)
      assert.match(r.arreglo, /dentro de la carpeta de WSL/)
    } finally { w.cleanup() }
  }
  const w = world({ root: '/mnt/wsl/charla' })
  try {
    assert.equal(byId(await comprobaciones(w.deps), 'repo').ok, true)
  } finally { w.cleanup() }
})

test('docker unreachable: docker, image and network all fail, with the Docker Desktop fix', async () => {
  const w = world({ exec: { 'docker version': { status: 1, stdout: '' } } })
  try {
    const results = await comprobaciones(w.deps)
    assert.equal(byId(results, 'docker').ok, false)
    assert.match(byId(results, 'docker').arreglo, /WSL integration/)
    assert.equal(byId(results, 'imagen').ok, false)
    assert.equal(byId(results, 'red').ok, false)
    assert.ok(!w.calls.some((c) => c[1] === 'image' || c[1] === 'network')) // not asked when Docker does not answer
    assert.equal(passed(results), false)
  } finally { w.cleanup() }
})

test('missing image and network name the exact command that creates them', async () => {
  const w = world({ exec: { 'docker image': { status: 1, stdout: '' }, 'docker network': { status: 1, stdout: '' } } })
  try {
    const results = await comprobaciones(w.deps)
    assert.match(byId(results, 'imagen').mensaje, /limonia-agente:dev/)
    assert.equal(byId(results, 'imagen').arreglo, 'Constrúyela con: npm run agente:imagen')
    assert.match(byId(results, 'red').mensaje, /limonia-agentes/)
    assert.equal(byId(results, 'red').arreglo, 'Créala con: npm run proxy:red')
  } finally { w.cleanup() }
})

test('credential: ok for sk-ant-oat and sk-ant-api, mode 600 or 400; never printed', async () => {
  for (const [value, mode] of [[TOKEN, 0o600], ['sk-ant-api03-ZZZZ', 0o400], [TOKEN, 0o600]]) {
    const w = world({ credential: value, mode })
    try {
      const r = byId(await comprobaciones(w.deps), 'credencial')
      assert.equal(r.ok, true)
      assert.ok(!JSON.stringify(r).includes(value))
    } finally { w.cleanup() }
  }
})

test('credential: missing, loose mode, several lines, spaces, empty and wrong prefix all fail without printing the token', async () => {
  const cases = [
    [{ credential: null }, /No existe el fichero de credencial/, /claude setup-token/],
    [{ mode: 0o644 }, /permisos 644; debe ser 600/, /chmod 600 /],
    [{ credential: `${TOKEN}\nsegunda\n` }, /una sola línea/, /claude setup-token/],
    [{ credential: `${TOKEN} extra\n` }, /una sola línea, sin espacios/, /claude setup-token/],
    [{ credential: '\n' }, /una sola línea/, /claude setup-token/],
    [{ credential: 'ghp_notAnthropic\n' }, /no empieza por sk-ant-oat… ni sk-ant-api…/, /claude setup-token/],
  ]
  for (const [options, mensaje, arreglo] of cases) {
    const w = world(options)
    try {
      const r = byId(await comprobaciones(w.deps), 'credencial')
      assert.equal(r.ok, false, JSON.stringify(options))
      assert.match(r.mensaje, mensaje)
      assert.match(r.arreglo, arreglo)
      assert.ok(!JSON.stringify(r).includes('SECRETSECRET'))
      assert.ok(!JSON.stringify(r).includes('ghp_notAnthropic'))
    } finally { w.cleanup() }
  }
})

test('credential: LIMONIA_CREDENCIAL overrides the default path', async () => {
  const w = world({ credential: null })
  try {
    const file = join(w.home, 'otra')
    writeFileSync(file, `${TOKEN}\n`, { mode: 0o600 })
    assert.equal(byId(await comprobaciones({ ...w.deps, env: { ...w.deps.env, LIMONIA_CREDENCIAL: file } }), 'credencial').ok, true)
  } finally { w.cleanup() }
})

test('gh: not logged in, no login, other account than the owner, and no repo each fail with their fix', async () => {
  const cases = [
    [{ 'gh auth': { status: 1, stdout: '' } }, /no tiene la sesión iniciada/, /gh auth login/],
    [{ 'gh api': { status: 0, stdout: '\n' } }, /no dice quién eres/, /gh auth login/],
    [{ 'gh api': { status: 0, stdout: 'pedro\n' } }, /gh está como pedro, pero el repositorio es de maria/, /entra como maria/],
    [{ 'gh repo': { status: 1, stdout: '' } }, /no encuentra el repositorio/, /git remote -v/],
  ]
  for (const [exec, mensaje, arreglo] of cases) {
    const w = world({ exec })
    try {
      const r = byId(await comprobaciones(w.deps), 'gh')
      assert.equal(r.ok, false)
      assert.match(r.mensaje, mensaje)
      assert.match(r.arreglo, arreglo)
    } finally { w.cleanup() }
  }
})

test('proxy alive is reported ✓; a throwing probe counts as not running', async () => {
  const up = world({ alive: true })
  const broken = world()
  try {
    assert.equal(byId(await comprobaciones(up.deps), 'proxy').ok, true)
    assert.equal(byId(await comprobaciones({ ...broken.deps, proxyAlive: async () => { throw new Error('x') } }), 'proxy').ok, false)
  } finally { up.cleanup(); broken.cleanup() }
})

// --- runtime directory -----------------------------------------------------------------------------------------------

function scratch() {
  const tmp = mkdtempSync(join(tmpdir(), 'runtime-test-'))
  return { tmp, cleanup: () => rmSync(tmp, { recursive: true, force: true }) }
}

test('runtimeDir: a usable XDG_RUNTIME_DIR is used as is', () => {
  const s = scratch()
  try {
    const r = runtimeDir({ env: { XDG_RUNTIME_DIR: s.tmp }, fs, uid, tmp: s.tmp })
    assert.deepEqual(r, { ok: true, dir: s.tmp, fallback: false, env: { XDG_RUNTIME_DIR: s.tmp } })
  } finally { s.cleanup() }
})

test('runtimeDir: unset falls back to <tmp>/limonia-<uid>, created with mode 700', () => {
  const s = scratch()
  try {
    const r = runtimeDir({ env: {}, fs, uid, tmp: s.tmp })
    const dir = join(s.tmp, `limonia-${uid}`)
    assert.equal(r.ok, true)
    assert.equal(r.fallback, true)
    assert.equal(r.dir, dir)
    assert.deepEqual(r.env, { XDG_RUNTIME_DIR: dir })
    assert.match(r.why, /no está definida/)
    assert.equal(fs.statSync(dir).mode & 0o777, 0o700)
    assert.equal(runtimeDir({ env: {}, fs, uid, tmp: s.tmp }).ok, true) // second run: the same directory is accepted
  } finally { s.cleanup() }
})

test('runtimeDir: set but missing (WSL without systemd) falls back too', () => {
  const s = scratch()
  try {
    const r = runtimeDir({ env: { XDG_RUNTIME_DIR: join(s.tmp, 'no-existe') }, fs, uid, tmp: s.tmp })
    assert.equal(r.fallback, true)
    assert.match(r.why, /no es un directorio tuyo y escribible/)
  } finally { s.cleanup() }
})

test('runtimeDir: a set directory owned by someone else is not used', () => {
  const s = scratch()
  try {
    const r = runtimeDir({ env: { XDG_RUNTIME_DIR: s.tmp }, fs, uid: uid + 1, tmp: s.tmp })
    assert.equal(r.fallback, true)
    assert.equal(r.dir, join(s.tmp, `limonia-${uid + 1}`))
  } finally { s.cleanup() }
})

test('runtimeDir: the fallback is refused when it exists with another mode, another owner, as a file or as a symlink', () => {
  const dir = (s) => join(s.tmp, `limonia-${uid}`)
  const cases = {
    'mode 755': (s) => { mkdirSync(dir(s), { mode: 0o755 }); fs.chmodSync(dir(s), 0o755) },
    'a file': (s) => writeFileSync(dir(s), ''),
    'a symlink to a good directory': (s) => { mkdirSync(join(s.tmp, 'real'), { mode: 0o700 }); symlinkSync(join(s.tmp, 'real'), dir(s)) },
  }
  for (const [name, make] of Object.entries(cases)) {
    const s = scratch()
    try {
      make(s)
      const r = runtimeDir({ env: {}, fs, uid, tmp: s.tmp })
      assert.equal(r.ok, false, name)
      assert.match(r.error, /ya existe y no es un directorio tuyo con permisos 700/)
      assert.ok(r.arreglo)
    } finally { s.cleanup() }
  }
  const s = scratch()
  try {
    mkdirSync(dir(s), { mode: 0o700 })
    assert.equal(runtimeDir({ env: {}, fs, uid: uid + 1, tmp: s.tmp }).ok, true) // another uid has its own name
    const other = runtimeDir({ env: {}, fs: { ...fs, lstatSync: (p) => ({ ...fs.lstatSync(p), uid: uid + 5, isDirectory: () => true, isSymbolicLink: () => false }) }, uid, tmp: s.tmp })
    assert.equal(other.ok, false) // another owner
  } finally { s.cleanup() }
})

test('the runtime check reports the fallback it uses, and a refusal as a failure with its fix', async () => {
  const s = scratch()
  const w = world({ env: { XDG_RUNTIME_DIR: '' } })
  try {
    const ok = byId(await comprobaciones({ ...w.deps, tmp: s.tmp }), 'runtime')
    assert.equal(ok.ok, true)
    assert.match(ok.mensaje, /limonia-\d+.*se usa este directorio/)
    mkdirSync(join(s.tmp, 'x'))
    const bad = byId(await comprobaciones({ ...w.deps, runtime: { ok: false, error: 'roto', arreglo: 'arréglalo' } }), 'runtime')
    assert.deepEqual([bad.ok, bad.mensaje, bad.arreglo], [false, 'roto', 'arréglalo'])
  } finally { s.cleanup(); w.cleanup() }
})

test('formatear: a failing required check prints ✗ and its fix on the next line', () => {
  const lines = formatear([{ id: 'x', required: true, ok: false, mensaje: 'mal', arreglo: 'haz esto' }, { id: 'y', required: true, ok: true, mensaje: 'bien', arreglo: null }])
  assert.deepEqual(lines, ['✗ mal', '    → haz esto', '✓ bien'])
})
