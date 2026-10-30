// Screenshots for the visual reviewers: what the factory renders, what it gives to whom, and how it fails.

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { runFactory } from '../lib/factory.js'
import { rehearsalCopy } from '../lib/rehearsal.js'
import { replayProvider, openAIProvider, providersFromEnv } from '../lib/providers.js'
import { renderSite, serveDir, findBrowser, RenderError, SHOTS } from '../lib/render.js'

const repo = new URL('..', import.meta.url).pathname
const CSS = 'src/styles/global.css'
const read = (path) => readFileSync(join(repo, path), 'utf8')

const scratches = []
const scratch = () => {
  const root = mkdtempSync(join(tmpdir(), 'render-'))
  scratches.push(root)
  rehearsalCopy(repo, root, ['content', 'catalogo', 'data', 'config', 'brain', 'design', 'src', 'factory', 'policy', 'AGENTS.md'])
  return root
}
after(() => scratches.forEach((dir) => rmSync(dir, { recursive: true, force: true })))

// --- The factory: when it renders, what the reviewers get ---

const ok = { aprobado: true, motivo: 'bien' }
const FIX = { ficheros: [{ ruta: CSS, cambios: [{ buscar: '.hero__disco{position:absolute;top:50%;left:12%;width:150%;', reemplazar: '.hero__disco{position:absolute;top:50%;left:12%;width:140%;' }] }] }
const UNSAFE = { ficheros: [{ ruta: CSS, cambios: [{ buscar: '.hero__disco{position:absolute;top:50%;left:12%;width:150%;', reemplazar: '.hero__disco{position:absolute;top:50%;left:12%;width:150%;background:url(https://example.com/x.png);' }] }] }
const png = 'data:image/png;base64,iVBORw0KGgo='
const SHOTS_2 = [{ id: 'a', label: 'Inicio ANTES', dataUrl: png }, { id: 'b', label: 'Inicio DESPUÉS', dataUrl: png }]

// A model that answers each station from a script (a list per station: one answer per call) and records what it was sent.
function scripted(answers, { name = 'scripted' } = {}) {
  const sent = []
  return {
    name,
    sent,
    async complete({ station, messages }) {
      sent.push({ station, content: messages[0].content })
      const next = answers[station]
      const answer = Array.isArray(next) ? next[Math.min(sent.filter((s) => s.station === station).length - 1, next.length - 1)] : next
      return { text: JSON.stringify(answer), usage: { input: 1, output: 1 } }
    },
  }
}
const model = (build, name) => scripted({ spec: { tipo: 'estilo', resumen: 'x', criterios: [] }, build, seguridad: ok, ux: ok, ui: ok }, { name })
const spyRender = (impl = async () => SHOTS_2) => {
  const calls = []
  return { calls, render: async (...args) => { calls.push(args); return impl(...args) } }
}
async function run(provider, render, { id = 80 } = {}) {
  const events = []
  const result = await runFactory({ task: { id, profile: 'marketing', request: 'x' }, root: scratch(), provider, render, trace: (e) => events.push(e) })
  return { result, events }
}

test('estilo renders the candidate only after the static check: an unsafe change never reaches the renderer', async () => {
  const unsafe = spyRender()
  const refused = await run(model(UNSAFE), unsafe.render)
  assert.equal(unsafe.calls.length, 0)
  assert.notEqual(refused.result.status, 'ok')

  const safe = spyRender()
  const accepted = await run(model(FIX), safe.render)
  assert.equal(accepted.result.status, 'ok')
  assert.equal(safe.calls.length, 1)
  assert.deepEqual(safe.calls[0][1].map((f) => f.path), [CSS])
  assert.match(safe.calls[0][1][0].content, /left:12%;width:140%;/)
})

