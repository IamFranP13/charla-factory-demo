import { test } from 'node:test'
import assert from 'node:assert/strict'
import { handleIntake, handleAccess, TEST_COOKIE } from '../lib/intake.js'
import { onRequestGet } from '../functions/api/acceso.js'

// The rehearsal pass: with the form closed (INTAKE_OPEN not 1), only a browser that opened /api/acceso?clave=<key>
// may file requests. Turnstile and the cap still apply to it.
const KEY = 'k'.repeat(20) + 'ensayo-de-la-charla-2026'
const CLOSED = { TURNSTILE_SECRET: 's3cret', INTAKE_OPEN: '0', INTAKE_TEST_KEY: KEY, GITHUB_TOKEN: 'ghp_TOKEN', GITHUB_REPO: 'me/repo' }
const json = (data, status = 200) => new Response(JSON.stringify(data), { status })
const valid = { peticion: 'Pon un cohete en el muro', turnstile: 'tok' }

function network({ turnstile = { success: true }, existing = 0 } = {}) {
  const calls = []
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init })
    if (String(url).startsWith('https://challenges.cloudflare.com/')) return json(turnstile)
    if (init.method === 'POST') return json({ number: 42 }, 201)
    return json(Array.from({ length: existing }, (_, i) => ({ number: i + 1 })))
  }
  return { calls, fetchImpl }
}

const post = (cookie) => new Request('https://x.test/api/peticion', {
  method: 'POST',
  body: JSON.stringify(valid),
  headers: cookie ? { cookie } : {},
})
const intake = (request, env, fetchImpl) => handleIntake(request, env, fetchImpl, () => 0)
const access = (query, env = CLOSED) => handleAccess(new Request(`https://x.test/api/acceso${query}`), env)

async function expectError(response, status, error) {
  assert.equal(response.status, status)
  assert.deepEqual(await response.json(), { error })
}

// The cookie the access endpoint hands out for the given environment.
async function passFor(env = CLOSED) {
  const response = await access(`?clave=${encodeURIComponent(KEY)}`, env)
  const set = response.headers.get('set-cookie')
  return set.split(';')[0]
}

test('the right key answers 303 to the home page with an HttpOnly, Secure, SameSite=Strict cookie on /api', async () => {
  const response = await access(`?clave=${encodeURIComponent(KEY)}`)
  assert.equal(response.status, 303)
  assert.equal(response.headers.get('location'), '/')
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer')
  const set = response.headers.get('set-cookie')
  assert.match(set, new RegExp(`^${TEST_COOKIE}=[0-9a-f]{64}; Path=/api; Max-Age=2592000; HttpOnly; Secure; SameSite=Strict$`))
})

test('the cookie never carries the key itself', async () => {
  const cookie = await passFor()
  assert.equal(cookie.includes(KEY), false)
})

test('a wrong key answers 403 and sets no cookie', async () => {
  for (const query of ['?clave=otra', `?clave=${encodeURIComponent(KEY)}x`, '?clave=', '']) {
    const response = await access(query)
    assert.equal(response.headers.get('set-cookie'), null, query)
    await expectError(response, 403, 'Clave no válida.')
  }
})

test('without INTAKE_TEST_KEY, or with one shorter than 32 characters, nobody gets a pass', async () => {
  for (const INTAKE_TEST_KEY of [undefined, '', 'corta']) {
    const env = { ...CLOSED, INTAKE_TEST_KEY }
    const response = await access(`?clave=${encodeURIComponent(INTAKE_TEST_KEY ?? '')}`, env)
    assert.equal(response.headers.get('set-cookie'), null)
    await expectError(response, 503, 'El acceso de pruebas no está configurado.')
  }
})

test('?salir clears the cookie and goes home', async () => {
  const response = await access('?salir')
  assert.equal(response.status, 303)
  assert.equal(response.headers.get('location'), '/')
  assert.equal(response.headers.get('set-cookie'), `${TEST_COOKIE}=; Path=/api; Max-Age=0; HttpOnly; Secure; SameSite=Strict`)
})

test('the Pages Function delegates GET /api/acceso to the access handler', async () => {
  const response = await onRequestGet({ request: new Request(`https://x.test/api/acceso?clave=${encodeURIComponent(KEY)}`), env: CLOSED })
  assert.equal(response.status, 303)
})

