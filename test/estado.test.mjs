import { test } from 'node:test'
import assert from 'node:assert/strict'
import { handleEstado, derivar, createMemoryCache, STATION_LABELS, MENSAJES, enlaceFor } from '../lib/estado.js'
import { initialState, finishState, replaceState, replaceTrace, parseState, STATIONS } from '../lib/estado.js'

const NOW = '2026-10-27T10:00:00.000Z'
const SHA_A = 'a'.repeat(40)
const SHA_B = 'b'.repeat(40)
const env = { GITHUB_TOKEN: 'ghp_secret_token', GITHUB_REPO: 'o/r' }
const requestBlock = (peticion, perfil) => `Petición desde la web.\n\n\`\`\`json\n${JSON.stringify({ perfil, peticion })}\n\`\`\`\n`

const stationsAt = (upTo, value = 'ok') => Object.fromEntries(STATIONS.slice(0, STATIONS.indexOf(upTo) + 1).map((s) => [s, value]))
const withState = (perfil, change) => {
  const base = initialState(perfil, NOW)
  return { ...base, ...change, estaciones: { ...base.estaciones, ...change.estaciones } }
}
const issue = (number, perfil, state, over = {}) => ({
  number,
  title: `[${perfil}] titulo ${number}`,
  state: 'open',
  updated_at: NOW,
  labels: [{ name: 'entrada' }, { name: `perfil:${perfil}` }],
  body: state === null ? requestBlock('texto secreto de la petición', perfil) : replaceState(requestBlock('texto secreto de la petición', perfil), state),
  ...over,
})
const pull = (number, over = {}) => ({ number, title: `Tarea #${number} · negocio`, state: 'open', pull_request: {}, html_url: `https://github.com/o/r/pull/${number}`, body: `Closes #${number}`, labels: [{ name: 'necesita-humano' }], ...over })

// A fake GitHub + same-origin /deploy.json. Records every call.
function fakeFetch({ issues = [], pulls = [], deploy = { commit: SHA_B, builtAt: NOW }, compare = {}, fail = null, prs = {}, checks = {} } = {}) {
  const calls = []
  const fn = async (url, init = {}) => {
    const u = String(url)
    calls.push(u)
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status })
    if (fail && u.includes(fail)) return json({ message: 'Bad credentials ghp_secret_token' }, 401)
    if (u.includes('/issues?labels=entrada')) return json(issues)
    if (u.includes('/issues?labels=necesita-humano')) return json(pulls)
    if (u.endsWith('/deploy.json')) return deploy === null ? json({}, 404) : json(deploy)
    const pr = /\/pulls\/(\d+)$/.exec(u)
    if (pr) return prs[pr[1]] ? json(prs[pr[1]]) : json({ message: 'Not Found' }, 404)
    const runs = /\/commits\/([0-9a-f]+)\/check-runs\?check_name=build$/.exec(u)
    if (runs) return json({ check_runs: checks[runs[1]] ?? [] })
    const m = /\/compare\/([0-9a-f]+)\.\.\.([0-9a-f]+)$/.exec(u)
    if (m) return compare[m[1]] ? json({ status: compare[m[1]] }) : json({ message: 'Not Found' }, 404)
    return json({ message: 'unexpected' }, 500)
  }
  fn.calls = calls
  return fn
}
const request = (query = '') => new Request(`https://limonia.example/api/estado${query}`)
const call = async (fetchImpl, { query = '', extra = {}, confirmadas = new Map(), cache = createMemoryCache(() => 0), e = env } = {}) => {
  const r = await handleEstado(request(query), e, fetchImpl, { cache, confirmadas, now: () => 0, ...extra })
  return { r, body: await r.json() }
}

