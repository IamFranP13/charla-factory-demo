import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildSite } from '../lib/build.js'

const repo = new URL('..', import.meta.url).pathname

// A scratch copy of the site template plus the content we want to render.
function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), 'build-'))
  cpSync(join(repo, 'site'), join(root, 'site'), { recursive: true })
  for (const [path, value] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true })
    writeFileSync(join(root, path), typeof value === 'string' ? value : JSON.stringify(value))
  }
  return root
}

test('renders wall cards, sections, figures and ticket config into dist/index.html', () => {
  const root = fixture({
    'content/muro/hola.json': { texto: 'Hola desde la fila 3', autor: 'Ana', emoji: '👋', color: 'verde' },
    'content/secciones/faq.json': { titulo: 'Preguntas', cuerpo: 'Al final de la charla.' },
    'data/cifras.json': { asistentes: 120 },
    'config/entradas.json': { precio: 15, aforo: 200 },
  })
  const result = buildSite(root)
  assert.deepEqual(result, { ok: true, errors: [], cards: 1, sections: 1 })

  const html = readFileSync(join(root, 'dist/index.html'), 'utf8')
  assert.match(html, /Hola desde la fila 3/)
  assert.match(html, /Ana/)
  assert.match(html, /class="card verde"/)
  assert.match(html, /Preguntas/)
  assert.match(html, /asistentes/)
  assert.match(html, /15 €/)
  assert.ok(existsSync(join(root, 'dist/style.css')))
  assert.ok(existsSync(join(root, 'dist/app.js')))
  assert.deepEqual(JSON.parse(readFileSync(join(root, 'dist/muro.json'), 'utf8')).length, 1)
})

test('text is HTML-escaped even if it somehow passed validation', () => {
  const root = fixture({ 'data/cifras.json': { lema: 'a & b "c"' } })
  buildSite(root)
  const html = readFileSync(join(root, 'dist/index.html'), 'utf8')
  assert.match(html, /a &amp; b &quot;c&quot;/)
})

test('an invalid content file fails the build and names the file', () => {
  const root = fixture({ 'content/muro/malo.json': { texto: '<b>hola</b>' } })
  const result = buildSite(root)
  assert.equal(result.ok, false)
  assert.match(result.errors.join('\n'), /content\/muro\/malo\.json/)
  assert.equal(existsSync(join(root, 'dist/index.html')), false)
})

test('an empty site still builds', () => {
  const result = buildSite(fixture({}))
  assert.deepEqual(result, { ok: true, errors: [], cards: 0, sections: 0 })
})
