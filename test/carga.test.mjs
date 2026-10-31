import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { issueFor } from '../lib/intake.js'
import { parseIssueBody } from '../scripts/factory.mjs'
import { initialState, replaceState, finishState, applyEvent } from '../lib/estado.js'
import {
  planRequests, issuesFor, percentile, resumen, newTrack, observar, seguir, informe,
} from '../lib/carga.js'

const battery = JSON.parse(readFileSync(new URL('./battery.json', import.meta.url), 'utf8'))
const script = new URL('../scripts/carga.mjs', import.meta.url).pathname
const REPO = 'owner/repo'
const T0 = Date.parse('2026-01-01T10:00:00Z')
const MERGE = 'a'.repeat(40)
const DEPLOYED = 'b'.repeat(40)

// An issue as GitHub lists it after the intake (or `gh`) filed it, with an optional factory state.
function issue(number, { perfil = 'marketing', peticion = 'Una campaña que diga «hola»', state = null, closed = false } = {}) {
  const filed = issueFor(perfil, peticion)
  return {
    number,
    title: filed.title,
    labels: filed.labels.map((name) => ({ name })),
    body: state ? replaceState(filed.body, state) : filed.body,
    state: closed ? 'closed' : 'open',
    created_at: new Date(T0).toISOString(),
  }
}
const pull = (number, task, extra = {}) => ({
  number, head: { ref: `tarea/${task}`, repo: { full_name: REPO } }, created_at: new Date(T0 + 20_000).toISOString(),
  merged_at: null, state: 'open', labels: [], merge_commit_sha: null, ...extra,
})
const running = () => applyEvent(initialState('marketing', '2026-01-01T10:00:05Z'), { station: 'spec', status: 'en_curso' })

test('planRequests: equal profile split, only requests the replay turns into a change', () => {
  const plan = planRequests(9, battery)
  assert.equal(plan.length, 9)
  for (const perfil of ['marketing', 'producto', 'negocio']) assert.equal(plan.filter((p) => p.perfil === perfil).length, 3)
  const ok = new Set(battery.filter((c) => c.esperado.factory === 'ok').map((c) => c.peticion))
  for (const p of plan) assert.ok(ok.has(p.peticion), p.peticion)
  for (const p of plan) assert.equal(battery.find((c) => c.peticion === p.peticion).perfil, p.perfil)
  assert.deepEqual(planRequests(9, battery), plan)
  assert.equal(planRequests(7, battery).filter((p) => p.perfil === 'marketing').length, 3)
  assert.deepEqual(planRequests(0, battery), [])
})

test('planRequests: prefers requests that take the automatic route', () => {
  const auto = new Set(battery.filter((c) => c.esperado.factory === 'ok' && c.esperado.ruta === 'auto').map((c) => c.peticion))
  for (const p of planRequests(30, battery)) assert.ok(auto.has(p.peticion), p.peticion)
})

test('issuesFor: identical to the intake issue and readable by parseIssueBody', () => {
  const plan = planRequests(6, battery)
  const issues = issuesFor(plan)
  assert.deepEqual(issues, plan.map((p) => issueFor(p.perfil, p.peticion)))
  issues.forEach((i, k) => {
    assert.deepEqual(parseIssueBody(i.body), { profile: plan[k].perfil, request: plan[k].peticion })
    assert.ok(i.labels.includes('entrada') && i.labels.includes(`perfil:${plan[k].perfil}`))
  })
})

test('percentile and resumen: nearest rank, empty input', () => {
  assert.equal(percentile([5, 1, 3, 2, 4, 10, 8, 7, 9, 6], 50), 5)
  assert.equal(percentile([5, 1, 3, 2, 4, 10, 8, 7, 9, 6], 90), 9)
  assert.equal(percentile([4], 90), 4)
  assert.equal(percentile([], 50), null)
  assert.deepEqual(resumen([1000, 3000, 2000]), { n: 3, mediana: 2000, p90: 3000, max: 3000 })
  assert.equal(resumen([]), null)
})

