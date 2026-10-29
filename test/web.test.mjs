import { hasSandbox, needsSandbox } from './sandbox-node.mjs'
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { MAX_LENGTH } from '../lib/intake.js'
import { STATIONS, STATION_LABELS, MENSAJES } from '../lib/estado.js'
import { NAV } from '../src/lib/nav.js'
import { PASOS, REVISORES } from '../src/lib/diagrama.js'
import { cargarEstado } from '../lib/estado-node.js'

const repo = new URL('..', import.meta.url).pathname
const state = cargarEstado(repo)
let out
let pages

// Builds the real Astro site once into a scratch directory (inside the repo, since Astro renames
// its cache into outDir and that fails across devices; .test-dist-* is gitignored and removed afterwards); every test reads the generated HTML.
before(() => {
  if (!hasSandbox) return // the build needs the sandbox; the tests below are skipped on such a Node
  out = mkdtempSync(join(repo, '.test-dist-'))
  // The pages read the feature registry that `npm run build` generates first.
  const features = spawnSync(process.execPath, [join(repo, 'scripts/build-features.mjs')], { cwd: repo, encoding: 'utf8' })
  assert.equal(features.status, 0, features.stdout + features.stderr)
  const build = spawnSync(join(repo, 'node_modules/.bin/astro'), ['build', '--outDir', out], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, TURNSTILE_SITE_KEY: 'sitekey-de-prueba', ASTRO_TELEMETRY_DISABLED: '1' },
  })
  assert.equal(build.status, 0, build.stdout + build.stderr)
  const read = (path) => readFileSync(join(out, path), 'utf8')
  pages = { home: read('index.html'), catalogo: read('catalogo/index.html'), presupuesto: read('presupuesto/index.html'), tarea: read('tarea/index.html'), factory: read('factory/index.html') }
})

after(() => out && rmSync(out, { recursive: true, force: true }))

// Astro inlines small scripts into the page and emits bigger ones as _astro/*.js: look at both.
const clientCode = (html) =>
  html + (existsSync(join(out, '_astro')) ? readdirSync(join(out, '_astro')) : []).filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(out, '_astro', f), 'utf8')).join('\n')

const campaigns = () =>
  readdirSync(join(repo, 'content/campanas')).map((n) => JSON.parse(readFileSync(join(repo, 'content/campanas', n), 'utf8')))

needsSandbox('home lists every campaign with its colour class and call to action', () => {
  for (const c of campaigns()) {
    assert.ok(pages.home.includes(c.titulo), c.titulo)
    assert.match(pages.home, new RegExp(`campana--${c.color}`))
    if (c.cta) assert.ok(pages.home.includes(c.cta), c.cta)
  }
})

needsSandbox('the request form allows exactly the characters the intake accepts and lets nobody choose a profile', () => {
  assert.match(pages.home, new RegExp(`<textarea[^>]*maxlength="${MAX_LENGTH}"`))
  assert.doesNotMatch(pages.home, /name="perfil"/)
  assert.match(pages.home, /Pídele un cambio a LIMONIA/)
  assert.match(pages.home, /al azar/)
})

needsSandbox('the site copy names the three profiles, and the follow-up page shows the kind the spec writer gave the request', () => {
  assert.match(pages.home, /Marketing, Producto o Negocio/)
  assert.doesNotMatch(pages.home, /Desarrollo/)
  assert.match(clientCode(pages.tarea), /\.tipo\b/, 'the kind of the request (campana, precios, bug, feature...)')
})

needsSandbox('features written by the factory are painted by one generic component on their page, as escaped text', () => {
  assert.match(pages.catalogo, /<section[^>]*data-feature="ordenar-catalogo"/)
  assert.match(pages.catalogo, /<h2[^>]*>Del más barato al más caro<\/h2>/)
  assert.match(pages.catalogo, /<li><span>[^<]+<\/span><strong>\d+,\d\d €\/kg<\/strong><\/li>/)
  assert.doesNotMatch(pages.home, /data-feature="ordenar-catalogo"/)
  assert.doesNotMatch(pages.presupuesto, /data-feature="ordenar-catalogo"/)
})