test('ux and ui receive the prompt and each labelled screenshot; every other station keeps a plain string', async () => {
  const provider = model(FIX)
  const { result } = await run(provider, spyRender().render)
  assert.equal(result.status, 'ok')
  for (const station of ['ux', 'ui']) {
    const { content } = provider.sent.find((s) => s.station === station)
    assert.ok(Array.isArray(content), station)
    assert.equal(content[0].type, 'text')
    assert.match(content[0].text, station === 'ux' ? /UX reviewer/ : /UI reviewer/)
    assert.match(content[0].text, /Screenshots of the site/)
    assert.deepEqual(content.slice(1), [
      { type: 'text', text: 'Inicio ANTES' }, { type: 'image_url', image_url: { url: png } },
      { type: 'text', text: 'Inicio DESPUÉS' }, { type: 'image_url', image_url: { url: png } },
    ])
  }
  for (const station of ['spec', 'build', 'seguridad']) {
    assert.equal(typeof provider.sent.find((s) => s.station === station).content, 'string', station)
  }
})

test('the shot count goes in the detail of the build trace', async () => {
  const { events } = await run(model(FIX), spyRender().render)
  assert.match(events.find((e) => e.station === 'build' && e.status === 'ok').detail, /src\/styles\/global\.css · 2 capturas$/)
})

test('other kinds never render and keep plain strings', async () => {
  const { render, calls } = spyRender()
  const provider = scripted({
    spec: { tipo: 'campana', resumen: 'x' },
    build: { ficheros: [{ ruta: 'content/campanas/tarea-81.json', contenido: { titulo: 'Hola', texto: 'Texto', color: 'oliva' } }] },
    seguridad: ok, ux: ok, ui: ok,
  })
  const { result } = await run(provider, render, { id: 81 })
  assert.equal(result.status, 'ok')
  assert.equal(calls.length, 0)
  assert.ok(provider.sent.every((s) => typeof s.content === 'string'))
})

test('a candidate that does not build goes back to the Builder with the tail of the error, and a fixed one goes on', async () => {
  let n = 0
  const { render, calls } = spyRender(async () => {
    if (++n === 1) throw new RenderError('la web con el cambio no se construye: Unexpected "}" in global.css', { candidate: true })
    return SHOTS_2
  })
  const provider = model(FIX)
  const { result, events } = await run(provider, render)
  assert.equal(result.status, 'ok')
  assert.equal(result.attempts, 2)
  assert.equal(calls.length, 2)
  assert.match(events.find((e) => e.station === 'build' && e.status === 'error').detail, /no se construye: Unexpected "}"/)
  const builds = provider.sent.filter((s) => s.station === 'build')
  assert.equal(builds.length, 2)
  assert.match(builds[1].content, /does not build with your change[\s\S]*Unexpected "}" in global\.css/)
  assert.equal(provider.sent.filter((s) => s.station === 'ux').length, 1, 'the reviewers only see the attempt that built')
})

test('a render that fails closes the task with a real model, and is allowed with replay (noted in the trace)', async () => {
  const broken = spyRender(async () => { throw new RenderError('no hay navegador') })
  const real = await run(model(FIX, 'openai:vision'), broken.render)
  assert.equal(real.result.status, 'failed')
  assert.match(real.events.find((e) => e.station === 'build' && e.status === 'error').detail, /^no se pudo ver la web: no hay navegador/)
  assert.ok(!real.events.some((e) => e.station === 'ux'), 'no reviewer ran')

  const request = 'el botón del hero no se ve bien'
  const events = []
  const hero = await runFactory({ task: { id: 82, profile: 'marketing', request }, root: scratch(), provider: replayProvider(), render: broken.render, trace: (e) => events.push(e) })
  assert.equal(hero.status, 'ok')
  assert.match(events.find((e) => e.station === 'build' && e.status === 'ok').detail, /sin capturas.*no hay navegador/)
})

test('the replay provider and the OpenAI-compatible one accept array content', async () => {
  const multimodal = [{ role: 'user', content: [{ type: 'text', text: 'hola' }, { type: 'image_url', image_url: { url: png } }] }]
  const answer = await replayProvider().complete({ station: 'ux', messages: multimodal, task: { kind: 'estilo', task: { request: 'x' } } })
  assert.equal(JSON.parse(answer.text).aprobado, true)

  let sent
  const fetchImpl = async (_url, init) => { sent = JSON.parse(init.body); return { ok: true, json: async () => ({ choices: [{ message: { content: '{}' } }], usage: {} }) } }
  await openAIProvider({ url: 'https://x', key: 'k', model: 'm', fetchImpl }).complete({ messages: multimodal })
  assert.deepEqual(sent.messages, multimodal)
})

