import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { parsePolicy, routeFor, verdict, matchesGlob, originAllowsAuto } from '../lib/policy.js'

const repo = new URL('..', import.meta.url).pathname
const policy = parsePolicy(readFileSync(`${repo}policy/risk.yaml`, 'utf8'))

test('glob matching: ** crosses folders, * does not', () => {
  assert.equal(matchesGlob('content/campanas/a.json', 'content/campanas/**'), true)
  assert.equal(matchesGlob('content/campanas/x/a.json', 'content/campanas/**'), true)
  assert.equal(matchesGlob('content/campanas/x/a.json', 'content/campanas/*'), false)
  assert.equal(matchesGlob('content/campanasX/a.json', 'content/campanas/**'), false)
  assert.equal(matchesGlob('AGENTS.md', 'AGENTS.md'), true)
  assert.equal(matchesGlob('a.md', '*.md'), true)
})

test('a campaign goes the short way', () => {
  const r = routeFor(policy, ['content/campanas/hola.json'])
  assert.equal(r.route, 'auto')
  assert.deepEqual(r.files, [{ file: 'content/campanas/hola.json', route: 'auto', rule: 'content/campanas/*.json' }])
})

test('a new product or destination goes the short way', () => {
  assert.equal(routeFor(policy, ['catalogo/productos/tarea-3.json']).route, 'auto')
  assert.equal(routeFor(policy, ['catalogo/destinos/tarea-4.json']).route, 'auto')
  assert.deepEqual(routeFor(policy, ['catalogo/productos/tarea-3.json']).files[0].rule, 'catalogo/productos/*.json')
})

test('prices and discounts always need a human', () => {
  assert.equal(routeFor(policy, ['data/precios.json']).route, 'human')
  assert.equal(routeFor(policy, ['data/descuentos.json']).route, 'human')
})

test('platform files need a human', () => {
  const files = ['policy/risk.yaml', 'scripts/gate.mjs', 'lib/policy.js', '.github/workflows/gate.yml', 'functions/api/peticion.js', 'factory/profiles.yaml', 'brain/marca.md', 'design/system.md', 'design/system.html', 'src/domain/presupuesto.js', 'src/pages/index.astro', 'public/favicon.svg', 'astro.config.mjs', 'AGENTS.md', 'package.json', 'package-lock.json']
  for (const file of files) assert.equal(routeFor(policy, [file]).route, 'human', file)
})

test('the strictest route wins: a campaign plus a price change needs a human', () => {
  const r = routeFor(policy, ['content/campanas/hola.json', 'data/precios.json'])
  assert.equal(r.route, 'human')
  assert.equal(r.files.length, 2)
})

const HOLE = /(- paths: \["config\/\*\*"\]\n\s+route: )\w+/
const withHole = (route) => parsePolicy(readFileSync(`${repo}policy/risk.yaml`, 'utf8').replace(HOLE, `$1${route}`))

test('the hole of the demo is an explicit rule: config/ was taken for plain data and merges by itself', () => {
  assert.deepEqual(routeFor(policy, ['config/transporte.json']).files, [{ file: 'config/transporte.json', route: 'auto', rule: 'config/**' }])
})

test('the one-line fix closes the hole', () => {
  const fixed = withHole('human')
  assert.equal(routeFor(fixed, ['config/transporte.json']).route, 'human')
  assert.equal(routeFor(fixed, ['content/campanas/hola.json']).route, 'auto')
  assert.equal(routeFor(fixed, ['catalogo/productos/tarea-1.json']).route, 'auto')
})

test('fails closed: the default is human, so a file no rule names waits for a person', () => {
  assert.equal(policy.default, 'human')
  for (const file of ['README.md', '.node-version', '.gitignore', 'odd/tasks/x.md', 'nuevo.js', 'vite.config.js', 'otra/carpeta/x.json']) {
    assert.deepEqual(routeFor(policy, [file]).files, [{ file, route: 'human', rule: 'default' }], file)
  }
})