needsSandbox('the Turnstile site key is read at build time', () => {
  assert.match(pages.home, /data-sitekey="sitekey-de-prueba"/)
})

needsSandbox('the form posts to the intake endpoint and links to the task page', () => {
  const bundle = clientCode(pages.home)
  assert.ok(bundle.includes('/api/peticion'))
  assert.ok(bundle.includes('/tarea/?n='))
  assert.ok(bundle.includes('Te ha tocado pedirlo como'))
})

needsSandbox('the catalogue shows a price for priced products and "Precio a consultar" for the rest', () => {
  const unpriced = Object.keys(state.productos).filter((id) => !(id in state.precios))
  assert.ok(unpriced.length > 0, 'the sample data should include a product without price')
  const card = (id) => pages.catalogo.match(new RegExp(`id="producto-${id}"[\\s\\S]*?</article>`))[0]
  for (const id of unpriced) assert.match(card(id), /Precio a consultar/)
  const priced = Object.keys(state.precios)[0]
  assert.doesNotMatch(card(priced), /Precio a consultar/)
  assert.match(card(priced), /\d,\d\d\s€/)
  for (const p of Object.values(state.productos)) assert.ok(pages.catalogo.includes(p.nombre), p.nombre)
})

needsSandbox('the catalogue lists every destination with its transit days', () => {
  for (const d of Object.values(state.destinos)) {
    assert.ok(pages.catalogo.includes(d.ciudad), d.ciudad)
    assert.ok(pages.catalogo.includes(`${d.diasTransito} días`) || pages.catalogo.includes(`${d.diasTransito} día `))
  }
})

needsSandbox('the quote page embeds the build-time state and ships the domain module', () => {
  const attr = pages.presupuesto.match(/data-estado="([^"]*)"/)[1].replaceAll('&#34;', '"').replaceAll('&quot;', '"')
  assert.deepEqual(JSON.parse(attr), JSON.parse(JSON.stringify(state)))
  const bundle = clientCode(pages.presupuesto)
  assert.ok(bundle.includes('Los kilos deben ser un número entero entre 1 y 100.000'))
  assert.match(pages.presupuesto, /Transporte/)
})

needsSandbox('the quote calculator only offers products that can be priced', () => {
  const select = pages.presupuesto.match(/<select class="linea__producto">([\s\S]*?)<\/select>/)[1]
  for (const [id, p] of Object.entries(state.productos)) {
    const offered = select.includes(`value="${id}"`)
    assert.equal(offered, p.disponible && id in state.precios, id)
  }
})

needsSandbox('every page has the navigation, with the factory board enabled', () => {
  assert.equal(NAV.some((item) => item.pronto), false)
  for (const html of Object.values(pages)) {
    assert.match(html, /href="\/catalogo\/"/)
    assert.match(html, /href="\/presupuesto\/"/)
    assert.match(html, /href="\/factory\/"/)
    assert.doesNotMatch(html, /<small>pronto<\/small>/)
  }
})

