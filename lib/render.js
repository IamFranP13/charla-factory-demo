// Renders the site with a candidate change and takes screenshots of it, for the ux and ui reviewers of a visual change.
// Nothing is measured here (no contrast, no overlap): the reviewers, a vision model, judge what they see.
//   1. a throwaway copy of the site (no .git; node_modules is linked, not copied) with the candidate files laid over it
//   2. build it there (the feature registry, then astro build)
//   3. serve each build on 127.0.0.1 (port 0) with a tiny static server
//   4. a headless Chromium-family browser takes the screenshots of SHOTS
// It runs only on a change that already passed the static check of lib/estilo.js (the factory keeps that order).
// Every child process (build, browser) gets an EMPTY environment: PATH, and HOME and TMPDIR inside the scratch
// directory. Never the model key or a GitHub token. The scratch directory is always removed.

import { spawn } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { delimiter, dirname, extname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const BUILD_TIMEOUT_MS = 120000
export const SHOT_TIMEOUT_MS = 30000
// Headless Chrome waits this long (virtual time) so the entrance animations of the page finish before the shot.
const VIRTUAL_TIME_MS = 3000
const MAX_OUTPUT = 20000
const BROWSERS = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'brave']
const COPIED = ['src', 'public', 'content', 'catalogo', 'data', 'config', 'lib', 'astro.config.mjs', 'package.json']

// The shots, in the order the reviewers get them. `site` is the build they come from: the current site or the candidate.
export const SHOTS = [
  { id: 'inicio-antes-escritorio', site: 'before', path: '/', width: 1280, height: 800, label: 'Inicio ANTES del cambio · escritorio 1280×800' },
  { id: 'inicio-despues-escritorio', site: 'after', path: '/', width: 1280, height: 800, label: 'Inicio DESPUÉS del cambio · escritorio 1280×800' },
  { id: 'inicio-antes-movil', site: 'before', path: '/', width: 390, height: 844, label: 'Inicio ANTES del cambio · móvil 390×844' },
  { id: 'inicio-despues-movil', site: 'after', path: '/', width: 390, height: 844, label: 'Inicio DESPUÉS del cambio · móvil 390×844' },
  { id: 'catalogo-despues-escritorio', site: 'after', path: '/catalogo/', width: 1280, height: 800, label: 'Catálogo DESPUÉS del cambio · escritorio 1280×800' },
  { id: 'presupuesto-despues-escritorio', site: 'after', path: '/presupuesto/', width: 1280, height: 800, label: 'Presupuesto DESPUÉS del cambio · escritorio 1280×800' },
]

// The failure of a render. `candidate` is true when the CANDIDATE site does not build (the Builder can fix that);
// otherwise the problem is the environment (no browser, a shot that failed, the current site not building).
export class RenderError extends Error {
  constructor(message, { candidate = false } = {}) {
    super(message)
    this.name = 'RenderError'
    this.candidate = candidate
  }
}

/** The browser to use: FACTORY_BROWSER (a name on the PATH or a path), else the first of BROWSERS found on the PATH; null if none. */
export function findBrowser(env = process.env, isFile = (p) => existsSync(p) && statSync(p).isFile()) {
  const onPath = (name) => (name.includes('/') ? [name] : String(env.PATH ?? '').split(delimiter).filter(Boolean).map((dir) => join(dir, name))).find(isFile) ?? null
  if (env.FACTORY_BROWSER) return onPath(env.FACTORY_BROWSER)
  for (const name of BROWSERS) {
    const found = onPath(name)
    if (found) return found
  }
  return null
}

/**
 * @param {string} root the repository
 * @param {{path: string, content: string}[]} files the candidate files
 * @param {object} [options] `run`, `serve`, `browser`, `env` and the time limits can be injected (tests)
 * @returns {Promise<{id: string, label: string, dataUrl: string}[]>} one PNG data URL per shot of SHOTS
 */
