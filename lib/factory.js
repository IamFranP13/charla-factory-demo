// The factory, as in the talk diagram:
//   spec (LLM, with the Brain) → build (LLM) → seguridad · ux · ui (LLM) + codigo (code), in parallel
//   → approver (code: all four ok, or back to build once) → the risk gate decides what happens next.
// Models only fill in content. Code decides paths, validates every file, runs the business rules and keeps the score.
// The Spec writer classifies every request into a KIND (factory/kinds.yaml); the kind decides what may be written.
// The visual kind (estilo) is checked as text by lib/estilo.js: an .astro file is code, so it may only change its markup.
// Code kinds (bug, feature, cambio) go through the same stations: `codigo` checks the code statically and runs its
// tests in the isolation of lib/sandbox.js. Nothing a model writes is ever imported by this process, and neither is
// anything under src/domain/ or src/features/ (a model can change it): the business rules are evaluated in the isolation too.

import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, posix } from 'node:path'
import { parse } from 'yaml'
import { validateFile } from './schemas.js'
import { cargarEstado } from './estado-node.js'
import { REVIEWERS, TIPOS } from './estado.js'
import { checkEstilo } from './estilo.js'
import { MAX_CODE_FILES, SANDBOX_TIMEOUT_MS, checkState, codePathError, runSuite, staticCheck } from './sandbox.js'

const MAX_BUILDS = 2
const MAX_FILES = 2
// A code patch is longer than a JSON file: the Builder of code gets more room to answer.
const CODE_MAX_TOKENS = 4000
const MAX_FEEDBACK = 1500

// Files the factory created for the audience (content/*/tarea-<n>.json, catalogo/*/tarea-<n>.json, src/features/tarea-<n>/,
// src/domain/tarea-<n>*.js and tarea-<n>*.test.mjs).
// Rehearsal copies of the repository leave them out, so tests and simulations behave the same before and after a talk.
export const isAudienceFile = (path) =>
  /(^|[\\/])(content|catalogo)[\\/][^\\/]+[\\/]tarea-\d+\.json$/.test(path) ||
  /(^|[\\/])src[\\/]features[\\/]tarea-\d+([\\/]|$)/.test(path) ||
  /(^|[\\/])src[\\/]domain[\\/]tarea-\d+(-[^\\/]*)?\.(js|test\.mjs)$/.test(path)

export function loadProfiles(root) {
  return parse(readFileSync(join(root, 'factory/profiles.yaml'), 'utf8'))
}

export function loadKinds(root) {
  return parse(readFileSync(join(root, 'factory/kinds.yaml'), 'utf8'))
}

// What may be written for the kinds in play: the one the spec named or, when it named none, the default kinds of
// the profile. Several kinds merge their folders and files (all data: a profile never defaults to code).
function surfaceOf(kinds, names) {
  const chosen = names.map((name) => kinds[name]).filter(Boolean)
  return {
    code: chosen.some((k) => k.code === true),
    visual: chosen.some((k) => k.visual === true),
    scope: [...new Set(chosen.flatMap((k) => k.scope ?? []))],
    newFile: chosen.some((k) => k.newFile === true),
    folders: chosen.flatMap((k) => k.folders ?? []),
    files: chosen.flatMap((k) => k.files ?? []),
  }
}

// The task state is pure data (no Node imports): it lives in lib/estado.js so /api/estado can run on Cloudflare.
export { STATIONS, initialState, applyEvent, finishState, renderState, parseState, replaceState } from './estado.js'

