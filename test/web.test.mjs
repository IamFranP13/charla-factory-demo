import { hasSandbox, needsSandbox } from './sandbox-node.mjs'
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { MAX_LENGTH } from '../lib/intake.js'
import { STATIONS, STATION_LABELS, MENSAJES } from '../lib/estado.js'
import { NAV } from '../src/lib/nav.js'
import { cargarEstado } from '../lib/estado-node.js'
import { checkEstilo } from '../lib/estilo.js'
import { ESTACIONES, QUIEN, RECORRIDO } from '../src/lib/explica.js'

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
  pages = { home: read('index.html'), catalogo: read('catalogo/index.html'), presupuesto: read('presupuesto/index.html'), tarea: read('tarea/index.html'), factory: read('factory/index.html'), pide: read('pide/index.html') }
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

needsSandbox('/pide/ is the page for asking: the requester chooses one of the three profiles (required radios), then writes the request', () => {
  const html = pages.pide
  assert.match(html, new RegExp(`<textarea[^>]*maxlength="${MAX_LENGTH}"`))
  assert.match(html, /<h1[^>]*>Pide un cambio<\/h1>/)
  assert.match(html, /id="peticion"/)
  assert.doesNotMatch(html, /al azar|Te ha tocado/)
  for (const [clave, nombre] of [['marketing', 'Marketing'], ['producto', 'Producto'], ['negocio', 'Negocio']]) {
    assert.match(html, new RegExp(`<label[^>]*>\\s*<input[^>]*type="radio"[^>]*name="perfil"[^>]*value="${clave}"[^>]*required|<label[^>]*>\\s*<input[^>]*name="perfil"[^>]*value="${clave}"[^>]*required`), clave)
    assert.ok(html.includes(nombre), nombre)
  }
  assert.equal((html.match(/name="perfil"/g) ?? []).length, 3)
  assert.match(html, /crear campañas/)
  assert.match(html, /añadir productos/)
  assert.match(html, /cambiar precios/)
  assert.match(html, /id="mis-peticiones"/)
  assert.match(html, /Tus peticiones/)
  assert.match(clientCode(html), /perfil:/, 'the body carries the profile')
})

needsSandbox('/factory/ is only the board: no request form, no Turnstile, no "Tus peticiones"', () => {
  assert.doesNotMatch(pages.factory, /<textarea|id="peticion"|id="pide"|cf-turnstile|challenges\.cloudflare\.com|Tus peticiones|mis-peticiones|name="perfil"/)
  assert.match(pages.factory, /href="\/pide\/"/)
})

needsSandbox('the home has no request form: it points to /pide/ (S11)', () => {
  assert.doesNotMatch(pages.home, /<textarea|<form|id="peticion"|cf-turnstile|challenges\.cloudflare\.com|Tus peticiones|mis-peticiones/)
  assert.match(pages.home, /href="\/pide\/"/)
  assert.match(pages.home, /href="\/factory\/"/)
  assert.doesNotMatch(pages.home, /name="perfil"/)
})

needsSandbox('the site copy names the three profiles, and the follow-up page shows the kind the spec writer gave the request', () => {
  assert.match(pages.pide, /Marketing/)
  assert.match(pages.pide, /Producto/)
  assert.match(pages.pide, /Negocio/)
  assert.doesNotMatch(pages.pide, /Desarrollo/)
  assert.doesNotMatch(pages.home, /Marketing, Producto o Negocio/)
  assert.match(clientCode(pages.tarea), /\.tipo\b/, 'the kind of the request (campana, precios, bug, feature...)')
})

needsSandbox('features written by the factory are painted by one generic component on their page, as escaped text', () => {
  assert.match(pages.catalogo, /<section[^>]*data-feature="ordenar-catalogo"/)
  assert.match(pages.catalogo, /<h2[^>]*>Del más barato al más caro<\/h2>/)
  assert.match(pages.catalogo, /<li><span>[^<]+<\/span><strong>\d+,\d\d €\/kg<\/strong><\/li>/)
  assert.doesNotMatch(pages.home, /data-feature="ordenar-catalogo"/)
  assert.doesNotMatch(pages.presupuesto, /data-feature="ordenar-catalogo"/)
})

needsSandbox('the Turnstile site key is read at build time, and its script is only on /pide/', () => {
  assert.match(pages.pide, /data-sitekey="sitekey-de-prueba"/)
  assert.match(pages.pide, /<script[^>]*src="https:\/\/challenges\.cloudflare\.com\/turnstile\/v0\/api\.js"/)
  for (const nombre of ['home', 'catalogo', 'presupuesto', 'tarea', 'factory']) assert.doesNotMatch(pages[nombre], /turnstile/i, nombre)
})