export async function renderSite(root, files, options = {}) {
  const { run = runChild, serve = serveDir, env = process.env, buildTimeoutMs = BUILD_TIMEOUT_MS, shotTimeoutMs = SHOT_TIMEOUT_MS } = options
  const browser = options.browser ?? findBrowser(env)
  if (!browser) throw new RenderError('no hay navegador (instala Chrome o Chromium, o indica uno en FACTORY_BROWSER)')
  if (!existsSync(join(root, 'node_modules')) || !existsSync(join(root, 'package.json'))) throw new RenderError('el repositorio no tiene sus dependencias instaladas (node_modules)')

  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'factory-render-')))
  const servers = []
  try {
    mkdirSync(join(scratch, 'home'))
    mkdirSync(join(scratch, 'tmp'))
    // Nothing of the parent's environment gets through: not the model key, not a token.
    const childEnv = { PATH: env.PATH ?? '/usr/bin:/bin', HOME: join(scratch, 'home'), TMPDIR: join(scratch, 'tmp'), ASTRO_TELEMETRY_DISABLED: '1' }

    // 1 and 2. Both sites, built: the candidate first, since that is the failure the Builder can fix.
    const sites = {}
    for (const site of ['after', 'before']) {
      const dir = join(scratch, site)
      copySite(root, dir, site === 'after' ? files : [])
      const built = await buildSite(dir, { run, env: childEnv, timeoutMs: buildTimeoutMs })
      if (!built.ok) throw new RenderError(`${site === 'after' ? 'la web con el cambio' : 'la web actual'} no se construye: ${tail(built.output, scratch)}`, { candidate: site === 'after' })
      sites[site] = join(dir, 'dist')
    }

    // 3. Each build on its own port, on this machine only.
    const urls = {}
    for (const site of ['before', 'after']) {
      const server = await serve(sites[site])
      servers.push(server)
      urls[site] = server.url
    }

    // 4. The shots, one browser run each.
    const shots = []
    mkdirSync(join(scratch, 'shots'))
    for (const shot of SHOTS) {
      const file = join(scratch, 'shots', `${shot.id}.png`)
      const args = [
        '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
        `--user-data-dir=${join(scratch, 'profile')}`,
        `--window-size=${shot.width},${shot.height}`, `--virtual-time-budget=${VIRTUAL_TIME_MS}`,
        `--screenshot=${file}`, `${urls[shot.site]}${shot.path}`,
      ]
      const result = await run(browser, args, { env: childEnv, cwd: scratch, timeoutMs: shotTimeoutMs })
      if (result.timedOut) throw new RenderError(`la captura «${shot.label}» superó el tiempo límite (${+(shotTimeoutMs / 1000).toFixed(1)} s)`)
      if (!existsSync(file)) throw new RenderError(`el navegador no hizo la captura «${shot.label}»: ${tail(result.output, scratch) || `código ${result.code}`}`)
      shots.push({ id: shot.id, label: shot.label, dataUrl: `data:image/png;base64,${readFileSync(file).toString('base64')}` })
    }
    return shots
  } finally {
    await Promise.all(servers.map((server) => server.close()))
    rmSync(scratch, { recursive: true, force: true })
  }
}

// The site as a throwaway copy: only what the build reads, the candidate files laid over it, node_modules linked.
function copySite(root, dir, files) {
  mkdirSync(dir, { recursive: true })
  for (const entry of COPIED) {
    if (!existsSync(join(root, entry))) continue
    cpSync(join(root, entry), join(dir, entry), { recursive: true, filter: (src) => src !== join(root, 'src/features/index.js') })
  }
  symlinkSync(join(root, 'node_modules'), join(dir, 'node_modules'), 'dir')
  for (const { path, content } of files) {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), content)
  }
}

// The feature registry (computed in the isolation of lib/sandbox.js), then the static build into <dir>/dist.
async function buildSite(dir, { run, env, timeoutMs }) {
  const features = fileURLToPath(new URL('../scripts/build-features.mjs', import.meta.url))
  const first = await run(process.execPath, [features, '--root', dir], { env, cwd: dir, timeoutMs })
  if (first.timedOut || first.code !== 0) return { ok: false, output: first.timedOut ? 'la construcción superó el tiempo límite' : first.output }
  const astro = await run(process.execPath, [join(dir, 'node_modules/astro/bin/astro.mjs'), 'build'], { env, cwd: dir, timeoutMs })
  if (astro.timedOut || astro.code !== 0) return { ok: false, output: astro.timedOut ? 'la construcción superó el tiempo límite' : astro.output }
  return { ok: true, output: astro.output }
}

// The end of a tool's output, without the scratch directory.
function tail(output, scratch) {
  const text = String(output ?? '').split(scratch).join('').replace(/\x1b\[[0-9;]*m/g, '').trim()
  return text.length > 1500 ? `…${text.slice(-1500)}` : text
}

// One child process with a time limit (its whole process group is killed), output kept to the last MAX_OUTPUT characters.
function runChild(command, args, { env, cwd, timeoutMs }) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { env, cwd, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
    let output = ''
    let timedOut = false
    const collect = (chunk) => { output = (output + chunk).slice(-MAX_OUTPUT) }
    child.stdout.on('data', collect)
    child.stderr.on('data', collect)
    const timer = setTimeout(() => {
      timedOut = true
      try { process.kill(-child.pid, 'SIGKILL') } catch { child.kill('SIGKILL') }
    }, timeoutMs)
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ code: null, timedOut: false, output: error.message })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      try { process.kill(-child.pid, 'SIGKILL') } catch { /* nothing left */ }
      resolve({ code, timedOut, output })
    })
  })
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain; charset=utf-8' }

// A tiny static server for a built dist/, on 127.0.0.1 only (port 0: the system picks a free one).
export async function serveDir(dir) {
  const base = realpathSync(dir)
  const server = createServer((req, res) => {
    let path
    try { path = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname) } catch { path = null }
    const target = path === null ? null : normalize(join(base, path))
    const file = target && (target === base || target.startsWith(base + sep)) ? (existsSync(target) && statSync(target).isDirectory() ? join(target, 'index.html') : target) : null
    if (!file || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found')
      return
    }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file))
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(() => resolve()) }),
  }
}
