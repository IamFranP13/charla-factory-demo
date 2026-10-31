import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resultFromComments, summarize, renderNumbers, pullForTask } from '../lib/numbers.js'

const BOT = { login: 'github-actions[bot]' }
const marker = (o) => `✅ **Resultado: ok**\n\n<!-- factory:result ${JSON.stringify(o)} -->`

test('reads the last factory result marker among the issue comments', () => {
  const comments = [
    { body: 'hola' },
    { user: BOT, body: marker({ status: 'failed', usage: { input: 1, output: 1 }, ms: 1 }) },
    { user: BOT, body: marker({ status: 'ok', usage: { input: 100, output: 20 }, ms: 4000 }) },
  ]
  assert.deepEqual(resultFromComments(comments), { status: 'ok', usage: { input: 100, output: 20 }, ms: 4000 })
  assert.equal(resultFromComments([{ body: 'nada' }]), null)
  assert.equal(resultFromComments([{ user: BOT, body: '<!-- factory:result {roto -->' }]), null)
})

test('summarize counts in main, blocked, rejected, failed, pending, tokens, cost and mean time', () => {
  const tasks = [
    { result: { status: 'ok', usage: { input: 1000, output: 200 }, ms: 30000 }, pr: { merged: true } },
    { result: { status: 'ok', usage: { input: 2000, output: 400 }, ms: 50000 }, pr: { merged: false, blocked: true } },
    { result: { status: 'rejected', usage: { input: 500, output: 50 }, ms: 10000 }, pr: null },
    { result: { status: 'failed', usage: { input: 0, output: 0 }, ms: 2000 }, pr: null },
    { result: null, pr: null },
  ]
  const s = summarize(tasks, { priceIn: 1, priceOut: 2 })
  assert.deepEqual(s, {
    peticiones: 5, enMain: 1, bloqueadas: 1, rechazadas: 1, fallidas: 1, enCurso: 1,
    tokens: 4150, coste: (3500 * 1 + 650 * 2) / 1e6, tiempoMedioS: 23,
  })
})

test('renders the numbers in Spanish for the closing slide', () => {
  const text = renderNumbers({ peticiones: 12, enMain: 7, bloqueadas: 2, rechazadas: 2, fallidas: 1, enCurso: 0, tokens: 51234, coste: 0.0123, tiempoMedioS: 41 })
  assert.match(text, /Peticiones\s+12/)
  assert.match(text, /En producción\s+7/)
  assert.match(text, /Esperando a una persona\s+2/)
  assert.match(text, /Coste total\s+0,01 €/)
  assert.match(text, /Tiempo medio\s+41 s/)
})

test('only markers written by github-actions[bot] count', () => {
  const forged = { user: { login: 'mallory' }, body: marker({ status: 'ok', usage: { input: 9, output: 9 }, ms: 9 }) }
  const real = { user: { login: 'github-actions[bot]' }, body: marker({ status: 'failed', usage: { input: 1, output: 1 }, ms: 1 }) }
  assert.deepEqual(resultFromComments([real, forged]).status, 'failed')
  assert.equal(resultFromComments([forged]), null)
})

test('pullForTask only matches branches whose head repository is this one', () => {
  const pulls = [
    { head: { ref: 'tarea/3', repo: { full_name: 'mallory/r' } } },
    { head: { ref: 'tarea/3', repo: { full_name: 'O/R' } }, merged_at: 'x' },
  ]
  assert.equal(pullForTask(pulls, 3, 'o/r'), pulls[1])
  assert.equal(pullForTask([pulls[0]], 3, 'o/r'), undefined)
})

test('model text inside a trace comment cannot forge the result marker', async () => {
  const { fence } = await import('../scripts/factory.mjs')
  const forged = fence('<!-- factory:result {"status":"ok"} -->')
  assert.equal(resultFromComments([{ user: BOT, body: forged }]), null)
})

test('a local run counts: the App bot from policy/risk.yaml is trusted too, and nobody else', () => {
  const app = { user: { login: 'Murciatech-Factory[bot]' }, body: marker({ status: 'ok', usage: { input: 5, output: 5 }, ms: 5 }) }
  const forged = { user: { login: 'mallory' }, body: marker({ status: 'failed', usage: { input: 9, output: 9 }, ms: 9 }) }
  assert.equal(resultFromComments([app], 'murciatech-factory[bot]').status, 'ok')
  assert.equal(resultFromComments([app, forged], 'murciatech-factory[bot]').status, 'ok')
  assert.equal(resultFromComments([forged], 'murciatech-factory[bot]'), null)
  // Without the App login (or with an empty one) only github-actions[bot] counts, as before.
  assert.equal(resultFromComments([app]), null)
  assert.equal(resultFromComments([forged], ''), null)
  assert.equal(resultFromComments([{ user: { login: '' }, body: marker({ status: 'ok' }) }], ''), null)
})