test('observar: a request deployed gets every timestamp, and nothing is lost between polls', () => {
  let track = newTrack(issue(1))
  track = observar(track, { issue: issue(1), pulls: [], repo: REPO, desplegada: false }, T0 + 2000)
  assert.equal(track.empezada, null)
  assert.equal(track.estado, 'en_curso')

  const started = issue(1, { state: running() })
  track = observar(track, { issue: started, pulls: [], repo: REPO, desplegada: false }, T0 + 5000)
  assert.equal(track.empezada, T0 + 5000)

  const done = { ...finishState(running(), 'ok'), pr: 7, ruta: 'auto' }
  const withPr = issue(1, { state: done })
  track = observar(track, { issue: withPr, pulls: [pull(7, 1)], repo: REPO, desplegada: false }, T0 + 25_000)
  assert.equal(track.empezada, T0 + 5000)
  assert.equal(track.prAbierta, T0 + 20_000)
  assert.equal(track.estado, 'en_curso')

  const merged = pull(7, 1, { state: 'closed', merged_at: new Date(T0 + 40_000).toISOString(), merge_commit_sha: MERGE })
  track = observar(track, { issue: withPr, pulls: [merged], repo: REPO, desplegada: false }, T0 + 45_000)
  assert.equal(track.fusionada, T0 + 40_000)
  assert.equal(track.mergeCommit, MERGE)
  assert.equal(track.estado, 'en_curso')

  track = observar(track, { issue: withPr, pulls: [merged], repo: REPO, desplegada: true }, T0 + 90_000)
  assert.equal(track.desplegada, T0 + 90_000)
  assert.equal(track.estado, 'desplegada')
  assert.equal(track.final, true)
  // Once deployed, later polls do not move the timestamps.
  const later = observar(track, { issue: withPr, pulls: [merged], repo: REPO, desplegada: true }, T0 + 200_000)
  assert.equal(later.desplegada, T0 + 90_000)
})

test('observar: final states that never reach production', () => {
  const at = (i, pulls = [], extra = {}) => observar(newTrack(i), { issue: i, pulls, repo: REPO, desplegada: false }, T0 + 9000)
  const rejected = at(issue(2, { state: finishState(running(), 'rejected', undefined, 'no') }))
  assert.equal(rejected.estado, 'rechazada')
  assert.equal(rejected.final, true)
  assert.equal(rejected.prAbierta, null)

  assert.equal(at(issue(3, { state: finishState(running(), 'failed') })).estado, 'fallida')
  assert.equal(at(issue(4, { state: finishState(running(), 'unchanged') })).estado, 'sin_cambios')
  // The runner closes an issue the factory could not start without leaving a marker.
  assert.equal(at(issue(5, { closed: true })).estado, 'fallida')

  const human = { ...finishState(running(), 'ok'), pr: 9, ruta: 'human' }
  const waiting = at(issue(6, { state: human }), [pull(9, 6, { labels: [{ name: 'necesita-humano' }] })])
  assert.equal(waiting.estado, 'esperando_persona')
  assert.equal(waiting.final, true)
  assert.equal(waiting.prAbierta, T0 + 20_000)

  const closedPr = at(issue(7, { state: { ...finishState(running(), 'ok'), pr: 10, ruta: 'auto' } }), [pull(10, 7, { state: 'closed' })])
  assert.equal(closedPr.estado, 'cerrada')
})

