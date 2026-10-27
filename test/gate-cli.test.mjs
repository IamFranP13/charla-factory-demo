import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, chmodSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { approvalsAtHead } from '../lib/github.js'
import { parsePolicy } from '../lib/policy.js'
import { initialState, replaceState, parseState } from '../lib/factory.js'

const repo = new URL('..', import.meta.url).pathname
const gate = join(repo, 'scripts/gate.mjs')

const run = (args, env = {}) => spawnSync(process.execPath, [gate, ...args], { encoding: 'utf8', env: { ...process.env, ...env } })

test('local mode: prints the route of each file and the overall route', () => {
  const r = run(['content/campanas/a.json', 'data/precios.json'])
  assert.equal(r.status, 0)
  assert.equal(r.stderr, '')
  assert.match(r.stdout, /content\/campanas\/a\.json\s+auto\s+content\/campanas\/\*\*/)
  assert.match(r.stdout, /data\/precios\.json\s+human\s+data\/\*\*/)
  assert.match(r.stdout, /Route: human/)
})

test('local mode --json prints machine-readable output', () => {
  const route = parsePolicy(readFileSync(join(repo, 'policy/risk.yaml'), 'utf8')).default
  const r = run(['--json', 'config/transporte.json'])
  assert.equal(r.status, 0)
  assert.deepEqual(JSON.parse(r.stdout), { route, files: [{ file: 'config/transporte.json', route, rule: 'default' }] })
})

test('--policy points at another policy file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gate-'))
  writeFileSync(join(dir, 'p.yaml'), 'default: human\n')
  const r = run(['--json', '--policy', join(dir, 'p.yaml'), 'config/transporte.json'])
  assert.equal(JSON.parse(r.stdout).route, 'human')
})

test('a broken policy makes the gate fail closed (exit 2)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gate-'))
  writeFileSync(join(dir, 'p.yaml'), 'default: perhaps\n')
  const r = run(['--policy', join(dir, 'p.yaml'), 'content/campanas/a.json'])
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
function fakeGh({ files, reviews, head = 'head', author = 'murciatech-factory[bot]', headRepo = 'o/r', changed = files.length, ref = 'tarea/5', merged = false, issueBody = undefined, issueFails = false }) {
  const dir = mkdtempSync(join(tmpdir(), 'gh-'))
  writeFileSync(join(dir, 'files.json'), JSON.stringify(files))
  writeFileSync(join(dir, 'reviews.json'), JSON.stringify(reviews))
  writeFileSync(join(dir, 'pr.json'), JSON.stringify({ user: { login: author }, merged, head: { sha: head, ref, repo: headRepo === null ? null : { full_name: headRepo } }, changed_files: changed }))
  const body = issueBody ?? replaceState('Petición desde la web.\n\n```json\n{"perfil":"marketing","peticion":"hola"}\n```\n', { ...initialState('marketing'), resultado: 'ok', fase: 'puerta', pr: 7 })
  writeFileSync(join(dir, 'issue.json'), JSON.stringify({ number: 5, user: { login: 'o' }, body }))
  writeFileSync(join(dir, 'gh'), `#!/bin/sh
echo "$*" >> "${dir}/calls"
case "$*" in
  *pulls/7/files*) cat "${dir}/files.json" ;;
  *pulls/7/reviews*) cat "${dir}/reviews.json" ;;
  *pulls/7*) cat "${dir}/pr.json" ;;
  "api repos/o/r/issues/5") ${issueFails ? 'echo "issue unavailable" >&2; exit 1' : `cat "${dir}/issue.json"`} ;;
  "api -X PATCH repos/o/r/issues/5 --input -")
    payload=$(cat)
    echo "$payload" >> "${dir}/patches"
    echo "$payload" | node -e 'const fs=require("fs");const f=process.argv[1];const i=JSON.parse(fs.readFileSync(f,"utf8"));i.body=JSON.parse(fs.readFileSync(0,"utf8")).body;fs.writeFileSync(f,JSON.stringify(i))' "${dir}/issue.json"
    echo '{}' ;;
  *) echo "unexpected gh call: $*" >&2; exit 1 ;;
esac
`)
  chmodSync(join(dir, 'gh'), 0o755)
  return { dir, PATH: `${dir}:${process.env.PATH}`, GITHUB_REPOSITORY: 'o/r', GITHUB_OUTPUT: join(dir, 'out'), GITHUB_STEP_SUMMARY: join(dir, 'summary') }
}

