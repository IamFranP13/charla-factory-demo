// Builds the static site: validates every content file, renders site/index.html into dist/.
// No framework on purpose: the whole site is one template and a few string replacements.

import { readdirSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { validateFile } from './schemas.js'

export function buildSite(root, { turnstileSiteKey = '' } = {}) {
  const errors = []
  const read = (folder) => listJson(root, folder).map((path) => {
    const raw = readFileSync(join(root, path), 'utf8')
    const result = validateFile(path, raw)
    if (!result.ok) errors.push(...result.errors)
    return { path, value: result.ok ? JSON.parse(raw) : null }
  })

  const cards = read('content/muro')
  const sections = read('content/secciones')
  const data = read('data')
  const config = read('config')
  if (errors.length) return { ok: false, errors, cards: 0, sections: 0 }

  const figures = Object.assign({}, ...data.map((d) => d.value))
  const tickets = config.find((c) => c.path === 'config/entradas.json')?.value
  const wall = cards.map(({ path, value }) => ({ id: slug(path), ...value }))

  // One pass with a replacer function: content is never re-scanned for placeholders and
  // "$'" or "$`" inside it are plain text, not replacement patterns.
  const parts = {
    SECCIONES: () => sections.map(({ path, value }) => renderSection(slug(path), value)).join('\n'),
    MURO: () => wall.map(renderCard).join('\n'),
    CIFRAS: () => renderFigures(figures),
    ENTRADAS: () => (tickets ? renderTickets(tickets) : ''),
    TURNSTILE_SITEKEY: () => escape(turnstileSiteKey),
  }
  const html = readFileSync(join(root, 'site/index.html'), 'utf8')
    .replace(/\{\{([A-Z_]+)\}\}/g, (token, name) => parts[name]?.() ?? token)

  const dist = join(root, 'dist')
  rmSync(dist, { recursive: true, force: true })
  mkdirSync(dist, { recursive: true })
  writeFileSync(join(dist, 'index.html'), html)
  writeFileSync(join(dist, 'muro.json'), JSON.stringify(wall))
  for (const asset of ['style.css', 'app.js']) copyFileSync(join(root, 'site', asset), join(dist, asset))

  return { ok: true, errors: [], cards: cards.length, sections: sections.length }
}

function listJson(root, folder) {
  const dir = join(root, folder)
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => `${folder}/${f}`)
}

const slug = (path) => path.split('/').pop().replace(/\.json$/, '')

const renderCard = (c) => `<article class="card ${escape(c.color ?? 'amarillo')}" id="${escape(c.id)}">
  ${c.emoji ? `<span class="emoji">${escape(c.emoji)}</span>` : ''}
  <p>${escape(c.texto)}</p>
  ${c.autor ? `<footer>— ${escape(c.autor)}</footer>` : ''}
</article>`

const renderSection = (id, s) => `<section class="seccion" id="${escape(id)}">
  <h2>${escape(s.titulo)}</h2>
  <p>${escape(s.cuerpo)}</p>
</section>`

function renderFigures(figures) {
  const entries = Object.entries(figures)
  if (!entries.length) return ''
  return `<dl class="cifras">${entries.map(([k, v]) => `<div><dt>${escape(k.replaceAll('_', ' '))}</dt><dd>${escape(String(v))}</dd></div>`).join('')}</dl>`
}

const renderTickets = (t) => `<p class="entradas">Entrada: <strong>${t.precio === 0 ? 'gratis' : `${escape(String(t.precio))} €`}</strong> · Aforo: ${escape(String(t.aforo))}</p>`

export function escape(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch])
}