test('informe: per-request table, aggregates over what happened, status counts', () => {
  const base = (n, extra) => ({ ...newTrack(issue(n)), ...extra })
  const tracks = [
    base(1, { perfil: 'marketing', empezada: T0 + 5000, prAbierta: T0 + 20_000, fusionada: T0 + 40_000, desplegada: T0 + 90_000, estado: 'desplegada', final: true }),
    base(2, { perfil: 'producto', empezada: T0 + 7000, prAbierta: T0 + 30_000, fusionada: T0 + 50_000, desplegada: T0 + 130_000, estado: 'desplegada', final: true }),
    base(3, { perfil: 'negocio', empezada: T0 + 6000, estado: 'rechazada', final: true }),
    base(4, { perfil: 'negocio', empezada: T0 + 6000, prAbierta: T0 + 25_000, estado: 'esperando_persona', final: true }),
    base(5, { perfil: 'marketing', estado: 'en_curso', final: false }),
  ]
  const r = informe(tracks)
  assert.deepEqual(r.estados, { desplegada: 2, rechazada: 1, esperando_persona: 1, sin_terminar: 1 })
  assert.deepEqual(r.etapas.empezada, { n: 4, mediana: 6000, p90: 7000, max: 7000 })
  assert.deepEqual(r.etapas.prAbierta, { n: 3, mediana: 25_000, p90: 30_000, max: 30_000 })
  assert.deepEqual(r.etapas.fusionada, { n: 2, mediana: 40_000, p90: 50_000, max: 50_000 })
  assert.deepEqual(r.etapas.desplegada, { n: 2, mediana: 90_000, p90: 130_000, max: 130_000 })
  assert.equal(r.filas.length, 5)
  assert.equal(r.filas[0].numero, 1)
  assert.equal(r.filas[0].desplegada, 90_000)
  assert.equal(r.filas[2].desplegada, null)
  assert.match(r.texto, /#1/)
  assert.match(r.texto, /mediana/i)
  assert.match(r.texto, /sin_terminar/)
})

// A scripted GitHub: `world(t)` returns what the lists show at poll number t.
function harness(world, { timeoutMs = 600_000, deployedAt = () => null } = {}) {
  let clock = T0
  const calls = { issues: 0, pulls: 0, deploy: 0, compare: 0 }
  const deps = {
    repo: REPO,
    listIssues: async () => { calls.issues++; return world(clock).issues },
    listPulls: async () => { calls.pulls++; return world(clock).pulls },
    deployedCommit: async () => { calls.deploy++; return deployedAt(clock) },
    contains: async (merge, deployed) => { calls.compare++; return deployed === DEPLOYED && merge === MERGE },
    now: () => clock,
    sleep: async (ms) => { clock += ms },
    pollMs: 5000,
    timeoutMs,
  }
  return { deps, calls }
}

test('seguir: follows requests until each is final, one list call per cycle', async () => {
  const done = { ...finishState(running(), 'ok'), pr: 7, ruta: 'auto' }
  const world = (t) => {
    const s = t - T0
    const mergedPull = pull(7, 1, { state: 'closed', merged_at: new Date(T0 + 30_000).toISOString(), merge_commit_sha: MERGE })
    return {
      issues: [
        issue(1, { state: s >= 10_000 ? done : null }),
        issue(2, { state: finishState(running(), 'rejected', undefined, 'no') }),
      ],
      pulls: s >= 15_000 ? [s >= 30_000 ? mergedPull : pull(7, 1)] : [],
    }
  }
  const { deps, calls } = harness(world, { deployedAt: (t) => (t - T0 >= 50_000 ? DEPLOYED : 'c'.repeat(40)) })
  const tracks = await seguir({ ...deps, tracks: [newTrack(world(T0).issues[0]), newTrack(world(T0).issues[1])] })
  assert.equal(tracks[0].estado, 'desplegada')
  assert.equal(tracks[0].desplegada, T0 + 50_000)
  assert.equal(tracks[1].estado, 'rechazada')
  assert.ok(tracks.every((t) => t.final))
  assert.equal(calls.issues, calls.pulls)
  assert.equal(calls.issues, 11)
  // The same (merge, deployed) pair is asked only once.
  assert.ok(calls.compare <= 2, `compare calls: ${calls.compare}`)
})

test('seguir: a request that never deploys ends at the timeout as unfinished, and polling stops', async () => {
  const done = { ...finishState(running(), 'ok'), pr: 7, ruta: 'auto' }
  const merged = pull(7, 1, { state: 'closed', merged_at: new Date(T0 + 30_000).toISOString(), merge_commit_sha: MERGE })
  const { deps, calls } = harness(() => ({ issues: [issue(1, { state: done })], pulls: [merged] }), { timeoutMs: 20_000, deployedAt: () => 'c'.repeat(40) })
  const [track] = await seguir({ ...deps, tracks: [newTrack(issue(1))] })
  assert.equal(track.final, false)
  assert.equal(track.desplegada, null)
  assert.equal(track.fusionada, T0 + 30_000)
  assert.ok(calls.issues <= 5)
  assert.match(informe([track]).texto, /sin_terminar/)
})

test('seguir: a failing poll does not end the follow-up', async () => {
  let n = 0
  const rejected = issue(1, { state: finishState(running(), 'rejected', undefined, 'no') })
  const { deps } = harness(() => ({ issues: [rejected], pulls: [] }))
  const flaky = { ...deps, listIssues: async () => { if (n++ === 0) throw new Error('boom'); return [rejected] } }
  const [track] = await seguir({ ...flaky, tracks: [newTrack(rejected)] })
  assert.equal(track.estado, 'rechazada')
})

// A gh that fails the test if it is ever called, and records it.
test('--dry-run prints what it would file and creates nothing', () => {
  const r = spawnSync(process.execPath, [script, '--n', '3', '--dry-run', '--repo', REPO], {
    encoding: 'utf8',
    env: { PATH: '/nonexistent', HOME: '/nonexistent' },
  })
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /\[Marketing\]/)
  assert.match(r.stdout, /\[Producto\]/)
  assert.match(r.stdout, /\[Negocio\]/)
  assert.match(r.stdout, /simulación|no se crea/i)
  assert.doesNotMatch(r.stdout, /reset-demo/)
})

test('--help documents the options; bad arguments fail', () => {
  const help = spawnSync(process.execPath, [script, '--help'], { encoding: 'utf8' })
  assert.equal(help.status, 0)
  for (const flag of ['--n', '--json', '--timeout-min', '--repo', '--dry-run', '--site']) assert.ok(help.stdout.includes(flag), flag)
  assert.match(help.stdout, /reset-demo/)
  for (const args of [[], ['--n', '0'], ['--n', 'x'], ['--n', '101'], ['--n', '2', '--timeout-min', '0'], ['--nope']]) {
    const r = spawnSync(process.execPath, [script, ...args, '--dry-run'], { encoding: 'utf8' })
    assert.notEqual(r.status, 0, args.join(' '))
  }
})
