// The agents' Docker network and the proxy container. Needs Docker and the image (npm run agente:imagen).
//   npm run proxy:red                 create the internal network (idempotent)
//   npm run proxy                     run the proxy container (foreground; Ctrl+C stops it)
//   npm run proxy:red -- check        from an agent container: the internet fails, the proxy answers
//   npm run proxy:red -- remove       remove the network
//
// The network is --internal: a container on it has no route out. The proxy container is on it and also on the default
// bridge (the only way out); a host process bound to the network's gateway is not reachable from containers on
// Docker 29, so the proxy is a container. Agents reach it by name: http://limonia-proxy:8787
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { checkCredentialFile } from '../lib/proxy.js'

export const NETWORK = 'limonia-agentes'
export const PROXY = 'limonia-proxy'
export const PROXY_URL = `http://${PROXY}:8787`
const IMAGE = 'limonia-agente:dev'
const root = join(import.meta.dirname, '..')

const docker = (args, opts = {}) => spawnSync('docker', args, { encoding: 'utf8', ...opts })

function create() {
  if (docker(['network', 'inspect', NETWORK]).status === 0) return console.log(`network ${NETWORK} exists`)
  const r = docker(['network', 'create', '--internal', NETWORK])
  if (r.status !== 0) { console.error(r.stderr); process.exit(1) }
  console.log(`network ${NETWORK} created (internal)`)
}

// Starts the proxy container. Mounts: lib/ and scripts/ read-only, the credential file read-only, the admin socket dir.
function up() {
  const credential = process.env.LIMONIA_CREDENCIAL ?? join(homedir(), '.config/limonia/claude-credencial')
  try { checkCredentialFile(credential) } catch (e) { console.error(e.message); process.exit(1) } // before Docker creates anything
  create()
  const run = join(process.env.XDG_RUNTIME_DIR ?? '/tmp', 'limonia')
  mkdirSync(run, { recursive: true, mode: 0o700 })
  chmodSync(run, 0o700)
  docker(['rm', '-f', PROXY])
  const created = docker([
    'create', '--rm', '--name', PROXY, '--network', NETWORK, '--user', `${process.getuid()}:${process.getgid()}`,
    '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '--mount', `type=bind,source=${join(root, 'lib')},target=/app/lib,readonly`, '--mount', `type=bind,source=${join(root, 'scripts')},target=/app/scripts,readonly`,
    '--mount', `type=bind,source=${credential},target=/run/credencial,readonly`, '--mount', `type=bind,source=${run},target=/run/limonia`,
    '-e', 'LIMONIA_CREDENCIAL=/run/credencial', '-e', 'PROXY_HOST=0.0.0.0', '-e', 'PROXY_ADMIN_SOCKET=/run/limonia/proxy-admin.sock',
    ...['PROXY_MODELOS'].filter((k) => process.env[k]).flatMap((k) => ['-e', `${k}=${process.env[k]}`]),
    '--entrypoint', 'node', IMAGE, '/app/scripts/proxy.mjs',
  ])
  if (created.status !== 0) { console.error(created.stderr); process.exit(1) }
  docker(['network', 'connect', 'bridge', PROXY]) // the way out to the model API
  console.log(`proxy ${PROXY_URL} (admin socket ${join(run, 'proxy-admin.sock')})`)
  process.exit(docker(['start', '-a', PROXY], { stdio: 'inherit' }).status ?? 1)
}

// An agent container on the network: no internet; the proxy name resolves and answers (any HTTP status counts).
function check() {
  create()
  const probe = docker(['inspect', '-f', '{{.State.Running}}', PROXY]).stdout.trim() === 'true'
  const stub = probe ? [] : ['run', '-d', '--rm', '--name', PROXY, '--network', NETWORK, '--entrypoint', 'node', IMAGE, '-e',
    "require('http').createServer((q,s)=>{s.writeHead(404);s.end()}).listen(8787)"]
  if (!probe) docker(stub)
  const script = `
    const t = (u) => fetch(u, { signal: AbortSignal.timeout(5000) }).then((r) => 'answered ' + r.status, () => 'failed')
    Promise.all([t('https://api.anthropic.com'), t('http://1.1.1.1'), t('${PROXY_URL}/')]).then((x) => console.log(x.join('|')))`
  const r = docker(['run', '--rm', '--network', NETWORK, '--entrypoint', 'node', IMAGE, '-e', script])
  if (!probe) docker(['rm', '-f', PROXY])
  if (r.status !== 0) { console.error(r.stderr); process.exit(1) }
  const [api, ip, proxy] = r.stdout.trim().split('|')
  console.log(`api.anthropic.com: ${api}\n1.1.1.1: ${ip}\n${PROXY_URL}: ${proxy}${probe ? '' : ' (temporary stand-in; no proxy was running)'}`)
  const ok = api === 'failed' && ip === 'failed' && proxy.startsWith('answered')
  console.log(ok ? 'OK: an agent container reaches only the proxy' : 'FAIL')
  process.exit(ok ? 0 : 1)
}

if (import.meta.main) {
  const cmd = process.argv[2] ?? 'create'
  if (cmd === 'create') create()
  else if (cmd === 'up') up()
  else if (cmd === 'check') check()
  else if (cmd === 'remove') process.exit(docker(['network', 'rm', NETWORK]).status)
  else { console.error('usage: proxy-red.mjs [create|up|check|remove]'); process.exit(2) }
}
