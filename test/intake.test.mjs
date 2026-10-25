import { test } from 'node:test'
import assert from 'node:assert/strict'
import { handleIntake } from '../lib/intake.js'
import { parseIssueBody } from '../scripts/factory.mjs'
import { onRequestPost } from '../functions/api/peticion.js'

const ENV = { TURNSTILE_SECRET: 's3cret', INTAKE_OPEN: '1', GITHUB_TOKEN: 'ghp_TOKEN', GITHUB_REPO: 'me/repo' }
const json = (data, status = 200) => new Response(JSON.stringify(data), { status })
const post = (body, raw = false) => new Request('https://x.test/api/peticion', { method: 'POST', body: raw ? body : JSON.stringify(body) })
const valid = { perfil: 'marketing', peticion: 'Pon un cohete en el muro', turnstile: 'tok' }

// Fake network: records calls, answers Turnstile, the issue list and issue creation.
function network({ turnstile = { success: true }, existing = 0, list, create } = {}) {
  const calls = []
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init })
    if (String(url).startsWith('https://challenges.cloudflare.com/')) return turnstile instanceof Error ? Promise.reject(turnstile) : json(turnstile)
    if (init.method === 'POST') return create ? create() : json({ number: 42 }, 201)
    return list ? list() : json(Array.from({ length: existing }, (_, i) => ({ number: i + 1 })))
  }
  return { calls, fetchImpl }
}

async function expectError(response, status, error) {
  assert.equal(response.status, status)
  assert.deepEqual(await response.json(), { error })
}

