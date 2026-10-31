// Load test of the factory: which requests to file, and what happened to each one. Pure: GitHub, the deployed site
// and the clock are injected, so every timing is derived from fixtures in the tests.

import { issueFor } from './intake.js'
import { parseState, derivar } from './estado.js'
import { pullForTask } from './numbers.js'

export const PERFILES = ['marketing', 'producto', 'negocio']
export const STAGES = ['empezada', 'prAbierta', 'fusionada', 'desplegada']
const STAGE_LABELS = { empezada: 'arranque', prAbierta: 'PR abierta', fusionada: 'fusionada', desplegada: 'desplegada' }
const NEEDS_HUMAN = 'necesita-humano'

// --- What to file ---

// Profiles in equal parts (round robin), requests from the battery that the replay turns into a change, preferring
// the automatic route so that the whole way to production is measured. Deterministic.
export function planRequests(n, battery) {
  const changes = battery.filter((c) => c.esperado?.factory === 'ok')
  const pools = Object.fromEntries(PERFILES.map((perfil) => {
    const own = changes.filter((c) => c.perfil === perfil)
    const auto = own.filter((c) => c.esperado.ruta === 'auto')
    return [perfil, auto.length > 0 ? auto : own]
  }))
  return Array.from({ length: n }, (_, i) => {
    const perfil = PERFILES[i % PERFILES.length]
    const pool = pools[perfil]
    if (pool.length === 0) throw new Error(`the battery has no request for the profile ${perfil}`)
    return { perfil, peticion: pool[Math.floor(i / PERFILES.length) % pool.length].peticion }
  })
}

// Exactly what the intake would file.
export const issuesFor = (plan) => plan.map((p) => issueFor(p.perfil, p.peticion))

// --- Maths ---

// Nearest rank.
export function percentile(values, p) {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)]
}

export function resumen(values) {
  if (values.length === 0) return null
  return { n: values.length, mediana: percentile(values, 50), p90: percentile(values, 90), max: Math.max(...values) }
}

// --- State of each request ---

export function newTrack(issue) {
  return {
    numero: issue.number,
    perfil: issue.labels?.map((l) => l?.name).find((n) => typeof n === 'string' && n.startsWith('perfil:'))?.slice(7) ?? 'desconocido',
    creada: Date.parse(issue.created_at),
    empezada: null,
    prAbierta: null,
    fusionada: null,
    desplegada: null,
    mergeCommit: null,
    estado: 'en_curso',
    final: false,
  }
}

// One poll of one request. `desplegada`: the deployed commit contains its merge commit (decided by the caller, which
// owns the network). Timestamps GitHub gives (PR created / merged) are used as they are; the rest are the poll time
// at which the fact was first seen, so their precision is the polling interval.
export function observar(track, { issue, pulls, repo, desplegada }, now) {
  if (track.final || !issue) return track
  const state = parseState(issue.body)
  const pr = pullForTask(pulls, track.numero, repo)
  const next = { ...track }
  if (next.empezada === null && (state || pr)) next.empezada = now
  if (pr && next.prAbierta === null) next.prAbierta = Date.parse(pr.created_at)
  if (pr?.merged_at && next.fusionada === null) next.fusionada = Date.parse(pr.merged_at)
  next.mergeCommit = pr?.merge_commit_sha ?? state?.mergeCommit ?? next.mergeCommit
  if (next.desplegada === null && next.fusionada !== null && desplegada) next.desplegada = now

  const waiting = new Set(pr && pr.state === 'open' && (pr.labels ?? []).some((l) => l?.name === NEEDS_HUMAN) ? [pr.number] : [])
  const result = derivar(issue, { cola: waiting, estado: state }).resultadoFinal
  if (next.desplegada !== null) next.estado = 'desplegada'
  else if (next.fusionada !== null) next.estado = 'en_curso'
  else if (pr && pr.state === 'closed') next.estado = 'cerrada'
  else if (!state && issue.state === 'closed') next.estado = 'fallida'
  else if (result === 'desplegada') {
    next.estado = 'desplegada'
    next.desplegada = now
  } else next.estado = result
  next.final = next.estado !== 'en_curso'
  return next
}

// Follows the requests until each is final or the timeout. Per cycle: one issues list, one pulls list and one
// deploy.json read; a compare only for a (merge, deployed) pair never asked before.
export async function seguir({ tracks, repo, listIssues, listPulls, deployedCommit, contains, now, sleep, pollMs, timeoutMs }) {
  const start = now()
  const asked = new Map()
  let current = tracks
  for (;;) {
    try {
      const [issues, pulls] = await Promise.all([listIssues(), listPulls()])
      const deployed = await deployedCommit().catch(() => null)
      const t = now()
      const known = async (merge) => {
        if (!merge || !deployed) return false
        const key = `${merge}...${deployed}`
        if (!asked.has(key)) asked.set(key, await contains(merge, deployed).catch(() => null))
        const answer = asked.get(key)
        if (answer === null) asked.delete(key)
        return answer === true
      }
      const updated = []
      for (const track of current) {
        const view = { issue: issues.find((i) => i.number === track.numero), pulls, repo, desplegada: false }
        let next = observar(track, view, t)
        if (!next.final && next.fusionada !== null && await known(next.mergeCommit)) next = observar(next, { ...view, desplegada: true }, t)
        updated.push(next)
      }
      current = updated
    } catch {
      // A failed poll costs one cycle, not the run.
    }
    if (current.every((t) => t.final) || now() - start >= timeoutMs) return current
    await sleep(pollMs)
  }
}

// --- Report ---

const ms = (track, stage) => (track[stage] === null ? null : track[stage] - track.creada)

export function informe(tracks) {
  const filas = tracks.map((t) => ({
    numero: t.numero,
    perfil: t.perfil,
    estado: t.final ? t.estado : 'sin_terminar',
    ...Object.fromEntries(STAGES.map((s) => [s, ms(t, s)])),
  }))
  const estados = {}
  for (const f of filas) estados[f.estado] = (estados[f.estado] ?? 0) + 1
  const etapas = Object.fromEntries(STAGES.map((s) => [s, resumen(filas.map((f) => f[s]).filter((v) => v !== null))]))
  return { filas, estados, etapas, texto: render(filas, estados, etapas, tracks.length) }
}

const secs = (v) => (v === null ? '—' : `${(v / 1000).toFixed(1)} s`)

function render(filas, estados, etapas, total) {
  const head = ['tarea', 'perfil', 'estado', ...STAGES.map((s) => STAGE_LABELS[s])]
  const rows = [head, ...filas.map((f) => [`#${f.numero}`, f.perfil, f.estado, ...STAGES.map((s) => secs(f[s]))])]
  const widths = head.map((_, c) => Math.max(...rows.map((r) => r[c].length)))
  const table = rows.map((r) => r.map((cell, c) => cell.padEnd(widths[c])).join('  ').trimEnd())
  const aggregate = STAGES.map((s) => {
    const r = etapas[s]
    return r
      ? `  ${STAGE_LABELS[s].padEnd(11)} mediana ${secs(r.mediana)} · p90 ${secs(r.p90)} · max ${secs(r.max)} (${r.n}/${total})`
      : `  ${STAGE_LABELS[s].padEnd(11)} sin datos (0/${total})`
  })
  const counts = Object.entries(estados).map(([e, n]) => `${e}: ${n}`).join(' · ')
  return [
    'Tiempos desde que se crea la issue:',
    ...table,
    '',
    'Agregado (solo peticiones que llegaron a esa etapa):',
    ...aggregate,
    '',
    `Estados finales: ${counts}`,
  ].join('\n')
}