test('CI mode: a wall card passes and asks for merge', () => {
  const env = fakeGh({ files: [{ filename: 'content/campanas/a.json' }], reviews: [] })
  const r = run(['--pr', '7'], env)
  assert.equal(r.status, 0, r.stderr)
  const out = readFileSync(env.GITHUB_OUTPUT, 'utf8')
  assert.match(out, /route=auto/)
  assert.match(out, /merge=true/)
  assert.match(readFileSync(env.GITHUB_STEP_SUMMARY, 'utf8'), /content\/campanas\/a\.json/)
})

test('CI mode: a data change fails until the approver approves the current head', () => {
  const blocked = fakeGh({ files: [{ filename: 'data/precios.json' }], reviews: [] })
  const r = run(['--pr', '7'], blocked)
  assert.equal(r.status, 1)
  assert.match(readFileSync(blocked.GITHUB_OUTPUT, 'utf8'), /route=human/)
  assert.match(r.stdout, /waiting for approval from IamFranP13/)

  const approved = fakeGh({ files: [{ filename: 'data/precios.json' }], reviews: [{ user: { login: 'IamFranP13' }, state: 'APPROVED', commit_id: 'head' }] })
  assert.equal(run(['--pr', '7'], approved).status, 0)
})

test('CI mode: renaming a data file into the wall still counts the old path', () => {
  const env = fakeGh({ files: [{ filename: 'content/campanas/a.json', previous_filename: 'data/precios.json' }], reviews: [] })
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
    const env = fakeGh({ files: [{ filename: 'content/campanas/a.json' }], reviews: [], ...over })
    const r = run(['--pr', '7'], env)
    assert.equal(r.status, 1, JSON.stringify(over))
    const out = readFileSync(env.GITHUB_OUTPUT, 'utf8')
    assert.match(out, /route=human/)
    assert.match(out, /merge=false/)
    assert.match(r.stdout, /not opened by the factory from this repository/)
  }
})

test('CI mode: an approver can still approve a stranger\'s PR, but it does not auto-merge', () => {
  const env = fakeGh({ files: [{ filename: 'content/campanas/a.json' }], reviews: [{ user: { login: 'IamFranP13' }, state: 'APPROVED', commit_id: 'head' }], author: 'mallory' })
  const r = run(['--pr', '7'], env)
  assert.equal(r.status, 0, r.stderr)
  assert.match(readFileSync(env.GITHUB_OUTPUT, 'utf8'), /merge=false/)
})

test('CI mode: the judged head sha is exported so the merge can pin it', () => {
  const env = fakeGh({ files: [{ filename: 'content/campanas/a.json' }], reviews: [], head: 'abc123' })
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
  const env = fakeGh({ files: [{ filename: 'config/transporte.json' }], reviews: [] })
  assert.equal(run(['--pr', '7', '--policy', policyWithDefault('auto')], env).status, 0)
  assert.match(readFileSync(env.GITHUB_OUTPUT, 'utf8'), /merge=true/)
})

test('CI mode: with default: human the fix blocks config/ until an approver approves', () => {
  const env = fakeGh({ files: [{ filename: 'config/transporte.json' }], reviews: [] })
  const r = run(['--pr', '7', '--policy', policyWithDefault('human')], env)
  assert.equal(r.status, 1)
  assert.match(readFileSync(env.GITHUB_OUTPUT, 'utf8'), /merge=false/)
})

test('CI mode: a truncated file list (fewer files than changed_files) fails closed', () => {
  const env = fakeGh({ files: [{ filename: 'content/campanas/a.json' }], reviews: [], changed: 3001 })
  const r = run(['--pr', '7'], env)
  assert.equal(r.status, 2)
  assert.match(r.stderr, /changed_files/)
})

// --- the gate keeps the task state of the linked issue up to date ---

const issueState = (env) => parseState(JSON.parse(readFileSync(join(env.dir, 'issue.json'), 'utf8')).body)
const calls = (env) => readFileSync(join(env.dir, 'calls'), 'utf8')

test('state: a low-risk PR marks puerta ok, ruta auto and the merge in progress', () => {
  const env = fakeGh({ files: [{ filename: 'content/campanas/a.json' }], reviews: [] })
  assert.equal(run(['--pr', '7'], env).status, 0)
  const state = issueState(env)
  assert.equal(state.estaciones.puerta, 'ok')
  assert.equal(state.ruta, 'auto')
  assert.equal(state.estaciones.merge, 'en_curso')
  assert.equal(state.fase, 'merge')
  assert.equal(state.pr, 7)
  assert.equal(state.resultado, 'ok', 'the factory result is left alone')
})

