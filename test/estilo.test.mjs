// The kind `estilo`: the look of the site (the stylesheet and the presentational components), guarded in code.
// An .astro file is code, so the static check of lib/estilo.js is what lets a model touch it at all.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'
import { checkEstilo } from '../lib/estilo.js'
import { parsePolicy, routeFor } from '../lib/policy.js'

const repo = new URL('..', import.meta.url).pathname
const SURFACE = ['src/styles/global.css', 'src/components/Paisaje.astro', 'src/components/CampanaCard.astro', 'src/components/ProductoCard.astro', 'src/components/Header.astro', 'src/components/Footer.astro']
const loadKinds = (root) => parse(readFileSync(join(root, 'factory/kinds.yaml'), 'utf8'))
const read = (path) => readFileSync(join(repo, path), 'utf8')
const CSS = 'src/styles/global.css'
const PAISAJE = 'src/components/Paisaje.astro'
const HEADER = 'src/components/Header.astro'
const FFOOTER = 'src/components/Footer.astro'
const CARD = 'src/components/CampanaCard.astro'
const current = Object.fromEntries(SURFACE.map((p) => [p, read(p)]))
const check = (path, text) => checkEstilo([{ path, content: text }], current)

test('the kind estilo exists, with the stylesheet and the five visual components as its surface (modify only)', () => {
  const kind = loadKinds(repo).estilo
  assert.ok(kind, 'estilo is in factory/kinds.yaml')
  assert.deepEqual(kind.files, SURFACE)
  assert.equal(kind.newFile, false)
  assert.equal(kind.visual, true)
  assert.notEqual(kind.code, true, 'it does not go through the sandbox of code kinds')
  assert.deepEqual(Object.keys(loadKinds(repo)).slice(5, 8), ['transporte', 'estilo', 'bug'])
})

test('legit changes pass: a CSS rule and a literal attribute of the landscape', () => {
  // A rule that is the same with and without the planted hero bug, so the test holds once a request has fixed it.
  const css = current[CSS].replace('.tira{display:flex;height:40px;', '.tira{display:flex;height:36px;')
  assert.notEqual(css, current[CSS])
  assert.deepEqual(check(CSS, css), { ok: true, errors: [] })
  const svg = current[PAISAJE].replace('width="800" height="800"', 'width="640" height="640"')
  assert.notEqual(svg, current[PAISAJE])
  assert.deepEqual(check(PAISAJE, svg), { ok: true, errors: [] })
  const markup = current[CARD].replace('<h3>', '<h3 class="titulo">')
  assert.deepEqual(check(CARD, markup), { ok: true, errors: [] })
})

const FORBIDDEN_CSS = [
  '@import "x.css";', '@IMPORT url(x)', 'a { background: url(x.png) }', 'a { background: URL( x ) }', 'a { width: expression(alert(1)) }',
  'a { background: javascript:x }', 'a { behavior: x }', 'a { -moz-binding: x }', '</style><script>x</script>', 'a { content: "http://x" }',
  'a { background: image-set("x.png" 1x) }', 'a { color: \\72ed }',
]
test('CSS: each forbidden pattern is refused, whatever the case', () => {
  for (const bad of FORBIDDEN_CSS) {
    const result = check(CSS, `${current[CSS]}\n${bad}\n`)
    assert.equal(result.ok, false, bad)
    assert.ok(result.errors.length >= 1, bad)
  }
})

