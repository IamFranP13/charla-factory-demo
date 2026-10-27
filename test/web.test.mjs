import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { MAX_LENGTH } from '../lib/intake.js'
import { STATIONS, STATION_LABELS, MENSAJES } from '../lib/estado.js'
import { NAV } from '../src/lib/nav.js'
import { PASOS, REVISORES } from '../src/lib/diagrama.js'
import { cargarEstado } from '../src/domain/estado-node.js'

const repo = new URL('..', import.meta.url).pathname
const state = cargarEstado(repo)
let out
let pages

// Builds the real Astro site once into a scratch directory (inside the repo, since Astro renames
// its cache into outDir and that fails across devices; .test-dist-* is gitignored and removed afterwards); every test reads the generated HTML.
before(() => {
  out = mkdtempSync(join(repo, '.test-dist-'))
  const build = spawnSync(join(repo, 'node_modules/.bin/astro'), ['build', '--outDir', out], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, TURNSTILE_SITE_KEY: 'sitekey-de-prueba', ASTRO_TELEMETRY_DISABLED: '1' },
  })
  assert.equal(build.status, 0, build.stdout + build.stderr)
  const read = (path) => readFileSync(join(out, path), 'utf8')
  pages = { home: read('index.html'), catalogo: read('catalogo/index.html'), presupuesto: read('presupuesto/index.html'), tarea: read('tarea/index.html'), factory: read('factory/index.html') }
})

after(() => rmSync(out, { recursive: true, force: true }))

// Astro inlines small scripts into the page and emits bigger ones as _astro/*.js: look at both.
const clientCode = (html) =>
  html + (existsSync(join(out, '_astro')) ? readdirSync(join(out, '_astro')) : []).filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(out, '_astro', f), 'utf8')).join('\n')

const campaigns = () =>
  readdirSync(join(repo, 'content/campanas')).map((n) => JSON.parse(readFileSync(join(repo, 'content/campanas', n), 'utf8')))

test('home lists every campaign with its colour class and call to action', () => {
  for (const c of campaigns()) {
    assert.ok(pages.home.includes(c.titulo), c.titulo)
    assert.match(pages.home, new RegExp(`campana--${c.color}`))
    if (c.cta) assert.ok(pages.home.includes(c.cta), c.cta)
  }
})

test('the request form allows exactly the characters the intake accepts and lets nobody choose a profile', () => {
  assert.match(pages.home, new RegExp(`<textarea[^>]*maxlength="${MAX_LENGTH}"`))
  assert.doesNotMatch(pages.home, /name="perfil"/)
  assert.match(pages.home, /Pídele un cambio a LIMONIA/)
  assert.match(pages.home, /al azar/)
})

test('the Turnstile site key is read at build time', () => {
  assert.match(pages.home, /data-sitekey="sitekey-de-prueba"/)
})

test('the form posts to the intake endpoint and links to the task page', () => {
  const bundle = clientCode(pages.home)
  assert.ok(bundle.includes('/api/peticion'))
  assert.ok(bundle.includes('/tarea/?n='))
  assert.ok(bundle.includes('Te ha tocado pedirlo como'))
})

test('the catalogue shows a price for priced products and "Precio a consultar" for the rest', () => {
  const unpriced = Object.keys(state.productos).filter((id) => !(id in state.precios))
  assert.ok(unpriced.length > 0, 'the sample data should include a product without price')
  const card = (id) => pages.catalogo.match(new RegExp(`id="producto-${id}"[\\s\\S]*?</article>`))[0]
  for (const id of unpriced) assert.match(card(id), /Precio a consultar/)
  const priced = Object.keys(state.precios)[0]
  assert.doesNotMatch(card(priced), /Precio a consultar/)
  assert.match(card(priced), /\d,\d\d\s€/)
  for (const p of Object.values(state.productos)) assert.ok(pages.catalogo.includes(p.nombre), p.nombre)
})

test('the catalogue lists every destination with its transit days', () => {
  for (const d of Object.values(state.destinos)) {
    assert.ok(pages.catalogo.includes(d.ciudad), d.ciudad)
    assert.ok(pages.catalogo.includes(`${d.diasTransito} días`) || pages.catalogo.includes(`${d.diasTransito} día `))
  }
})

test('the quote page embeds the build-time state and ships the domain module', () => {
  const attr = pages.presupuesto.match(/data-estado="([^"]*)"/)[1].replaceAll('&#34;', '"').replaceAll('&quot;', '"')
  assert.deepEqual(JSON.parse(attr), JSON.parse(JSON.stringify(state)))
  const bundle = clientCode(pages.presupuesto)
  assert.ok(bundle.includes('Los kilos deben ser un número entero entre 1 y 100.000'))
  assert.match(pages.presupuesto, /Transporte/)
})

test('the quote calculator only offers products that can be priced', () => {
  const select = pages.presupuesto.match(/<select class="linea__producto">([\s\S]*?)<\/select>/)[1]
  for (const [id, p] of Object.entries(state.productos)) {
    const offered = select.includes(`value="${id}"`)
    assert.equal(offered, p.disponible && id in state.precios, id)
  }
})