// `codeProvider` builds code (FACTORY_CODE_MODEL); `sandbox` = { run, timeoutMs } lets tests spy on or shorten the isolated run.
export async function runFactory({ task, root, provider, reviewProvider = provider, codeProvider = provider, sandbox = {}, trace }) {
  const usage = { input: 0, output: 0 }
  const profile = loadProfiles(root)[task.profile]
  if (!profile) {
    trace(event('entrada', 'error', `perfil desconocido: "${task.profile}"`))
    return done('failed')
  }

  const kinds = loadKinds(root)
  const ctx = {
    task,
    profile,
    kinds,
    agents: readFileSync(join(root, 'AGENTS.md'), 'utf8'),
    brain: readBrain(root),
    design: readDesign(root),
    estado: loadEstado(root),
    kind: null,
    surface: surfaceOf(kinds, profile.kinds),
    assigned: [],
    existing: {},
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

  // The kind the Spec writer named decides what may be written. With none, the default kinds of the profile apply.
  const named = spec.value.tipo
  if (named !== undefined && named !== null && !TIPOS.includes(named)) {
    trace(event('spec', 'error', `tipo desconocido ${JSON.stringify(named)}: debe ser uno de ${TIPOS.join(', ')}`, spec))
    return done('failed')
  }
  const names = named === undefined || named === null ? profile.kinds : [named]
  ctx.kind = names.length === 1 ? names[0] : null
  ctx.surface = surfaceOf(kinds, names)
  const code = ctx.surface.code
  const surface = ctx.surface
  // Long answers: code and the look both come as whole files or edits of long ones.
  const long = code || surface.visual
  ctx.assigned = !code && surface.newFile ? surface.folders.map((folder) => `${folder}tarea-${task.id}.json`) : []
  ctx.existing = code ? readCodeSources(root) : surface.newFile ? {} : readExisting(root, surface.files)
  trace({ ...event('spec', 'ok', spec.value.resumen ?? '', spec), ...(ctx.kind && { tipo: ctx.kind }) })

  // 2. Builder, then the four reviewers; the approver allows one loop back to the Builder
  let attempts = 0
  let lastRejection = null
  while (attempts < MAX_BUILDS) {
    attempts++
    trace(started('build'))
    const build = await ask(long ? codeProvider : provider, 'build', ctx, { retries: 0, maxTokens: long ? CODE_MAX_TOKENS : undefined })
    if (!build.ok) {
      ctx.feedback = build.error
      continue
    }
    const checked = code ? checkCodeBuild(root, task.id, build.value, surface.scope) : surface.visual ? checkVisualBuild(root, surface, build.value) : checkBuild(root, surface, ctx.assigned, build.value)
    if (!checked.ok) {
      trace(event('build', 'error', checked.errors.join('; '), build))
      ctx.feedback = checked.errors.join('\n')
      continue
    }
    // Asking for what is already there ("price to 0" twice) is not an error, but there is nothing
    // to review or commit: an empty commit would break the pipeline.
    if (checked.files.every((f) => (code || surface.visual ? sameText(root, f) : sameJson(root, f)))) {
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
  async function ask(p, station, context, { retries = 1, maxTokens } = {}) {
    let error
    for (let i = 0; i <= retries; i++) {
      const started = Date.now()
      try {
        const answer = await p.complete({ station, messages: messagesFor(root, station, context), task: context, maxTokens })
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
  async function runCodigo(rootDir, files) {
    const begun = Date.now()
    try {
      const value = code ? await codigoDeCodigo(rootDir, files, sandbox) : surface.visual ? codigoDeEstilo(rootDir, files) : await codigo(rootDir, files, sandbox)
      return { ok: true, value, ms: Date.now() - begun, usage: null }
    } catch (e) {
      trace(event('codigo', 'error', e.message, { ms: Date.now() - begun }))
      return { ok: false, error: e.message }
    }
  }
}

// Station "codigo": schemas, then the business rules over the state the change would produce.
// Every sample order of factory/muestras.json must still behave as its "esperado" says. The rules themselves
// (validateCatalog, presupuestar) are code of src/domain/: they run in the isolation, only their data comes back.
export async function codigo(root, files, { check = checkState } = {}) {
  const schema = files.flatMap((f) => validateFile(f.path, f.content).errors)
  if (schema.length) return { aprobado: false, motivo: `Un fichero no cumple su esquema: ${schema.join('; ')}` }

  const result = await check(root, withFiles(cargarEstado(root), files))
  if (result.error) return { aprobado: false, motivo: `No se pudieron comprobar las reglas del negocio: ${result.error}` }
  if (!result.catalogo.ok) return { aprobado: false, motivo: `El catálogo quedaría incoherente: ${result.catalogo.errors.join('; ')}` }

  const failures = []
  for (const m of result.muestras) {
    if (m.esperado === 'ok' && !(m.ok && m.importes.every((n) => Number.isFinite(n) && n >= 0))) {
      failures.push(`el presupuesto de muestra «${m.nombre}» debía salir bien y ahora falla${m.errores.length ? `: ${m.errores.join(', ')}` : ''}`)
    } else if (m.esperado === 'error' && m.ok) {
      failures.push(`el presupuesto de muestra «${m.nombre}» debía dar error y ahora se presupuesta`)
    }
  }
  if (failures.length) return { aprobado: false, motivo: `Los presupuestos de muestra cambian: ${failures.join('; ')}` }
  return { aprobado: true, motivo: `${files.length} fichero(s) válidos y ${result.muestras.length} presupuestos de muestra intactos` }
}

// Station "codigo" for code. Nothing runs until the static check passes; then the tests of the domain and the
// features (plus the sample orders and the feature contract) run in the isolated copy of lib/sandbox.js.
export async function codigoDeCodigo(root, files, { run = runSuite, timeoutMs } = {}) {
  const checked = staticCheck(files)
  if (!checked.ok) return { aprobado: false, motivo: `Código no permitido: ${checked.errors.join('; ')}` }

  const limit = timeoutMs ?? SANDBOX_TIMEOUT_MS
  const result = await run(root, files, { timeoutMs: limit })
  if (result.timedOut) return { aprobado: false, motivo: `Los tests superaron el tiempo límite (${+(limit / 1000).toFixed(1)} s) y se han cancelado` }
  if (result.memoryExceeded) return { aprobado: false, motivo: 'Los tests superaron el límite de memoria y se han cancelado' }
  if (!result.ok) return { aprobado: false, motivo: `Fallan los tests: ${tail(result.output)}` }
  return { aprobado: true, motivo: `${files.length} fichero(s) de código: comprobación estática limpia y tests en verde en un entorno aislado` }
}

// Station "codigo" for the look: the static check of lib/estilo.js against the files as they are now. Nothing runs,
// and nothing measured either (colour, contrast, overlap): the reviewers judge that on what the site looks like.
export function codigoDeEstilo(root, files) {
  const checked = checkEstilo(files, currentTexts(root, files))
  if (!checked.ok) return { aprobado: false, motivo: `Estilo no permitido: ${checked.errors.join('; ')}` }
  return { aprobado: true, motivo: `${files.length} fichero(s) de estilo: comprobación estática limpia (sin código nuevo ni recursos externos)` }
}

const currentTexts = (root, files) => Object.fromEntries(files.map((f) => [f.path, existsSync(join(root, f.path)) ? readFileSync(join(root, f.path), 'utf8') : null]))

// The end of a test run, without the scratch directory the isolation used.
function tail(output) {
  const text = String(output ?? '').replace(/(?:file:\/\/)?\/\S*?sandbox-run-\w+\//g, '').trim()
  return text.length > MAX_FEEDBACK ? `…${text.slice(-MAX_FEEDBACK)}` : text
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

function sameText(root, file) {
  const path = join(root, file.path)
  return existsSync(path) && readFileSync(path, 'utf8') === file.content
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

// A code answer: for each file either the whole new text ("contenido") or exact replacements ("cambios", each
// "buscar" must match exactly once). The factory applies the edits; the model never writes to disk.
function checkCodeBuild(root, taskId, value, scope) {
  const list = value?.ficheros
  if (!Array.isArray(list) || list.length === 0) return { ok: false, errors: ['answer must contain a non-empty "ficheros" list'] }
  if (list.length > MAX_CODE_FILES) return { ok: false, errors: [`too many files (max ${MAX_CODE_FILES})`] }

  const errors = []
  const files = []
  for (const item of list) {
    const path = typeof item?.ruta === 'string' ? posix.normalize(item.ruta) : ''
    if (!path || path.startsWith('/') || path.startsWith('..')) {
      errors.push(`invalid path "${item?.ruta}"`)
      continue
    }
    const denied = codePathError(root, taskId, path, scope)
    if (denied) {
      errors.push(denied)
      continue
    }
    if (files.some((f) => f.path === path)) {
      errors.push(`${path}: listed twice`)
      continue
    }
    const current = existsSync(join(root, path)) ? readFileSync(join(root, path), 'utf8') : null
    const edited = typeof item.contenido === 'string' && item.cambios === undefined ? item.contenido : applyEdits(path, current, item)
    if (typeof edited !== 'string') {
      errors.push(...edited.errors)
      continue
    }
    if (edited.trim() === '') {
      errors.push(`${path}: empty file`)
      continue
    }
    files.push({ path, content: edited.endsWith('\n') ? edited : `${edited}\n` })
  }
  return errors.length ? { ok: false, errors } : { ok: true, files }
}

// A visual answer: like a code answer (whole text or exact edits) over the files of the kind, and nothing the static
// check of lib/estilo.js refuses is ever accepted, so nothing unsafe is written or rendered.
function checkVisualBuild(root, surface, value) {
  const list = value?.ficheros
  if (!Array.isArray(list) || list.length === 0) return { ok: false, errors: ['answer must contain a non-empty "ficheros" list'] }
  if (list.length > MAX_FILES) return { ok: false, errors: [`too many files (max ${MAX_FILES})`] }

  const errors = []
  const files = []
  for (const item of list) {
    const path = typeof item?.ruta === 'string' ? posix.normalize(item.ruta) : ''
    if (!surface.files.includes(path)) {
      errors.push(`${path || `invalid path "${item?.ruta}"`}: not allowed for this kind of request (allowed: ${surface.files.join(', ')})`)
      continue
    }
    if (files.some((f) => f.path === path)) {
      errors.push(`${path}: listed twice`)
      continue
    }
    const current = existsSync(join(root, path)) ? readFileSync(join(root, path), 'utf8') : null
    const edited = typeof item.contenido === 'string' && item.cambios === undefined ? item.contenido : applyEdits(path, current, item)
    if (typeof edited !== 'string') {
      errors.push(...edited.errors)
      continue
    }
    if (edited.trim() === '') {
      errors.push(`${path}: empty file`)
      continue
    }
    files.push({ path, content: edited.endsWith('\n') ? edited : `${edited}\n` })
  }
  if (errors.length) return { ok: false, errors }
  const checked = checkEstilo(files, currentTexts(root, files))
  return checked.ok ? { ok: true, files } : { ok: false, errors: checked.errors }
}

function applyEdits(path, current, item) {
  if (!Array.isArray(item.cambios) || item.cambios.length === 0 || item.contenido !== undefined) {
    return { errors: [`${path}: give either "contenido" (the whole text) or "cambios" (a list of {buscar, reemplazar}), not both`] }
  }
  if (current === null) return { errors: [`${path}: does not exist yet, so it cannot be edited: use "contenido"`] }
  const errors = []
  let text = current
  for (const change of item.cambios) {
    if (typeof change?.buscar !== 'string' || change.buscar === '' || typeof change?.reemplazar !== 'string') {
      errors.push(`${path}: each change needs text in "buscar" and "reemplazar"`)
      continue
    }
    const matches = text.split(change.buscar).length - 1
    if (matches !== 1) {
      errors.push(`${path}: «${change.buscar.slice(0, 60)}» appears ${matches} times (it must appear exactly once)`)
      continue
    }
    text = text.replace(change.buscar, () => change.reemplazar)
  }
  return errors.length ? { errors } : text
}

function checkBuild(root, surface, assigned, value) {
  const list = value?.ficheros
  if (!Array.isArray(list) || list.length === 0) return { ok: false, errors: ['answer must contain a non-empty "ficheros" list'] }
  if (list.length > (surface.newFile ? 1 : MAX_FILES)) return { ok: false, errors: [`too many files (max ${surface.newFile ? 1 : MAX_FILES})`] }

  const errors = []
  const files = []
  for (const item of list) {
    const path = typeof item?.ruta === 'string' ? posix.normalize(item.ruta) : ''
    if (!path || path.startsWith('/') || path.startsWith('..')) {
      errors.push(`invalid path "${item?.ruta}"`)
      continue
    }
    // New-file kinds may only create the factory-named file in one of their folders; the others, only their listed files.
    if (surface.newFile ? !assigned.includes(path) : !surface.files.includes(path)) {
      errors.push(`${path}: not allowed for this kind of request (allowed: ${(surface.newFile ? assigned : surface.files).join(', ')})`)
      continue
    }
    if (files.some((f) => f.path === path)) {
      errors.push(`${path}: listed twice`)
      continue
    }
    if (surface.newFile && existsSync(join(root, path))) {
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

// What a code request may change, for the Builder to read: the domain and every feature, tests included.
// The Node-only loader (estado-node.js) is not offered: code of the factory may not import it.
function readCodeSources(root) {
  const sources = {}
  const add = (path) => {
    if (existsSync(join(root, path))) sources[path] = readFileSync(join(root, path), 'utf8')
  }
  const domain = join(root, 'src/domain')
  if (existsSync(domain)) {
    for (const name of readdirSync(domain).sort()) if ((name.endsWith('.js') && name !== 'estado-node.js') || name.endsWith('.test.mjs')) add(`src/domain/${name}`)
  }
  const features = join(root, 'src/features')
  if (existsSync(features)) {
    for (const entry of readdirSync(features, { withFileTypes: true }).filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
      for (const name of ['index.js', 'index.test.mjs']) add(`src/features/${entry.name}/${name}`)
    }
  }
  return sources
}

// Every brain/*.md, in name order: brand, tone and business decisions. Only humans write them.
function readBrain(root) {
  const dir = join(root, 'brain')
  if (!existsSync(dir)) return '(vacío)'
  return readdirSync(dir).filter((n) => n.endsWith('.md')).sort().map((n) => `### brain/${n}\n${readFileSync(join(dir, n), 'utf8').trim()}`).join('\n\n') || '(vacío)'
}

// design/system.md: the tokens and component rules of the site, synced from src/styles/ by people. The ux and ui reviewers judge against it.
function readDesign(root) {
  const file = join(root, 'design/system.md')
  return existsSync(file) ? readFileSync(file, 'utf8').trim() || '(vacío)' : '(vacío)'
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
  const code = ctx.surface.code
  // A prompt for the kind (`-estilo`) or for code (`-codigo`) replaces the general one when it exists.
  const suffix = ctx.surface.visual ? 'estilo' : code ? 'codigo' : null
  const variant = join(root, 'factory/prompts', `${station}-${suffix}.md`)
  const template = readFileSync(suffix && existsSync(variant) ? variant : join(root, 'factory/prompts', `${station}.md`), 'utf8')
  const where = code
    ? `Up to ${MAX_CODE_FILES} files. ${[
      ctx.surface.scope.includes('features') && `Features: a NEW one goes in src/features/tarea-${ctx.task.id}/index.js (+ index.test.mjs); to fix an existing one, edit its files listed below.`,
      ctx.surface.scope.includes('domain') && `Business rules: edit the src/domain/ files listed below, or add src/domain/tarea-${ctx.task.id}-<topic>.js and .test.mjs.`,
    ].filter(Boolean).join(' ')}`
    : ctx.surface.visual
    ? `Modify the files below (max ${MAX_FILES} files). You may only write: ${ctx.surface.files.join(', ')}. For each file give either "contenido" or "cambios".`
    : ctx.surface.newFile
    ? `Exactly one new file, at one of these paths (pick the folder that fits the request): ${ctx.assigned.join(' | ')}`
    : `Modify the files below (max ${MAX_FILES} files). You may only write: ${ctx.surface.files.join(', ')}`
  const vars = {
    AGENTS: ctx.agents,
    BRAIN: ctx.brain,
    DESIGN: ctx.design,
    PROFILE: ctx.task.profile,
    PROFILE_DESCRIPTION: ctx.profile.description,
    KINDS: Object.entries(ctx.kinds).map(([name, kind]) => `- ${name}: ${kind.description}`).join('\n'),
    KIND: ctx.kind ?? (ctx.profile.kinds ?? []).join(' | '),
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
