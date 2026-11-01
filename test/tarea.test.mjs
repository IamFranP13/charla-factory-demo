import { test } from 'node:test'
import assert from 'node:assert/strict'
import { run } from '../scripts/tarea.mjs'
import { issueFor, MAX_LENGTH } from '../lib/intake.js'
import { parseIssueBody } from './issue-body.mjs'

// A fake `gh`: records the calls and answers like the issues API. Nothing touches GitHub.
delete process.env.GITHUB_REPOSITORY // the repository comes from the fake `gh`

function harness({ number = 77, fail = false } = {}) {
  const calls = []
  const out = []
  const err = []
  const gh = (args, { input } = {}) => {
    calls.push({ args, input })
    if (args[0] === 'repo') return 'me/repo\n'
    if (fail) throw new Error('gh: not logged in')
    return JSON.stringify({ number })
  }
  return { calls, out, err, deps: { gh, out: (l) => out.push(l), err: (l) => err.push(l) } }
}
const created = (h) => h.calls.filter((c) => c.args[0] === 'api')

test('tarea files one issue in the intake format with origen:prueba and prints its number', async () => {
  const h = harness()
  assert.equal(await run(['--perfil', 'producto', '  Pon un cohete en el muro  '], h.deps), 0)
  const [call] = created(h)
  assert.deepEqual(call.args, ['api', '-X', 'POST', 'repos/me/repo/issues', '--input', '-'])
  const issue = JSON.parse(call.input)
  assert.deepEqual(issue, issueFor('producto', 'Pon un cohete en el muro', 'prueba'))
  assert.deepEqual(issue.labels, ['entrada', 'perfil:producto', 'origen:prueba'])
  assert.deepEqual(parseIssueBody(issue.body), { profile: 'producto', request: 'Pon un cohete en el muro' })
  assert.match(h.out.join('\n'), /#77/)
  assert.deepEqual(h.err, [])
})

test('tarea: default profile is marketing', async () => {
  const h = harness()
  assert.equal(await run(['Una campaña de naranjas'], h.deps), 0)
  assert.equal(JSON.parse(created(h)[0].input).labels[1], 'perfil:marketing')
})

test('tarea refuses empty, too short, too long, control characters, bad profile and bad usage; nothing is filed', async () => {
  const bad = [
    [[], /texto/i], [[''], /3 a 150/], [['   '], /3 a 150/], [['ab'], /3 a 150/],
    [['a'.repeat(MAX_LENGTH + 1)], /3 a 150/], [['hola\u0007mundo'], /caracteres no permitidos/],
    [['--perfil', 'dios', 'hola mundo'], /perfil/], [['--perfil'], /perfil/], [['--nope', 'hola mundo'], /--nope/],
    [['uno', 'dos'], /un solo texto/],
  ]
  for (const [argv, message] of bad) {
    const h = harness()
    assert.equal(await run(argv, h.deps), 2, argv.join(' '))
    assert.match(h.err.join('\n'), message, argv.join(' '))
    assert.equal(h.calls.length, 0, argv.join(' '))
  }
})

test('tarea --ayuda prints the usage and exits 0', async () => {
  const h = harness()
  assert.equal(await run(['--ayuda'], h.deps), 0)
  assert.match(h.out.join('\n'), /npm run tarea/)
  assert.equal(h.calls.length, 0)
})

test('tarea: a gh failure exits 1 with a message', async () => {
  const h = harness({ fail: true })
  assert.equal(await run(['hola mundo'], h.deps), 1)
  assert.match(h.err.join('\n'), /tarea:/)
})