test('an agent may change any file: only campaigns, catalogue, features, the estilo surface and the hole merge alone', () => {
  const tracked = execFileSync('git', ['ls-files'], { cwd: repo, encoding: 'utf8' }).split('\n').filter(Boolean)
  const auto = tracked.filter((f) => routeFor(policy, [f]).route === 'auto')
  const allowed = [/^content\/campanas\/[^/]+$/, /^catalogo\/(productos|destinos)\/[^/]+$/, /^src\/features\/[^/]+\/index\.(js|test\.mjs)$/,
    /^src\/styles\/global\.css$/, /^src\/components\/(Paisaje|CampanaCard|ProductoCard|Header|Footer)\.astro$/, /^config\/transporte\.json$/]
  assert.deepEqual(auto.filter((f) => !allowed.some((r) => r.test(f))), [], 'nothing else of the repository merges by itself')
  for (const f of tracked.filter((x) => /^(test|lib|scripts|policy|factory|functions|\.github)\//.test(x))) assert.equal(routeFor(policy, [f]).route, 'human', f)
})

test('an empty change is not allowed through', () => {
  assert.equal(routeFor(policy, []).route, 'human')
})

test('first matching rule decides a file', () => {
  const p = parsePolicy('default: auto\nrules:\n  - paths: ["a/b/**"]\n    route: human\n  - paths: ["a/**"]\n    route: auto\n')
  assert.equal(routeFor(p, ['a/b/c']).route, 'human')
  assert.equal(routeFor(p, ['a/c']).route, 'auto')
})

test('a malformed policy is rejected, never treated as permissive', () => {
  assert.throws(() => parsePolicy('default: maybe\nrules: []'), /default/)
  assert.throws(() => parsePolicy('default: auto\nrules:\n  - paths: []\n    route: auto'), /paths/)
  assert.throws(() => parsePolicy('default: auto\nrules:\n  - paths: ["x"]\n    route: yolo'), /route/)
  assert.throws(() => parsePolicy('rules: []'), /default/)
})

test('verdict: auto passes and asks for merge', () => {
  assert.deepEqual(verdict({ route: 'auto', approvals: [], approvers: ['ana'] }), { pass: true, merge: true, reason: 'low risk: merges by itself' })
})

test('verdict: human fails until a listed approver approves', () => {
  const blocked = verdict({ route: 'human', approvals: [], approvers: ['ana'] })
  assert.equal(blocked.pass, false)
  assert.equal(blocked.merge, false)
  assert.match(blocked.reason, /ana/)

  assert.equal(verdict({ route: 'human', approvals: ['manolito'], approvers: ['ana'] }).pass, false)
  assert.deepEqual(verdict({ route: 'human', approvals: ['ana'], approvers: ['ana'] }), { pass: true, merge: false, reason: 'approved by ana' })
})

test('verdict: approver names are compared case-insensitively', () => {
  assert.equal(verdict({ route: 'human', approvals: ['Ana'], approvers: ['ana'] }).pass, true)
})

test('verdict: a pull request an approver opened from this repository is already the human decision (never merged by the gate)', () => {
  assert.deepEqual(verdict({ route: 'human', approvals: [], approvers: ['ana'], author: { login: 'Ana', sameRepo: true } }), { pass: true, merge: false, reason: 'opened by approver Ana' })
  assert.equal(verdict({ route: 'human', approvals: [], approvers: ['ana'], author: { login: 'ana', sameRepo: false } }).pass, false, 'from a fork')
  assert.equal(verdict({ route: 'human', approvals: [], approvers: ['ana'], author: { login: 'manolito', sameRepo: true } }).pass, false, 'not an approver')
  assert.equal(verdict({ route: 'human', approvals: [], approvers: [], author: { login: 'ana', sameRepo: true } }).pass, false, 'no approvers configured')
  assert.deepEqual(verdict({ route: 'auto', approvals: [], approvers: ['ana'], author: { login: 'ana', sameRepo: true } }), { pass: true, merge: true, reason: 'low risk: merges by itself' }, 'auto is unchanged')
})

test('verdict: a factory pull request an approver approved merges by itself; any other approved one waits for a person to merge it', () => {
  assert.deepEqual(verdict({ route: 'human', approvals: ['ana'], approvers: ['ana'], fromFactory: true }), { pass: true, merge: true, reason: 'approved by ana: the factory change merges by itself' })
  assert.deepEqual(verdict({ route: 'human', approvals: ['ana'], approvers: ['ana'], fromFactory: false }), { pass: true, merge: false, reason: 'approved by ana' })
  assert.equal(verdict({ route: 'human', approvals: ['ana'], approvers: ['ana'] }).merge, false, 'unknown origin is not the factory')
  assert.deepEqual(verdict({ route: 'human', approvals: ['manolito'], approvers: ['ana'], fromFactory: true }).pass, false, 'only an approver')
  assert.equal(verdict({ route: 'human', approvals: [], approvers: ['ana'], author: { login: 'ana', sameRepo: true }, fromFactory: false }).merge, false, 'a person merges their own')
})

test('verdict: with no approvers configured nothing high-risk can pass', () => {
  assert.equal(verdict({ route: 'human', approvals: ['ana'], approvers: [] }).pass, false)
})

test('parsePolicy: "factory" must be a string when present', () => {
  assert.equal(parsePolicy('default: auto\nfactory: app[bot]\n').factory, 'app[bot]')
  assert.equal(parsePolicy('default: auto\n').factory, '')
  assert.throws(() => parsePolicy('default: auto\nfactory: [a]\n'), /factory/)
})

test('the shipped policy names the factory bot', () => {
  assert.match(parsePolicy(readFileSync(`${repo}policy/risk.yaml`, 'utf8')).factory, /\[bot\]$/)
})

test('originAllowsAuto: only the factory bot, from this repository, may auto-merge', () => {
  const p = { factory: 'charla-factory[bot]' }
  const ok = originAllowsAuto(p, { author: 'Charla-Factory[bot]', headRepo: 'O/R', repo: 'o/r' })
  assert.equal(ok.ok, true)
  const stranger = originAllowsAuto(p, { author: 'mallory', headRepo: 'o/r', repo: 'o/r' })
  assert.equal(stranger.ok, false)
  assert.match(stranger.reason, /not opened by the factory from this repository/)
  assert.equal(originAllowsAuto(p, { author: 'charla-factory[bot]', headRepo: 'mallory/r', repo: 'o/r' }).ok, false)
  assert.equal(originAllowsAuto(p, { author: 'charla-factory[bot]', headRepo: null, repo: 'o/r' }).ok, false)
})

test('originAllowsAuto: a missing factory login fails closed', () => {
  for (const factory of ['', undefined]) {
    assert.equal(originAllowsAuto({ factory }, { author: '', headRepo: 'o/r', repo: 'o/r' }).ok, false)
    assert.equal(originAllowsAuto({ factory }, { author: undefined, headRepo: 'o/r', repo: 'o/r' }).ok, false)
  }
})

test('a path with . or .. segments, empty segments or a leading slash fails closed', () => {
  for (const f of ['content/campanas/../../lib/x.js', 'catalogo/../.github/workflows/x.yml', 'config/../lib/policy.js', 'src/features//index.js', 'catalogo/./x.json', '/catalogo/x.json']) {
    assert.deepEqual(routeFor(policy, [f]).files, [{ file: f, route: 'human', rule: 'invalid-path' }], f)
  }
})

test('only data merges alone in the campaign and catalogue folders: a script there waits for a person (config/** is the demo hole, wide on purpose)', () => {
  for (const f of ['content/campanas/x.js', 'catalogo/productos/x.mjs', 'catalogo/.github/workflows/x.yml', 'catalogo/x.json', 'catalogo/productos/a/b.json']) {
    assert.equal(routeFor(policy, [f]).route, 'human', f)
  }
  for (const f of ['content/campanas/tarea-1.json', 'catalogo/productos/tarea-2.json', 'catalogo/destinos/tarea-3.json', 'config/transporte.json']) {
    assert.equal(routeFor(policy, [f]).route, 'auto', f)
  }
})

test('a rename takes the strictest of its two paths: a platform file moved into an auto folder waits for a person', () => {
  assert.equal(routeFor(policy, ['catalogo/productos/p.json', 'lib/policy.js']).route, 'human')
})

test('the repository holds no symlink: the gate only sees names, so a link under an auto folder could point anywhere', () => {
  const links = execFileSync('git', ['ls-files', '-s'], { cwd: repo, encoding: 'utf8' }).split('\n').filter((l) => l.startsWith('120000 ') || l.startsWith('160000 '))
  assert.deepEqual(links, [])
})