test('providersFromEnv: empty review variables (unset repository variables reach Actions as "") fall back to the main model', () => {
  const env = { FACTORY_PROVIDER: 'openai', FACTORY_API_URL: 'https://main', FACTORY_API_KEY: 'k', FACTORY_MODEL: 'm', FACTORY_REVIEW_MODEL: 'vision', FACTORY_REVIEW_API_URL: '', FACTORY_REVIEW_API_KEY: '' }
  assert.equal(providersFromEnv(env).reviewProvider.name, 'openai:vision')
  assert.equal(providersFromEnv({ ...env, FACTORY_REVIEW_MODEL: '' }).reviewProvider.name, 'openai:m')
})

// --- renderSite, with the children and the server injected ---

const PNG_BYTES = Buffer.from('iVBORw0KGgo=', 'base64')
function fakeSite({ failBuild = null, timeout = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'render-root-'))
  scratches.push(root)
  mkdirSync(join(root, 'node_modules'))
  mkdirSync(join(root, 'src/styles'), { recursive: true })
  writeFileSync(join(root, 'package.json'), '{}')
  writeFileSync(join(root, CSS), 'body { color: black }\n')
  const log = []
  const run = async (command, args, { env, cwd, timeoutMs }) => {
    const entry = { command, args, env, cwd, timeoutMs }
    if (args.some((a) => a.endsWith('build-features.mjs'))) {
      entry.step = 'features'
      entry.css = readFileSync(join(cwd, CSS), 'utf8')
    } else if (args.some((a) => a.endsWith('astro.mjs'))) {
      entry.step = 'astro'
      log.push(entry)
      if (failBuild === (cwd.endsWith('/after') ? 'after' : 'before')) return { code: 1, timedOut: false, output: `${cwd}/src/styles/global.css: Unexpected "}"` }
      mkdirSync(join(cwd, 'dist'))
      writeFileSync(join(cwd, 'dist/index.html'), '<h1>x</h1>')
      return { code: 0, timedOut: false, output: '' }
    } else {
      entry.step = 'browser'
      log.push(entry)
      if (timeout) return { code: null, timedOut: true, output: '' }
      writeFileSync(args.find((a) => a.startsWith('--screenshot=')).slice('--screenshot='.length), PNG_BYTES)
      return { code: 0, timedOut: false, output: '' }
    }
    log.push(entry)
    return { code: 0, timedOut: false, output: '' }
  }
  const served = []
  const serve = async (dir) => {
    log.push({ step: 'serve', dir })
    const url = `http://127.0.0.1:${9000 + served.length}`
    const server = { url, closed: false, close: async () => { server.closed = true } }
    served.push(server)
    return server
  }
  return { root, log, run, serve, served }
}
const SECRETS = { FACTORY_API_KEY: 'sk-secret-1', GH_TOKEN: 'ghs_secret_2', FACTORY_APP_PRIVATE_KEY: 'pem-secret-3', ANTHROPIC_API_KEY: 'key-secret-4' }

