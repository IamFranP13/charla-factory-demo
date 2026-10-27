import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, chmodSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { approvalsAtHead } from '../lib/github.js'
import { parsePolicy } from '../lib/policy.js'

const repo = new URL('..', import.meta.url).pathname
const gate = join(repo, 'scripts/gate.mjs')

const run = (args, env = {}) => spawnSync(process.execPath, [gate, ...args], { encoding: 'utf8', env: { ...process.env, ...env } })

test('local mode: prints the route of each file and the overall route', () => {
  const r = run(['content/muro/a.json', 'data/cifras.json'])
  assert.equal(r.status, 0)
  assert.equal(r.stderr, '')
  assert.match(r.stdout, /content\/muro\/a\.json\s+auto\s+content\/muro\/\*\*/)
  assert.match(r.stdout, /data\/cifras\.json\s+human\s+data\/\*\*/)
  assert.match(r.stdout, /Route: human/)
})

test('local mode --json prints machine-readable output', () => {
  const route = parsePolicy(readFileSync(join(repo, 'policy/risk.yaml'), 'utf8')).default
  const r = run(['--json', 'config/entradas.json'])
  assert.equal(r.status, 0)
  assert.deepEqual(JSON.parse(r.stdout), { route, files: [{ file: 'config/entradas.json', route, rule: 'default' }] })
})

test('--policy points at another policy file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gate-'))
  writeFileSync(join(dir, 'p.yaml'), 'default: human\n')
  const r = run(['--json', '--policy', join(dir, 'p.yaml'), 'config/entradas.json'])
  assert.equal(JSON.parse(r.stdout).route, 'human')
})

test('a broken policy makes the gate fail closed (exit 2)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gate-'))
  writeFileSync(join(dir, 'p.yaml'), 'default: perhaps\n')
  const r = run(['--policy', join(dir, 'p.yaml'), 'content/muro/a.json'])
  assert.equal(r.status, 2)
  assert.match(r.stderr, /default/)
})

test('approvals only count when the latest review of that user is APPROVED on the current head', () => {
  const reviews = [
    { user: { login: 'ana' }, state: 'APPROVED', commit_id: 'old' },
    { user: { login: 'bea' }, state: 'APPROVED', commit_id: 'head' },
    { user: { login: 'cris' }, state: 'APPROVED', commit_id: 'head' },
    { user: { login: 'cris' }, state: 'CHANGES_REQUESTED', commit_id: 'head' },
    { user: { login: 'dani' }, state: 'COMMENTED', commit_id: 'head' },
  ]
  assert.deepEqual(approvalsAtHead(reviews, 'head'), ['bea'])
})

// CI mode talks to GitHub through the gh CLI; here gh is a stub that serves fixtures.
function fakeGh({ files, reviews, head = 'head', author = 'murciatech-factory[bot]', headRepo = 'o/r', changed = files.length }) {
  const dir = mkdtempSync(join(tmpdir(), 'gh-'))
  writeFileSync(join(dir, 'files.json'), JSON.stringify(files))
  writeFileSync(join(dir, 'reviews.json'), JSON.stringify(reviews))
  writeFileSync(join(dir, 'pr.json'), JSON.stringify({ user: { login: author }, head: { sha: head, repo: headRepo === null ? null : { full_name: headRepo } }, changed_files: changed }))
  writeFileSync(join(dir, 'gh'), `#!/bin/sh
case "$*" in
  *pulls/7/files*) cat "${dir}/files.json" ;;
  *pulls/7/reviews*) cat "${dir}/reviews.json" ;;
  *pulls/7*) cat "${dir}/pr.json" ;;
  *) echo "unexpected gh call: $*" >&2; exit 1 ;;
esac
`)
  chmodSync(join(dir, 'gh'), 0o755)
  return { PATH: `${dir}:${process.env.PATH}`, GITHUB_REPOSITORY: 'o/r', GITHUB_OUTPUT: join(dir, 'out'), GITHUB_STEP_SUMMARY: join(dir, 'summary') }
}

test('CI mode: a wall card passes and asks for merge', () => {
  const env = fakeGh({ files: [{ filename: 'content/muro/a.json' }], reviews: [] })
  const r = run(['--pr', '7'], env)
  assert.equal(r.status, 0, r.stderr)
  const out = readFileSync(env.GITHUB_OUTPUT, 'utf8')
  assert.match(out, /route=auto/)
  assert.match(out, /merge=true/)
  assert.match(readFileSync(env.GITHUB_STEP_SUMMARY, 'utf8'), /content\/muro\/a\.json/)
})

