import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const repo = new URL('..', import.meta.url).pathname
const script = join(repo, 'scripts/preflight.mjs')

// A scratch copy with only what the preflight reads.
function scratchRepo({ policy, price } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'preflight-'))
  for (const dir of ['policy', 'config', 'factory/seed/config']) mkdirSync(join(root, dir), { recursive: true })
  const risk = readFileSync(join(repo, 'policy/risk.yaml'), 'utf8').replace(/^default:.*$/m, 'default: auto')
  writeFileSync(join(root, 'policy/risk.yaml'), policy ? policy(risk) : risk)
  cpSync(join(repo, 'factory/seed/config/entradas.json'), join(root, 'factory/seed/config/entradas.json'))
  const seed = JSON.parse(readFileSync(join(root, 'factory/seed/config/entradas.json'), 'utf8'))
  writeFileSync(join(root, 'config/entradas.json'), JSON.stringify({ ...seed, precio: price ?? seed.precio }))
  return root
}
const run = (root) => spawnSync(process.execPath, [script, '--root', root], { encoding: 'utf8' })

test('everything ready: open hole, factory set, seed price: exit 0', () => {
  const r = run(scratchRepo())
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.equal(r.stdout.match(/✓/g).length, 3)
  assert.doesNotMatch(r.stdout, /✗/)
})

test('default: human (hole already closed): exit 1 and the ✗ line names the hole', () => {
  const r = run(scratchRepo({ policy: (s) => s.replace(/^default:.*$/m, 'default: human') }))
  assert.equal(r.status, 1)
  assert.match(r.stdout, /✗.*agujero/)
})

test('the price is not the seed price: exit 1 and it says how to reset', () => {
  const r = run(scratchRepo({ price: 0 }))
  assert.equal(r.status, 1)
  assert.match(r.stdout, /✗.*precio/)
  assert.match(r.stdout, /factory\/seed\/config\/entradas\.json/)
})

test('an empty factory login: exit 1', () => {
  const r = run(scratchRepo({ policy: (s) => s.replace(/^factory:.*$/m, 'factory:') }))
  assert.equal(r.status, 1)
  assert.match(r.stdout, /✗.*factory/)
})