test('renderSite: builds both sites, serves them, then shoots; the children get an empty environment and the scratch is removed', async () => {
  const site = fakeSite()
  const before = new Set(readdirSync(tmpdir()).filter((n) => n.startsWith('factory-render-')))
  const shots = await renderSite(site.root, [{ path: CSS, content: 'body { color: red }\n' }], { run: site.run, serve: site.serve, browser: '/usr/bin/fake-browser', env: { PATH: '/usr/bin:/bin', ...SECRETS } })

  assert.deepEqual(shots.map((s) => s.id), SHOTS.map((s) => s.id))
  assert.equal(shots.length, 6)
  for (const shot of shots) assert.equal(shot.dataUrl, `data:image/png;base64,${PNG_BYTES.toString('base64')}`)
  assert.deepEqual(shots.map((s) => s.label), SHOTS.map((s) => s.label))

  // Order: build (candidate, then current), serve both, then the six shots.
  assert.deepEqual(site.log.map((e) => e.step), ['features', 'astro', 'features', 'astro', 'serve', 'serve', ...Array(6).fill('browser')])
  const children = site.log.filter((e) => e.env)
  assert.ok(children.length >= 10)
  for (const child of children) {
    assert.deepEqual(Object.keys(child.env).sort(), ['ASTRO_TELEMETRY_DISABLED', 'HOME', 'PATH', 'TMPDIR'], 'nothing but what the child strictly needs')
    assert.equal(child.env.PATH, '/usr/bin:/bin')
    assert.match(child.env.HOME, /factory-render-/)
    for (const value of Object.values(child.env)) for (const secret of Object.values(SECRETS)) assert.ok(!value.includes(secret))
    assert.ok(child.timeoutMs > 0)
  }
  // The candidate is laid over the "after" copy only.
  const features = site.log.filter((e) => e.step === 'features')
  assert.deepEqual(features.map((f) => f.css), ['body { color: red }\n', 'body { color: black }\n'])
  assert.equal(readFileSync(join(site.root, CSS), 'utf8'), 'body { color: black }\n', 'the repository is never written')
  // The browser: the documented flags, one URL per shot, the "before" and "after" servers apart.
  const browsers = site.log.filter((e) => e.step === 'browser')
  assert.ok(browsers.every((b) => b.command === '/usr/bin/fake-browser'))
  for (const [i, b] of browsers.entries()) {
    const shot = SHOTS[i]
    for (const flag of ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--virtual-time-budget=3000', `--window-size=${shot.width},${shot.height}`]) assert.ok(b.args.includes(flag), flag)
    assert.ok(b.args.at(-1).startsWith(`http://127.0.0.1:${shot.site === 'before' ? 9000 : 9001}`) && b.args.at(-1).endsWith(shot.path), b.args.at(-1))
  }
  assert.ok(site.served.every((s) => s.closed))
  const after = readdirSync(tmpdir()).filter((n) => n.startsWith('factory-render-') && !before.has(n))
  assert.deepEqual(after, [], 'the scratch directory is gone')
})

test('renderSite: the shot list is one constant of 6 shots (home before/after, desktop and mobile; catalogue and quote after)', () => {
  assert.deepEqual(SHOTS.map((s) => [s.site, s.path, s.width, s.height]), [
    ['before', '/', 1280, 800], ['after', '/', 1280, 800], ['before', '/', 390, 844], ['after', '/', 390, 844], ['after', '/catalogo/', 1280, 800], ['after', '/presupuesto/', 1280, 800],
  ])
})

test('renderSite: no browser is a RenderError before anything is copied or built', async () => {
  const site = fakeSite()
  await assert.rejects(renderSite(site.root, [], { run: site.run, serve: site.serve, env: { PATH: '/nonexistent' } }), (e) => e instanceof RenderError && e.candidate === false && /navegador/.test(e.message))
  assert.equal(site.log.length, 0)
})

test('renderSite: a candidate that does not build is a candidate error with the error and no scratch path; a current site that does not build is not', async () => {
  const bad = fakeSite({ failBuild: 'after' })
  await assert.rejects(renderSite(bad.root, [], { run: bad.run, serve: bad.serve, browser: '/b' }), (e) => e.candidate === true && /Unexpected "}"/.test(e.message) && !e.message.includes('factory-render-'))
  assert.equal(bad.log.filter((e) => e.step === 'serve' || e.step === 'browser').length, 0)
  const current = fakeSite({ failBuild: 'before' })
  await assert.rejects(renderSite(current.root, [], { run: current.run, serve: current.serve, browser: '/b' }), (e) => e.candidate === false)
})

test('renderSite: a shot over its time limit fails, and the servers are closed', async () => {
  const site = fakeSite({ timeout: true })
  await assert.rejects(renderSite(site.root, [], { run: site.run, serve: site.serve, browser: '/b', shotTimeoutMs: 5 }), /tiempo límite/)
  assert.ok(site.served.length === 2 && site.served.every((s) => s.closed))
  assert.equal(site.log.find((e) => e.step === 'browser').timeoutMs, 5)
})

test('findBrowser: FACTORY_BROWSER first, then the first known name on the PATH', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bin-'))
  scratches.push(dir)
  for (const name of ['brave', 'chromium', 'mine']) writeFileSync(join(dir, name), '')
  assert.equal(findBrowser({ PATH: dir }), join(dir, 'chromium'))
  assert.equal(findBrowser({ PATH: dir, FACTORY_BROWSER: 'mine' }), join(dir, 'mine'))
  assert.equal(findBrowser({ PATH: dir, FACTORY_BROWSER: 'missing' }), null)
  assert.equal(findBrowser({ PATH: join(dir, 'none') }), null)
})

