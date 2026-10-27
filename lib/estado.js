// Task state and the public status API. Pure and web-standard (no Node imports): it runs on Cloudflare Workers,
// in the browser and under Node tests. scripts/ and lib/factory.js re-use the state helpers from here.

// --- Task state: one comment in the issue body, read by the board in a single API call ---

export const STATIONS = ['entrada', 'spec', 'build', 'seguridad', 'ux', 'ui', 'codigo', 'approver', 'puerta', 'merge', 'produccion']
const STATION_VALUES = ['pendiente', 'en_curso', 'ok', 'rechazada', 'error']
const RESULTS = ['ok', 'rejected', 'failed', 'unchanged']
const ROUTES = ['auto', 'human']
const MARKER = /<!-- factory:state (.+?) -->/g
export const REVIEWERS = ['seguridad', 'ux', 'ui']
const MAX_MOTIVO = 160
const SHA = /^[0-9a-f]{40}$/
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
    // Optional: absent until a station refuses / the pull request is merged.
    ...(cleanMotivo(raw?.motivo) && { motivo: cleanMotivo(raw.motivo) }),
    ...(typeof raw?.mergeCommit === 'string' && SHA.test(raw.mergeCommit) && { mergeCommit: raw.mergeCommit }),
  }
}

// Plain text, one line, at most 160 characters: the reason a station refused or failed.
function cleanMotivo(value) {
  if (typeof value !== 'string') return null
  const text = Array.from(value.replace(/[\u0000-\u001f\u007f\u2028\u2029\s]+/g, ' ').trim()).slice(0, MAX_MOTIVO).join('').trim()
  return text || null
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

// The factory is done: record its result. A task that passed waits at the gate; one that stopped stays where it stopped,
// with the reason the station gave.
export function finishState(state, status, now = new Date().toISOString(), motivo = null) {
  const next = normalizeState(state)
  next.resultado = status
  delete next.motivo
  if (status === 'ok') next.fase = 'puerta'
  else if (cleanMotivo(motivo)) next.motivo = motivo
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


// --- /api/estado: what the public pages read (board at /factory, follow-up at /tarea) ---

export const STATION_LABELS = {
  entrada: 'Entrada',
  spec: 'Spec writer',
  build: 'Builder',
  seguridad: 'Seguridad',
  ux: 'UX',
  ui: 'UI',
  codigo: 'Código',
  approver: 'Approver',
  puerta: '¿Humano?',
  merge: 'Main o PR',
  produccion: 'Producción',
}

export const MENSAJES = {
  en_curso: 'Tu petición está en la factory',
  esperando_persona: 'Tu petición espera a una persona que la revise',
  desplegada: 'Ya está en la web',
  rechazada: 'La factory ha rechazado tu petición',
  sin_cambios: 'No hacía falta cambiar nada: la web ya era así',
  fallida: 'La factory no ha podido con tu petición',
  cerrada: 'Una persona ha cerrado el cambio sin publicarlo',
}

// Where a deployed change can be seen. The state does not keep file paths, but the profile fixes the folder family:
// Marketing writes campaigns (home), Producto writes products and destinations (catalogue),
// Negocio changes prices, discounts and transport (quote calculator).
const VISIBLE_IN = { marketing: '/', producto: '/catalogo/', negocio: '/presupuesto/' }
export const enlaceFor = (perfil) => VISIBLE_IN[perfil] ?? '/'

const CACHE_SECONDS = 10
const MAX_TITLE = 120
const GITHUB = 'https://api.github.com'
const ERROR_502 = 'No hemos podido consultar la factory. Inténtalo de nuevo en un momento.'
const ERROR_404 = 'No encontramos esa petición.'
const ERROR_503 = 'El seguimiento no está disponible ahora mismo.'

// The station a task is at: the one working, else the one that refused or failed, else the last phase.
function currentStation(state) {
  return STATIONS.find((s) => state.estaciones[s] === 'en_curso') ?? STATIONS.find((s) => ['rechazada', 'error'].includes(state.estaciones[s])) ?? state.fase
}

// `cola`: the numbers of the open pull requests labelled necesita-humano.
function finalResult(state, cola) {
  if (state.resultado === 'unchanged') return 'sin_cambios'
  if (state.resultado === 'failed') return 'fallida'
  if (state.resultado === 'rejected') return 'rechazada'
  if (state.estaciones.produccion === 'ok') return 'desplegada'
  const waiting = state.pr !== null && cola.has(state.pr)
  if (state.estaciones.merge === 'rechazada') return 'cerrada'
  if (state.estaciones.puerta === 'rechazada') return waiting ? 'esperando_persona' : 'cerrada'
  if (state.estaciones.merge === 'ok') return 'en_curso'
  if (state.estaciones.puerta !== 'ok' && (waiting || (state.ruta === 'human' && state.pr !== null))) return 'esperando_persona'
  return 'en_curso'
}

// One issue (as GitHub lists it) → one public task. A task without marker has just entered the factory.
export function derivar(issue, { cola = new Set(), estado = parseState(issue.body) } = {}) {
  const labelled = (issue.labels ?? []).map((l) => l?.name).find((n) => typeof n === 'string' && n.startsWith('perfil:'))
  const state = estado ?? initialState(labelled?.slice(7), issue.updated_at)
  const resultadoFinal = finalResult(state, cola)
  return {
    numero: issue.number,
    titulo: String(issue.title ?? '').slice(0, MAX_TITLE),
    perfil: state.perfil,
    fase: state.fase,
    estaciones: state.estaciones,
    resultado: state.resultado,
    pr: state.pr,
    ruta: state.ruta,
    actualizado: state.actualizado,
    resultadoFinal,
    mensaje: MENSAJES[resultadoFinal],
    estacion: resultadoFinal === 'desplegada' ? 'produccion' : currentStation(state),
    motivo: state.motivo ?? null,
    enlace: resultadoFinal === 'desplegada' ? enlaceFor(state.perfil) : null,
  }
}

const json = (status, body, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
})

// Production confirmations never change back: remembered for the life of the worker.
const CONFIRMADAS = new Map()

// Fallback when the Cache API is not there (tests, local dev): the same 10 seconds, in memory.
export function createMemoryCache(now = Date.now) {
  const store = new Map()
  return {
    async match(key) {
      const hit = store.get(key.url ?? String(key))
      return hit && now() - hit.at < CACHE_SECONDS * 1000 ? hit.response.clone() : undefined
    },
    async put(key, response) {
      store.set(key.url ?? String(key), { at: now(), response: response.clone() })
    },
  }
}
const MEMORY = createMemoryCache()

export async function handleEstado(request, env = {}, fetchImpl = fetch, { cache = globalThis.caches?.default ?? MEMORY, confirmadas = CONFIRMADAS } = {}) {
  if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) return json(503, { error: ERROR_503 })
  const url = new URL(request.url)
  const wanted = url.searchParams.get('tarea')

  // The cache holds the full answer; ?tarea=N is a filter on top of it.
  const key = new Request(`${url.origin}${url.pathname}`)
  let full = null
  try {
    const hit = await cache.match(key)
    if (hit) full = await hit.json()
  } catch {
    full = null
  }
  if (!full) {
    try {
      full = await build(url.origin, env, fetchImpl, confirmadas)
    } catch {
      return json(502, { error: ERROR_502 })
    }
    try {
      await cache.put(key, json(200, full, { 'cache-control': `public, max-age=${CACHE_SECONDS}` }))
    } catch {
      // A cache that cannot be written only costs GitHub calls.
    }
  }

  if (wanted === null) return json(200, full, { 'cache-control': `public, max-age=${CACHE_SECONDS}` })
  const tarea = /^\d{1,9}$/.test(wanted) ? full.tareas.find((t) => t.numero === Number(wanted)) : undefined
  if (!tarea) return json(404, { error: ERROR_404 })
  return json(200, { ...full, tareas: [tarea], cola: full.cola.filter((c) => c.tarea === tarea.numero) }, { 'cache-control': `public, max-age=${CACHE_SECONDS}` })
}

