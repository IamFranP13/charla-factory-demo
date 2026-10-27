import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openAIProvider, providersFromEnv } from '../lib/providers.js'

function fakeFetch(status, body) {
  const calls = []
  const impl = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) })
    return { ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) }
  }
  return { impl, calls }
}

test('openai provider sends a JSON-mode chat completion with the key and returns text and usage', async () => {
  const f = fakeFetch(200, { choices: [{ message: { content: '{"aprobado":true}' } }], usage: { prompt_tokens: 120, completion_tokens: 8 } })
  const p = openAIProvider({ url: 'https://api.example.com/', key: 'sk-test', model: 'tiny', fetchImpl: f.impl })
  const answer = await p.complete({ messages: [{ role: 'user', content: 'hola' }] })

  assert.deepEqual(answer, { text: '{"aprobado":true}', usage: { input: 120, output: 8 } })
  assert.equal(f.calls[0].url, 'https://api.example.com/chat/completions')
  assert.equal(f.calls[0].init.headers.authorization, 'Bearer sk-test')
  assert.equal(f.calls[0].body.model, 'tiny')
  assert.deepEqual(f.calls[0].body.response_format, { type: 'json_object' })
})

test('openai provider turns an HTTP error into a readable error', async () => {
  const f = fakeFetch(503, { error: 'overloaded' })
  const p = openAIProvider({ url: 'https://api.example.com', key: 'k', model: 'm', fetchImpl: f.impl })
  await assert.rejects(p.complete({ messages: [] }), /503.*overloaded/)
})

test('openai provider rejects an answer without content', async () => {
  const f = fakeFetch(200, { choices: [] })
  const p = openAIProvider({ url: 'https://api.example.com', key: 'k', model: 'm', fetchImpl: f.impl })
  await assert.rejects(p.complete({ messages: [] }), /without content/)
})

test('openai provider refuses to start without url, key or model', () => {
  assert.throws(() => openAIProvider({ url: 'u', key: '', model: 'm' }), /needs url, key and model/)
})

test('providers from env: replay is the default, so forgetting a variable never spends money', () => {
  assert.equal(providersFromEnv({}).provider.name, 'replay')
})

test('providers from env: reviewers can use a different model', () => {
  const { provider, reviewProvider } = providersFromEnv({
    FACTORY_PROVIDER: 'openai', FACTORY_API_URL: 'https://a', FACTORY_API_KEY: 'k', FACTORY_MODEL: 'builder-model', FACTORY_REVIEW_MODEL: 'reviewer-model',
  })
  assert.equal(provider.name, 'openai:builder-model')
  assert.equal(reviewProvider.name, 'openai:reviewer-model')
})

test('providers from env: an unknown provider is an error', () => {
  assert.throws(() => providersFromEnv({ FACTORY_PROVIDER: 'magic' }), /unknown FACTORY_PROVIDER/)
})

test('providers from env: an empty FACTORY_PROVIDER (unset repository variable in Actions) means replay', () => {
  assert.equal(providersFromEnv({ FACTORY_PROVIDER: '', FACTORY_API_URL: '', FACTORY_MODEL: '', FACTORY_API_KEY: '' }).provider.name, 'replay')
})
