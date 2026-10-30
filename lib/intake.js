// Public intake: validates a request from the form and files it as a GitHub issue.
// Web-standard APIs only (fetch, Response, JSON): it runs on Cloudflare Workers and under Node tests.

const PROFILES = { marketing: 'Marketing', producto: 'Producto', negocio: 'Negocio' }
const MIN_LENGTH = 3
export const MAX_LENGTH = 150
const DEFAULT_MAX_TASKS = 15
// The issue list is read in one page of 100, so a higher cap could never trigger.
const MAX_TASKS_CEILING = 100
const TURNSTILE_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
const LABEL = 'entrada'

// Everything below U+0020 and DEL, except newline; plus the Unicode line separators the factory's parser cannot read.
const CONTROL_CHARS = /[\u0000-\u0009\u000b-\u001f\u007f\u2028\u2029]/

const reply = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
})
const fail = (status, error) => reply(status, { error })

// The server draws the profile in equal parts: nobody chooses which part of the company they speak for.
export async function handleIntake(request, env = {}, fetchImpl = fetch, random = Math.random) {
  const dev = env.INTAKE_DEV === '1'
  const secret = env.TURNSTILE_SECRET
  // Fail closed: without a Turnstile secret nothing gets through unless dev mode is explicit.
  if ((!secret && !dev) || !env.GITHUB_TOKEN || !env.GITHUB_REPO) return fail(503, 'El servicio no está disponible ahora mismo.')
  if (env.INTAKE_OPEN !== '1' && !(await hasTestPass(request, env))) return fail(403, 'La factory está cerrada')

  let input
  try {
    input = await request.json()
  } catch {
    return fail(400, 'La petición no es válida.')
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return fail(400, 'La petición no es válida.')

  const { turnstile } = input
  const keys = Object.keys(PROFILES)
  const perfil = keys[Math.min(keys.length - 1, Math.floor(random() * keys.length))]
  if (typeof input.peticion !== 'string') return fail(400, `Escribe una petición de ${MIN_LENGTH} a ${MAX_LENGTH} caracteres.`)
  const peticion = input.peticion.trim()
  const length = Array.from(peticion).length
  if (length < MIN_LENGTH || length > MAX_LENGTH) return fail(400, `Escribe una petición de ${MIN_LENGTH} a ${MAX_LENGTH} caracteres.`)
  if (CONTROL_CHARS.test(peticion)) return fail(400, 'La petición contiene caracteres no permitidos.')

  if (secret) {
    const verified = await verifyTurnstile(fetchImpl, secret, turnstile, request.headers.get('CF-Connecting-IP'))
    if (verified === null) return fail(502, 'No hemos podido verificar que eres una persona. Inténtalo de nuevo.')
    if (!verified) return fail(403, 'No hemos podido verificar que eres una persona.')
  }

  const max = Number.parseInt(env.INTAKE_MAX_TASKS, 10)
  // The cap check (count, then create) is not atomic: concurrent requests can overshoot it slightly.
  // Accepted for a talk.
  const limit = Math.min(Number.isInteger(max) && max >= 0 ? max : DEFAULT_MAX_TASKS, MAX_TASKS_CEILING)
  const headers = {
    authorization: `Bearer ${env.GITHUB_TOKEN}`,
    accept: 'application/vnd.github+json',
    'user-agent': 'charla-factory-intake',
    'x-github-api-version': '2022-11-28',
  }
  const api = `https://api.github.com/repos/${env.GITHUB_REPO}/issues`
  const unavailable = () => fail(502, 'No hemos podido registrar tu petición. Inténtalo de nuevo en un momento.')

  try {
    const list = await fetchImpl(`${api}?labels=${LABEL}&state=all&per_page=100`, { headers })
    if (!list.ok) return unavailable()
    const issues = await list.json()
    if (!Array.isArray(issues)) return unavailable()
    if (issues.length >= limit) return fail(429, 'Hemos alcanzado el máximo de tareas de la charla.')

    const created = await fetchImpl(api, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify(issueFor(perfil, peticion)),
    })
    if (!created.ok) return unavailable()
    const issue = await created.json()
    if (!Number.isInteger(issue?.number)) return unavailable()
    return reply(201, { tarea: issue.number, perfil })
  } catch {
    return unavailable()
  }
}

// Title, labels and the one-line JSON block that `parseIssueBody` reads back.
export function issueFor(perfil, peticion) {
  const head = Array.from(peticion.replace(/\s+/g, ' ')).slice(0, 60).join('').trim()
  return {
    title: `[${PROFILES[perfil]}] ${head}`,
    labels: [LABEL, `perfil:${perfil}`],
    body: `Petición desde la web.\n\n\`\`\`json\n${JSON.stringify({ perfil, peticion })}\n\`\`\`\n`,
  }
}

// Rehearsal pass: with the form closed, only a browser that opened /api/acceso?clave=<INTAKE_TEST_KEY> may file requests
// (Turnstile and the cap still apply). The cookie carries an HMAC of the key, never the key: changing or removing
// INTAKE_TEST_KEY revokes every pass. A key shorter than 32 characters counts as no key (fail closed).
export const TEST_COOKIE = 'factory_pruebas'
const MIN_TEST_KEY = 32
const PASS_DAYS = 30
const COOKIE_ATTRIBUTES = 'Path=/api; Max-Age=%s; HttpOnly; Secure; SameSite=Strict'

const testKey = (env) => (typeof env.INTAKE_TEST_KEY === 'string' && env.INTAKE_TEST_KEY.length >= MIN_TEST_KEY ? env.INTAKE_TEST_KEY : null)

async function passFor(key) {
  const hmacKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = await crypto.subtle.sign('HMAC', hmacKey, new TextEncoder().encode('factory-pruebas'))
  return Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, '0')).join('')
}

// Same length and every character compared: the time does not reveal how much of a guess was right.
function sameText(a, b) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

async function hasTestPass(request, env) {
  const key = testKey(env)
  if (!key) return false
  const cookies = (request.headers.get('cookie') ?? '').split(';').map((c) => c.trim())
  const sent = cookies.find((c) => c.startsWith(`${TEST_COOKIE}=`))?.slice(TEST_COOKIE.length + 1)
  return typeof sent === 'string' && sameText(sent, await passFor(key))
}

const home = (cookie) => new Response(null, {
  status: 303,
  headers: { location: '/', 'set-cookie': cookie, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' },
})

// GET /api/acceso?clave=<key> hands out the pass; GET /api/acceso?salir takes it back.
export async function handleAccess(request, env = {}) {
  const params = new URL(request.url).searchParams
  if (params.has('salir')) return home(`${TEST_COOKIE}=; ${COOKIE_ATTRIBUTES.replace('%s', '0')}`)
  const key = testKey(env)
  if (!key) return fail(503, 'El acceso de pruebas no está configurado.')
  if (!sameText(params.get('clave') ?? '', key)) return fail(403, 'Clave no válida.')
  return home(`${TEST_COOKIE}=${await passFor(key)}; ${COOKIE_ATTRIBUTES.replace('%s', String(PASS_DAYS * 24 * 60 * 60))}`)
}

// true = human, false = rejected, null = could not ask Cloudflare.
async function verifyTurnstile(fetchImpl, secret, token, ip) {
  if (typeof token !== 'string' || !token) return false
  const form = new URLSearchParams({ secret, response: token })
  if (ip) form.set('remoteip', ip)
  try {
    const response = await fetchImpl(TURNSTILE_URL, { method: 'POST', body: form })
    if (!response.ok) return null
    return (await response.json()).success === true
  } catch {
    return null
  }
}