test('CI mode: a data change fails until the approver approves the current head', () => {
  const blocked = fakeGh({ files: [{ filename: 'data/cifras.json' }], reviews: [] })
  const r = run(['--pr', '7'], blocked)
  assert.equal(r.status, 1)
  assert.match(readFileSync(blocked.GITHUB_OUTPUT, 'utf8'), /route=human/)
  assert.match(r.stdout, /waiting for approval from IamFranP13/)

  const approved = fakeGh({ files: [{ filename: 'data/cifras.json' }], reviews: [{ user: { login: 'IamFranP13' }, state: 'APPROVED', commit_id: 'head' }] })
  assert.equal(run(['--pr', '7'], approved).status, 0)
})

test('CI mode: renaming a data file into the wall still counts the old path', () => {
  const env = fakeGh({ files: [{ filename: 'content/muro/a.json', previous_filename: 'data/cifras.json' }], reviews: [] })
  const r = run(['--pr', '7'], env)
  assert.equal(r.status, 1)
  assert.match(readFileSync(env.GITHUB_OUTPUT, 'utf8'), /route=human/)
})

test('CI mode: if GitHub cannot be read, the gate fails closed', () => {
  const env = fakeGh({ files: [], reviews: [] })
  const r = run(['--pr', '8'], env)
  assert.equal(r.status, 2)
  assert.match(r.stderr, /unexpected gh call/)
})

test('CI mode: a wall card from a fork (or from a stranger) never auto-merges', () => {
  for (const over of [{ headRepo: 'mallory/r' }, { author: 'mallory' }, { headRepo: null }]) {
    const env = fakeGh({ files: [{ filename: 'content/muro/a.json' }], reviews: [], ...over })
    const r = run(['--pr', '7'], env)
    assert.equal(r.status, 1, JSON.stringify(over))
    const out = readFileSync(env.GITHUB_OUTPUT, 'utf8')
    assert.match(out, /route=human/)
    assert.match(out, /merge=false/)
    assert.match(r.stdout, /not opened by the factory from this repository/)
  }
})

test('CI mode: an approver can still approve a stranger\'s PR, but it does not auto-merge', () => {
  const env = fakeGh({ files: [{ filename: 'content/muro/a.json' }], reviews: [{ user: { login: 'IamFranP13' }, state: 'APPROVED', commit_id: 'head' }], author: 'mallory' })
  const r = run(['--pr', '7'], env)
  assert.equal(r.status, 0, r.stderr)
  assert.match(readFileSync(env.GITHUB_OUTPUT, 'utf8'), /merge=false/)
})

test('CI mode: the judged head sha is exported so the merge can pin it', () => {
  const env = fakeGh({ files: [{ filename: 'content/muro/a.json' }], reviews: [], head: 'abc123' })
  assert.equal(run(['--pr', '7'], env).status, 0)
  assert.match(readFileSync(env.GITHUB_OUTPUT, 'utf8'), /^head=abc123$/m)
})

// The live default is not pinned: these tests use explicit policies derived from the real file.
function policyWithDefault(route) {
  const file = join(mkdtempSync(join(tmpdir(), 'gate-')), 'risk.yaml')
  writeFileSync(file, readFileSync(join(repo, 'policy/risk.yaml'), 'utf8').replace(/^default:.*$/m, `default: ${route}`))
  return file
}

test('CI mode: with default: auto the hole is open (config/ auto-merges for the factory)', () => {
  const env = fakeGh({ files: [{ filename: 'config/entradas.json' }], reviews: [] })
  assert.equal(run(['--pr', '7', '--policy', policyWithDefault('auto')], env).status, 0)
  assert.match(readFileSync(env.GITHUB_OUTPUT, 'utf8'), /merge=true/)
})

test('CI mode: with default: human the fix blocks config/ until an approver approves', () => {
  const env = fakeGh({ files: [{ filename: 'config/entradas.json' }], reviews: [] })
  const r = run(['--pr', '7', '--policy', policyWithDefault('human')], env)
  assert.equal(r.status, 1)
  assert.match(readFileSync(env.GITHUB_OUTPUT, 'utf8'), /merge=false/)
})

test('CI mode: a truncated file list (fewer files than changed_files) fails closed', () => {
  const env = fakeGh({ files: [{ filename: 'content/muro/a.json' }], reviews: [], changed: 3001 })
  const r = run(['--pr', '7'], env)
  assert.equal(r.status, 2)
  assert.match(r.stderr, /changed_files/)
})