test('creates the issue and answers 201 with its number', async () => {
  const { calls, fetchImpl } = network()
  const response = await handleIntake(post(valid), ENV, fetchImpl)
  assert.equal(response.status, 201)
  assert.deepEqual(await response.json(), { tarea: 42 })

  const verify = calls[0]
  assert.equal(verify.url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify')
  assert.equal(verify.init.body.get('secret'), 's3cret')
  assert.equal(verify.init.body.get('response'), 'tok')

  assert.equal(calls[1].url, 'https://api.github.com/repos/me/repo/issues?labels=entrada&state=all&per_page=100')
  const create = calls[2]
  assert.equal(create.url, 'https://api.github.com/repos/me/repo/issues')
  assert.equal(create.init.headers.authorization, 'Bearer ghp_TOKEN')
  assert.equal(create.init.headers['user-agent'], 'charla-factory-intake')
  assert.equal(create.init.headers.accept, 'application/vnd.github+json')
  const issue = JSON.parse(create.init.body)
  assert.equal(issue.title, '[Marketing] Pon un cohete en el muro')
  assert.deepEqual(issue.labels, ['entrada', 'perfil:marketing'])
  assert.equal(issue.body, 'Petición desde la web.\n\n```json\n{"perfil":"marketing","peticion":"Pon un cohete en el muro"}\n```\n')
})

test('the issue body is one line that parseIssueBody reads back, even with newlines and backticks', async () => {
  const peticion = 'Línea uno\nlínea "dos" con ```código```'
  const { calls, fetchImpl } = network()
  await handleIntake(post({ ...valid, perfil: 'negocio', peticion }), ENV, fetchImpl)
  const issue = JSON.parse(calls[2].init.body)
  assert.equal(issue.title, '[Negocio] Línea uno línea "dos" con ```código```')
  assert.deepEqual(parseIssueBody(issue.body), { profile: 'negocio', request: peticion })
  assert.equal(issue.body.split('\n').filter((l) => l.startsWith('{')).length, 1)
})

test('the title keeps only the first 60 characters', async () => {
  const { calls, fetchImpl } = network()
  await handleIntake(post({ ...valid, peticion: 'a'.repeat(100) }), ENV, fetchImpl)
  assert.equal(JSON.parse(calls[2].init.body).title, `[Marketing] ${'a'.repeat(60)}`)
})

test('trims the request before validating and storing it', async () => {
  const { calls, fetchImpl } = network()
  await handleIntake(post({ ...valid, peticion: '  hola  ' }), ENV, fetchImpl)
  assert.deepEqual(parseIssueBody(JSON.parse(calls[2].init.body).body), { profile: 'marketing', request: 'hola' })
})

test('rejects bodies that are not a JSON object with 400', async () => {
  const { calls, fetchImpl } = network()
  for (const raw of ['not json', '', 'null', '[1]', '"x"']) {
    await expectError(await handleIntake(post(raw, true), ENV, fetchImpl), 400, 'La petición no es válida.')
  }
  assert.equal(calls.length, 0)
})

test('rejects an unknown or missing profile with 400', async () => {
  const { calls, fetchImpl } = network()
  for (const perfil of ['admin', '', undefined, 7, '__proto__', 'toString']) {
    await expectError(await handleIntake(post({ ...valid, perfil }), ENV, fetchImpl), 400, 'Elige un perfil válido.')
  }
  assert.equal(calls.length, 0)
})

test('rejects requests shorter than 3 or longer than 280 characters after trim', async () => {
  const message = 'Escribe una petición de 3 a 280 caracteres.'
  const { calls, fetchImpl } = network()
  for (const peticion of ['', '  ab  ', 'ab', undefined, 42, 'a'.repeat(281), `  ${'a'.repeat(281)}  `]) {
    await expectError(await handleIntake(post({ ...valid, peticion }), ENV, fetchImpl), 400, message)
  }
  assert.equal(calls.length, 0)
  for (const peticion of ['abc', 'a'.repeat(280), `  ${'a'.repeat(280)}  `]) {
    assert.equal((await handleIntake(post({ ...valid, peticion }), ENV, network().fetchImpl)).status, 201)
  }
})

test('rejects control characters other than newline', async () => {
  const { calls, fetchImpl } = network()
  for (const peticion of ['hola\u0000mundo', 'hola\u001bmundo', 'hola\rmundo', 'hola\tmundo', 'hola\u007fmundo']) {
    await expectError(await handleIntake(post({ ...valid, peticion }), ENV, fetchImpl), 400, 'La petición contiene caracteres no permitidos.')
  }
  assert.equal(calls.length, 0)
})

test('the stop switch answers 403 unless INTAKE_OPEN is exactly 1', async () => {
  for (const open of [undefined, '0', 'true', '']) {
    const { calls, fetchImpl } = network()
    await expectError(await handleIntake(post(valid), { ...ENV, INTAKE_OPEN: open }, fetchImpl), 403, 'La factory está cerrada')
    assert.equal(calls.length, 0)
  }
})

test('fails closed with 503 when the Turnstile secret is missing outside dev mode', async () => {
  const { calls, fetchImpl } = network()
  const message = 'El servicio no está disponible ahora mismo.'
  await expectError(await handleIntake(post(valid), { ...ENV, TURNSTILE_SECRET: undefined }, fetchImpl), 503, message)
  await expectError(await handleIntake(post(valid), { ...ENV, TURNSTILE_SECRET: '', INTAKE_DEV: '0' }, fetchImpl), 503, message)
  assert.equal(calls.length, 0)
})

test('fails closed with 503 when the GitHub token or repo is missing', async () => {
  const { calls, fetchImpl } = network()
  for (const missing of ['GITHUB_TOKEN', 'GITHUB_REPO']) {
    const response = await handleIntake(post(valid), { ...ENV, [missing]: undefined }, fetchImpl)
    await expectError(response, 503, 'El servicio no está disponible ahora mismo.')
  }
  assert.equal(calls.length, 0)
})

test('INTAKE_DEV=1 skips Turnstile only when there is no secret', async () => {
  const dev = network()
  const response = await handleIntake(post({ ...valid, turnstile: '' }), { ...ENV, TURNSTILE_SECRET: undefined, INTAKE_DEV: '1' }, dev.fetchImpl)
  assert.equal(response.status, 201)
  assert.ok(dev.calls.every((c) => !c.url.includes('cloudflare')))

  const prod = network({ turnstile: { success: false } })
  await expectError(await handleIntake(post(valid), { ...ENV, INTAKE_DEV: '1' }, prod.fetchImpl), 403, 'No hemos podido verificar que eres una persona.')
})

test('a failed Turnstile check answers 403 and creates nothing', async () => {
  for (const [turnstile, token] of [[{ success: false }, 'tok'], [{ success: true }, ''], [{ success: true }, undefined]]) {
    const { calls, fetchImpl } = network({ turnstile })
    await expectError(await handleIntake(post({ ...valid, turnstile: token }), ENV, fetchImpl), 403, 'No hemos podido verificar que eres una persona.')
    assert.ok(calls.every((c) => !c.url.includes('api.github.com')))
  }
})

test('Turnstile being unreachable answers 502', async () => {
  const { calls, fetchImpl } = network({ turnstile: new Error('boom ghp_TOKEN') })
  const response = await handleIntake(post(valid), ENV, fetchImpl)
  await expectError(response, 502, 'No hemos podido verificar que eres una persona. Inténtalo de nuevo.')
  assert.equal(calls.length, 1)
})

test('the cap answers 429 at INTAKE_MAX_TASKS (default 15) and creates nothing', async () => {
  const message = 'Hemos alcanzado el máximo de tareas de la charla.'
  const full = network({ existing: 15 })
  await expectError(await handleIntake(post(valid), ENV, full.fetchImpl), 429, message)
  assert.ok(full.calls.every((c) => c.init.method !== 'POST' || c.url.includes('cloudflare')))

  assert.equal((await handleIntake(post(valid), ENV, network({ existing: 14 }).fetchImpl)).status, 201)
  await expectError(await handleIntake(post(valid), { ...ENV, INTAKE_MAX_TASKS: '3' }, network({ existing: 3 }).fetchImpl), 429, message)
  assert.equal((await handleIntake(post(valid), { ...ENV, INTAKE_MAX_TASKS: '3' }, network({ existing: 2 }).fetchImpl)).status, 201)
  assert.equal((await handleIntake(post(valid), { ...ENV, INTAKE_MAX_TASKS: 'nope' }, network({ existing: 14 }).fetchImpl)).status, 201)
})

test('GitHub failures answer 502 without leaking details or the token', async () => {
  const message = 'No hemos podido registrar tu petición. Inténtalo de nuevo en un momento.'
  const leaky = () => json({ message: 'Bad credentials ghp_TOKEN', documentation_url: 'https://docs.github.com' }, 401)
  const cases = [
    network({ list: leaky }),
    network({ list: () => Promise.reject(new Error('ECONNRESET ghp_TOKEN')) }),
    network({ list: () => json({ message: 'nope' }) }),
    network({ create: leaky }),
    network({ create: () => Promise.reject(new Error('ECONNRESET ghp_TOKEN')) }),
    network({ create: () => json({ nothing: true }, 201) }),
  ]
  for (const { fetchImpl } of cases) {
    const response = await handleIntake(post(valid), ENV, fetchImpl)
    assert.equal(response.status, 502)
    const text = await response.text()
    assert.deepEqual(JSON.parse(text), { error: message })
    assert.ok(!text.includes('ghp_') && !text.includes('Bad credentials') && !text.includes('github'))
  }
})

test('the Pages Function delegates to the intake with the environment', async () => {
  const response = await onRequestPost({ request: post(valid), env: { ...ENV, INTAKE_OPEN: '0' } })
  await expectError(response, 403, 'La factory está cerrada')
})
