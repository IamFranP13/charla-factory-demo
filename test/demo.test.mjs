import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import * as fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { run } from '../scripts/demo.mjs'

// Fake processes, proxy and signals: nothing starts Docker, the proxy or the factory.
function fakeChild(log, name) {
  const child = new EventEmitter()
  child.kills = []
  child.kill = (signal) => { child.kills.push(signal); log.push(`${name}.kill ${signal}`); return true }
  child.finish = (code = 0, signal = null) => child.emit('exit', code, signal)
  return child
}

function harness({ checks = { ok: true, lines: ['✓ todo'] }, alive = [false, false, true], waitMs, env = {} } = {}) {
  const tmp = mkdtempSync(join(tmpdir(), 'demo-test-'))
  const log = []
  const out = []
  const err = []
  const spawned = []
  const handlers = []
  const answers = [...alive]
  const find = (name) => spawned.find((s) => s.name === name)
  const deps = {
    env: { XDG_RUNTIME_DIR: tmp, ...env },
    fs,
    uid: process.getuid(),
    tmp,
    root: '/repo',
    checks: async (childEnv) => { log.push(`checks ${childEnv.XDG_RUNTIME_DIR}`); return checks },
    alive: async () => (answers.length > 1 ? answers.shift() : answers[0]),
    spawn: (cmd, args, options) => {
      const name = args[0].includes('proxy') ? 'proxy' : 'factory'
      const child = fakeChild(log, name)
      spawned.push({ name, cmd, args, options, child })
      log.push(`spawn ${name}`)
      return child
    },
    stopProxy: () => { log.push('stopProxy'); find('proxy')?.child.finish(0) }, // stopping the container ends the proxy process
    sleep: () => new Promise((resolve) => setImmediate(resolve)), // yields, so a test can act between two looks
    signals: { on: (fn) => { handlers.push(fn); return () => handlers.splice(handlers.indexOf(fn), 1) } },
    waitMs,
    out: (l) => out.push(l),
    err: (l) => err.push(l),
  }
  const settle = async () => { for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve)) }
  return { deps, log, out, err, spawned, handlers, find, settle, cleanup: () => rmSync(tmp, { recursive: true, force: true }) }
}

test('demo refuses to start when a required check fails, and starts nothing', async () => {
  const h = harness({ checks: { ok: false, lines: ['✗ Docker no responde', '    → abre Docker Desktop'] } })
  try {
    assert.equal(await run([], h.deps), 1)
    assert.deepEqual(h.spawned, [])
    assert.deepEqual(h.out.slice(0, 2), ['✗ Docker no responde', '    → abre Docker Desktop'])
    assert.match(h.err.join('\n'), /no arranco/)
    assert.deepEqual(h.log, [`checks ${h.deps.env.XDG_RUNTIME_DIR}`])
  } finally { h.cleanup() }
})

test('demo starts the proxy, waits until it answers, then starts the factory with the extra arguments', async () => {
  const h = harness({ alive: [false, false, true] })
  try {
    const done = run(['--origen', 'web'], h.deps)
    await h.settle()
    assert.deepEqual(h.log.filter((l) => l.startsWith('spawn')), ['spawn proxy', 'spawn factory'])
    const proxy = h.find('proxy')
    const factory = h.find('factory')
    assert.deepEqual(proxy.args, [`${'/repo'}/scripts/proxy-red.mjs`, 'up'])
    assert.deepEqual(factory.args, ['/repo/scripts/fabrica.mjs', '--origen', 'web'])
    assert.equal(proxy.cmd, process.execPath)
    assert.equal(factory.options.cwd, '/repo')
    assert.equal(factory.options.detached, true) // a terminal Ctrl+C reaches only demo, which forwards it
    assert.equal(proxy.options.detached, true)
    factory.child.finish(0)
    assert.equal(await done, 0)
    assert.deepEqual(h.log.slice(-1), ['stopProxy'])
  } finally { h.cleanup() }
})

test('demo passes the runtime directory to both children and creates the fallback when XDG_RUNTIME_DIR is unset', async () => {
  const h = harness({ env: { XDG_RUNTIME_DIR: '' } })
  try {
    const done = run([], h.deps)
    await h.settle()
    const dir = join(h.deps.tmp, `limonia-${process.getuid()}`)
    assert.equal(h.find('proxy').options.env.XDG_RUNTIME_DIR, dir)
    assert.equal(h.find('factory').options.env.XDG_RUNTIME_DIR, dir)
    assert.equal(fs.statSync(dir).mode & 0o777, 0o700)
    h.find('factory').child.finish(0)
    await done
  } finally { h.cleanup() }
})

