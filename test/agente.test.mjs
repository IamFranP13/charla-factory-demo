import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { acquireLock, runCommand } from '../lib/runner.js'
import {
  parseArgs, loadLinearConfig, parseStage, parseAssessment, createUsageMeter, buildPrompt, prBody, agentEnv, createAgent,
} from '../lib/agente.js'
import { MARKER } from '../lib/linear.js'

const scratch = () => mkdtempSync(join(tmpdir(), 'agente-test-'))
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' }).trim()
const SECRETS = { GH_TOKEN: 'gh-secret-1', GITHUB_TOKEN: 'gh-secret-2', LINEAR_API_KEY: 'lin-secret-3', FACTORY_APP_KEY: '/home/me/.config/charla-factory-demo/app-key.pem', FACTORY_API_KEY: 'model-secret-4' }
const APP_TOKEN = 'app-token-xyz'

const ISSUE = (n = 1, extra = {}) => ({ id: `iid${n}`, identifier: `LIM-${n}`, title: `Arreglar el descuento ${n}`, description: 'El descuento por volumen no se aplica.', url: `https://linear.app/x/issue/LIM-${n}`, ...extra })
const SETUP = { viewerId: 'me', states: { todo: { id: 'todo' }, progress: { id: 'prog' }, review: { id: 'rev' }, done: { id: 'done' } }, labels: { entrada: 'L1', fallida: 'L2' } }

// --- arguments and config ---

test('--paralelo defaults to 2 and must be a sensible integer', () => {
  assert.equal(parseArgs([]).paralelo, 2)
  assert.equal(parseArgs(['--paralelo', '3']).paralelo, 3)
  for (const bad of ['0', '-1', 'abc', '2.5', '100', '']) assert.throws(() => parseArgs(['--paralelo', bad]), /--paralelo/)
  assert.equal(parseArgs(['--help']).help, true)
  assert.throws(() => parseArgs(['--nope']), /--nope/)
})

