// The factory, as in the talk diagram:
//   spec (LLM, with the Brain) → build (LLM) → seguridad · ux · ui (LLM) + codigo (code), in parallel
//   → approver (code: all four ok, or back to build once) → the risk gate decides what happens next.
// Models only fill in content. Code decides paths, validates every file, runs the business rules and keeps the score.

import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, posix } from 'node:path'
import { parse } from 'yaml'
import { validateFile } from './schemas.js'
import { validateCatalog } from '../src/domain/catalogo.js'
import { presupuestar } from '../src/domain/presupuesto.js'
import { cargarEstado } from '../src/domain/estado-node.js'

const MAX_BUILDS = 2
const MAX_FILES = 2
const REVIEWERS = ['seguridad', 'ux', 'ui']

// Files the factory created for the audience (content/*/tarea-<n>.json, catalogo/*/tarea-<n>.json).
// Rehearsal copies of the repository leave them out, so tests and simulations behave the same before and after a talk.
export const isAudienceFile = (path) => /(^|[\\/])(content|catalogo)[\\/][^\\/]+[\\/]tarea-\d+\.json$/.test(path)

export function loadProfiles(root) {
  return parse(readFileSync(join(root, 'factory/profiles.yaml'), 'utf8'))
}

// --- Task state: one comment in the issue body, read by the board in a single API call ---

export const STATIONS = ['entrada', 'spec', 'build', 'seguridad', 'ux', 'ui', 'codigo', 'approver', 'puerta', 'merge', 'produccion']
const STATION_VALUES = ['pendiente', 'en_curso', 'ok', 'rechazada', 'error']
const RESULTS = ['ok', 'rejected', 'failed', 'unchanged']
const ROUTES = ['auto', 'human']
const MARKER = /<!-- factory:state (.+?) -->/g
const REQUEST_BLOCK = /```json\n(.*)\n```/

export function initialState(perfil, now = new Date().toISOString()) {
  return normalizeState({ perfil, fase: 'entrada', estaciones: { entrada: 'ok' }, resultado: null, pr: null, ruta: null, actualizado: now })
}