test('demo refuses a fallback runtime directory that exists with another mode, and starts nothing', async () => {
  const h = harness({ env: { XDG_RUNTIME_DIR: '' } })
  try {
    const dir = join(h.deps.tmp, `limonia-${process.getuid()}`)
    fs.mkdirSync(dir, { mode: 0o755 })
    fs.chmodSync(dir, 0o755)
    assert.equal(await run([], h.deps), 1)
    assert.deepEqual(h.spawned, [])
    assert.match(h.err.join('\n'), /permisos 700/)
  } finally { h.cleanup() }
})

test('a proxy that exits before answering stops demo with its reason and a non-zero code; no factory', async () => {
  const h = harness({ alive: [false] })
  try {
    const done = run([], h.deps)
    await h.settle()
    h.find('proxy').child.finish(1)
    assert.equal(await done, 1)
    assert.equal(h.find('factory'), undefined)
    assert.match(h.err.join('\n'), /el proxy no ha arrancado.*código 1/)
    assert.match(h.err.join('\n'), /credencial|docker/i)
    assert.ok(h.log.includes('stopProxy'))
  } finally { h.cleanup() }
})

test('a proxy that never answers times out: demo stops it and exits non-zero', async () => {
  const h = harness({ alive: [false], waitMs: 2000 })
  try {
    assert.equal(await run([], h.deps), 1)
    assert.equal(h.find('factory'), undefined)
    assert.match(h.err.join('\n'), /no responde/)
    assert.ok(h.log.includes('stopProxy'))
  } finally { h.cleanup() }
})

test('Ctrl+C once: the factory gets SIGINT and finishes its tasks; the proxy stops only when the factory has exited', async () => {
  const h = harness()
  try {
    const done = run([], h.deps)
    await h.settle()
    const factory = h.find('factory').child
    h.handlers[0]()
    assert.deepEqual(factory.kills, ['SIGINT'])
    assert.ok(!h.log.includes('stopProxy'))
    assert.match(h.out.join('\n'), /Ctrl\+C/)
    factory.finish(0)
    assert.equal(await done, 0)
    assert.equal(h.log.at(-1), 'stopProxy')
    assert.equal(h.handlers.length, 0) // the handler is removed
  } finally { h.cleanup() }
})

test('Ctrl+C twice: the second one is forwarded so the factory kills its agents, then the proxy stops', async () => {
  const h = harness()
  try {
    const done = run([], h.deps)
    await h.settle()
    const factory = h.find('factory').child
    h.handlers[0]()
    h.handlers[0]()
    assert.deepEqual(factory.kills, ['SIGINT', 'SIGINT'])
    assert.ok(!h.log.includes('stopProxy'))
    factory.finish(0)
    await done
    assert.deepEqual(h.log.slice(-2), ['factory.kill SIGINT', 'stopProxy'])
  } finally { h.cleanup() }
})

test('Ctrl+C while waiting for the proxy: stops the proxy and never starts the factory', async () => {
  const h = harness({ alive: [false] })
  try {
    const done = run([], h.deps)
    await h.settle()
    h.handlers[0]()
    assert.equal(await done, 130)
    assert.equal(h.find('factory'), undefined)
    assert.ok(h.log.includes('stopProxy'))
  } finally { h.cleanup() }
})

test('the factory exiting by itself (or failing) stops the proxy and returns its exit code', async () => {
  const h = harness()
  try {
    const done = run([], h.deps)
    await h.settle()
    h.find('factory').child.finish(1)
    assert.equal(await done, 1)
    assert.equal(h.log.at(-1), 'stopProxy')
  } finally { h.cleanup() }
})

test('a proxy already running is reused and left running', async () => {
  const h = harness({ alive: [true] })
  try {
    const done = run([], h.deps)
    await h.settle()
    assert.equal(h.find('proxy'), undefined)
    assert.match(h.out.join('\n'), /ya estaba en marcha/)
    h.find('factory').child.finish(0)
    assert.equal(await done, 0)
    assert.ok(!h.log.includes('stopProxy'))
  } finally { h.cleanup() }
})

test('the proxy dying while the factory runs sends the factory a SIGINT and says so', async () => {
  const h = harness()
  try {
    const done = run([], h.deps)
    await h.settle()
    h.find('proxy').child.finish(1)
    assert.deepEqual(h.find('factory').child.kills, ['SIGINT'])
    assert.match(h.err.join('\n'), /el proxy se ha parado/)
    h.find('factory').child.finish(0)
    await done
  } finally { h.cleanup() }
})