needsSandbox('the form remembers the submitted task numbers (max 20) and links to the follow-up page', () => {
  const bundle = clientCode(pages.home)
  assert.ok(bundle.includes('limonia:tareas'))
  assert.ok(bundle.includes('Sigue tu petición'))
  assert.ok(bundle.includes('Recibida: tarea #'), 'the existing success sentence stays')
  assert.match(bundle, /slice\(-?20|MAX_GUARDADAS|20/)
})

needsSandbox('the home lists "Tus peticiones" from localStorage, with a link to each task', () => {
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

needsSandbox('/tarea/ draws the factory scheme as a stepper and polls the status API for one task', () => {
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

const ESTACIONES_TABLERO = ['Entrada', 'Spec writer', 'Builder', 'Seguridad', 'UX', 'UI', 'Código', 'Approver', '¿Humano?', 'Main o PR', 'Producción']

needsSandbox('/factory/ is the control room: 11 station headers in order, grouped, with the legend, counters, follow form, gate and queue', () => {
  const html = pages.factory
  const cabecera = html.match(/<div class="cab-t"[^>]*>([\s\S]*?)<\/div>\s*<ol class="filas"/)?.[1] ?? ''
  const cabeceras = [...cabecera.matchAll(/<div class="h">([^<]+)<\/div>/g)].map((m) => m[1])
  assert.deepEqual(cabeceras, ESTACIONES_TABLERO, 'the 11 station headers, in order, with their literal names')
  assert.match(html, />Revisión en paralelo</)
  assert.match(html, />Puerta de riesgo</)
  assert.match(html, />Preparación</)
  assert.match(html, /class="cabecera"/, 'the site header')
  assert.match(html, /<a class="marca"/)
  assert.doesNotMatch(html, /tema-charla|Chivo/)
  assert.match(html, /<ol class="filas"[^>]*id="filas"/, 'the rows are drawn by the client script')
  assert.match(html, /<form[^>]*id="sigue"/)
  assert.match(html, /<label for="sigue-n">Sigue tu petición #<\/label>/)
  assert.match(html, /<input[^>]*name="n"[^>]*inputmode="numeric"/)
  for (const [id, label] of [['peticiones', 'Peticiones'], ['desplegadas', 'En producción'], ['esperando', 'Esperando'], ['rechazadas', 'Rechazadas']]) {
    assert.match(html, new RegExp(`data-total="${id}"[^>]*>0</dd><dt>${label}</dt>`), label)
  }
  assert.match(html, /data-puerta="auto"/)
  assert.match(html, /data-puerta="persona"/)
  assert.match(html, /Automático/)
  assert.match(html, /Una persona/)
  assert.match(html, /<h2[^>]*>Esperando a una persona<\/h2>/)
  assert.match(html, /id="cola"/)
  assert.match(html, /Nadie espera ahora mismo/)
  for (const leyenda of ['Ok', 'En curso', 'Rechazada', 'Pendiente']) assert.ok(html.includes(`</b>${leyenda}</span>`), `legend: ${leyenda}`)
  for (const simbolo of ['✓', '●', '!', '–']) assert.ok(html.includes(`>${simbolo}</b>`), `legend symbol: ${simbolo}`)
})

needsSandbox('/factory/ polls /api/estado every 5 s, keeps the demo mode and paints every text with textContent', () => {
  const bundle = clientCode(pages.factory)
  const entry = [...pages.factory.matchAll(/<script type="module" src="(\/_astro\/[^"]+)"/g)].map((m) => readFileSync(join(out, m[1]), 'utf8')).join('\n')
  assert.ok(entry.includes('/api/estado') || bundle.includes('/api/estado'))
  assert.doesNotMatch(entry + pages.factory, /api\/estado\?tarea/, 'the board reads the whole list')
  assert.match(bundle, /5e3|5000/)
  assert.match(bundle, /get\(["'`]demo["'`]\)/)
  assert.match(bundle, /textContent/)
  assert.doesNotMatch(bundle, /innerHTML|insertAdjacentHTML|outerHTML/)
  assert.match(bundle, /3e4|30000/, 'a rejection stays 30 s')
  assert.match(bundle, /bloqueadas_tests/)
})

needsSandbox('the demo mode (?demo=1) is built in, driven by a fake sequence, and only switched on by the parameter', () => {
  for (const html of [pages.factory, pages.tarea]) {
    const bundle = clientCode(html)
    assert.match(bundle, /demo/)
    assert.match(bundle, /get\(["'`]demo["'`]\)/)
  }
})

needsSandbox('the stations of the pages are the ones of the factory', () => {
  assert.deepEqual(Object.keys(STATION_LABELS), STATIONS)
})

needsSandbox('"bloqueada_tests" is a final state on /tarea/ and counts with the rejected ones on /factory/', () => {
  assert.match(clientCode(pages.tarea), /\[[^\]]*['"`]bloqueada_tests['"`][^\]]*\]/, 'listed among the final states')
  assert.match(clientCode(pages.factory), /bloqueadas_tests/)
})