needsSandbox('the form posts to the intake endpoint and links to the task page', () => {
  const bundle = clientCode(pages.pide)
  assert.ok(bundle.includes('/api/peticion'))
  assert.ok(bundle.includes('/tarea/?n='))
  assert.ok(bundle.includes('pedida como'))
  assert.ok(!bundle.includes('Te ha tocado'))
})

needsSandbox('the catalogue shows a price for priced products and "Precio a consultar" for the rest', () => {
  const unpriced = Object.keys(state.productos).filter((id) => !(id in state.precios))
  assert.ok(unpriced.length > 0, 'the sample data should include a product without price')
  const card = (id) => pages.catalogo.match(new RegExp(`id="producto-${id}"[\\s\\S]*?</li>`))[0]
  for (const id of unpriced) assert.match(card(id), /Precio a consultar/)
  const priced = Object.keys(state.precios)[0]
  assert.doesNotMatch(card(priced), /Precio a consultar/)
  assert.match(card(priced), /\d,\d\d\s€/)
  for (const p of Object.values(state.productos)) assert.ok(pages.catalogo.includes(p.nombre), p.nombre)
})

needsSandbox('the catalogue lists every destination with its transit days', () => {
  for (const [id, d] of Object.entries(state.destinos)) {
    const item = pages.catalogo.match(new RegExp(`id="destino-${id}"[\\s\\S]*?</li>`))?.[0] ?? ''
    assert.ok(item.includes(d.ciudad), d.ciudad)
    assert.match(item, new RegExp(`<strong>${d.diasTransito}</strong><small>${d.diasTransito === 1 ? 'día' : 'días'}</small>`), `${d.ciudad}: days`)
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
  const bundle = clientCode(pages.factory)
  assert.ok(bundle.includes('limonia:tareas'))
  assert.ok(bundle.includes('Sigue tu petición'))
  assert.ok(bundle.includes('Recibida: tarea #'), 'the existing success sentence stays')
  assert.match(bundle, /slice\(-?20|MAX_GUARDADAS|20/)
})

needsSandbox('/pide/ lists "Tus peticiones" from localStorage, with a link to each task', () => {
  assert.match(pages.pide, /Tus peticiones/)
  assert.match(pages.pide, /id="mis-peticiones"/)
  const bundle = clientCode(pages.pide)
  assert.ok(bundle.includes('limonia:tareas'))
  assert.ok(bundle.includes('/tarea/?n='))
})

// /tarea/ (artboard 02, "ahora y tira"): a strip of seven segments, one big "ahora" card, the four reviewers as separate items
// and the final messages; mobile first, in the styles of the rest of the site.
const SEGMENTOS_TAREA = [['entrada', 'Entrada'], ['agente', 'Agente'], ['revision', 'Revisión'], ['approver', 'Approver'], ['puerta', 'Puerta'], ['merge', 'Main o PR'], ['produccion', 'Producción']]

needsSandbox('/tarea/ is the "ahora" card over a strip of seven segments and polls the status API for one task', () => {
  const bundle = clientCode(pages.tarea)
  const html = pages.tarea
  const tira = html.match(/<ol[^>]*data-tira[^>]*>[\s\S]*?<\/ol>/)?.[0] ?? ''
  assert.ok(tira, 'the strip')
  assert.equal([...tira.matchAll(/<li[^>]*data-seg="/g)].length, 7, 'seven segments')
  for (const [id, label] of SEGMENTOS_TAREA) {
    assert.match(tira, new RegExp(`data-seg="${id}"`), `strip: ${id}`)
    assert.ok(bundle.includes(label), `label ${label}`)
  }
  assert.ok(html.indexOf('data-seg="entrada"') < html.indexOf('data-seg="produccion"'))
  assert.match(html, /<section[^>]*data-ahora[^>]*role="status"/, 'the card announces its changes')
  assert.match(html, /<ul[^>]*data-acciones/, 'the agent\'s last actions')
  assert.match(html, /<ul[^>]*data-revisores/, 'the four reviewers')
  assert.match(html, /<details[^>]*data-todos/, 'the seven steps, folded')
  assert.match(html, /data-vivo/, 'the live light and the age of the last read')
  assert.match(html, /class="cabecera"/, 'the site header')
  assert.match(html, /<a class="marca"/, 'the LIMONIA brand')
  assert.doesNotMatch(html, /tema-charla|Chivo/, 'not the talk theme')
  assert.match(html, /href="\/factory\/"/)
  assert.match(html, /viewport/)
  assert.ok(bundle.includes('/api/estado?tarea='))
  assert.match(bundle, /5e3|5000/, 'the polling budget')
  for (const message of Object.values(MENSAJES)) assert.ok(bundle.includes(message) || html.includes(message), message)
  for (const status of ['pendiente', 'en_curso', 'ok', 'rechazada', 'error']) assert.ok(bundle.includes(status), status)
  for (const text of ['La puerta revisa qué toca el cambio', 'Fusionando en main', 'Publicando en la web', 'Sin conexión con la factory', 'Terminada']) assert.ok(bundle.includes(text), text)
})

needsSandbox('/tarea/ paints what the factory wrote as text only, and its markers are drawn on the server (no external asset)', () => {
  const bundle = clientCode(pages.tarea)
  assert.match(bundle, /textContent|replaceChildren/)
  assert.doesNotMatch(bundle, /innerHTML|insertAdjacentHTML|outerHTML|document\.write|createContextualFragment/)
  for (const tipo of ['lee', 'edita', 'escribe', 'busca', 'comando', 'empieza']) assert.match(pages.tarea, new RegExp(`data-icono="${tipo}"`), `icon: ${tipo}`)
  for (const id of ['seguridad', 'ux', 'ui', 'codigo']) assert.match(pages.tarea, new RegExp(`data-revisor="${id}"`), `reviewer ${id}`)
  const page = pages.tarea.replace(/<script[\s\S]*?<\/script>/g, '')
  assert.doesNotMatch(page, /<(img|link|iframe|object|embed)\b[^>]*(src|href)="https?:/i, 'no external asset')
})

const ESTACIONES_TABLERO = ['Entrada', 'Spec writer', 'Builder', 'Seguridad', 'UX', 'UI', 'Código', 'Approver', '¿Humano?', 'Main o PR', 'Producción']
// The two layouts of the diagram are drawn on the server: a horizontal one (wide screens) and a vertical one.
const capa = (html, c) => html.match(new RegExp(`<div class="stage stage--${c}"[\\s\\S]*?(?=<div class="stage stage--|<div class="fd-leyenda")`))?.[0] ?? ''

needsSandbox('/factory/ is a flow diagram drawn on the server: the stations, the gate with AUTO and PERSONA, the dashed loop and Rechazadas', () => {
  const html = pages.factory
  for (const c of ['h', 'v']) {
    const svg = capa(html, c)
    assert.ok(svg, `layout ${c}`)
    const nombres = [...svg.matchAll(/<text class="n-nombre[^"]*"[^>]*>([^<]+)<\/text>/g)].map((m) => m[1])
    for (const nombre of ESTACIONES_TABLERO.filter((n) => n !== 'Main o PR')) assert.ok(nombres.includes(nombre), `${c}: station ${nombre}`)
    for (const nodo of ['Main', 'PR', 'Rechazadas']) assert.ok(nombres.includes(nodo), `${c}: node ${nodo}`)
    assert.match(svg, /<polygon class="n-forma dec"/, `${c}: the gate is a diamond`)
    assert.match(svg, /data-etiqueta="e-auto"[^>]*>[\s\S]*?<text[^>]*>AUTO<\/text>/, `${c}: AUTO edge`)
    assert.match(svg, /data-etiqueta="e-per"[^>]*>[\s\S]*?<text[^>]*>PERSONA<\/text>/, `${c}: PERSONA edge`)
    assert.match(svg, /class="e-base vuelta"/, `${c}: the dashed loop back to Build`)
    assert.match(svg, /data-etiqueta="e-vuelta"/, `${c}: the loop is labelled`)
    assert.match(svg, /data-nodo-g="rechazadas"/, `${c}: the Rechazadas terminal`)
    assert.match(svg, /REVISIÓN EN PARALELO/, `${c}: the parallel review frame`)
    for (const id of ['entrada', 'spec', 'build', 'seguridad', 'ux', 'ui', 'codigo', 'approver', 'puerta', 'main', 'pr', 'produccion', 'rechazadas']) {
      assert.match(svg, new RegExp(`<button class="nodo-btn" type="button" data-nodo="${id}" aria-label="Estación [^"]+"`), `${c}: a button for ${id}`)
    }
    assert.match(svg, /<title id="svg-t-/)
  }
  assert.match(capa(html, 'h'), /VUELVE A BUILD · SOLO 1 VEZ/)
  assert.match(html, /class="cabecera"/, 'the site header')
  assert.match(html, /<a class="marca"/)
  assert.doesNotMatch(html, /tema-charla|Chivo/)
  assert.doesNotMatch(html, /class="tk[ "]/, 'the tokens are created by the script, the diagram itself is complete without it')
})

needsSandbox('/factory/ says in every box of both layouts who does it and what it does, with the same texts as the panel', () => {
  for (const c of ['h', 'v']) {
    const svg = capa(pages.factory, c)
    for (const [id, e] of Object.entries(ESTACIONES)) {
      const nodo = svg.match(new RegExp(`<g class="nodo[^"]*" data-nodo-g="${id}">([\\s\\S]*?)</g>\\s*(?=<g class="nodo|</svg>)`))?.[1] ?? ''
      assert.ok(nodo, `${c}: node ${id}`)
      assert.match(nodo, new RegExp(`<text class="n-quien q-${e.quien}"[^>]*>${QUIEN[e.quien]}</text>`), `${c}/${id}: the word ${QUIEN[e.quien]}, not colour alone`)
      const lineas = [...(nodo.match(/<text class="n-linea"[\s\S]*?<\/text>/)?.[0] ?? '').matchAll(/<tspan[^>]*>([^<]+)<\/tspan>/g)].map((m) => m[1])
      assert.ok(lineas.length >= 1 && lineas.length <= 2, `${c}/${id}: one line in at most two rows`)
      assert.equal(lineas.join(' '), e.linea, `${c}/${id}`)
    }
    assert.match(svg, /aria-label="Estación Builder\. MODELO: Escribe solo dentro de su tipo\."/, `${c}: the button says it too`)
  }
})

needsSandbox('/factory/ has the "¿Cómo funciona?" button and the guided tour: 8 steps, one per group, written on the server', () => {
  const html = pages.factory
  assert.match(html, /<button[^>]*id="b-recorrido"[^>]*aria-haspopup="dialog"[^>]*aria-expanded="false"[^>]*>¿Cómo funciona\?<\/button>/)
  const tour = html.match(/<section class="fd-recorrido"[\s\S]*?<\/section>/)?.[0] ?? ''
  assert.match(tour, /role="dialog"[^>]*aria-modal="false"[^>]*aria-label="Recorrido por la factory"/)
  assert.ok(/ hidden/.test(tour.split('>')[0]), 'closed until it is opened')
  const pasos = [...tour.matchAll(/<li data-paso="(\d)" data-nodos="([^"]+)"[^>]*>\s*<h2>([^<]+)<\/h2>/g)]
  assert.equal(pasos.length, 8)
  assert.deepEqual(pasos.map((m) => m[3]), RECORRIDO.map((p) => p.titulo))
  assert.deepEqual(pasos.map((m) => m[2]), RECORRIDO.map((p) => p.nodos.join(' ')))
  assert.match(tour, /id="rec-n">1 de 8</)
  for (const id of ['rec-ant', 'rec-sig', 'rec-saltar', 'rec-x']) assert.match(tour, new RegExp(`id="${id}"`), id)
  for (const texto of ['Anterior', 'Siguiente', 'Saltar']) assert.ok(tour.includes(`>${texto}</button>`), texto)
  const bundle = clientCode(html)
  assert.match(bundle, /limonia:recorrido-visto/, 'it opens by itself the first time only')
  assert.match(bundle, /ArrowRight/)
  assert.match(bundle, /ArrowLeft/)
  assert.match(bundle, /rec-on/)
  assert.doesNotMatch(bundle, /innerHTML|insertAdjacentHTML|outerHTML/)
})

needsSandbox('/factory/ has the counters, the follow form, the legend, the detail panel and the queue; no prototype controls', () => {
  const html = pages.factory
  for (const [id, label] of [['peticiones', 'Peticiones'], ['desplegadas', 'En producción'], ['esperando', 'Esperando'], ['rechazadas', 'Rechazadas']]) {
    assert.match(html, new RegExp(`data-total="${id}"[^>]*>0</dd><dt>${label}</dt>`), label)
  }
  assert.match(html, /<form[^>]*id="sigue"/)
  assert.match(html, /<label[^>]*for="sigue-n">Sigue tu petición #<\/label>/)
  assert.match(html, /<input[^>]*name="n"[^>]*inputmode="numeric"/)
  assert.match(html, /id="siguiendo"[^>]*aria-live="polite"/, 'polite live region for the followed request')
  for (const texto of ['Leyenda', 'Estación', 'Entrada · salida', 'Decisión', 'Flujo', 'Vuelta a Build', 'Camino de la petición que sigues', 'trabajando', 'espera a una persona', 'en producción', 'rechazada']) assert.ok(html.includes(texto), `legend: ${texto}`)
  assert.match(html, /✓ hecho · ● en curso · ! rechazada · – pendiente/)
  assert.match(html, /id="detalle"/)
  assert.match(html, /aria-label="Cerrar el detalle \(Esc\)"/)
  assert.match(html, /id="cola"/)
  assert.match(html, /Esperando a una persona/)
  assert.match(html, /Nadie espera ahora mismo/)
  assert.doesNotMatch(html, /Pausa|Reiniciar|prototipo/i, 'the prototype controls are not on the page')
})

needsSandbox('/factory/ polls /api/estado every 5 s, keeps the demo mode, never travels a token along the edges and paints every text with textContent', () => {
  const bundle = clientCode(pages.factory)
  const entry = [...pages.factory.matchAll(/<script type="module" src="(\/_astro\/[^"]+)"/g)].map((m) => readFileSync(join(out, m[1]), 'utf8')).join('\n')
  assert.ok(entry.includes('/api/estado') || bundle.includes('/api/estado'))
  assert.doesNotMatch(entry + pages.factory, /api\/estado\?tarea/, 'the board reads the whole list')
  assert.match(bundle, /5e3|5000/)
  assert.match(bundle, /get\(["'`]demo["'`]\)/)
  assert.match(bundle, /textContent/)
  assert.doesNotMatch(bundle, /innerHTML|insertAdjacentHTML|outerHTML/)
  assert.doesNotMatch(bundle, /\.animate\(/, 'tokens do not travel: no Web Animations on the diagram')
  assert.match(bundle, /tk-spin/, 'a working token shows the spinner')
  assert.match(bundle, /tk-m/)
  assert.match(bundle, /prefers-reduced-motion/)
  const css = readdirSync(join(out, '_astro')).filter((f) => f.endsWith('.css')).map((f) => readFileSync(join(out, '_astro', f), 'utf8')).join('\n')
  assert.match(css, /\.fd \.tk-spin\{[^}]*infinite tk-gira/, 'the spinner keeps turning')
  assert.match(css, /\.fd \.tk-spin\{[^}]*animation:none\}\s*\.fd \.tk-spin:before\{content:"…"/, 'and stands still, as "…", under reduced motion')
  assert.match(bundle, /3e4|30000/, 'a rejection stays 30 s')
  assert.match(bundle, /bloqueadas_tests/)
  assert.match(bundle, /Escape/)
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

// --- S11: no credits, no emoji, local fonts and photographs, one place for the form ---

const everyFile = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? everyFile(join(dir, e.name)) : [join(dir, e.name)]))
const textFiles = () => everyFile(out).filter((f) => /\.(html|css|js|svg|txt|json)$/.test(f)).map((f) => [f, readFileSync(f, 'utf8')])

needsSandbox('no licence, credit or photograph source is shown or served anywhere (S11)', () => {
  for (const [file, text] of textFiles()) {
    assert.doesNotMatch(text, /CC BY|licencia|license|Wikimedia|Commons|créditos|credits?\b/i, file)
  }
  const served = everyFile(out).map((f) => f.slice(out.length + 1))
  assert.deepEqual(served.filter((f) => /credit|licen[sc]e|^OFL|copying|notice/i.test(f)), [], 'no credits or licence file is served')
  assert.deepEqual(everyFile(join(repo, 'public')).map((f) => f.split('/').pop()).filter((f) => /credit|licen[sc]e|^OFL/i.test(f)), [])
})

needsSandbox('fonts and photographs are local; the only other server is Turnstile, on /pide/', () => {
  const css = textFiles().filter(([f]) => f.endsWith('.css')).map(([, t]) => t).join('\n')
  assert.match(css, /font-family:\s*League Spartan/)
  assert.match(css, /font-family:\s*Figtree/)
  for (const font of ['/fonts/league-spartan-latin.woff2', '/fonts/figtree-latin.woff2']) {
    assert.ok(css.includes(font), font)
    assert.ok(existsSync(join(out, font)), `${font} is served`)
  }
  assert.doesNotMatch(css, /@import|url\(\s*["']?(?:https?:)?\/\//)
  const foreign = []
  for (const [name, html] of Object.entries(pages)) {
    for (const m of html.matchAll(/\b(?:src|href)="(https?:\/\/[^"]+)"/g)) if (!(name === 'pide' && m[1] === 'https://challenges.cloudflare.com/turnstile/v0/api.js')) foreign.push(`${name}: ${m[1]}`)
    for (const m of html.matchAll(/\bsrc="(\/fotos\/[^"]+)"/g)) assert.ok(existsSync(join(out, m[1])), `${name}: ${m[1]} is served`)
  }
  assert.deepEqual(foreign, [])
  const fotos = readdirSync(join(repo, 'public/fotos'))
  assert.ok(fotos.length >= 6)
  for (const f of fotos) assert.ok(statSync(join(repo, 'public/fotos', f)).size <= 300 * 1024, `${f} is at most 300 KB`)
  for (const id of ['limon-cortado', 'vega-del-segura', 'limonero', 'huerta-de-murcia', 'naranjos', 'puerto-de-cartagena']) assert.ok(Object.values(pages).some((h) => h.includes(`/fotos/${id}.webp`)), id)
})

needsSandbox('the emoji of the data are not painted (S11), and the campaign cards keep exactly their four colours', () => {
  const emojis = [...Object.values(state.productos).map((p) => p.emoji), ...campaigns().map((c) => c.emoji)].filter(Boolean)
  assert.ok(emojis.length > 0)
  for (const [name, painted] of Object.entries(pages)) {
    const html = painted.replace(/data-estado="[^"]*"/g, '') // the calculator carries the whole state as data; it paints none of it
    for (const emoji of emojis) assert.ok(!html.includes(emoji), `${name}: ${emoji}`)
    assert.doesNotMatch(html, /\p{Extended_Pictographic}/u, name)
  }
  const css = readFileSync(join(repo, 'src/styles/global.css'), 'utf8') // the built stylesheet is minified and merges rules
  const fondos = { oliva: 'var(--oliva)', limon: 'var(--limon)', tierra: 'var(--tierra)', blanco: '#fff' }
  for (const [color, fondo] of Object.entries(fondos)) assert.ok(css.includes(`.campana--${color}{background:${fondo};`), color)
  assert.deepEqual([...new Set([...css.matchAll(/\.campana--(\w+)\{/g)].map((m) => m[1]))].sort(), Object.keys(fondos).sort())
})

needsSandbox('every page has the "Pedir un cambio" button, in the header and the footer, pointing at /pide/', () => {
  for (const [name, html] of Object.entries(pages)) {
    assert.ok((html.match(/<a class="btn[^"]*" href="\/pide\/">Pedir un cambio<\/a>/g) ?? []).length >= 2, name)
    assert.doesNotMatch(html, /\/factory\/#pide/, name)
  }
})

test('the estilo surface of the seed passes the static check against the live site, and the seed carries the planted hero bug', () => {
  const surface = ['src/styles/global.css', 'src/components/Paisaje.astro', 'src/components/CampanaCard.astro', 'src/components/ProductoCard.astro', 'src/components/Header.astro', 'src/components/Footer.astro']
  const live = Object.fromEntries(surface.map((f) => [f, readFileSync(join(repo, f), 'utf8')]))
  const CSS = 'src/styles/global.css'
  for (const f of surface.filter((x) => existsSync(join(repo, 'factory/seed', x)))) {
    const seed = readFileSync(join(repo, 'factory/seed', f), 'utf8')
    // Only the stylesheet may differ: a request that fixed the hero is live until reset-demo puts the seed back.
    if (f !== CSS) assert.equal(seed, live[f], `${f}: the live site and the seed are the same`)
    assert.deepEqual(checkEstilo([{ path: f, content: seed }], live), { ok: true, errors: [] }, f)
  }
  const seedCss = readFileSync(join(repo, 'factory/seed', CSS), 'utf8')
  assert.match(seedCss, /\.hero\{position:relative;/)
  assert.doesNotMatch(seedCss, /\.hero\{display:grid/)
  assert.match(seedCss, /\.hero__campo\{position:absolute;inset:0;[^}]*overflow:visible/)
  for (const css of [seedCss, live[CSS]]) assert.doesNotMatch(css, /url\(/, 'the stylesheet loads nothing: the fonts are in fuentes.css')
})
