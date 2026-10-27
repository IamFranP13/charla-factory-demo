import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { MAX_LENGTH } from '../lib/intake.js'
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
  pages = { home: read('index.html'), catalogo: read('catalogo/index.html'), presupuesto: read('presupuesto/index.html') }
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

test('every page has the navigation with a disabled slot for the factory', () => {
  for (const html of Object.values(pages)) {
    assert.match(html, /href="\/catalogo\/"/)
    assert.match(html, /href="\/presupuesto\/"/)
    assert.match(html, /Factory <small>pronto<\/small>/)
  }
})