async function build(origin, env, fetchImpl, confirmadas) {
  const headers = {
    authorization: `Bearer ${env.GITHUB_TOKEN}`,
    accept: 'application/vnd.github+json',
    'user-agent': 'charla-factory-estado',
    'x-github-api-version': '2022-11-28',
  }
  const api = `${GITHUB}/repos/${env.GITHUB_REPO}`
  const read = async (url) => {
    const response = await fetchImpl(url, { headers })
    if (!response.ok) throw new Error('github')
    const list = await response.json()
    if (!Array.isArray(list)) throw new Error('github')
    return list
  }
  const [issues, labelled] = await Promise.all([
    read(`${api}/issues?labels=entrada&state=all&per_page=100`),
    read(`${api}/issues?labels=necesita-humano&state=open&per_page=100`),
  ])

  const entries = issues.filter((i) => !i.pull_request && Number.isInteger(i.number))
  const states = new Map(entries.map((i) => [i.number, parseState(i.body)]))
  const queue = labelled.filter((p) => p.pull_request && Number.isInteger(p.number))
  const owner = (pr) => {
    const byState = [...states].find(([, s]) => s?.pr === pr.number)?.[0]
    const named = /^Tarea #(\d+)\b/.exec(pr.title ?? '')?.[1] ?? /^Closes #(\d+)\b/.exec(pr.body ?? '')?.[1]
    return byState ?? (named ? Number(named) : null)
  }

  await confirmProduction(origin, api, headers, fetchImpl, entries, states, confirmadas)

  const cola = new Set(queue.map((p) => p.number))
  const tareas = entries
    .map((i) => derivar(i, { cola, estado: states.get(i.number) }))
    .sort((a, b) => b.numero - a.numero)
  const titles = new Map(tareas.map((t) => [t.numero, t.titulo]))
  return {
    tareas,
    cola: queue.map((p) => {
      const tarea = owner(p)
      return { pr: p.number, tarea, titulo: titles.get(tarea) ?? String(p.title ?? '').slice(0, MAX_TITLE), url: `https://github.com/${env.GITHUB_REPO}/pull/${p.number}` }
    }),
    contadores: counters(tareas),
    actualizado: new Date().toISOString(),
  }
}

