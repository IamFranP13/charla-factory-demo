// The model proxy server. Normally run inside its container by `npm run proxy` (scripts/proxy-red.mjs up).
// Two listeners: the proxy on TCP (what the agent containers reach) and the admin on a unix socket that issues and
// revokes task tokens (the agent containers do not mount it). The credential is read from a file with mode 600,
// never from argv or the environment.
import http from 'node:http'
import { chmodSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createAdmin, createProxy, createTokens, loadCredential } from '../lib/proxy.js'

const file = process.env.LIMONIA_CREDENCIAL ?? join(homedir(), '.config/limonia/claude-credencial')
const host = process.env.PROXY_HOST ?? '127.0.0.1'
const port = Number(process.env.PROXY_PORT ?? 8787)
const socket = process.env.PROXY_ADMIN_SOCKET ?? join(process.env.XDG_RUNTIME_DIR ?? '/tmp', 'limonia', 'proxy-admin.sock')
const allowedModels = (process.env.PROXY_MODELOS ?? 'claude-sonnet-,claude-haiku-').split(',').map((s) => s.trim()).filter(Boolean)

let credential
try { credential = loadCredential(file) } catch (e) { console.error(e.message); process.exit(1) }
const tokens = createTokens()
const proxy = http.createServer(createProxy({ tokens, credential, allowedModels }))
const admin = http.createServer(createAdmin({ tokens }))
// A request body must arrive quickly: a task that leaves uploads half open cannot hold the shared body budget for long.
proxy.requestTimeout = 30_000
proxy.headersTimeout = 10_000
proxy.listen(port, host, () => console.log(`proxy http://${host}:${port} (${credential.kind}, models ${allowedModels.join(', ')})`))
rmSync(socket, { force: true })
admin.listen(socket, () => { chmodSync(socket, 0o600); console.log(`admin ${socket}`) })
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { rmSync(socket, { force: true }); process.exit(0) })