// One task per final: built from the real state helpers.
const merged = withState('marketing', { fase: 'produccion', resultado: 'ok', pr: 3, ruta: 'auto', mergeCommit: SHA_A, estaciones: { ...stationsAt('merge'), produccion: 'pendiente' } })
const scenarios = () => [
  issue(1, 'marketing', withState('marketing', { fase: 'build', estaciones: { ...stationsAt('spec'), build: 'en_curso' } })),
  issue(2, 'negocio', withState('negocio', { fase: 'puerta', resultado: 'ok', pr: 9, ruta: 'human', estaciones: { ...stationsAt('approver'), puerta: 'en_curso' } })),
  issue(3, 'marketing', merged, { state: 'closed' }),
  issue(4, 'marketing', finishState(withState('marketing', { fase: 'ui', estaciones: { ...stationsAt('build'), ui: 'rechazada', approver: 'rechazada' } }), 'rejected', NOW, 'ui: el color no es de la marca')),
  issue(5, 'producto', finishState(withState('producto', { fase: 'build', estaciones: { ...stationsAt('spec'), build: 'ok' } }), 'unchanged', NOW, 'sin cambios')),
  issue(6, 'negocio', finishState(withState('negocio', { fase: 'spec', estaciones: { spec: 'error' } }), 'failed', NOW, 'el modelo no responde')),
  issue(7, 'negocio', withState('negocio', { fase: 'puerta', resultado: 'ok', pr: 12, ruta: 'human', estaciones: { ...stationsAt('approver'), puerta: 'rechazada' } }), { state: 'closed' }),
  issue(8, 'marketing', null),
]
const byNumber = (body) => Object.fromEntries(body.tareas.map((t) => [t.numero, t]))

test('shape: tareas, cola and contadores; only the issue title, never the request text', async () => {
  const f = fakeFetch({ issues: scenarios(), pulls: [pull(9)] })
  const { r, body } = await call(f)
  assert.equal(r.status, 200)
  assert.match(r.headers.get('content-type'), /application\/json/)
  assert.deepEqual(Object.keys(body).sort(), ['actualizado', 'cola', 'contadores', 'tareas'])
  const t = byNumber(body)[1]
  for (const key of ['numero', 'titulo', 'perfil', 'fase', 'estaciones', 'resultado', 'pr', 'ruta', 'actualizado', 'resultadoFinal', 'mensaje', 'estacion']) assert.ok(key in t, key)
  assert.equal(t.titulo, '[marketing] titulo 1')
  assert.deepEqual(Object.keys(t.estaciones), STATIONS)
  const text = JSON.stringify(body)
  assert.doesNotMatch(text, /texto secreto/)
  assert.doesNotMatch(text, /ghp_|factory:state|Bearer/)
  assert.deepEqual(body.tareas.map((x) => x.numero), [8, 7, 6, 5, 4, 3, 2, 1], 'newest first')
})

test('it reads GitHub with two calls (issues entrada, PRs necesita-humano) and the token', async () => {
  const seen = []
  const f = fakeFetch({ issues: [], pulls: [] })
  const spy = async (url, init) => { seen.push({ url: String(url), headers: init?.headers }); return f(url, init) }
  await call(spy)
  const gh = seen.filter((s) => s.url.startsWith('https://api.github.com/'))
  assert.equal(gh.length, 2)
  assert.ok(gh.some((s) => s.url === 'https://api.github.com/repos/o/r/issues?labels=entrada&state=all&per_page=100'))
  assert.ok(gh.some((s) => s.url === 'https://api.github.com/repos/o/r/issues?labels=necesita-humano&state=open&per_page=100'))
  for (const s of gh) assert.equal(s.headers.authorization, 'Bearer ghp_secret_token')
})

test('resultadoFinal is derived for every ending, in Spanish', async () => {
  const f = fakeFetch({ issues: scenarios(), pulls: [pull(9)], compare: {} })
  const { body } = await call(f)
  const t = byNumber(body)
  assert.equal(t[1].resultadoFinal, 'en_curso')
  assert.equal(t[2].resultadoFinal, 'esperando_persona')
  assert.equal(t[3].resultadoFinal, 'en_curso', 'merged but production not confirmed yet')
  assert.equal(t[4].resultadoFinal, 'rechazada')
  assert.equal(t[4].motivo, 'ui: el color no es de la marca')
  assert.equal(t[5].resultadoFinal, 'sin_cambios')
  assert.equal(t[6].resultadoFinal, 'fallida')
  assert.equal(t[6].motivo, 'el modelo no responde')
  assert.equal(t[7].resultadoFinal, 'cerrada')
  assert.equal(t[1].mensaje, 'Tu petición está en la factory')
  assert.equal(t[2].mensaje, MENSAJES.esperando_persona)
  assert.equal(MENSAJES.desplegada, 'Ya está en la web')
  for (const k of ['en_curso', 'esperando_persona', 'desplegada', 'rechazada', 'sin_cambios', 'fallida', 'cerrada']) assert.ok(MENSAJES[k], k)
})

