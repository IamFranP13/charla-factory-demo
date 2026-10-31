import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLinear, renderProgress, renderQuestion, answerAfter, pickStates, formatElapsed, MARKER, ENDPOINT } from '../lib/linear.js'

// A fake Linear: records every call and answers from a function of (query, variables).
function fake(answer) {
  const calls = []
  const fetch = async (url, init) => {
    const { query, variables } = JSON.parse(init.body)
    calls.push({ url, headers: init.headers, query, variables })
    const data = await answer(query, variables)
    return data instanceof Error ? { ok: false, status: 500, json: async () => ({}) } : { ok: true, status: 200, json: async () => (data.errors ? data : { data }) }
  }
  return { calls, fetch }
}

const STATES = [
  { id: 's1', name: 'Backlog', type: 'backlog', position: 0 },
  { id: 's2', name: 'Todo', type: 'unstarted', position: 1 },
  { id: 's3', name: 'In Progress', type: 'started', position: 2 },
  { id: 's4', name: 'In Review', type: 'started', position: 3 },
  { id: 's5', name: 'Done', type: 'completed', position: 4 },
  { id: 's6', name: 'Canceled', type: 'canceled', position: 5 },
]

test('the progress comment shows stage, elapsed time, tokens and cost, and carries the marker', () => {
  const body = renderProgress({ stage: 'implementing', elapsedMs: 200000, tokens: 12345, cost: 0.1234 })
  assert.equal(body, `Agente · etapa: implementando\nTiempo: 3 min 20 s · Tokens: 12345 · Coste: $0.12\n\n${MARKER}`)
  assert.match(renderProgress({ stage: 'pr', pr: 'https://github.com/o/r/pull/5', note: 'hecho' }), /PR: https:\/\/github\.com\/o\/r\/pull\/5\n\nhecho/)
  assert.equal(formatElapsed(42000), '42 s')
  assert.ok(renderQuestion('¿A o B?').includes(MARKER))
})

test('an answer is the owner\'s comments after the question, never the lane\'s own comments nor other people\'s', () => {
  const at = (s) => `2026-01-01T00:00:${String(s).padStart(2, '0')}Z`
  const comments = [
    { id: 'a', body: 'old', createdAt: at(1), user: { id: 'me' } },
    { id: 'b', body: `question ${MARKER}`, createdAt: at(5), user: { id: 'me' } },
    { id: 'c', body: 'stranger', createdAt: at(6), user: { id: 'other' } },
    { id: 'd', body: ' opción A ', createdAt: at(7), user: { id: 'me' } },
    { id: 'e', body: 'y además B', createdAt: at(8), user: { id: 'me' } },
    { id: 'f', body: `progress ${MARKER}`, createdAt: at(9), user: { id: 'me' } },
  ]
  assert.equal(answerAfter(comments, { since: at(5), viewerId: 'me' }), 'opción A\n\ny además B')
  assert.equal(answerAfter(comments.slice(0, 3), { since: at(5), viewerId: 'me' }), null)
})

test('states are picked by role, preferring the usual names, and a team without one fails', () => {
  const picked = pickStates(STATES)
  assert.deepEqual([picked.todo.id, picked.progress.id, picked.review.id, picked.done.id], ['s2', 's3', 's4', 's5'])
  assert.equal(pickStates(STATES.filter((s) => s.id !== 's4')).review.id, 's3', 'no In Review: In Progress stands in')
  assert.throws(() => pickStates(STATES.filter((s) => s.type !== 'completed')), /done/)
})

test('candidates: only the team\'s issues with the label in an unstarted state, oldest first, with the key in the header', async () => {
  const { calls, fetch } = fake(() => ({ issues: { nodes: [
    { id: 'i2', identifier: 'LIM-2', createdAt: '2026-01-02T00:00:00Z' },
    { id: 'i1', identifier: 'LIM-1', createdAt: '2026-01-01T00:00:00Z' },
  ] } }))
  const linear = createLinear({ apiKey: 'lin_key', fetch })
  const issues = await linear.candidates({ team: 'LIM', label: 'factory' })
  assert.deepEqual(issues.map((i) => i.identifier), ['LIM-1', 'LIM-2'])
  assert.equal(calls[0].url, ENDPOINT)
  assert.equal(calls[0].headers.Authorization, 'lin_key')
  assert.deepEqual(calls[0].variables, { team: 'LIM', label: 'factory', first: 50 })
  assert.match(calls[0].query, /team: \{ key: \{ eq: \$team \} \}/)
  assert.match(calls[0].query, /labels: \{ some: \{ name: \{ eq: \$label \} \} \}/)
  assert.match(calls[0].query, /state: \{ type: \{ eq: "unstarted" \} \}/)
})

