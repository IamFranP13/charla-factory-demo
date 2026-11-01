// The agent image is pinned by text; no test needs Docker.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const dockerfile = readFileSync(new URL('../factory/agente/Dockerfile', import.meta.url), 'utf8')
const entrada = readFileSync(new URL('../factory/agente/entrada.sh', import.meta.url), 'utf8')
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const nodeMajor = readFileSync(new URL('../.node-version', import.meta.url), 'utf8').trim().split('.')[0]
const lines = dockerfile.split('\n').filter((l) => !l.trim().startsWith('#'))

test('the base image is pinned by tag (and digest) and is the Node of .node-version', () => {
  const from = lines.find((l) => /^FROM\s/.test(l))
  assert.match(from, /^FROM\s+node:\d+(\.\d+){0,2}-[a-z0-9.-]+@sha256:[0-9a-f]{64}\s*$/)
  assert.equal(from.match(/node:(\d+)/)[1], nodeMajor)
  assert.equal(nodeMajor, '26')
  assert.doesNotMatch(from, /:latest/)
})

test('Claude Code is installed at an exact version', () => {
  assert.match(dockerfile, /@anthropic-ai\/claude-code@\d+\.\d+\.\d+(\s|$)/)
})

test('the image runs as a non-root user', () => {
  const users = lines.filter((l) => /^USER\s/.test(l))
  assert.ok(users.length > 0)
  const last = users.at(-1).split(/\s+/)[1]
  assert.ok(last !== 'root' && last !== '0')
})

test('no secret is baked in or expected as ENV/ARG', () => {
  for (const l of lines.filter((x) => /^(ENV|ARG)\s/.test(x))) assert.doesNotMatch(l, /KEY|TOKEN|SECRET|PASSWORD/i, l)
  assert.doesNotMatch(dockerfile + entrada, /sk-ant-/)
})

test('no installer is piped into a shell', () => {
  assert.doesNotMatch(dockerfile + entrada, /(curl|wget)[^\n]*\|\s*(sudo\s+)?(ba|z)?sh/)
})

test('the image has a browser, git and the dependencies installed with npm ci', () => {
  assert.match(dockerfile, /chromium/)
  assert.match(dockerfile, /\bgit\b/)
  assert.match(dockerfile, /npm ci/)
  assert.match(entrada, /ln -s/)
  assert.match(entrada, /exec "\$@"/)
})

test('the npm scripts exist', () => {
  assert.equal(pkg.scripts['agente:imagen'].includes('factory/agente'), true)
  assert.match(pkg.scripts['agente:imagen'], /limonia-agente:dev/)
  assert.equal(pkg.scripts['agente:medir'], 'node scripts/agente-medir.mjs')
})
