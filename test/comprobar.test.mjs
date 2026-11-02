import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { run } from '../scripts/comprobar.mjs'

function harness(results) {
  const tmp = mkdtempSync(join(tmpdir(), 'comprobar-test-'))
  const out = []
  const seen = []
  const env = { XDG_RUNTIME_DIR: tmp }
  const deps = (runtime, e) => ({
    env: e, fs, runtime, uid: process.getuid(), root: tmp, home: tmp, nodeVersion: 'v26.0.0',
    exec: (cmd, args) => { seen.push([cmd, ...args]); return results[`${cmd} ${args[0]}`] ?? { status: 0, stdout: 'x\n' } },
    proxyAlive: async () => false,
  })
  return { env, deps, out, seen, cleanup: () => rmSync(tmp, { recursive: true, force: true }) }
}

test('comprobar prints one line per check and exits 1 when a required one fails', async () => {
  const h = harness({ 'docker version': { status: 1, stdout: '' } })
  try {
    fs.writeFileSync(join(h.env.XDG_RUNTIME_DIR, '.node-version'), '26\n')
    const code = await run({ env: h.env, deps: h.deps, out: (l) => h.out.push(l) })
    assert.equal(code, 1)
    assert.ok(h.out.some((l) => l.startsWith('✗ Docker no responde')))
    assert.ok(h.out.some((l) => l.includes('→ Abre Docker Desktop')))
    assert.match(h.out.at(-1), /Hay comprobaciones en rojo/)
  } finally { h.cleanup() }
})

test('comprobar sets XDG_RUNTIME_DIR to the fallback in the environment it hands to the checks when it is unset', async () => {
  const h = harness({})
  const tmpBefore = process.env.XDG_RUNTIME_DIR
  try {
    const env = {}
    const tmp = h.env.XDG_RUNTIME_DIR // the fallback is created here, never in the real /tmp
    let handed
    await run({ env, tmp, deps: (runtime, e) => { handed = { runtime, e }; return h.deps(runtime, e) }, out: () => {} })
    assert.equal(handed.runtime.fallback, true)
    assert.equal(handed.e.XDG_RUNTIME_DIR, handed.runtime.dir)
    assert.equal(env.XDG_RUNTIME_DIR, handed.runtime.dir)
    assert.equal(process.env.XDG_RUNTIME_DIR, tmpBefore) // only the environment it was given
  } finally { h.cleanup() }
})