test('a human gate refusal on a PR that is still open is still waiting for a person', async () => {
  const issues = [issue(7, 'negocio', withState('negocio', { fase: 'puerta', resultado: 'ok', pr: 12, ruta: 'human', estaciones: { ...stationsAt('approver'), puerta: 'rechazada' } }))]
  const { body } = await call(fakeFetch({ issues, pulls: [pull(12, { body: 'Closes #7' })] }))
  assert.equal(body.tareas[0].resultadoFinal, 'esperando_persona')
})

test('cola: PR, task, title and link; the task comes from the state, the PR title or "Closes #n"', async () => {
  const pulls = [pull(9), pull(40, { title: 'otra cosa', body: 'Closes #1' }), pull(41, { title: 'Tarea #4 · x', body: 'nada' }), pull(50, { pull_request: undefined })]
  const { body } = await call(fakeFetch({ issues: scenarios(), pulls }))
  assert.deepEqual(body.cola.find((c) => c.pr === 9), { pr: 9, tarea: 2, titulo: '[negocio] titulo 2', url: 'https://github.com/o/r/pull/9' })
  assert.equal(body.cola.find((c) => c.pr === 40).tarea, 1)
  assert.equal(body.cola.find((c) => c.pr === 41).tarea, 4)
  assert.equal(body.cola.some((c) => c.pr === 50), false, 'plain issues are not pull requests')
})

test('a task without marker: entrada ok, the rest pendiente, en_curso; the profile comes from the label', async () => {
  const { body } = await call(fakeFetch({ issues: [issue(8, 'negocio', null)] }))
  const t = body.tareas[0]
  assert.equal(t.resultadoFinal, 'en_curso')
  assert.equal(t.perfil, 'negocio')
  assert.equal(t.estaciones.entrada, 'ok')
  for (const s of STATIONS.slice(1)) assert.equal(t.estaciones[s], 'pendiente', s)
  assert.equal(t.fase, 'entrada')
  assert.equal(t.estacion, 'entrada')
})

test('production: identical or ahead means desplegada, behind or diverged keeps the task waiting', async () => {
  for (const [status, expected] of [['identical', 'desplegada'], ['ahead', 'desplegada'], ['behind', 'en_curso'], ['diverged', 'en_curso']]) {
    const f = fakeFetch({ issues: [issue(3, 'marketing', merged, { state: 'closed' })], compare: { [SHA_A]: status } })
    const { body } = await call(f)
    assert.equal(body.tareas[0].resultadoFinal, expected, status)
    assert.equal(body.tareas[0].estaciones.produccion, expected === 'desplegada' ? 'ok' : 'pendiente', status)
    assert.ok(f.calls.includes(`https://api.github.com/repos/o/r/compare/${SHA_A}...${SHA_B}`), status)
    assert.ok(f.calls.includes('https://limonia.example/deploy.json'))
  }
})

test('production is only checked for merged tasks that are not in production yet', async () => {
  const done = withState('marketing', { ...merged, estaciones: { ...merged.estaciones, produccion: 'ok' } })
  const noSha = withState('marketing', { ...merged, mergeCommit: undefined })
  const f = fakeFetch({ issues: [issue(3, 'marketing', done), issue(4, 'marketing', noSha), issue(1, 'marketing', null)] })
  const { body } = await call(f)
  assert.equal(f.calls.filter((c) => c.includes('/compare/')).length, 0)
  assert.equal(f.calls.some((c) => c.endsWith('/deploy.json')), false, 'no deploy.json read when nothing needs confirming')
  assert.equal(byNumber(body)[3].resultadoFinal, 'desplegada')
  assert.equal(byNumber(body)[4].resultadoFinal, 'en_curso')
})