// A merged task is in production when the deployed commit contains its merge commit:
// compare {merge}...{deployed} says "identical" or "ahead". The repository is public: no extra permissions.
async function confirmProduction(origin, api, headers, fetchImpl, entries, states, confirmadas) {
  const pending = []
  for (const issue of entries) {
    const state = states.get(issue.number)
    if (!state || state.estaciones.merge !== 'ok' || state.estaciones.produccion === 'ok' || !state.mergeCommit) continue
    if (confirmadas.has(`${api}#${issue.number}#${state.mergeCommit}`)) markDeployed(state)
    else pending.push([issue.number, state])
  }
  if (pending.length === 0) return

  let deployed = null
  try {
    const response = await fetchImpl(`${origin}/deploy.json`)
    const commit = response.ok ? (await response.json())?.commit : null
    deployed = typeof commit === 'string' && SHA.test(commit) ? commit : null
  } catch {
    deployed = null
  }
  if (!deployed) return

  await Promise.all(pending.map(async ([number, state]) => {
    try {
      let status = 'identical'
      if (deployed !== state.mergeCommit) {
        const response = await fetchImpl(`${api}/compare/${state.mergeCommit}...${deployed}`, { headers })
        if (!response.ok) return
        status = (await response.json())?.status
      }
      if (status !== 'identical' && status !== 'ahead') return
      confirmadas.set(`${api}#${number}#${state.mergeCommit}`, true)
      markDeployed(state)
    } catch {
      // Not confirmed yet: the task stays where it was.
    }
  }))
}

function markDeployed(state) {
  state.estaciones.produccion = 'ok'
  state.fase = 'produccion'
}

function counters(tareas) {
  const count = (result) => tareas.filter((t) => t.resultadoFinal === result).length
  return {
    peticiones: tareas.length,
    desplegadas: count('desplegada'),
    esperando: count('esperando_persona'),
    rechazadas: count('rechazada'),
    fallidas: count('fallida'),
    sin_cambios: count('sin_cambios'),
    cerradas: count('cerrada'),
    en_curso: count('en_curso'),
    porEstacion: Object.fromEntries(STATIONS.map((s) => [s, tareas.filter((t) => t.estacion === s).length])),
  }
}
