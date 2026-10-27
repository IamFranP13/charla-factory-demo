import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const repo = new URL('..', import.meta.url).pathname
const script = join(repo, 'scripts/preflight.mjs')

// A scratch copy with only what the preflight reads.
function scratchRepo({ policy, tariff } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'preflight-'))
  for (const dir of ['policy', 'config', 'factory/seed/config', 'src/domain', 'src/features/ordenar-catalogo']) mkdirSync(join(root, dir), { recursive: true })
  for (const file of ['src/domain/presupuesto.js', 'src/features/ordenar-catalogo/index.js']) {
    mkdirSync(join(root, 'factory/seed', file, '..'), { recursive: true })
    cpSync(join(repo, 'factory/seed', file), join(root, 'factory/seed', file))
    cpSync(join(repo, 'factory/seed', file), join(root, file))
  }
  const risk = readFileSync(join(repo, 'policy/risk.yaml'), 'utf8').replace(/^default:.*$/m, 'default: auto')
  writeFileSync(join(root, 'policy/risk.yaml'), policy ? policy(risk) : risk)
  cpSync(join(repo, 'factory/seed/config/transporte.json'), join(root, 'factory/seed/config/transporte.json'))
  const seed = JSON.parse(readFileSync(join(root, 'factory/seed/config/transporte.json'), 'utf8'))
  writeFileSync(join(root, 'config/transporte.json'), JSON.stringify({ ...seed, 'alemania-hamburgo': tariff ?? seed['alemania-hamburgo'] }))
  return root
}
const run = (root) => spawnSync(process.execPath, [script, '--root', root], { encoding: 'utf8' })

test('everything ready: open hole, factory set, seed tariff: exit 0', () => {
  const r = run(scratchRepo())
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.equal(r.stdout.match(/✓/g).length, 5)
  assert.doesNotMatch(r.stdout, /✗/)
})

test('default: human (hole already closed): exit 1 and the ✗ line names the hole', () => {
  const r = run(scratchRepo({ policy: (s) => s.replace(/^default:.*$/m, 'default: human') }))
  assert.equal(r.status, 1)
  assert.match(r.stdout, /✗.*agujero/)
})

test('transport to Germany is not the seed tariff (the twist already happened): exit 1 and it says how to reset', () => {
  const r = run(scratchRepo({ tariff: { eurPorKg: 0, minimo: 0 } }))
  assert.equal(r.status, 1)
  assert.match(r.stdout, /✗.*transporte.*alemania-hamburgo/i)
  assert.match(r.stdout, /factory\/seed\/config\/transporte\.json/)
})

test('an empty factory login: exit 1', () => {
  const r = run(scratchRepo({ policy: (s) => s.replace(/^factory:.*$/m, 'factory:') }))
  assert.equal(r.status, 1)
  assert.match(r.stdout, /✗.*factory/)
})

test('a planted bug already fixed on main: exit 1, naming the file and how to restore it', () => {
  const root = scratchRepo()
  writeFileSync(join(root, 'src/domain/presupuesto.js'), readFileSync(join(root, 'src/domain/presupuesto.js'), 'utf8').replace('t.desdeKg < kgTotal', 't.desdeKg <= kgTotal'))
  const r = run(root)
  assert.equal(r.status, 1)
  assert.match(r.stdout, /✗.*src\/domain\/presupuesto\.js.*reset-demo/)
  assert.doesNotMatch(r.stdout, /✗.*ordenar-catalogo/)
})

test('code policy: a broken rule for features or for the domain: exit 1', () => {
  for (const wrong of [
    (s) => s.replace('"src/features/*/index.js"', '"src/features/nada/index.js"'),
    (s) => s.replace('paths: ["src/domain/**"]\n    route: human', 'paths: ["src/domain/**"]\n    route: auto'),
  ]) {
    const r = run(scratchRepo({ policy: wrong }))
    assert.equal(r.status, 1)
    assert.match(r.stdout, /✗.*Política de código/)
  }
})