const FORBIDDEN_ASTRO = [
  '<script>alert(1)</script>', '<p set:html="x">a</p>', '<p set:text="x">a</p>', '<script is:inline>x</script>', '<p is:raw>a</p>',
  '<p onclick="x()">a</p>', '<p onmouseover = "x()">a</p>', '<a href="javascript:x()">a</a>', '<a href="https://x.test">a</a>', '<a href="//x.test">a</a>',
  '<iframe src="/x"></iframe>', '<object data="/x"></object>', '<embed src="/x">', '<link rel="stylesheet" href="/x.css">', '<meta http-equiv="refresh" content="0">',
  '<base href="/x/">', '<form action="/x"></form>', '<slot />', '<style>a { color: red }</style>', '<p>import x</p>', '<a href="data:text/html,x">a</a>',
  '<a href="/x" xlink:href="vbscript:x">a</a>', '<p class="a">&#106;avascript:</p>', '<svg><image href="/x.png" /></svg>', '<svg><use href="/x.svg#a" /></svg>',
  '<Calculadora />', '<p style="background:url(/x.png)">a</p>', '<a href=x>a</a>', '<a href="/ok" client:load>a</a>', '<p>{window.name}</p>',
]
test('astro: each forbidden pattern is refused', () => {
  for (const bad of FORBIDDEN_ASTRO) {
    for (const path of [PAISAJE, FFOOTER]) {
      const result = check(path, `${current[path]}\n${bad}\n`)
      assert.equal(result.ok, false, `${path}: ${bad}`)
    }
  }
})
test('astro: the frontmatter and the template expressions are code and may not change', () => {
  const frontmatter = check(CARD, current[CARD].replace('const { campana } = Astro.props', 'const { campana } = Astro.props\nconst x = 1'))
  assert.equal(frontmatter.ok, false)
  assert.match(frontmatter.errors.join(), /frontmatter/)
  assert.equal(check(CARD, current[CARD].replace('---\nconst', '---\n// hi\nconst')).ok, false)
  assert.equal(check(PAISAJE, current[PAISAJE].replace('Purely visual.', 'Purely visual!')).ok, false, 'even a comment of the frontmatter')
  assert.equal(check(FFOOTER, `---\nconst x = 1\n---\n${current[FFOOTER]}`).ok, false, 'a frontmatter added to a file without one')
  assert.equal(check(CARD, `\n---\nconst x = 1\n---\n${current[CARD]}`).ok, false, 'a fence that is not at the start of the file')

  const changed = check(CARD, current[CARD].replace('{campana.titulo}', '{campana.texto}'))
  assert.equal(changed.ok, false)
  assert.match(changed.errors.join(), /expression/)
  assert.equal(check(CARD, current[CARD].replace('<h3>{campana.titulo}</h3>', '<h3>{campana.titulo}</h3><h4>{campana.titulo}</h4>')).ok, false, 'an expression added')
  assert.equal(check(CARD, current[CARD].replace('<h3>{campana.titulo}</h3>\n', '')).ok, false, 'an expression removed')
  assert.equal(check(CARD, current[CARD].replace('<h3>', '<h3 title={campana.texto}>')).ok, false, 'an attribute that runs code')
  assert.equal(check(CARD, current[CARD].replace('<h3>', '<h3>{')).ok, false, 'an unclosed brace')
  // moving an expression around is a layout change, not a code change
  const moved = current[CARD].replace('  <p>{campana.texto}</p>\n', '').replace('  <div class="campana__texto">', '  <p>{campana.texto}</p>\n  <div class="campana__texto">')
  assert.deepEqual(check(CARD, moved), { ok: true, errors: [] })
})

test('astro: an expression keeps its context: it may not move from the text into an attribute, or to another attribute', () => {
  const intoStyle = check(CARD, current[CARD].replace('<p>{campana.texto}</p>', '<p style={campana.texto}></p>'))
  assert.equal(intoStyle.ok, false, 'audience text would become CSS')
  assert.match(intoStyle.errors.join(), /context/)
  assert.equal(check(CARD, current[CARD].replace('<h3>{campana.titulo}</h3>', '<h3 title={campana.titulo}></h3>')).ok, false, 'from the text into an attribute')
  const header = current[HEADER]
  const [, attr, expr] = header.match(/ ([\w:-]+)=(\{[^{}]*\})/)
  assert.equal(check(HEADER, header.replace(`${attr}=${expr}`, `data-x=${expr}`)).ok, false, `from ${attr} to another attribute`)
  // a template literal attribute is code too: the expression would land in `style` with a `$` before its brace
  const literal = check(CARD, current[CARD].replace('<p>{campana.texto}</p>', '<p style=`${campana.texto}`></p>'))
  assert.equal(literal.ok, false, 'audience text in a template literal attribute')
  assert.equal(check(CARD, current[CARD].replace('<p>{campana.texto}</p>', '<p title=`x`>{campana.texto}</p>')).ok, false, 'any template literal outside the expressions')
  assert.equal(check(CARD, current[CARD].replace('<p>{campana.texto}</p>', '<p {campana.texto}></p>')).ok, false, 'an expression inside a tag, not after =')
})