test('closed form: without the pass, or with a wrong one, 403 and nothing is called', async () => {
  for (const cookie of [undefined, `${TEST_COOKIE}=${'0'.repeat(64)}`, `${TEST_COOKIE}=${KEY}`, `otra=1`]) {
    const { calls, fetchImpl } = network()
    await expectError(await intake(post(cookie), CLOSED, fetchImpl), 403, 'La factory está cerrada')
    assert.equal(calls.length, 0, String(cookie))
  }
})

test('closed form: the pass files the request, through Turnstile and the cap', async () => {
  const cookie = await passFor()
  const { calls, fetchImpl } = network()
  const response = await intake(post(`tema=claro; ${cookie}; otra=1`), CLOSED, fetchImpl)
  assert.equal(response.status, 201)
  assert.deepEqual(await response.json(), { tarea: 42, perfil: 'marketing' })
  assert.equal(calls[0].url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify')
  assert.equal(calls[2].init.method, 'POST')
})

test('closed form: the pass does not skip a failed Turnstile check', async () => {
  const { calls, fetchImpl } = network({ turnstile: { success: false } })
  await expectError(await intake(post(await passFor()), CLOSED, fetchImpl), 403, 'No hemos podido verificar que eres una persona.')
  assert.equal(calls.some((c) => c.init.method === 'POST' && c.url.startsWith('https://api.github.com/')), false)
})

test('closed form: the pass does not skip the cap', async () => {
  const { calls, fetchImpl } = network({ existing: 15 })
  await expectError(await intake(post(await passFor()), CLOSED, fetchImpl), 429, 'Hemos alcanzado el máximo de tareas de la charla.')
  assert.equal(calls.some((c) => c.init.method === 'POST' && c.url.startsWith('https://api.github.com/')), false)
})

test('closed form: a pass stops working when the key changes or is removed', async () => {
  const cookie = await passFor()
  for (const INTAKE_TEST_KEY of ['z'.repeat(40), undefined, 'corta']) {
    const { calls, fetchImpl } = network()
    await expectError(await intake(post(cookie), { ...CLOSED, INTAKE_TEST_KEY }, fetchImpl), 403, 'La factory está cerrada')
    assert.equal(calls.length, 0)
  }
})

test('open form: requests without a pass are filed as before', async () => {
  const { fetchImpl } = network()
  const response = await intake(post(), { ...CLOSED, INTAKE_OPEN: '1' }, fetchImpl)
  assert.equal(response.status, 201)
})

test('closed form: lookalike or malformed pass cookies do not pass', async () => {
  const pass = (await passFor()).split('=')[1]
  for (const cookie of [`x${TEST_COOKIE}=${pass}`, `${TEST_COOKIE}=`, TEST_COOKIE, `${TEST_COOKIE}="${pass}"`,
    `${TEST_COOKIE} = ${pass}`, `factory%5Fpruebas=${pass}`, `a=1, ${TEST_COOKIE}=${pass}`,
    `${TEST_COOKIE}=${pass.toUpperCase()}`, `${TEST_COOKIE}=${pass.slice(0, 63)}`, `${TEST_COOKIE}=bad; ${TEST_COOKIE}=${pass}`]) {
    const { calls, fetchImpl } = network()
    await expectError(await intake(post(cookie), CLOSED, fetchImpl), 403, 'La factory está cerrada')
    assert.equal(calls.length, 0, cookie)
  }
})

test('closed form: a pass never skips the 503 checks or a missing Turnstile token', async () => {
  const cookie = await passFor()
  for (const env of [{ ...CLOSED, GITHUB_TOKEN: '' }, { ...CLOSED, TURNSTILE_SECRET: '' }]) {
    const { calls, fetchImpl } = network()
    await expectError(await intake(post(cookie), env, fetchImpl), 503, 'El servicio no está disponible ahora mismo.')
    assert.equal(calls.length, 0)
  }
  const { calls, fetchImpl } = network()
  const request = new Request('https://x.test/api/peticion', { method: 'POST', body: JSON.stringify({ peticion: 'hola mundo' }), headers: { cookie } })
  await expectError(await intake(request, CLOSED, fetchImpl), 403, 'No hemos podido verificar que eres una persona.')
  assert.equal(calls.length, 0)
})

test('access: salir wins over clave, and a 31-character key gives no pass', async () => {
  assert.match((await access(`?clave=${encodeURIComponent(KEY)}&salir`)).headers.get('set-cookie'), /^factory_pruebas=; .*Max-Age=0/)
  const short = KEY.slice(0, 31)
  await expectError(await access(`?clave=${short}`, { ...CLOSED, INTAKE_TEST_KEY: short }), 503, 'El acceso de pruebas no está configurado.')
})
