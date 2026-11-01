// The model proxy: the agent container talks to this, never to the model API. It holds the real credential, accepts
// only per-task tokens, forwards only the messages endpoints and only allowed models, and logs no header or body.
// Standard library only; fetch and clock are injected. A request can never kill the process: every handler is wrapped.
import { randomBytes } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { Readable } from 'node:stream'

export const UPSTREAM = 'https://api.anthropic.com'
export const OAUTH_BETA = 'oauth-2025-04-20' // what Claude Code sends with a subscription token (verify live)
// anthropic-beta values accepted from the agent. Derived by listing every beta string in the pinned Claude Code binary
// (2.1.316) and keeping those that change how a plain messages call behaves (thinking, streaming, caching, effort,
// context, structured output, token counting). Left out on purpose: anything that makes Anthropic's servers act for
// the agent (web-search, web-fetch, code execution, mcp-*, tool-search, files, managed-agents, environments, advisor,
// dangerous-tool-use). Claude Code 2.1.316 sends `thinking-token-count` and `advanced-tool-use` on every request (seen
// live): the second is allowed because the server-side tools it enables carry a `type` and the body check refuses them. An unlisted value gets 403, so a Claude Code update that adds a needed
// beta shows up in the proxy log as status=403 and is added here deliberately.
export const ALLOWED_BETAS = [
  'claude-code-20250219', OAUTH_BETA, 'interleaved-thinking-2025-05-14', 'fine-grained-tool-streaming-2025-05-14',
  'context-management-2025-06-27', 'context-1m-2025-08-07', 'prompt-caching-scope-2026-01-05', 'extended-cache-ttl-2025-04-11',
  'effort-2025-11-24', 'structured-outputs-2025-12-15', 'redact-thinking-2026-02-12', 'token-counting-2024-11-01',
  'thinking-token-count-2026-05-13', 'advanced-tool-use-2025-11-20',
]
const ROUTES = new Set(['/v1/messages', '/v1/messages/count_tokens'])
const FORWARD = ['content-type', 'accept', 'anthropic-version', 'user-agent']
const RESPONSE_HEADERS = ['content-type', 'request-id', 'retry-after', 'cache-control']
const RESPONSE_PREFIXES = ['anthropic-ratelimit-'] // rate limits only; never anthropic-organization-id
const MAX_BODY = 32 * 1024 * 1024
const TASK_ID = /^(0|[1-9]\d{0,9}|[A-Za-z][A-Za-z0-9_-]{0,39})$/ // one canonical form: no leading zeros, no stray characters

export function checkCredentialFile(path) {
  let st
  try { st = statSync(path) } catch { throw new Error(`credential file not found: ${path}`) }
  if (!st.isFile()) throw new Error(`credential ${path} must be a regular file`)
  if ((st.mode & 0o077) !== 0) throw new Error(`credential file ${path} has a loose mode: use 600 (no group or other access)`)
}

export function loadCredential(path) {
  let st
  try { st = statSync(path) } catch { throw new Error(`credential file not found: ${path}`) }
  if (!st.isFile() || (st.mode & 0o077) !== 0) throw new Error(`credential file ${path} must have mode 600 (no group or other access)`)
  const value = readFileSync(path, 'utf8').trim()
  if (value.startsWith('sk-ant-oat')) return { kind: 'oauth', value }
  if (value.startsWith('sk-ant-')) return { kind: 'apikey', value }
  throw new Error(`credential file ${path}: unknown kind (expected sk-ant-api… or sk-ant-oat…)`)
}

export function createTokens({ clock = Date.now, ttlMs = 30 * 60_000, maxRequests = 300 } = {}) {
  const live = new Map() // token -> { task, expires, left }
  const purge = () => { const now = clock(); for (const [k, v] of live) if (now >= v.expires) live.delete(k) }
  return {
    issue(task, { ttlMs: ttl = ttlMs, max = maxRequests } = {}) {
      purge()
      const token = `lim-${randomBytes(24).toString('hex')}`
      live.set(token, { task: String(task), expires: clock() + ttl, left: max })
      return token
    },
    // Returns how many tokens were revoked.
    revoke(task) { let n = 0; for (const [k, v] of live) if (v.task === String(task)) { live.delete(k); n++ } return n },
    size() { purge(); return live.size },
    // Counts the request against the budget when it is valid.
    use(token) {
      purge()
      const t = typeof token === 'string' ? live.get(token) : undefined
      if (!t) return { ok: false, status: 401 }
      if (t.left <= 0) return { ok: false, status: 429, task: t.task }
      t.left--
      return { ok: true, task: t.task }
    },
  }
}

