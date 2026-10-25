import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parsePolicy, routeFor, verdict, matchesGlob, originAllowsAuto } from '../lib/policy.js'

const repo = new URL('..', import.meta.url).pathname
const policy = parsePolicy(readFileSync(`${repo}policy/risk.yaml`, 'utf8'))

test('glob matching: ** crosses folders, * does not', () => {
  assert.equal(matchesGlob('content/muro/a.json', 'content/muro/**'), true)
  assert.equal(matchesGlob('content/muro/x/a.json', 'content/muro/**'), true)
  assert.equal(matchesGlob('content/muro/x/a.json', 'content/muro/*'), false)
  assert.equal(matchesGlob('content/muroX/a.json', 'content/muro/**'), false)
  assert.equal(matchesGlob('AGENTS.md', 'AGENTS.md'), true)
  assert.equal(matchesGlob('a.md', '*.md'), true)
})

test('a wall card goes the short way', () => {
  const r = routeFor(policy, ['content/muro/hola.json'])
  assert.equal(r.route, 'auto')
  assert.deepEqual(r.files, [{ file: 'content/muro/hola.json', route: 'auto', rule: 'content/muro/**' }])
})

test('a new section goes the short way', () => {
  assert.equal(routeFor(policy, ['content/secciones/faq.json']).route, 'auto')
})

test('data changes always need a human', () => {
  assert.equal(routeFor(policy, ['data/cifras.json']).route, 'human')
})

test('platform files need a human', () => {
  for (const file of ['policy/risk.yaml', 'scripts/gate.mjs', 'lib/policy.js', '.github/workflows/gate.yml', 'functions/api/peticion.js', 'site/index.html', 'factory/profiles.yaml', 'AGENTS.md', 'package.json']) {
    assert.equal(routeFor(policy, [file]).route, 'human', file)
  }
})

test('the strictest route wins: a card plus a data change needs a human', () => {
  const r = routeFor(policy, ['content/muro/hola.json', 'data/cifras.json'])
  assert.equal(r.route, 'human')
  assert.equal(r.files.length, 2)
})

test('THE HOLE (on purpose, for the demo): config/ is not covered, so it falls to the default', () => {
  const r = routeFor(policy, ['config/entradas.json'])
  assert.equal(r.route, 'auto')
  assert.deepEqual(r.files, [{ file: 'config/entradas.json', route: 'auto', rule: 'default' }])
})

test('the one-line fix closes the hole', () => {
  const fixed = parsePolicy(readFileSync(`${repo}policy/risk.yaml`, 'utf8').replace('default: auto', 'default: human'))
  assert.equal(routeFor(fixed, ['config/entradas.json']).route, 'human')
  assert.equal(routeFor(fixed, ['content/muro/hola.json']).route, 'auto')
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