test('state: a high-risk PR waiting for a human keeps puerta in progress with ruta human', () => {
  const env = fakeGh({ files: [{ filename: 'data/precios.json' }], reviews: [] })
  assert.equal(run(['--pr', '7'], env).status, 1)
  const state = issueState(env)
  assert.equal(state.estaciones.puerta, 'en_curso')
  assert.equal(state.ruta, 'human')
  assert.equal(state.estaciones.merge, 'pendiente')
  assert.equal(state.fase, 'puerta')
})

test('state: an approval of the current head turns the gate ok', () => {
  const env = fakeGh({ files: [{ filename: 'data/precios.json' }], reviews: [{ user: { login: 'IamFranP13' }, state: 'APPROVED', commit_id: 'head' }] })
  assert.equal(run(['--pr', '7'], env).status, 0)
  const state = issueState(env)
  assert.equal(state.estaciones.puerta, 'ok')
  assert.equal(state.ruta, 'human')
})

test('state: an approver asking for changes marks the gate rechazada', () => {
  const env = fakeGh({ files: [{ filename: 'data/precios.json' }], reviews: [{ user: { login: 'IamFranP13' }, state: 'CHANGES_REQUESTED', commit_id: 'head' }] })
  assert.equal(run(['--pr', '7'], env).status, 1)
  assert.equal(issueState(env).estaciones.puerta, 'rechazada')
})

test('state: the request block and the single marker survive the update', () => {
  const env = fakeGh({ files: [{ filename: 'content/campanas/a.json' }], reviews: [] })
  run(['--pr', '7'], env)
  const body = JSON.parse(readFileSync(join(env.dir, 'issue.json'), 'utf8')).body
  assert.match(body, /```json\n\{"perfil":"marketing","peticion":"hola"\}\n```/)
  assert.equal(body.match(/<!-- factory:state /g).length, 1)
})

test('state: a branch that is not tarea/<n>, or a head in another repository, touches no issue', () => {
  for (const over of [{ ref: 'feature/x' }, { ref: 'tarea/5; rm', headRepo: 'o/r' }, { headRepo: 'mallory/r' }, { headRepo: null }]) {
    const env = fakeGh({ files: [{ filename: 'content/campanas/a.json' }], reviews: [], ...over })
    run(['--pr', '7'], env)
    assert.doesNotMatch(calls(env), /issues\/5/, JSON.stringify(over))
  }
})

test('state: an issue that cannot be updated never changes the verdict, only warns', () => {
  const env = fakeGh({ files: [{ filename: 'content/campanas/a.json' }], reviews: [], issueFails: true })
  const r = run(['--pr', '7'], env)
  assert.equal(r.status, 0)
  assert.match(readFileSync(env.GITHUB_OUTPUT, 'utf8'), /merge=true/)
  assert.match(r.stderr, /warning: could not update the state of issue #5/)
})

test('state: an issue without a state marker is left alone', () => {
  const env = fakeGh({ files: [{ filename: 'content/campanas/a.json' }], reviews: [], issueBody: 'sin estado' })
  assert.equal(run(['--pr', '7'], env).status, 0)
  assert.doesNotMatch(calls(env), /PATCH/)
})

test('--closed: a merged PR marks merge ok and the task waits at production', () => {
  const env = fakeGh({ files: [{ filename: 'content/campanas/a.json' }], reviews: [], merged: true })
  const r = run(['--closed', '7'], env)
  assert.equal(r.status, 0, r.stderr)
  const state = issueState(env)
  assert.equal(state.estaciones.merge, 'ok')
  assert.equal(state.estaciones.produccion, 'pendiente')
  assert.equal(state.fase, 'produccion')
})

test('--closed: a PR closed without merging marks the gate rechazada', () => {
  const env = fakeGh({ files: [{ filename: 'data/precios.json' }], reviews: [], merged: false })
  assert.equal(run(['--closed', '7'], env).status, 0)
  const state = issueState(env)
  assert.equal(state.estaciones.puerta, 'rechazada')
  assert.equal(state.estaciones.merge, 'pendiente')
})

test('--closed never judges the PR: it does not read files or reviews', () => {
  const env = fakeGh({ files: [{ filename: 'content/campanas/a.json' }], reviews: [], merged: true })
  run(['--closed', '7'], env)
  assert.doesNotMatch(calls(env), /files|reviews/)
})
