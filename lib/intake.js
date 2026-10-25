// Public intake: validates a request from the form and files it as a GitHub issue.
// Web-standard APIs only (fetch, Response, JSON): it runs on Cloudflare Workers and under Node tests.

const PROFILES = { marketing: 'Marketing', producto: 'Producto', negocio: 'Negocio' }
const MIN_LENGTH = 3
const MAX_LENGTH = 280
const DEFAULT_MAX_TASKS = 15
const TURNSTILE_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
const LABEL = 'entrada'

// Everything below U+0020 and DEL, except newline.
const CONTROL_CHARS = /[\u0000-\u0009\u000b-\u001f\u007f]/

const reply = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
})
const fail = (status, error) => reply(status, { error })

export async function handleIntake(request, env = {}, fetchImpl = fetch) {
  const dev = env.INTAKE_DEV === '1'
  const secret = env.TURNSTILE_SECRET
  // Fail closed: without a Turnstile secret nothing gets through unless dev mode is explicit.
  if ((!secret && !dev) || !env.GITHUB_TOKEN || !env.GITHUB_REPO) return fail(503, 'El servicio no está disponible ahora mismo.')
  if (env.INTAKE_OPEN !== '1') return fail(403, 'La factory está cerrada')

  let input
  try {
    input = await request.json()
  } catch {
    return fail(400, 'La petición no es válida.')
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return fail(400, 'La petición no es válida.')

  const { perfil, turnstile } = input
  if (typeof perfil !== 'string' || !Object.hasOwn(PROFILES, perfil)) return fail(400, 'Elige un perfil válido.')
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
  const limit = Number.isInteger(max) && max >= 0 ? max : DEFAULT_MAX_TASKS
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
    return reply(201, { tarea: issue.number })
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