test('setup finds the user, the team, the states and the labels, and creates the failure label once', async () => {
  const { calls, fetch } = fake((query, variables) => {
    if (query.includes('viewer')) return { viewer: { id: 'me' } }
    if (query.includes('teams(')) return { teams: { nodes: [{ id: 't1', key: 'LIM', states: { nodes: STATES } }] } }
    if (query.includes('issueLabels(')) return { issueLabels: { nodes: variables.name === 'factory' ? [{ id: 'l1', team: { key: 'LIM' } }] : [] } }
    if (query.includes('issueLabelCreate')) return { issueLabelCreate: { issueLabel: { id: 'l2' } } }
    throw new Error(`unexpected ${query}`)
  })
  const result = await createLinear({ apiKey: 'k', fetch }).setup({ team: 'LIM' })
  assert.equal(result.viewerId, 'me')
  assert.equal(result.states.todo.id, 's2')
  assert.deepEqual(result.labels, { entrada: 'l1', fallida: 'l2' })
  assert.deepEqual(calls.find((c) => c.query.includes('issueLabelCreate')).variables.input, { name: 'factory-fallida', teamId: 't1' })
})

test('setup fails clearly when the team or the label does not exist', async () => {
  const noTeam = fake((query) => (query.includes('viewer') ? { viewer: { id: 'me' } } : { teams: { nodes: [] } }))
  await assert.rejects(createLinear({ apiKey: 'k', fetch: noTeam.fetch }).setup({ team: 'XXX' }), /XXX/)
  const noLabel = fake((query) => {
    if (query.includes('viewer')) return { viewer: { id: 'me' } }
    if (query.includes('teams(')) return { teams: { nodes: [{ id: 't1', key: 'LIM', states: { nodes: STATES } }] } }
    return { issueLabels: { nodes: [] } }
  })
  await assert.rejects(createLinear({ apiKey: 'k', fetch: noLabel.fetch }).setup({ team: 'LIM', label: 'factory' }), /factory/)
})

test('comments and state changes go through the right mutations; swapLabel keeps the other labels', async () => {
  const { calls, fetch } = fake((query) => {
    if (query.includes('commentCreate')) return { commentCreate: { comment: { id: 'c1', createdAt: 'x' } } }
    if (query.includes('labels { nodes { id } }')) return { issue: { labels: { nodes: [{ id: 'l1' }, { id: 'keep' }] } } }
    return { ok: true }
  })
  const linear = createLinear({ apiKey: 'k', fetch })
  assert.deepEqual(await linear.createComment('i1', 'hola'), { id: 'c1', createdAt: 'x' })
  await linear.updateComment('c1', 'adiós')
  await linear.moveTo('i1', 's3')
  await linear.swapLabel('i1', { remove: 'l1', add: 'l2', stateId: 's2' })
  assert.deepEqual(calls[0].variables.input, { issueId: 'i1', body: 'hola' })
  assert.deepEqual(calls[1].variables, { id: 'c1', input: { body: 'adiós' } })
  assert.deepEqual(calls[2].variables, { id: 'i1', input: { stateId: 's3' } })
  assert.deepEqual(calls.at(-1).variables, { id: 'i1', input: { labelIds: ['keep', 'l2'], stateId: 's2' } })
})

test('an HTTP error or a GraphQL error is an error, and the key never appears in its message', async () => {
  await assert.rejects(createLinear({ apiKey: 'lin_secret', fetch: fake(() => new Error('x')).fetch }).comments('i1'), (e) => /HTTP 500/.test(e.message) && !e.message.includes('lin_secret'))
  await assert.rejects(createLinear({ apiKey: 'k', fetch: fake(() => ({ errors: [{ message: 'Entity not found' }] })).fetch }).comments('i1'), /Entity not found/)
})
