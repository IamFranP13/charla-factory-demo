// The side effects of several tasks share one Node process: none of them may block its event loop.
// Each test puts a slow fake command (a real child process) first on PATH and checks that a timer of "another task" keeps its time.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import http from 'node:http'
import { issueFor } from '../lib/intake.js'
import { initialState, replaceState, parseState } from '../lib/estado.js'
import { dockerNode, githubNode, proxyNode, gitNode } from '../lib/fabrica.js'
import { publicarNode, trabajoNode } from '../lib/publicar.js'

const SLOW = 0.5 // seconds each fake command takes
const LAG_MAX = 250 // ms a 100 ms timer may be late

// A directory with fake commands first on PATH. Each script sleeps, then runs `body`.
function shims(commands) {
  const dir = mkdtempSync(join(tmpdir(), 'fabrica-async-'))
  const bin = join(dir, 'bin')
  mkdirSync(bin)
  for (const [name, body] of Object.entries(commands)) {
    writeFileSync(join(bin, name), `#!/bin/sh\nsleep ${SLOW}\n${body}\n`)
    chmodSync(join(bin, name), 0o755)
  }
  const path = process.env.PATH
  process.env.PATH = `${bin}:${path}`
  return { dir, done() { process.env.PATH = path; rmSync(dir, { recursive: true, force: true }) } }
}

// Resolves with how late (ms) a 100 ms timer fired while `work` ran, and the result of `work`.
async function lagWhile(work) {
  const t0 = Date.now()
  const timer = new Promise((resolve) => setTimeout(() => resolve(Date.now() - t0 - 100), 100))
  const result = work()
  return { lag: await timer, result: await result }
}

test('a task state write through gh does not block the loop and two tasks write at the same time', async () => {
  const body = replaceState(issueFor('marketing', 'Una campaña').body, initialState('marketing'))
  const fake = shims({ gh: 'case "$*" in *PATCH*) cat >/dev/null; echo "{}" ;; *) cat "$BODY_JSON" ;; esac' })
  writeFileSync(join(fake.dir, 'body.json'), JSON.stringify({ body }))
  process.env.BODY_JSON = join(fake.dir, 'body.json')
  process.env.GITHUB_REPOSITORY = 'owner/repo'
  try {
    const github = githubNode({ repo: 'owner/repo' })
    const t0 = Date.now()
    const { lag, result } = await lagWhile(() => Promise.all([
      github.update(1, (s) => ({ ...s, pr: 7 })),
      github.update(2, (s) => ({ ...s, pr: 8 })),
    ]))
    assert.ok(lag < LAG_MAX, `the timer was ${lag} ms late: the loop was blocked`)
    assert.equal(result[0].pr, 7)
    assert.equal(result[1].pr, 8)
    assert.ok(Date.now() - t0 < SLOW * 1000 * 3.5, "the two tasks' read-modify-writes ran side by side")
    assert.equal(parseState(body).pr, null)
  } finally {
    delete process.env.BODY_JSON
    fake.done()
  }
})

test('the docker helpers do not block the loop', async () => {
  const fake = shims({ docker: 'echo limonia-t1' })
  try {
    const docker = dockerNode()
    const { lag } = await lagWhile(async () => {
      await docker.networkCreate('limonia-t1')
      await docker.kill('limonia-agente-t1')
    })
    assert.ok(lag < LAG_MAX, `the timer was ${lag} ms late: the loop was blocked`)
  } finally {
    fake.done()
  }
})

test('the host git of a copy does not block the loop', async () => {
  const fake = shims({ git: 'echo deadbeef' })
  const root = mkdtempSync(join(tmpdir(), 'fabrica-async-git-'))
  try {
    const node = gitNode({ source: root, copias: join(root, 'copias'), fetch: false })
    const { lag } = await lagWhile(() => node.prepare({ numero: 3 }).catch(() => {}))
    assert.ok(lag < LAG_MAX, `the timer was ${lag} ms late: the loop was blocked`)
  } finally {
    fake.done()
    rmSync(root, { recursive: true, force: true })
  }
})

test('publishing (push, workflow dispatch, polling) does not block the loop and still scrubs the token', async () => {
  const fake = shims({ gh: 'case "$1" in auth) echo SECRETTOKEN ;; api) echo "[{\\"number\\": 9}]" ;; *) : ;; esac', git: 'echo "fatal: bad SECRETTOKEN" >&2; exit 1' })
  try {
    const node = publicarNode({ repo: 'owner/repo', sleep: async () => {}, polls: 1 })
    const { lag, result } = await lagWhile(() => node.publicar({ clone: fake.dir, numero: 4 }).then(() => 'published', (e) => e.message))
    assert.ok(lag < LAG_MAX, `the timer was ${lag} ms late: the loop was blocked`)
    assert.match(result, /git push/)
    assert.ok(!result.includes('SECRETTOKEN'), 'the token never leaves in a message')
  } finally {
    fake.done()
  }
})

test('the host git of the work clone does not block the loop', async () => {
  const fake = shims({ git: 'echo' })
  const root = mkdtempSync(join(tmpdir(), 'fabrica-async-trabajo-'))
  try {
    mkdirSync(join(root, 'copia'))
    const node = trabajoNode({ source: root, copias: join(root, 'copias') })
    const { lag } = await lagWhile(() => node.tomar({ dir: join(root, 'copia'), base: 'a'.repeat(40), numero: 3, resumen: 'x' }).catch(() => {}))
    assert.ok(lag < LAG_MAX, `the timer was ${lag} ms late: the loop was blocked`)
  } finally {
    fake.done()
    rmSync(root, { recursive: true, force: true })
  }
})

// --- the proxy revoke -------------------------------------------------------------------------------------------------------

async function proxyWith(handler) {
  const dir = mkdtempSync(join(tmpdir(), 'proxy-async-'))
  const socket = join(dir, 'admin.sock')
  const seen = []
  const server = http.createServer((req, res) => { seen.push(req.method); handler(req, res, seen.length) })
  await new Promise((resolve) => server.listen(socket, resolve))
  return {
    socket,
    seen,
    async close() {
      server.closeAllConnections?.()
      await new Promise((resolve) => server.close(resolve))
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

test('revoke tries again once after a timeout, then succeeds', async () => {
  const fake = await proxyWith((req, res, count) => { if (count > 1) res.end('{}'); else req.resume() }) // the first call never answers
  try {
    await proxyNode({ socket: fake.socket, timeoutMs: 100, retryMs: 10 }).revoke(1)
    assert.deepEqual(fake.seen, ['DELETE', 'DELETE'])
  } finally { await fake.close() }
})

test('revoke tries again once after a dropped connection, and gives up after the second failure', async () => {
  const fake = await proxyWith((req) => req.socket.destroy())
  try {
    await assert.rejects(proxyNode({ socket: fake.socket, timeoutMs: 100, retryMs: 10 }).revoke(1))
    assert.equal(fake.seen.length, 2, 'one retry, no more')
  } finally { await fake.close() }
})

test('revoke does not retry an answer of the proxy that says no', async () => {
  const fake = await proxyWith((req, res) => { res.statusCode = 500; res.end('{}') })
  try {
    await assert.rejects(proxyNode({ socket: fake.socket, retryMs: 10 }).revoke(1), /HTTP 500/)
    assert.equal(fake.seen.length, 1)
  } finally { await fake.close() }
})