test('estilo changes how the site looks, never what it says: no new text in the CSS or in a component', () => {
  const css = check(CSS, `${current[CSS]}\n.hero::after { content: "Envío gratis y 50 % de descuento"; }\n`)
  assert.equal(css.ok, false)
  assert.match(css.errors.join(), /text/)
  assert.deepEqual(check(CSS, `${current[CSS]}\n.otro::before { content: '!'; }\n`), { ok: true, errors: [] }, 'a text the stylesheet already has')
  const footer = check(FFOOTER, current[FFOOTER].replace('</footer>', '<p>Envío gratis a toda Europa</p></footer>'))
  assert.equal(footer.ok, false)
  assert.match(footer.errors.join(), /text/)
  assert.equal(check(FFOOTER, current[FFOOTER].replace('Los precios y las tarifas son simulados.', 'Los precios son reales.')).ok, false, 'a text changed')
  assert.equal(check(CARD, current[CARD].replace('<p>', '<p aria-label="Oferta">')).ok, false, 'a text in an attribute')
  // moving the same words into another element is layout
  const wrapped = current[FFOOTER].replace('<p class="pie__nota">', '<p class="pie__nota"><span>').replace('simulados.</p>', 'simulados.</span></p>')
  assert.deepEqual(check(FFOOTER, wrapped), { ok: true, errors: [] })
})

test('astro: the one inline script of the header may stay as it is, never change or appear elsewhere', () => {
  assert.deepEqual(check(HEADER, current[HEADER].replace('class="marca"', 'class="marca marca--grande"')), { ok: true, errors: [] })
  assert.equal(check(HEADER, current[HEADER].replace("'click'", "'mouseover'")).ok, false, 'its code changed')
  assert.equal(check(HEADER, current[HEADER].replace(/<script>[\s\S]*<\/script>/, '')).ok, false, 'removed script: the page loses its behaviour')
  assert.equal(check(HEADER, `${current[HEADER]}\n<script>alert(1)</script>`).ok, false, 'a second script')
})

test('a new .astro file, or a file outside the surface, is never allowed', () => {
  assert.equal(check('src/components/Nueva.astro', '<p>hola</p>').ok, false)
  assert.equal(check('src/components/Calculadora.astro', current[CARD]).ok, false)
  assert.equal(check('src/pages/index.astro', current[CARD]).ok, false)
  assert.equal(check('src/layouts/Base.astro', current[CARD]).ok, false)
  assert.equal(check('src/styles/otra.css', 'a { color: red }').ok, false)
  assert.equal(check('lib/sandbox.js', 'export const x = 1').ok, false)
})

test('policy: the six files of the look go auto; the pages, the other components and the layout stay human', () => {
  const policy = parsePolicy(read('policy/risk.yaml'))
  for (const file of SURFACE) {
    const r = routeFor(policy, [file])
    assert.equal(r.route, 'auto', file)
    assert.notEqual(r.files[0].rule, 'default', file)
  }
  for (const file of ['src/pages/index.astro', 'src/components/Calculadora.astro', 'src/layouts/Base.astro', 'src/components/Features.astro', 'src/components/PeticionForm.astro', 'src/lib/nav.js', 'src/domain/presupuesto.js']) {
    assert.equal(routeFor(policy, [file]).route, 'human', file)
  }
  assert.equal(routeFor(policy, [CSS, 'src/pages/index.astro']).route, 'human', 'the strictest route wins')
  assert.equal(routeFor(policy, [CSS, 'data/precios.json']).route, 'human')
})