const send = (res, status, message) => {
  if (res.headersSent) return res.end()
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ type: 'error', error: { type: 'proxy_error', message } }))
}

// Reads the body up to a per-request cap and a cap shared by the whole server (bytes in flight); rejects with a status.
const reader = (budget) => (req, max) => new Promise((resolve, reject) => {
  const chunks = []
  let size = 0
  let settled = false
  const fail = (status, message) => { if (settled) return; settled = true; budget.used -= size; chunks.length = 0; reject(Object.assign(new Error(message), { status })) }
  req.on('data', (c) => {
    if (settled) return
    size += c.length; budget.used += c.length
    if (size > max || budget.used > budget.total) { fail(413, 'too large'); req.resume() } else chunks.push(c)
  })
  req.on('end', () => { if (settled) return; settled = true; budget.used -= size; resolve(Buffer.concat(chunks)) })
  req.on('error', () => fail(400, 'read'))
})

const taskToken = (req) => {
  const x = req.headers['x-api-key']
  if (typeof x === 'string' && x) return x
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? '')
  return m?.[1]
}

// A `source` of type url anywhere in the body (an image, a document, inside a tool_result): Anthropic would fetch it.
const urlSource = (v, depth = 0) => {
  if (depth > 64) return true // too deep to judge: refuse
  if (Array.isArray(v)) return v.some((x) => urlSource(x, depth + 1))
  if (!v || typeof v !== 'object') return false
  if (v.source && typeof v.source === 'object' && v.source.type === 'url') return true
  return Object.values(v).some((x) => urlSource(x, depth + 1))
}

// Anything that would make Anthropic's servers fetch or run something for the agent is refused.
const serverSide = (b) => {
  if (b.mcp_servers !== undefined || b.container !== undefined) return true
  if (urlSource(b)) return true
  if (b.tools === undefined) return false
  if (!Array.isArray(b.tools)) return true
  return b.tools.some((t) => !t || typeof t !== 'object' || (t.type !== undefined && t.type !== 'custom'))
}

const safe = (v) => JSON.stringify(String(v)).slice(0, 80) // untrusted text in a log line: quoted, escaped, short