test('serveDir: binds 127.0.0.1 only, serves folders as index.html and never leaves its directory', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'serve-'))
  scratches.push(dir)
  mkdirSync(join(dir, 'dist/catalogo'), { recursive: true })
  writeFileSync(join(dir, 'secret.txt'), 'no')
  writeFileSync(join(dir, 'dist/index.html'), 'home')
  writeFileSync(join(dir, 'dist/catalogo/index.html'), 'catalogo')
  const server = await serveDir(join(dir, 'dist'))
  try {
    assert.match(server.url, /^http:\/\/127\.0\.0\.1:\d+$/)
    assert.equal(await (await fetch(`${server.url}/`)).text(), 'home')
    assert.equal(await (await fetch(`${server.url}/catalogo/`)).text(), 'catalogo')
    assert.equal((await fetch(`${server.url}/%2e%2e/secret.txt`)).status, 404)
    assert.equal((await fetch(`${server.url}/nada`)).status, 404)
  } finally {
    await server.close()
  }
})

// --- One real render: builds the site and takes a screenshot ---

// Not every browser on the PATH can take a screenshot from the command line (Brave opens its UI and never writes the file):
// a quick probe decides whether the real render can run here.
async function usableBrowser() {
  const found = findBrowser()
  if (!found) return { skip: 'no headless browser on the PATH (set FACTORY_BROWSER)' }
  const dir = mkdtempSync(join(tmpdir(), 'probe-'))
  scratches.push(dir)
  writeFileSync(join(dir, 'index.html'), '<h1>probe</h1>')
  const file = join(dir, 'probe.png')
  const { spawnSync } = await import('node:child_process')
  spawnSync(found, ['--headless=new', '--disable-gpu', `--user-data-dir=${join(dir, 'profile')}`, `--screenshot=${file}`, `file://${join(dir, 'index.html')}`], { env: { PATH: process.env.PATH, HOME: dir }, timeout: 10000, killSignal: 'SIGKILL' })
  return existsSync(file) ? { skip: false } : { skip: `${found} cannot take a screenshot from the command line (set FACTORY_BROWSER to Chrome or Chromium)` }
}
const { skip } = await usableBrowser()
test('renderSite (real): builds the site with a candidate and takes the screenshots as PNGs', { skip, timeout: 600000 }, async () => {
  const css = read(CSS).replace('.hero__disco{position:absolute;top:50%;left:12%;width:150%;', '.hero__disco{position:absolute;top:50%;left:12%;width:140%;')
  const shots = await renderSite(repo, [{ path: CSS, content: css }])
  assert.equal(shots.length, SHOTS.length)
  for (const shot of shots) {
    assert.match(shot.dataUrl, /^data:image\/png;base64,/)
    const bytes = Buffer.from(shot.dataUrl.split(',')[1], 'base64')
    assert.deepEqual([...bytes.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], `${shot.id} is a PNG`)
    assert.ok(bytes.length > 2000, `${shot.id} is not blank`)
  }
  if (process.env.RENDER_KEEP_SHOTS) {
    mkdirSync(process.env.RENDER_KEEP_SHOTS, { recursive: true })
    for (const shot of shots) writeFileSync(join(process.env.RENDER_KEEP_SHOTS, `${shot.id}.png`), Buffer.from(shot.dataUrl.split(',')[1], 'base64'))
  }
})