test('linear.env: mode 600, key and team required, label defaults to factory, unknown keys dropped', () => {
  const dir = scratch()
  try {
    assert.throws(() => loadLinearConfig(dir), /linear\.env/)
    const put = (text, mode = 0o600) => { writeFileSync(join(dir, 'linear.env'), text); chmodSync(join(dir, 'linear.env'), mode) }
    put('LINEAR_API_KEY=k\nLINEAR_TEAM=LIM\n', 0o644)
    assert.throws(() => loadLinearConfig(dir), /600/)
    put('LINEAR_TEAM=LIM\n')
    assert.throws(() => loadLinearConfig(dir), /LINEAR_API_KEY/)
    put('LINEAR_API_KEY=k\n')
    assert.throws(() => loadLinearConfig(dir), /LINEAR_TEAM/)
    put('# c\nLINEAR_API_KEY="k"\nLINEAR_TEAM=LIM\nGH_TOKEN=x\n')
    assert.deepEqual(loadLinearConfig(dir), { apiKey: 'k', team: 'LIM', label: 'factory', model: undefined })
    put('LINEAR_API_KEY=k\nLINEAR_TEAM=LIM\nLINEAR_LABEL=agente\nAGENTE_MODEL=anthropic/sonnet\n')
    assert.deepEqual(loadLinearConfig(dir), { apiKey: 'k', team: 'LIM', label: 'agente', model: 'anthropic/sonnet' })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// --- what the agent writes and Pi reports ---

test('stage file: the first line names the stage, the rest is the detail; anything else is ignored', () => {
  assert.deepEqual(parseStage('implementing\n'), { name: 'implementing', detail: '' })
  assert.deepEqual(parseStage('Waiting\n¿A o B?\nA) x\n'), { name: 'waiting', detail: '¿A o B?\nA) x' })
  for (const bad of ['', 'dancing', null, undefined, '  \n']) assert.equal(parseStage(bad), null)
})

test('assessment: confident only on an explicit "confident: yes" first line', () => {
  assert.deepEqual(parseAssessment('confident: yes\n## Interpretation\nx'), { confident: true, text: '## Interpretation\nx' })
  assert.deepEqual(parseAssessment('Confident: NO\nwhy'), { confident: false, text: 'why' })
  assert.deepEqual(parseAssessment('some text'), { confident: false, text: 'some text' })
  assert.deepEqual(parseAssessment(null), { confident: false, text: '' })
})

test('usage from Pi\'s JSON events: final assistant message_end only, tolerant of noise and split chunks', () => {
  const meter = createUsageMeter()
  const end = JSON.stringify({ type: 'message_end', message: { role: 'assistant', usage: { input: 10, output: 5, cacheRead: 1, cacheWrite: 0, totalTokens: 16, cost: { total: 0.25 } } } })
  const noTotal = JSON.stringify({ type: 'message_end', message: { role: 'assistant', usage: { input: 3, output: 2, cost: { total: 0.5 } } } })
  const start = JSON.stringify({ type: 'message_start', message: { role: 'assistant', usage: { totalTokens: 999, cost: { total: 9 } } } })
  const user = JSON.stringify({ type: 'message_end', message: { role: 'user', content: [] } })
  meter.feed(`not json\n${start}\n${user}\n${end.slice(0, 40)}`)
  meter.feed(`${end.slice(40)}\n${noTotal}\n{"type":"x"}\n[1]\nnull\n`)
  assert.deepEqual(meter.usage(), { tokens: 21, cost: 0.75 })
})

test('prompt: the ticket and the stage directory; on resume the question and the answer too', () => {
  const first = buildPrompt(ISSUE(), { stageDir: '/s' })
  assert.match(first, /LIM-1: Arreglar el descuento 1/)
  assert.match(first, /https:\/\/linear\.app\/x\/issue\/LIM-1/)
  assert.match(first, /El descuento por volumen no se aplica\./)
  assert.match(first, /\/s/)
  assert.doesNotMatch(first, /answer/i)
  const again = buildPrompt(ISSUE(), { stageDir: '/s', question: '¿A o B?', answer: 'B' })
  assert.match(again, /¿A o B\?/)
  assert.match(again, /The owner's answer:\nB/)
})

test('the PR body: the Linear link, then the assessment', () => {
  assert.equal(prBody({ url: 'https://l/LIM-1', assessment: { confident: true, text: '## Assumptions I made\n- x' } }), 'Linear: https://l/LIM-1\n\n## Assumptions I made\n- x\n')
  assert.match(prBody({ url: 'u', assessment: { confident: false, text: '' } }), /no dejó una evaluación/)
})

test('the agent\'s environment is an allowlist: no GitHub token, no App key path, no Linear key, whatever the parent holds', () => {
  const parent = { PATH: '/bin', HOME: '/home/me', ...SECRETS, ANTHROPIC_API_KEY: 'pi-own-key', SSH_AUTH_SOCK: '/s', AWS_SECRET_ACCESS_KEY: 'aws' }
  const env = agentEnv({ parent, home: '/tmp/h', stageDir: '/tmp/s', piDir: '/home/me/.pi/agent' })
  assert.equal(env.HOME, '/tmp/h')
  assert.equal(env.AGENTE_STAGE_DIR, '/tmp/s')
  assert.equal(env.PI_CODING_AGENT_DIR, '/home/me/.pi/agent')
  assert.equal(env.ANTHROPIC_API_KEY, 'pi-own-key', 'its own Pi credentials stay')
  for (const key of ['GH_TOKEN', 'GITHUB_TOKEN', 'LINEAR_API_KEY', 'FACTORY_APP_KEY', 'FACTORY_API_KEY', 'SSH_AUTH_SOCK', 'AWS_SECRET_ACCESS_KEY']) assert.equal(key in env, false, key)
  const flat = JSON.stringify(env)
  for (const secret of Object.values(SECRETS)) assert.equal(flat.includes(secret), false)
})

// --- the lane, with a real git repository and everything else faked ---

function fixture() {
  const base = scratch()
  const origin = join(base, 'origin.git')
  const root = join(base, 'repo')
  mkdirSync(origin)
  git(origin, 'init', '--bare', '-b', 'main')
  git(base, 'clone', origin, root)
  writeFileSync(join(root, 'README.md'), 'base\n')
  git(root, 'add', '.')
  git(root, 'commit', '-m', 'base')
  git(root, 'push', 'origin', 'HEAD:main')
  return { base, origin, root, tmpBase: join(base, 'tmp') }
}

function harness(options = {}) {
  const fx = fixture()
  mkdirSync(fx.tmpBase)
  const clock = { t: Date.parse('2026-01-01T00:00:00Z') }
  const iso = () => new Date(clock.t).toISOString()
  const waiters = []
  const sleep = (ms) => new Promise((resolve) => {
    clock.t += ms
    setImmediate(() => { resolve(); setImmediate(() => waiters.splice(0).forEach((w) => w())) })
  })
  const nextTick = () => new Promise((resolve) => waiters.push(resolve))

  const store = []
  const api = {
    calls: [], todo: options.issues ?? [ISSUE()], claimed: new Set(),
    async candidates() { return this.todo.filter((i) => !this.claimed.has(i.id)) },
    async moveTo(id, stateId) { this.calls.push(['moveTo', id, stateId]); if (stateId === 'prog') this.claimed.add(id) },
    async createComment(issueId, body) { const c = { id: `c${store.length + 1}`, issueId, body, createdAt: iso(), user: { id: 'me' } }; store.push(c); this.calls.push(['createComment', issueId]); return c },
    async updateComment(id, body) { store.find((c) => c.id === id).body = body; this.calls.push(['updateComment', id]) },
    async swapLabel(id, change) { this.calls.push(['swapLabel', id, change]); this.claimed.add(id) },
    async comments(issueId) { return store.filter((c) => c.issueId === issueId) },
  }

  const commands = []
  const spawned = []
  const envs = []
  const prStates = new Map()
  const results = { npm: { code: 0, stdout: 'ok', stderr: '' } }
  const run = async (command, args, opts = {}) => {
    commands.push({ command, args, opts })
    if (opts.env) envs.push(opts.env)
    if (command === 'npm') return results.npm
    if (command === 'gh') return { code: 0, stdout: 'https://github.com/o/r/pull/77\n', stderr: '' }
    return runCommand(command, args, opts)
  }

  const behaviours = options.behaviours ?? []
  const spawnAgent = (opts) => {
    const index = spawned.length
    spawned.push(opts)
    envs.push(opts.env)
    let finish
    const done = new Promise((resolve) => { finish = resolve })
    const script = behaviours[index] ?? behaviours.at(-1) ?? (async () => {})
    Promise.resolve().then(() => script(opts, { index, nextTick })).then(() => finish({ code: 0 }), (error) => finish({ code: 1, stderr: error.message }))
    return { kill() { finish({ code: null }) }, done }
  }

  const logs = []
  const agent = createAgent({
    linear: api, setup: SETUP, team: 'LIM', label: 'factory', paralelo: options.paralelo ?? 2, root: fx.root, repo: 'o/r', run, spawnAgent,
    mintToken: async () => APP_TOKEN, prStatus: async (pr) => prStates.get(pr) ?? 'open', playbook: '/pb/agente.md', model: options.model,
    piDir: '/home/me/.pi/agent', now: () => clock.t, sleep, log: (m) => logs.push(m), tmpBase: fx.tmpBase, remoteUrl: () => fx.origin,
    parent: { PATH: process.env.PATH, ...SECRETS, ANTHROPIC_API_KEY: 'pi-own-key' }, timeoutMs: options.timeoutMs ?? 600000, watchdogMs: options.watchdogMs ?? 120000,
    tickMs: 5000, testTimeoutMs: 1000,
  })
  return { ...fx, agent, linear: api, store, commands, spawned, envs, prStates, results, clock, iso, logs, nextTick, cleanup: () => rmSync(fx.base, { recursive: true, force: true }) }
}

const waitFor = async (condition, what) => {
  for (let i = 0; i < 2000; i++) {
    if (condition()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  assert.fail(`timeout waiting for ${what}`)
}

const stage = (opts, name, detail = '') => writeFileSync(join(opts.env.AGENTE_STAGE_DIR, 'stage'), `${name}\n${detail}`)
const commit = (opts, file, text, message) => {
  writeFileSync(join(opts.cwd, file), text)
  git(opts.cwd, 'add', file)
  git(opts.cwd, 'commit', '-m', message)
  return git(opts.cwd, 'rev-parse', 'HEAD')
}

// An agent that does a good job: stages, a commit, an assessment.
const goodAgent = (confident = true, sink = {}) => async (opts, { nextTick }) => {
  stage(opts, 'investigating')
  await nextTick()
  stage(opts, 'implementing')
  await nextTick()
  sink.sha = commit(opts, 'fix.txt', 'fixed\n', 'Fix the discount')
  stage(opts, 'verifying')
  opts.onStdout(`${JSON.stringify({ type: 'message_end', message: { role: 'assistant', usage: { input: 100, output: 20, totalTokens: 120, cost: { total: 0.05 } } } })}\n`)
  await nextTick()
  writeFileSync(join(opts.env.AGENTE_STAGE_DIR, 'assessment.md'), `confident: ${confident ? 'yes' : 'no'}\n## Interpretation\nApply it.\n## Assumptions I made\n- per order\n`)
  stage(opts, 'pr')
}

const progressOf = (h, n = 1) => h.store.find((c) => c.issueId === `iid${n}` && c.body.includes('Agente ·'))

test('a ticket is claimed: In Progress, ONE comment that is then edited with stage, time, tokens and cost', async () => {
  const sink = {}
  const h = harness({ behaviours: [goodAgent(true, sink)] })
  try {
    await h.agent.tick()
    await h.agent.idle()
    const creates = h.linear.calls.filter(([kind]) => kind === 'createComment')
    assert.equal(creates.length, 1, 'one comment is created')
    assert.deepEqual(h.linear.calls[0], ['moveTo', 'iid1', 'prog'])
    const edits = h.linear.calls.filter(([kind]) => kind === 'updateComment')
    assert.ok(edits.length >= 2, 'and edited as the run advances')
    assert.ok(edits.every(([, id]) => id === 'c1'))
    assert.match(progressOf(h).body, /Tokens: 120 · Coste: \$0\.05/)
    assert.match(progressOf(h).body, /PR: https:\/\/github\.com\/o\/r\/pull\/77/)
  } finally { h.cleanup() }
})

test('the stage file drives the progress comment', async () => {
  const seen = []
  const h = harness({
    behaviours: [async (opts, { nextTick }) => {
      for (const name of ['investigating', 'implementing']) {
        stage(opts, name)
        await nextTick()
        seen.push(progressOf(h).body)
      }
      commit(opts, 'a.txt', 'a', 'a')
    }],
  })
  try {
    await h.agent.tick()
    await h.agent.idle()
    assert.match(seen[0], /etapa: investigando/)
    assert.match(seen[1], /etapa: implementando/)
  } finally { h.cleanup() }
})

test('Pi is started in a fresh worktree of origin/main on agente/<KEY> with the playbook, the model and the ticket', async () => {
  const h = harness({ model: 'anthropic/sonnet', behaviours: [async (opts) => {
    assert.equal(git(opts.cwd, 'rev-parse', '--abbrev-ref', 'HEAD'), 'agente/LIM-1')
    assert.equal(git(opts.cwd, 'rev-parse', 'HEAD'), git(opts.cwd, 'rev-parse', 'origin/main'))
    assert.ok(opts.cwd.startsWith(h.tmpBase))
    commit(opts, 'a.txt', 'a', 'a')
  }] })
  try {
    // origin/main moves after the repository was cloned: the lane must fetch first.
    const other = join(h.base, 'other')
    git(h.base, 'clone', h.origin, other)
    writeFileSync(join(other, 'new.txt'), 'n')
    git(other, 'add', '.')
    git(other, 'commit', '-m', 'newer')
    git(other, 'push', 'origin', 'HEAD:main')
    await h.agent.tick()
    await h.agent.idle()
    const { command, args } = h.spawned[0]
    assert.equal(command, 'pi')
    assert.deepEqual(args.slice(0, 7), ['-p', '--mode', 'json', '--no-session', '--append-system-prompt', '/pb/agente.md', '--model'])
    assert.equal(args[7], 'anthropic/sonnet')
    assert.equal(args[8], '--')
    assert.match(args[9], /LIM-1: Arreglar el descuento 1/)
  } finally { h.cleanup() }
})

test('after the agent: npm test re-run on its commit, then push of exactly that commit and a PR with the App token', async () => {
  const sink = {}
  const h = harness({ behaviours: [goodAgent(true, sink)] })
  try {
    await h.agent.tick()
    await h.agent.idle()
    const npm = h.commands.find((c) => c.command === 'npm')
    assert.deepEqual(npm.args, ['test'])
    assert.ok(npm.opts.cwd.startsWith(h.tmpBase))
    assert.equal(git(h.origin, 'rev-parse', 'refs/heads/agente/LIM-1'), sink.sha, 'the commit pushed is the agent\'s final commit')
    const pr = h.commands.find((c) => c.command === 'gh')
    assert.deepEqual(pr.args, [
      'pr', 'create', '--repo', 'o/r', '--base', 'main', '--head', 'agente/LIM-1',
      '--title', 'LIM-1 Arreglar el descuento 1',
      '--body', 'Linear: https://linear.app/x/issue/LIM-1\n\n## Interpretation\nApply it.\n## Assumptions I made\n- per order\n',
    ])
    assert.equal(pr.opts.env.GH_TOKEN, APP_TOKEN)
    assert.ok(h.commands.findIndex((c) => c.command === 'npm') < h.commands.findIndex((c) => c.command === 'gh'))
    assert.deepEqual(h.linear.calls.at(-1), ['moveTo', 'iid1', 'rev'], 'Linear: In Review')
    assert.match(progressOf(h).body, /pull\/77/)
    // Nothing is left behind: no worktree, no branch, no scratch directory.
    assert.equal(git(h.root, 'branch', '--list', 'agente/*'), '')
    assert.equal(readdirSync(h.tmpBase).length, 0)
    assert.equal(git(h.root, 'worktree', 'list').split('\n').length, 1)
  } finally { h.cleanup() }
})

test('the PR is a draft when the agent is not confident or left no assessment', async () => {
  for (const behaviour of [goodAgent(false), async (opts) => { commit(opts, 'a.txt', 'a', 'a') }]) {
    const h = harness({ behaviours: [behaviour] })
    try {
      await h.agent.tick()
      await h.agent.idle()
      const pr = h.commands.find((c) => c.command === 'gh')
      assert.ok(pr.args.includes('--draft'))
      assert.match(progressOf(h).body, /borrador/)
    } finally { h.cleanup() }
  }
  const h = harness({ behaviours: [goodAgent(true)] })
  try {
    await h.agent.tick()
    await h.agent.idle()
    assert.equal(h.commands.find((c) => c.command === 'gh').args.includes('--draft'), false)
  } finally { h.cleanup() }
})

test('a failing trusted npm test blocks the push: nothing reaches origin, no PR, back to Todo with the failure label', async () => {
  const h = harness({ behaviours: [goodAgent(true)] })
  h.results.npm = { code: 1, stdout: '# fail 1\nnot ok - discount', stderr: '' }
  try {
    await h.agent.tick()
    await h.agent.idle()
    assert.equal(git(h.origin, 'branch', '--list', 'agente/*'), '')
    assert.equal(h.commands.some((c) => c.command === 'gh'), false)
    assert.equal(h.commands.some((c) => c.command === 'git' && c.args.includes('push')), false)
    assert.deepEqual(h.linear.calls.at(-1), ['swapLabel', 'iid1', { remove: 'L1', add: 'L2', stateId: 'todo' }])
    assert.match(progressOf(h).body, /npm test.*falla/)
    assert.match(progressOf(h).body, /not ok - discount/)
    assert.equal(readdirSync(h.tmpBase).length, 0)
  } finally { h.cleanup() }
})

test('a run with no commit, or with uncommitted changes, fails and pushes nothing', async () => {
  for (const [behaviour, reason] of [
    [async () => {}, /sin ningún commit/],
    [async (opts) => { commit(opts, 'a.txt', 'a', 'a'); writeFileSync(join(opts.cwd, 'dirty.txt'), 'x') }, /sin commitear/],
  ]) {
    const h = harness({ behaviours: [behaviour] })
    try {
      await h.agent.tick()
      await h.agent.idle()
      assert.match(progressOf(h).body, reason)
      assert.equal(h.commands.some((c) => c.command === 'npm' || c.command === 'gh'), false)
      assert.equal(h.linear.calls.at(-1)[0], 'swapLabel')
    } finally { h.cleanup() }
  }
})

test('the agent saying failed, or Pi exiting with an error, fails the run with the reason', async () => {
  const h = harness({ behaviours: [async (opts) => stage(opts, 'failed', 'No puedo reproducirlo.')] })
  try {
    await h.agent.tick()
    await h.agent.idle()
    assert.match(progressOf(h).body, /No puedo reproducirlo\./)
    assert.equal(h.linear.calls.at(-1)[0], 'swapLabel')
  } finally { h.cleanup() }
  const crash = harness({ behaviours: [async () => { throw new Error('boom') }] })
  try {
    await crash.agent.tick()
    await crash.agent.idle()
    assert.match(progressOf(crash).body, /código 1/)
  } finally { crash.cleanup() }
})

test('the run time limit and the 10-minute stage watchdog both stop a stuck agent and fail the run', async () => {
  const hang = () => new Promise(() => {})
  const slow = harness({ behaviours: [hang], timeoutMs: 60000, watchdogMs: 600000 })
  try {
    await slow.agent.tick()
    await slow.agent.idle()
    assert.match(progressOf(slow).body, /tiempo máximo/)
    assert.equal(slow.linear.calls.at(-1)[0], 'swapLabel')
  } finally { slow.cleanup() }

  // The stage keeps changing for a while (so no watchdog), then stops.
  const quiet = harness({ behaviours: [async (opts, { nextTick }) => { stage(opts, 'implementing'); await nextTick(); return hang() }], timeoutMs: 3600000, watchdogMs: 600000 })
  try {
    await quiet.agent.tick()
    await quiet.agent.idle()
    assert.match(progressOf(quiet).body, /no cambió de etapa en 10 min/)
    assert.ok(quiet.clock.t - Date.parse('2026-01-01T00:00:00Z') < 3600000, 'stopped well before the run limit')
    assert.equal(quiet.commands.some((c) => c.command === 'gh'), false)
  } finally { quiet.cleanup() }
})

test('eligibility is the query\'s; the lane never takes a malformed key, a ticket twice, or more than --paralelo at once', async () => {
  const gates = []
  const gated = async (opts) => { await new Promise((resolve) => gates.push(resolve)); commit(opts, 'a.txt', 'a', 'a') }
  const h = harness({ paralelo: 2, issues: [ISSUE(1), ISSUE(2), ISSUE(3), ISSUE(4, { identifier: '../evil' })], behaviours: [gated], timeoutMs: 1e12, watchdogMs: 1e12 })
  try {
    await h.agent.tick()
    await waitFor(() => h.spawned.length === 2, 'two agents')
    await h.agent.tick()
    await h.agent.tick()
    await new Promise((resolve) => setTimeout(resolve, 50))
    assert.equal(h.spawned.length, 2, 'never more than two at once, nobody twice')
    gates[0]()
    await waitFor(() => h.agent.state().running.length === 1, 'a free slot')
    await h.agent.tick()
    await waitFor(() => h.spawned.length === 3, 'the third')
    gates.slice(1).forEach((g) => g())
    await waitFor(() => gates.length === 3, 'third gate')
    gates[2]()
    await h.agent.idle()
    assert.equal(h.spawned.length, 3, 'the malformed key was never started')
    assert.equal(h.linear.calls.some(([, id]) => id === 'iid4'), false)
  } finally { h.cleanup() }
})

test('waiting: the question is posted; a new owner comment resumes on the same branch with question and answer in the prompt', async () => {
  const h = harness({
    behaviours: [
      async (opts) => {
        commit(opts, 'wip.txt', 'wip\n', 'Failing test first')
        stage(opts, 'waiting', '¿Por pedido o por producto? A) por pedido (recomendado) B) por producto')
        await new Promise(() => {})
      },
      async (opts) => {
        assert.equal(readFileSync(join(opts.cwd, 'wip.txt'), 'utf8'), 'wip\n', 'same worktree, same branch, work preserved')
        assert.equal(git(opts.cwd, 'rev-parse', '--abbrev-ref', 'HEAD'), 'agente/LIM-1')
        commit(opts, 'fix.txt', 'fix\n', 'Fix')
      },
    ],
  })
  try {
    await h.agent.tick()
    await h.agent.idle()
    assert.deepEqual(h.agent.state().waiting, ['LIM-1'])
    const question = h.store.find((c) => c.body.includes('¿Por pedido o por producto?'))
    assert.ok(question.body.includes(MARKER))
    assert.notEqual(question.id, progressOf(h).id, 'the question is its own comment')
    assert.match(progressOf(h).body, /esperando tu respuesta/)
    assert.equal(h.commands.some((c) => c.command === 'npm'), false, 'nothing is verified or pushed while waiting')

    // Not an answer: our own comments and other people's.
    h.clock.t += 1000
    h.store.push({ id: 'x1', issueId: 'iid1', body: 'ruido', createdAt: h.iso(), user: { id: 'stranger' } })
    await h.agent.tick()
    assert.equal(h.spawned.length, 1)

    h.clock.t += 1000
    h.store.push({ id: 'x2', issueId: 'iid1', body: 'B, por producto', createdAt: h.iso(), user: { id: 'me' } })
    await h.agent.tick()
    await h.agent.idle()
    assert.equal(h.spawned.length, 2)
    const prompt = h.spawned[1].args.at(-1)
    assert.match(prompt, /¿Por pedido o por producto\?/)
    assert.match(prompt, /B, por producto/)
    assert.equal(h.agent.state().waiting.length, 0)
    assert.equal(h.commands.filter((c) => c.command === 'gh').length, 1, 'the resumed run ends in a PR')
    assert.equal(h.store.filter((c) => c.body.includes('Agente ·')).length, 1, 'still the one progress comment')
  } finally { h.cleanup() }
})

test('merged PR: Linear goes to Done on a later poll; a closed one is left in review; an open one is left alone', async () => {
  const h = harness({ issues: [ISSUE(1), ISSUE(2)], behaviours: [goodAgent(true)] })
  try {
    await h.agent.tick()
    await h.agent.idle()
    assert.deepEqual(h.agent.state().reviewing.sort(), ['LIM-1', 'LIM-2'])
    await h.agent.tick()
    assert.equal(h.linear.calls.some(([kind, , state]) => kind === 'moveTo' && state === 'done'), false, 'still open')
    h.prStates.set(77, 'merged')
    await h.agent.tick()
    assert.equal(h.linear.calls.filter(([kind, , state]) => kind === 'moveTo' && state === 'done').length, 2)
    assert.equal(h.agent.state().reviewing.length, 0)
    assert.match(progressOf(h).body, /PR fusionada/)
  } finally { h.cleanup() }
})

test('no secret reaches the agent or the trusted test run; the App token reaches only the push and the PR', async () => {
  const h = harness({ behaviours: [goodAgent(true)] })
  try {
    await h.agent.tick()
    await h.agent.idle()
    const agentEnvSeen = h.spawned[0].env
    const npmEnv = h.commands.find((c) => c.command === 'npm').opts.env
    for (const env of [agentEnvSeen, npmEnv]) {
      const flat = JSON.stringify(env)
      for (const secret of [...Object.values(SECRETS), APP_TOKEN, Buffer.from(`x-access-token:${APP_TOKEN}`).toString('base64')]) assert.equal(flat.includes(secret), false, secret)
      for (const key of ['GH_TOKEN', 'GITHUB_TOKEN', 'LINEAR_API_KEY', 'FACTORY_APP_KEY']) assert.equal(key in env, false, key)
    }
    assert.equal(agentEnvSeen.ANTHROPIC_API_KEY, 'pi-own-key')
    // The agent's argv carries no secret either.
    assert.equal(JSON.stringify(h.spawned[0].args).includes(APP_TOKEN), false)
    // Only the push (in its environment, never on the command line) and gh pr create hold the token.
    const holders = h.commands.filter((c) => JSON.stringify(c.opts.env ?? {}).includes(APP_TOKEN) || JSON.stringify(c.opts.env ?? {}).includes(Buffer.from(`x-access-token:${APP_TOKEN}`).toString('base64')))
    assert.deepEqual(holders.map((c) => `${c.command} ${c.args.includes('push') ? 'push' : c.args[0]}`), ['git push', 'gh pr'])
    assert.equal(JSON.stringify(h.commands.map((c) => c.args)).includes(APP_TOKEN), false)
  } finally { h.cleanup() }
})

// --- the script ---

const script = new URL('../scripts/agente.mjs', import.meta.url).pathname

test('script: --help documents the flags and the config; a bad flag is a clear error', () => {
  const help = spawnSync(process.execPath, [script, '--help'], { encoding: 'utf8' })
  assert.equal(help.status, 0)
  for (const word of ['--paralelo', 'linear.env', 'LINEAR_API_KEY', 'LINEAR_TEAM', 'factory-fallida']) assert.ok(help.stdout.includes(word), word)
  const bad = spawnSync(process.execPath, [script, '--nope'], { encoding: 'utf8' })
  assert.equal(bad.status, 2)
  assert.match(bad.stderr, /--nope/)
})

test('script: refuses without a mode-600 config, and refuses a second instance (lock) before touching any network', () => {
  const dir = scratch()
  try {
    const run = () => spawnSync(process.execPath, [script, '--config', dir, '--repo', 'o/r'], { encoding: 'utf8', timeout: 20000 })
    assert.match(run().stderr, /linear\.env/)
    writeFileSync(join(dir, 'linear.env'), 'LINEAR_API_KEY=k\nLINEAR_TEAM=LIM\n')
    chmodSync(join(dir, 'linear.env'), 0o600)
    const release = acquireLock(join(dir, 'agente.lock'))
    try {
      const second = run()
      assert.equal(second.status, 2)
      assert.match(second.stderr, /ya hay un agente en marcha/)
    } finally { release() }
    assert.equal(existsSync(join(dir, 'agente.lock')), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
