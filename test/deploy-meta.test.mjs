import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync, execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const repo = new URL('..', import.meta.url).pathname
const script = join(repo, 'scripts/deploy-meta.mjs')
const SHA = 'd'.repeat(40)

const run = (args, env = {}) => {
  const out = mkdtempSync(join(tmpdir(), 'deploy-'))
  const r = spawnSync(process.execPath, [script, '--out', out, ...args], { encoding: 'utf8', cwd: repo, env: { ...process.env, CF_PAGES_COMMIT_SHA: '', ...env } })
  const file = join(out, 'deploy.json')
  const result = { r, json: existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null }
  rmSync(out, { recursive: true, force: true })
  return result
}

test('deploy.json holds the Cloudflare commit and the build time', () => {
  const before = Date.now()
  const { r, json } = run([], { CF_PAGES_COMMIT_SHA: SHA })
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(Object.keys(json), ['commit', 'builtAt'])
  assert.equal(json.commit, SHA)
  assert.ok(new Date(json.builtAt).getTime() >= before - 1000)
  assert.equal(new Date(json.builtAt).toISOString(), json.builtAt)
})

test('locally it falls back to git rev-parse HEAD', () => {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim()
  const { r, json } = run([])
  assert.equal(r.status, 0, r.stderr)
  assert.equal(json.commit, head)
})

test('a commit that is not a sha is never published: git is used instead', () => {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim()
  const { json } = run([], { CF_PAGES_COMMIT_SHA: '--> nope' })
  assert.equal(json.commit, head)
})

test('npm run build writes deploy.json after astro build, with the content validation first and the feature registry before the site', () => {
  const build = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).scripts.build
  const steps = build.split('&&').map((s) => s.trim())
  assert.deepEqual(steps, ['node scripts/validate-content.mjs', 'node scripts/build-features.mjs', 'astro build', 'node scripts/deploy-meta.mjs'])
})