// Only known fields with known values survive: nothing a model or a request wrote can reach the marker.
function normalizeState(raw) {
  const perfil = String(raw?.perfil ?? '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 30)
  const actualizado = String(raw?.actualizado ?? '')
  return {
    perfil: /^[a-z]/.test(perfil) ? perfil : 'desconocido',
    fase: STATIONS.includes(raw?.fase) ? raw.fase : 'entrada',
    estaciones: Object.fromEntries(STATIONS.map((s) => [s, STATION_VALUES.includes(raw?.estaciones?.[s]) ? raw.estaciones[s] : 'pendiente'])),
    resultado: RESULTS.includes(raw?.resultado) ? raw.resultado : null,
    pr: Number.isInteger(raw?.pr) && raw.pr > 0 ? raw.pr : null,
    ruta: ROUTES.includes(raw?.ruta) ? raw.ruta : null,
    actualizado: /^[0-9T:.+Z-]{1,40}$/.test(actualizado) ? actualizado : new Date().toISOString(),
  }
}

const STATUS_TO_STATE = { en_curso: 'en_curso', ok: 'ok', rejected: 'rechazada', error: 'error', unchanged: 'ok' }

// A trace event moves the task along. The approver sending the work back resets the stations it re-runs.
export function applyEvent(state, event, now = new Date().toISOString()) {
  const next = normalizeState(state)
  if (!STATIONS.includes(event?.station)) return next
  if (event.station === 'approver' && event.status === 'retry') {
    for (const s of ['build', ...REVIEWERS, 'codigo']) next.estaciones[s] = 'pendiente'
    next.estaciones.approver = 'en_curso'
  } else if (STATUS_TO_STATE[event.status]) {
    next.estaciones[event.station] = STATUS_TO_STATE[event.status]
  } else {
    return next
  }
  next.fase = event.station
  next.actualizado = now
  return normalizeState(next)
}

// The factory is done: record its result. A task that passed waits at the gate; one that stopped stays where it stopped.
export function finishState(state, status, now = new Date().toISOString()) {
  const next = normalizeState(state)
  next.resultado = status
  if (status === 'ok') next.fase = 'puerta'
  next.actualizado = now
  return normalizeState(next)
}

export function renderState(state) {
  const json = JSON.stringify(normalizeState(state)).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e')
  return `<!-- factory:state ${json} -->`
}

// The state lives BELOW the request block: a marker typed inside the request is data, never state.
function requestEnd(body) {
  const match = REQUEST_BLOCK.exec(String(body ?? ''))
  return match ? match.index + match[0].length : -1
}

export function parseState(body) {
  const end = requestEnd(body)
  if (end === -1) return null
  const found = [...String(body).slice(end).matchAll(MARKER)].at(-1)
  if (!found) return null
  try {
    return normalizeState(JSON.parse(found[1]))
  } catch {
    return null
  }
}

export function replaceState(body, state) {
  const end = requestEnd(body)
  if (end === -1) throw new Error('the issue body has no request block')
  const rest = String(body).slice(end).replace(MARKER, '').trim()
  return `${body.slice(0, end)}\n\n${renderState(state)}${rest ? `\n\n${rest}` : ''}\n`
}

export async function runFactory({ task, root, provider, reviewProvider = provider, trace }) {
  const usage = { input: 0, output: 0 }
  const profile = loadProfiles(root)[task.profile]
  if (!profile) {
    trace(event('entrada', 'error', `perfil desconocido: "${task.profile}"`))
    return done('failed')
  }

  const ctx = {
    task,
    profile,
    agents: readFileSync(join(root, 'AGENTS.md'), 'utf8'),
    brain: readBrain(root),
    estado: loadEstado(root),
    assigned: profile.newFile ? profile.folders.map((folder) => `${folder}tarea-${task.id}.json`) : [],
    existing: profile.newFile ? {} : readExisting(root, profile.files),
  }

  // 1. Spec writer (receives the Brain)
  trace(started('spec'))
  const spec = await ask(provider, 'spec', ctx)
  if (!spec.ok) return done('failed')
  if (spec.value.rechazar) {
    trace(event('spec', 'rejected', spec.value.motivo ?? 'petición rechazada', spec))
    return done('rejected')
  }
  ctx.spec = spec.value
  trace(event('spec', 'ok', spec.value.resumen ?? '', spec))

  // 2. Builder, then the four reviewers; the approver allows one loop back to the Builder
  let attempts = 0
  let lastRejection = null
  while (attempts < MAX_BUILDS) {
    attempts++
    trace(started('build'))
    const build = await ask(provider, 'build', ctx, { retries: 0 })
    if (!build.ok) {
      ctx.feedback = build.error
      continue
    }
    const checked = checkBuild(root, profile, ctx.assigned, build.value)
    if (!checked.ok) {
      trace(event('build', 'error', checked.errors.join('; '), build))
      ctx.feedback = checked.errors.join('\n')
      continue
    }
    // Asking for what is already there ("price to 0" twice) is not an error, but there is nothing
    // to review or commit: an empty commit would break the pipeline.
    if (checked.files.every((f) => sameJson(root, f))) {
      trace(event('build', 'unchanged', `sin cambios: ${checked.files.map((f) => f.path).join(', ')} ya tiene ese contenido`, build))
      return done('unchanged', { attempts })
    }
    trace(event('build', 'ok', checked.files.map((f) => f.path).join(', '), build))
    ctx.files = checked.files

    // 3. seguridad, ux and ui (models) and codigo (code) run in parallel
    for (const station of [...REVIEWERS, 'codigo']) trace(started(station))
    const verdicts = await Promise.all([
      ...REVIEWERS.map((station) => ask(reviewProvider, station, ctx)),
      Promise.resolve().then(() => runCodigo(root, checked.files)),
    ])
    const results = [...REVIEWERS, 'codigo'].map((station, i) => ({ station, ...verdicts[i] }))
    for (const r of results) {
      if (!r.ok) continue
      trace(event(r.station, r.value.aprobado === true ? 'ok' : 'rejected', r.value.motivo ?? (r.value.aprobado === true ? '' : 'rechazado'), r))
    }
    if (results.some((r) => !r.ok)) return done('failed', { attempts })

    // 4. Approver: four approvals, or back to the Builder with every reason (once)
    const rejections = results.filter((r) => r.value.aprobado !== true).map((r) => `${r.station}: ${r.value.motivo ?? 'rechazado'}`)
    if (rejections.length === 0) {
      trace(event('approver', 'ok', `4/4 aprobaciones: ${results.map((r) => r.station).join(', ')}`))
      return done('ok', { files: checked.files, attempts })
    }
    lastRejection = rejections
    ctx.feedback = rejections.join('\n')
    const last = attempts >= MAX_BUILDS
    trace(event('approver', last ? 'rejected' : 'retry', last ? `rechazada por segunda vez: ${ctx.feedback}` : `vuelve a build: ${ctx.feedback}`))
  }
  return done(lastRejection ? 'rejected' : 'failed', { attempts })

  function done(status, { files = [], attempts: n = 0 } = {}) {
    return { status, files, attempts: n, usage }
  }

  // One model call that must return a JSON object. Errors and invalid JSON are retried.
  async function ask(p, station, context, { retries = 1 } = {}) {
    let error
    for (let i = 0; i <= retries; i++) {
      const started = Date.now()
      try {
        const answer = await p.complete({ station, messages: messagesFor(root, station, context), task: context })
        usage.input += answer.usage?.input ?? 0
        usage.output += answer.usage?.output ?? 0
        const value = parseObject(answer.text)
        return { ok: true, value, ms: Date.now() - started, usage: answer.usage }
      } catch (e) {
        error = e.message
        trace(event(station, 'error', error, { ms: Date.now() - started }))
      }
    }
    return { ok: false, error }
  }

  // The deterministic reviewer: same shape as a model's answer, no model involved.
  function runCodigo(rootDir, files) {
    const begun = Date.now()
    try {
      return { ok: true, value: codigo(rootDir, files), ms: Date.now() - begun, usage: null }
    } catch (e) {
      trace(event('codigo', 'error', e.message, { ms: Date.now() - begun }))
      return { ok: false, error: e.message }
    }
  }
}

// Station "codigo": schemas, then the business rules over the state the change would produce.
// Every sample order of factory/muestras.json must still behave as its "esperado" says.
export function codigo(root, files) {
  const schema = files.flatMap((f) => validateFile(f.path, f.content).errors)
  if (schema.length) return { aprobado: false, motivo: `Un fichero no cumple su esquema: ${schema.join('; ')}` }

  const estado = withFiles(cargarEstado(root), files)
  const catalog = validateCatalog(estado)
  if (!catalog.ok) return { aprobado: false, motivo: `El catálogo quedaría incoherente: ${catalog.errors.join('; ')}` }

  const muestras = JSON.parse(readFileSync(join(root, 'factory/muestras.json'), 'utf8'))
  const failures = []
  for (const m of muestras) {
    const r = presupuestar(m.pedido, estado)
    const amounts = [r.subtotal, r.descuento.importe, r.transporte, r.total, ...r.lineas.map((l) => l.importe)]
    if (m.esperado === 'ok' && !(r.ok && amounts.every((n) => Number.isFinite(n) && n >= 0))) {
      failures.push(`el presupuesto de muestra «${m.nombre}» debía salir bien y ahora falla${r.errores.length ? `: ${r.errores.join(', ')}` : ''}`)
    } else if (m.esperado === 'error' && r.ok) {
      failures.push(`el presupuesto de muestra «${m.nombre}» debía dar error y ahora se presupuesta`)
    }
  }
  if (failures.length) return { aprobado: false, motivo: `Los presupuestos de muestra cambian: ${failures.join('; ')}` }
  return { aprobado: true, motivo: `${files.length} fichero(s) válidos y ${muestras.length} presupuestos de muestra intactos` }
}

// The resulting state, in memory: the repository is never written here.
function withFiles(estado, files) {
  const next = { ...estado, productos: { ...estado.productos }, destinos: { ...estado.destinos } }
  for (const { path, content } of files) {
    const value = JSON.parse(content)
    const id = posix.basename(path, '.json')
    if (path.startsWith('catalogo/productos/')) next.productos[id] = value
    else if (path.startsWith('catalogo/destinos/')) next.destinos[id] = value
    else if (path === 'data/precios.json') next.precios = value
    else if (path === 'data/descuentos.json') next.descuentos = value
    else if (path === 'config/transporte.json') next.transporte = value
  }
  return next
}

function sameJson(root, file) {
  const path = join(root, file.path)
  if (!existsSync(path)) return false
  try {
    return JSON.stringify(JSON.parse(readFileSync(path, 'utf8'))) === JSON.stringify(JSON.parse(file.content))
  } catch {
    return false
  }
}

function checkBuild(root, profile, assigned, value) {
  const list = value?.ficheros
  if (!Array.isArray(list) || list.length === 0) return { ok: false, errors: ['answer must contain a non-empty "ficheros" list'] }
  if (list.length > (profile.newFile ? 1 : MAX_FILES)) return { ok: false, errors: [`too many files (max ${profile.newFile ? 1 : MAX_FILES})`] }

  const errors = []
  const files = []
  for (const item of list) {
    const path = typeof item?.ruta === 'string' ? posix.normalize(item.ruta) : ''
    if (!path || path.startsWith('/') || path.startsWith('..')) {
      errors.push(`invalid path "${item?.ruta}"`)
      continue
    }
    // New-file profiles may only create the factory-named file in one of their folders; the others, only their listed files.
    if (profile.newFile ? !assigned.includes(path) : !profile.files.includes(path)) {
      errors.push(`${path}: not allowed for this profile (allowed: ${(profile.newFile ? assigned : profile.files).join(', ')})`)
      continue
    }
    if (files.some((f) => f.path === path)) {
      errors.push(`${path}: listed twice`)
      continue
    }
    if (profile.newFile && existsSync(join(root, path))) {
      errors.push(`${path}: already exists`)
      continue
    }
    if (!item.contenido || typeof item.contenido !== 'object' || Array.isArray(item.contenido)) {
      errors.push(`${path}: "contenido" must be a JSON object`)
      continue
    }
    const content = JSON.stringify(item.contenido, null, 2) + '\n'
    const result = validateFile(path, content)
    if (!result.ok) errors.push(...result.errors)
    else files.push({ path, content })
  }
  return errors.length ? { ok: false, errors } : { ok: true, files }
}

function readExisting(root, paths) {
  const existing = {}
  for (const path of paths) {
    if (existsSync(join(root, path))) existing[path] = readFileSync(join(root, path), 'utf8')
  }
  return existing
}

// Every brain/*.md, in name order: brand, tone and business decisions. Only humans write them.
function readBrain(root) {
  const dir = join(root, 'brain')
  if (!existsSync(dir)) return '(vacío)'
  return readdirSync(dir).filter((n) => n.endsWith('.md')).sort().map((n) => `### brain/${n}\n${readFileSync(join(dir, n), 'utf8').trim()}`).join('\n\n') || '(vacío)'
}

function loadEstado(root) {
  try {
    return cargarEstado(root)
  } catch {
    return null
  }
}

function catalogText(estado) {
  if (!estado) return '(no disponible)'
  const products = Object.entries(estado.productos).map(([id, p]) => `- ${id} — ${p.nombre} (${p.categoria})${id in estado.precios ? ` — ${estado.precios[id]} €/kg` : ' — sin precio'}${p.disponible ? '' : ' — no disponible'}`)
  const destinations = Object.entries(estado.destinos).map(([id, d]) => `- ${id} — ${d.ciudad}, ${d.pais}`)
  return `Productos:\n${products.join('\n')}\nDestinos:\n${destinations.join('\n')}`
}

function messagesFor(root, station, ctx) {
  const template = readFileSync(join(root, 'factory/prompts', `${station}.md`), 'utf8')
  const where = ctx.profile.newFile
    ? `Exactly one new file, at one of these paths (pick the folder that fits the request): ${ctx.assigned.join(' | ')}`
    : `Modify the files below (max ${MAX_FILES} files). You may only write: ${ctx.profile.files.join(', ')}`
  const vars = {
    AGENTS: ctx.agents,
    BRAIN: ctx.brain,
    PROFILE: ctx.task.profile,
    PROFILE_DESCRIPTION: ctx.profile.description,
    REQUEST: ctx.task.request,
    SPEC: JSON.stringify(ctx.spec ?? {}, null, 2),
    WHERE: where,
    CATALOGO: catalogText(ctx.estado),
    EXISTING: Object.entries(ctx.existing).map(([p, c]) => `${p}:\n${c}`).join('\n') || '(none)',
    FEEDBACK: ctx.feedback ? `\nYour previous answer was not accepted. Fix this:\n${ctx.feedback}\n` : '',
    FILES: (ctx.files ?? []).map((f) => `${f.path}:\n${f.content}`).join('\n'),
  }
  const content = template.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? '')
  return [{ role: 'user', content }]
}

function parseObject(text) {
  const trimmed = String(text ?? '').trim().replace(/^```(?:json)?\s*|\s*```$/g, '')
  let value
  try {
    value = JSON.parse(trimmed)
  } catch {
    throw new Error('the model did not answer valid JSON')
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('the model did not answer a JSON object')
  return value
}

function event(station, status, detail, call = {}) {
  return { station, status, detail, ms: call.ms ?? 0, usage: call.usage ?? null }
}

// A station announces itself before it works, so the board can show it in progress.
const started = (station) => event(station, 'en_curso', '')