test('every page has the navigation, with the factory board enabled', () => {
  assert.equal(NAV.some((item) => item.pronto), false)
  for (const html of Object.values(pages)) {
    assert.match(html, /href="\/catalogo\/"/)
    assert.match(html, /href="\/presupuesto\/"/)
    assert.match(html, /href="\/factory\/"/)
    assert.doesNotMatch(html, /<small>pronto<\/small>/)
  }
})

test('the form remembers the submitted task numbers (max 20) and links to the follow-up page', () => {
  const bundle = clientCode(pages.home)
  assert.ok(bundle.includes('limonia:tareas'))
  assert.ok(bundle.includes('Sigue tu petición'))
  assert.ok(bundle.includes('Recibida: tarea #'), 'the existing success sentence stays')
  assert.match(bundle, /slice\(-?20|MAX_GUARDADAS|20/)
})

test('the home lists "Tus peticiones" from localStorage, with a link to each task', () => {
  assert.match(pages.home, /Tus peticiones/)
  assert.match(pages.home, /id="mis-peticiones"/)
  const bundle = clientCode(pages.home)
  assert.ok(bundle.includes('limonia:tareas'))
  assert.ok(bundle.includes('/tarea/?n='))
})

// Both factory pages draw the same scheme as a stepper, in the styles of the rest of the site (Base layout).
function assertScheme(html, name) {
  for (const paso of PASOS) {
    assert.ok(html.includes(`data-paso="${paso.id}"`), `${name}: step ${paso.id}`)
    assert.ok(html.includes(`>${paso.label}<`), `${name}: label ${paso.label}`)
  }
  for (const label of ['Entrada', 'Spec writer', 'Builder', 'Seguridad', 'UX', 'UI', 'Código', 'Approver', '¿Humano?', 'Main o PR', 'Producción']) assert.ok(html.includes(`>${label}<`), `${name}: ${label}`)
  for (const id of REVISORES) assert.ok(html.includes(`data-revisor="${id}"`), `${name}: reviewer ${id}`)
  assert.match(html, /Brain/, `${name}: the note that points to the Brain`)
  assert.match(html, /class="cabecera"/, `${name}: the site header`)
  assert.match(html, /<a class="marca"/, `${name}: the LIMONIA brand`)
  assert.doesNotMatch(html, /tema-charla|Chivo/, `${name}: not the talk's theme`)
  assert.match(html, /href="\/factory\/"/)
}

test('/tarea/ draws the factory scheme as a stepper and polls the status API for one task', () => {
  const bundle = clientCode(pages.tarea)
  assertScheme(pages.tarea, '/tarea/')
  assert.ok(bundle.includes('/api/estado?tarea='))
  assert.match(bundle, /5e3|5000/)
  for (const message of Object.values(MENSAJES)) assert.ok(bundle.includes(message), message)
  for (const status of ['pendiente', 'en_curso', 'ok', 'rechazada', 'error']) assert.ok(bundle.includes(status), status)
  for (const label of ['NO HACE FALTA', 'ESPERANDO A UNA PERSONA']) assert.ok(bundle.includes(label) || pages.tarea.includes(label), label)
  assert.match(pages.tarea, /viewport/)
  assert.match(bundle, /textContent|replaceChildren/)
  assert.doesNotMatch(bundle, /innerHTML/)
})

test('/factory/ draws the stepper with counters and task chips, the queue and the totals, polling every 5 s', () => {
  const bundle = clientCode(pages.factory)
  assertScheme(pages.factory, '/factory/')
  assert.match(pages.factory, /data-fichas/, 'every step has room for the task chips')
  assert.ok(bundle.includes('/api/estado'))
  const entry = [...pages.factory.matchAll(/<script type="module" src="(\/_astro\/[^"]+)"/g)].map((m) => readFileSync(join(out, m[1]), 'utf8')).join('\n')
  assert.ok(entry.includes('/api/estado'))
  assert.doesNotMatch(entry, /api\/estado\?tarea/, 'the board reads the whole list')
  assert.match(bundle, /5e3|5000/)
  assert.match(pages.factory, /Esperando a una persona/i)
  assert.match(pages.factory, /Sigue tu petición/)
  assert.match(pages.factory, /<input[^>]*name="n"/)
  for (const total of ['Peticiones', 'En producción', 'Esperando', 'Rechazadas']) assert.match(pages.factory, new RegExp(total))
  assert.doesNotMatch(bundle, /innerHTML/)
})

test('the demo mode (?demo=1) is built in, driven by a fake sequence, and only switched on by the parameter', () => {
  for (const html of [pages.factory, pages.tarea]) {
    const bundle = clientCode(html)
    assert.match(bundle, /demo/)
    assert.match(bundle, /get\(["'`]demo["'`]\)/)
  }
})

test('the stations of the pages are the ones of the factory', () => {
  assert.deepEqual(Object.keys(STATION_LABELS), STATIONS)
})