export function createProxy({
  tokens, credential, upstream = UPSTREAM, fetch: doFetch = globalThis.fetch, clock = Date.now,
  allowedModels = ['claude-sonnet-', 'claude-haiku-'], allowedBetas = ALLOWED_BETAS, log = console.log, maxBodyBytes = MAX_BODY,
}) {
  const readBody = reader({ used: 0, total: maxBodyBytes * 2 })
  const line = (o) => log(`${new Date(clock()).toISOString()} task=${o.task ?? '-'} model=${o.model === undefined ? '-' : safe(o.model)} status=${o.status} ms=${clock() - o.t0}` +
    (o.usage ? ` in=${o.usage.in ?? '-'} out=${o.usage.out ?? '-'}` : ''))

  async function serve(req, res, t0) {
    let url
    const done = (status, message, extra = {}) => { send(res, status, message); line({ status, t0, ...extra }) }
    try { url = new URL(req.url, 'http://proxy') } catch { req.resume(); return done(400, 'bad request') }

    if (!ROUTES.has(url.pathname)) { req.resume(); return done(404, 'not found') }
    if (req.method !== 'POST') { req.resume(); return done(405, 'method not allowed') }

    const auth = tokens.use(taskToken(req))
    if (!auth.ok) { req.resume(); return done(auth.status, auth.status === 429 ? 'request budget spent' : 'unauthorized', { task: auth.task }) }
    const task = auth.task

    let parsed, model
    try {
      parsed = JSON.parse((await readBody(req, maxBodyBytes)).toString('utf8'))
      model = parsed?.model
    } catch (e) { return done(e.status ?? 400, e.status === 413 ? 'body too large' : 'invalid request body', { task }) }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return done(400, 'invalid request body', { task })
    if (typeof model !== 'string' || !allowedModels.some((p) => model.startsWith(p))) return done(403, 'model not allowed', { task, model })
    if (serverSide(parsed)) return done(403, 'server-side tools are not allowed', { task, model })

    const betas = String(req.headers['anthropic-beta'] ?? '').split(',').map((s) => s.trim()).filter(Boolean)
    if (betas.some((b) => !allowedBetas.includes(b))) return done(403, 'beta not allowed', { task, model })

    const headers = {}
    for (const h of FORWARD) if (req.headers[h]) headers[h] = req.headers[h]
    headers['anthropic-version'] ??= '2023-06-01'
    if (credential.kind === 'oauth') {
      headers.authorization = `Bearer ${credential.value}`
      if (!betas.includes(OAUTH_BETA)) betas.push(OAUTH_BETA)
    } else {
      headers['x-api-key'] = credential.value
    }
    if (betas.length) headers['anthropic-beta'] = betas.join(',')

    const abort = new AbortController()
    res.on('close', () => { if (!res.writableFinished) abort.abort() })
    let up
    try {
      // The re-serialised body: a duplicate key in the raw bytes cannot disagree with what was checked.
      up = await doFetch(upstream + url.pathname + url.search, { method: 'POST', headers, body: JSON.stringify(parsed), signal: abort.signal, redirect: 'manual' })
    } catch { return done(502, 'upstream unreachable', { task, model }) }
    if (up.status >= 300 && up.status < 400) return done(502, 'upstream redirect refused', { task, model })

    const out = {}
    for (const [k, v] of up.headers) if (RESPONSE_HEADERS.includes(k) || RESPONSE_PREFIXES.some((p) => k.startsWith(p))) out[k] = v
    res.writeHead(up.status, out)
    const usage = {}
    let carry = ''
    const tap = (chunk) => { // usage numbers only, from a bounded window; the body is never kept
      carry = (carry + chunk.toString('utf8')).slice(-8192)
      for (const [k, re] of [['in', /"input_tokens":\s*(\d+)/g], ['out', /"output_tokens":\s*(\d+)/g]]) {
        for (const m of carry.matchAll(re)) usage[k] = Number(m[1])
      }
    }
    try {
      if (up.body) {
        for await (const chunk of Readable.fromWeb(up.body)) { tap(chunk); if (!res.write(chunk)) await new Promise((r) => res.once('drain', r)) }
      }
    } catch { /* client or upstream went away mid-stream */ }
    res.end()
    line({ task, model, status: up.status, t0, usage: usage.in !== undefined || usage.out !== undefined ? usage : undefined })
  }

  return async function handler(req, res) {
    const t0 = clock()
    try { await serve(req, res, t0) } catch {
      try { send(res, 500, 'internal error'); line({ status: 500, t0 }) } catch { /* the socket is gone */ }
    }
  }
}

// Admin: issue and revoke task tokens. Served on its own listener (unix socket), never on the one the containers reach.
export function createAdmin({ tokens }) {
  const readBody = reader({ used: 0, total: 1 << 20 })
  const json = (res, o) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)) }
  const canonical = (v) => {
    const s = typeof v === 'number' && Number.isInteger(v) && v >= 0 ? String(v) : v
    return typeof s === 'string' && TASK_ID.test(s) ? s : undefined
  }
  async function serve(req, res) {
    let url
    try { url = new URL(req.url, 'http://admin') } catch { return send(res, 400, 'bad request') }
    if (url.pathname === '/tokens' && req.method === 'POST') {
      let o
      try { o = JSON.parse((await readBody(req, 4096)).toString('utf8')) } catch { return send(res, 400, 'invalid body') }
      const task = canonical(o?.tarea)
      if (task === undefined) return send(res, 400, 'tarea must be a plain task id')
      const opts = {}
      if (o.ttl_s !== undefined) { if (!(typeof o.ttl_s === 'number' && o.ttl_s > 0)) return send(res, 400, 'ttl_s'); opts.ttlMs = o.ttl_s * 1000 }
      if (o.max !== undefined) { if (!(Number.isInteger(o.max) && o.max > 0)) return send(res, 400, 'max'); opts.max = o.max }
      return json(res, { token: tokens.issue(task, opts) })
    }
    const m = /^\/tokens\/([^/]+)$/.exec(url.pathname)
    if (m && req.method === 'DELETE') {
      const task = canonical(m[1])
      if (task === undefined) return send(res, 400, 'tarea must be a plain task id')
      return tokens.revoke(task) > 0 ? json(res, {}) : send(res, 404, 'no live token for that task')
    }
    send(res, 404, 'not found')
  }
  return async (req, res) => { try { await serve(req, res) } catch { try { send(res, 500, 'internal error') } catch { /* gone */ } } }
}
