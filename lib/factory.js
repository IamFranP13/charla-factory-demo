// The factory: Spec writer → Builder → reviewers (with one loop back to the Builder).
// Models only fill in content. Code decides paths, validates every file and keeps the score.

import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, posix } from 'node:path'
import { parse } from 'yaml'
import { validateFile } from './schemas.js'

const MAX_BUILDS = 2
const MAX_FILES = 2

// Files the factory created for the audience (content/*/tarea-<n>.json). Rehearsal copies of the
// repository leave them out, so tests and simulations behave the same before and after a talk.
export const isAudienceFile = (path) => /(^|[\\/])content[\\/][^\\/]+[\\/]tarea-\d+\.json$/.test(path)

export function loadProfiles(root) {
  return parse(readFileSync(join(root, 'factory/profiles.yaml'), 'utf8'))
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
    assignedPath: profile.newFile ? `${profile.folders[0]}tarea-${task.id}.json` : null,
    existing: profile.newFile ? {} : readExisting(root, profile.folders),
  }

  // 1. Spec writer
  const spec = await ask(provider, 'spec', ctx)
  if (!spec.ok) return done('failed')
  if (spec.value.rechazar) {
    trace(event('spec', 'rejected', spec.value.motivo ?? 'petición rechazada', spec))
    return done('rejected')
  }
  ctx.spec = spec.value
  trace(event('spec', 'ok', spec.value.resumen ?? '', spec))

  // 2. Builder, with one loop back on any failure or rejection
  let attempts = 0
  let lastRejection = null
  while (attempts < MAX_BUILDS) {
    attempts++
    const build = await ask(provider, 'build', ctx, { retries: 0 })
    if (!build.ok) {
      ctx.feedback = build.error
      continue
    }
    const checked = checkBuild(root, profile, ctx.assignedPath, build.value)
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

    // 3. Reviewers, in order; the first rejection goes back to the Builder
    lastRejection = null
    for (const station of profile.reviewers) {
      const review = await ask(reviewProvider, station, ctx)
      if (!review.ok) return done('failed', { attempts })
      if (review.value.aprobado === true) {
        trace(event(station, 'ok', review.value.motivo ?? '', review))
        continue
      }
      lastRejection = `${station}: ${review.value.motivo ?? 'rechazado'}`
      trace(event(station, 'rejected', review.value.motivo ?? 'rechazado', review))
      break
    }
    if (!lastRejection) return done('ok', { files: checked.files, attempts })
    ctx.feedback = lastRejection
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

function checkBuild(root, profile, assignedPath, value) {
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
    if (!profile.folders.some((f) => path.startsWith(f))) {
      errors.push(`${path}: not allowed for this profile (allowed: ${profile.folders.join(', ')})`)
      continue
    }
    if (profile.newFile && path !== assignedPath) {
      errors.push(`${path}: this profile must write exactly ${assignedPath}`)
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

function readExisting(root, folders) {
  const existing = {}
  for (const folder of folders) {
    const dir = join(root, folder)
    if (!existsSync(dir)) continue
    for (const name of readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
      existing[`${folder}${name}`] = readFileSync(join(dir, name), 'utf8')
    }
  }
  return existing
}

function messagesFor(root, station, ctx) {
  const template = readFileSync(join(root, 'factory/prompts', `${station === 'build' ? 'build' : station}.md`), 'utf8')
  const where = ctx.assignedPath
    ? `Exactly one new file: ${ctx.assignedPath}`
    : `Modify the files below, or create one new file in ${ctx.profile.folders[0]} (max ${MAX_FILES} files).`
  const vars = {
    AGENTS: ctx.agents,
    PROFILE: ctx.task.profile,
    PROFILE_DESCRIPTION: ctx.profile.description,
    REQUEST: ctx.task.request,
    SPEC: JSON.stringify(ctx.spec ?? {}, null, 2),
    WHERE: where,
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