test('a confirmed production is remembered: no more compare calls for that task', async () => {
  const confirmadas = new Map()
  const issues = [issue(3, 'marketing', merged, { state: 'closed' })]
  const first = fakeFetch({ issues, compare: { [SHA_A]: 'ahead' } })
  await call(first, { confirmadas })
  assert.equal(first.calls.filter((c) => c.includes('/compare/')).length, 1)
  const second = fakeFetch({ issues, compare: {} })
  const { body } = await call(second, { confirmadas })
  assert.equal(second.calls.filter((c) => c.includes('/compare/')).length, 0)
  assert.equal(body.tareas[0].resultadoFinal, 'desplegada')
  const unconfirmed = new Map()
  const third = fakeFetch({ issues, compare: { [SHA_A]: 'behind' } })
  await call(third, { confirmadas: unconfirmed })
  assert.equal(unconfirmed.size, 0, 'only confirmed results are remembered')
})

test('if /deploy.json or the compare call fails, the task simply stays where it was', async () => {
  const issues = [issue(3, 'marketing', merged, { state: 'closed' })]
  for (const f of [fakeFetch({ issues, deploy: null }), fakeFetch({ issues, deploy: { commit: 'nope' } }), fakeFetch({ issues, compare: {} })]) {
    const { r, body } = await call(f)
    assert.equal(r.status, 200)
    assert.equal(body.tareas[0].resultadoFinal, 'en_curso')
  }
})

test('contadores: totals and the number of tasks at each station', async () => {
  const { body } = await call(fakeFetch({ issues: scenarios(), pulls: [pull(9)], compare: { [SHA_A]: 'ahead' } }))
  const c = body.contadores
  assert.equal(c.peticiones, 8)
  assert.equal(c.desplegadas, 1)
  assert.equal(c.esperando, 1)
  assert.equal(c.rechazadas, 1)
  assert.equal(c.fallidas, 1)
  assert.equal(c.sin_cambios, 1)
  assert.equal(c.cerradas, 1)
  assert.equal(c.en_curso, 2)
  assert.deepEqual(Object.keys(c.porEstacion), STATIONS)
  assert.equal(Object.values(c.porEstacion).reduce((a, b) => a + b, 0), 8)
  assert.equal(c.porEstacion.produccion, 1)
  assert.equal(byNumber(body)[2].estacion, 'puerta')
  assert.equal(byNumber(body)[4].estacion, 'ui', 'a rejected task sits at the station that refused')
})

test('?tarea=N returns just that task and its queue entry; unknown tasks are a Spanish 404', async () => {
  const f = fakeFetch({ issues: scenarios(), pulls: [pull(9), pull(60, { title: 'Tarea #1 · x', body: 'Closes #1' })] })
  const { r, body } = await call(f, { query: '?tarea=2' })
  assert.equal(r.status, 200)
  assert.deepEqual(body.tareas.map((t) => t.numero), [2])
  assert.deepEqual(body.cola.map((c) => c.pr), [9])
  for (const q of ['?tarea=999', '?tarea=abc', '?tarea=-1', '?tarea=2%20OR']) {
    const res = await call(fakeFetch({ issues: scenarios() }), { query: q })
    assert.equal(res.r.status, 404, q)
    assert.match(res.body.error, /No encontramos/)
    assert.deepEqual(Object.keys(res.body), ['error'])
  }
})

test('GitHub failures answer 502 with a generic Spanish message and leak nothing', async () => {
  for (const fail of ['labels=entrada', 'labels=necesita-humano']) {
    const { r, body } = await call(fakeFetch({ issues: scenarios(), fail }))
    assert.equal(r.status, 502)
    assert.deepEqual(Object.keys(body), ['error'])
    assert.match(body.error, /No hemos podido/)
    assert.doesNotMatch(JSON.stringify(body), /ghp_|Bad credentials|401/)
  }
  const thrown = async () => { throw new Error('connect ECONNREFUSED ghp_secret_token') }
  const res = await call(thrown)
  assert.equal(res.r.status, 502)
  assert.doesNotMatch(JSON.stringify(res.body), /ghp_|ECONNREFUSED/)
  const notArray = async () => new Response(JSON.stringify({ message: 'x' }), { status: 200 })
  assert.equal((await call(notArray)).r.status, 502)
})

test('without token or repo the endpoint is unavailable (503), not a crash', async () => {
  for (const e of [{}, { GITHUB_TOKEN: 'x' }, { GITHUB_REPO: 'o/r' }]) {
    const { r, body } = await call(fakeFetch(), { e })
    assert.equal(r.status, 503)
    assert.deepEqual(Object.keys(body), ['error'])
  }
})

test('the whole answer is cached for 10 seconds, and the cache is bypassed after that', async () => {
  let clock = 0
  const cache = createMemoryCache(() => clock)
  const f = fakeFetch({ issues: scenarios(), pulls: [] })
  const run = (query = '') => handleEstado(request(query), env, f, { cache, confirmadas: new Map(), now: () => clock })
  const first = await run()
  assert.equal(first.status, 200)
  const used = f.calls.length
  clock = 9_000
  const second = await run('?tarea=1')
  assert.equal(f.calls.length, used, 'served from cache, filter applied on top')
  assert.deepEqual((await second.json()).tareas.map((t) => t.numero), [1])
  clock = 10_001
  await run()
  assert.ok(f.calls.length > used)
  assert.match(first.headers.get('cache-control'), /max-age=10/)
})

test('errors are never cached', async () => {
  const cache = createMemoryCache(() => 0)
  const bad = fakeFetch({ fail: 'labels=entrada' })
  assert.equal((await call(bad, { cache })).r.status, 502)
  const good = fakeFetch({ issues: scenarios() })
  assert.equal((await call(good, { cache })).r.status, 200)
})

test('the Cache API is used when available', async () => {
  const store = new Map()
  const cache = { match: async (k) => store.get(k.url ?? k)?.clone(), put: async (k, v) => { store.set(k.url ?? k, v) } }
  const f = fakeFetch({ issues: scenarios() })
  const run = () => handleEstado(request(), env, f, { cache, confirmadas: new Map() })
  await run()
  const used = f.calls.length
  const again = await run()
  assert.equal(f.calls.length, used)
  assert.equal(again.status, 200)
})

test('derivar: the files rule says where a deployed change is visible', () => {
  assert.equal(enlaceFor('marketing'), '/')
  assert.equal(enlaceFor('producto'), '/catalogo/')
  assert.equal(enlaceFor('negocio'), '/presupuesto/')
  assert.equal(enlaceFor('desconocido'), '/')
  const t = derivar(issue(3, 'negocio', { ...merged, perfil: 'negocio', estaciones: { ...merged.estaciones, produccion: 'ok' } }), { cola: new Set() })
  assert.equal(t.resultadoFinal, 'desplegada')
  assert.equal(t.enlace, '/presupuesto/')
  assert.equal(derivar(issue(1, 'negocio', null), { cola: new Set() }).enlace, null, 'no link until it is deployed')
})

test('derivar: vueltas says how many times the approver sent the task back; an old state without it derives 0', () => {
  assert.equal(derivar(issue(5, 'marketing', { ...withState('marketing', {}), vueltas: 1 }), { cola: new Set() }).vueltas, 1)
  assert.equal(derivar(issue(5, 'marketing', withState('marketing', {})), { cola: new Set() }).vueltas, 0)
  assert.equal(derivar(issue(6, 'marketing', null), { cola: new Set() }).vueltas, 0, 'no marker yet')
  assert.equal(derivar(issue(7, 'marketing', { ...withState('marketing', {}), vueltas: '2' }), { cola: new Set() }).vueltas, 0, 'a forged value never reaches the board')
})

test('the station labels are the ones of the talk diagram', () => {
  assert.deepEqual(STATIONS.map((s) => STATION_LABELS[s]), ['Entrada', 'Spec writer', 'Builder', 'Seguridad', 'UX', 'UI', 'Código', 'Approver', '¿Humano?', 'Main o PR', 'Producción'])
})

// A factory PR whose CI ("build") fails can never merge: the audience sees it blocked by the tests.
const atMerge = (pr, ruta = 'auto') => withState('marketing', { fase: 'merge', resultado: 'ok', pr, ruta, estaciones: { ...stationsAt('puerta'), merge: 'en_curso' } })
const run = (conclusion, status = 'completed') => ({ name: 'build', status, conclusion })

test('a factory PR whose CI fails is "bloqueada_tests": Main in red with the reason, counted apart', async () => {
  const f = fakeFetch({
    issues: [issue(20, 'marketing', atMerge(30)), issue(21, 'marketing', atMerge(31)), issue(22, 'marketing', atMerge(32))],
    prs: { 30: { state: 'open', merged: false, head: { sha: SHA_A } }, 31: { state: 'open', merged: false, head: { sha: SHA_B } }, 32: { state: 'open', merged: false, head: { sha: 'c'.repeat(40) } } },
    checks: { [SHA_A]: [run('failure')], [SHA_B]: [run(null, 'in_progress')], ['c'.repeat(40)]: [run('success')] },
  })
  const { body } = await call(f)
  const t = byNumber(body)
  assert.equal(t[20].resultadoFinal, 'bloqueada_tests')
  assert.equal(t[20].mensaje, 'Los tests automáticos han bloqueado tu cambio')
  assert.equal(t[20].motivo, 'Los tests automáticos (CI) han fallado')
  assert.equal(t[20].estacion, 'merge')
  assert.equal(t[20].estaciones.merge, 'rechazada')
  assert.equal(t[21].resultadoFinal, 'en_curso', 'CI still running')
  assert.equal(t[22].resultadoFinal, 'en_curso', 'CI green, merge on its way')
  assert.equal(body.contadores.bloqueadas_tests, 1)
})

test('the CI is only asked about for tasks waiting to merge, never for finished ones', async () => {
  const f = fakeFetch({ issues: scenarios(), pulls: [pull(9)], compare: { [SHA_A]: 'ahead' } })
  await call(f)
  assert.equal(f.calls.filter((u) => /\/pulls\/\d+$|check-runs/.test(u)).length, 0)
})

test('if the CI cannot be read the task simply stays en_curso', async () => {
  const f = fakeFetch({ issues: [issue(20, 'marketing', atMerge(30))], prs: {} })
  const { r, body } = await call(f)
  assert.equal(r.status, 200)
  assert.equal(byNumber(body)[20].resultadoFinal, 'en_curso')
})

test('replaceTrace: replaces the trace in place, keeps request and state, and bounds the size', () => {
  const request = requestBlock('Una campaña', 'marketing')
  const withState = replaceState(request, initialState('marketing', NOW))
  const once = replaceTrace(withState, 'Cabecera', ['uno', 'dos'])
  const twice = replaceTrace(replaceState(once, initialState('marketing', NOW)), 'Cabecera', ['uno', 'dos', 'tres'])
  assert.equal(twice.match(/<!-- factory:trace -->/g).length, 1)
  assert.match(twice, /tres/)
  assert.ok(twice.startsWith(request.trimEnd()))
  assert.equal(parseState(twice).perfil, 'marketing')
  const huge = replaceTrace(withState, 'Cabecera', Array.from({ length: 500 }, () => 'x'.repeat(2000)))
  assert.ok(huge.length < 40000, `got ${huge.length}`)
  assert.match(huge, /…/)
  assert.equal(parseState(huge).perfil, 'marketing')
})

test('replaceTrace: trace markers typed inside the request are data, never the trace', () => {
  const request = requestBlock('hola <!-- factory:trace --> x <!-- /factory:trace --> adiós', 'marketing')
  const withState = replaceState(request, initialState('marketing', NOW))
  const once = replaceTrace(withState, 'Cabecera', ['uno'])
  const twice = replaceTrace(replaceState(once, initialState('marketing', NOW)), 'Cabecera', ['uno', 'dos'])
  for (const body of [once, twice]) {
    assert.ok(body.startsWith(request.trimEnd()))
    assert.equal(parseState(body).perfil, 'marketing')
  }
  assert.equal(twice.match(/Cabecera/g).length, 1)
  assert.match(twice, /dos/)
})
