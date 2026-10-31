import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { utimesSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  parseArgs, eligibleIssues, freeSlots, nextStep, closeComment, checkWorkflowDisabled, acquireLock, childEnv, loadConfig,
  repoFromRemote, parseOutputs, runLoop, runTask, runCommand, abortAll, makeTokenMinter,
} from '../lib/runner.js'
import { REQUIRED_PERMISSIONS } from '../lib/app-token.js'
import { issueFor } from '../lib/intake.js'

const scratch = () => mkdtempSync(join(tmpdir(), 'runner-test-'))
const BODY = '```json\n{"perfil":"marketing","peticion":"una campaña"}\n```'
const issue = (n, extra = {}) => ({ number: n, state: 'open', user: { login: 'Owner' }, labels: [{ name: 'entrada' }], body: BODY, ...extra })
const ctx = { owner: 'owner', hasBranch: () => false, taken: new Set() }

// --- arguments ---

test('--paralelo defaults to 6 and must be a sensible integer', () => {
  assert.equal(parseArgs([]).paralelo, 6)
  assert.equal(parseArgs(['--paralelo', '3']).paralelo, 3)
  for (const bad of ['0', '-1', 'abc', '2.5', '100', '']) assert.throws(() => parseArgs(['--paralelo', bad]), /--paralelo/)
  assert.equal(parseArgs(['--help']).help, true)
  assert.throws(() => parseArgs(['--nope']), /--nope/)
})

// --- which issues are the runner's ---

test('eligible: open, labelled entrada, by the owner, with no state marker, not started and not taken', () => {
  const marked = issue(2, { body: `${BODY}\n<!-- factory:state {"perfil":"marketing"} -->` })
  const pr = issue(3, { pull_request: {} })
  const closed = issue(4, { state: 'closed' })
  const stranger = issue(5, { user: { login: 'mallory' } })
  const unlabelled = issue(6, { labels: [{ name: 'otra' }] })
  const taken = issue(7)
  const branch = issue(8)
  const fine = issue(9)
  const list = eligibleIssues([marked, pr, closed, stranger, unlabelled, taken, branch, fine, issue(1)], {
    owner: 'OWNER', taken: new Set([7]), hasBranch: (n) => n === 8,
  })
  assert.deepEqual(list.map((i) => i.number), [1, 9], 'oldest first')
})

test('eligible: a state marker typed inside the request text does not hide the request', () => {
  const typed = issue(11, { body: issueFor('marketing', 'Campaña <!-- factory:state {"x":1} --> para el verano').body })
  assert.deepEqual(eligibleIssues([typed], ctx).map((i) => i.number), [11])
  const started = issue(12, { body: `${typed.body}\n<!-- factory:state {"perfil":"marketing"} -->` })
  assert.deepEqual(eligibleIssues([started], ctx), [])
})

test('free slots never go below zero', () => {
  assert.equal(freeSlots(6, 2), 4)
  assert.equal(freeSlots(2, 5), 0)
})

test('the workflow-level decision: ok and ignored leave the issue alone, everything else closes it', () => {
  assert.equal(nextStep('ok'), 'pr')
  assert.equal(nextStep('ignored'), 'none')
  for (const status of ['rejected', 'failed', 'unchanged', 'error', undefined]) assert.equal(nextStep(status), 'close')
  assert.equal(closeComment('rejected'), 'La factory no ha podido convertir esta petición en un cambio (resultado: rejected). Cierro la tarea.')
})

test('repository slug from an ssh or https remote', () => {
  assert.equal(repoFromRemote('git@github.com:IamFranP13/charla-factory-demo.git'), 'IamFranP13/charla-factory-demo')
  assert.equal(repoFromRemote('https://github.com/o/r'), 'o/r')
  assert.equal(repoFromRemote('/tmp/somewhere'), null)
})

test('outputs file: key=value lines', () => {
  assert.deepEqual(parseOutputs('status=ok\nprofile=marketing\nfiles=a/b.json,c.json\n'), { status: 'ok', profile: 'marketing', files: 'a/b.json,c.json' })
})

// --- one mode at a time ---

test('refuses to run while the factory workflow is enabled, or when it cannot be checked', async () => {
  const answer = (state) => async () => ({ code: 0, stdout: JSON.stringify({ state }) })
  await assert.rejects(checkWorkflowDisabled({ run: answer('active'), repo: 'o/r' }), /gh workflow disable factory\.yml/)
  await assert.rejects(checkWorkflowDisabled({ run: async () => ({ code: 1, stdout: '', stderr: 'boom' }), repo: 'o/r' }), /no se pudo comprobar/)
  await assert.rejects(checkWorkflowDisabled({ run: async () => ({ code: 0, stdout: 'not json' }), repo: 'o/r' }), /no se pudo comprobar/)
  await checkWorkflowDisabled({ run: answer('disabled_manually'), repo: 'o/r' })
})

test('only one runner instance: a live lock refuses, a stale one is replaced, release frees it', () => {
  const dir = scratch()
  try {
    const path = join(dir, 'runner.lock')
    const release = acquireLock(path, { pid: 111, isAlive: () => true })
    assert.throws(() => acquireLock(path, { pid: 222, isAlive: (pid) => pid === 111 }), /ya hay un runner/)
    release()
    assert.equal(existsSync(path), false)
    writeFileSync(path, '999999')
    const again = acquireLock(path, { pid: 333, isAlive: () => false })
    assert.equal(readFileSync(path, 'utf8'), '333')
    again()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an empty or half-written lock file is held, not taken over (unless it is old)', () => {
  const dir = scratch()
  try {
    const path = join(dir, 'runner.lock')
    writeFileSync(path, '')
    assert.throws(() => acquireLock(path, { pid: 2, isAlive: () => true }), /runner/)
    writeFileSync(path, '12ab')
    assert.throws(() => acquireLock(path, { pid: 2, isAlive: () => false }), /runner/)
    const old = new Date(Date.now() - 60000)
    utimesSync(path, old, old)
    acquireLock(path, { pid: 2, isAlive: () => false })()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('taking over a stale lock is atomic: of many runners started together exactly one gets in', async () => {
  const dir = scratch()
  try {
    const path = join(dir, 'runner.lock')
    const code = `
      import { acquireLock } from ${JSON.stringify(new URL('../lib/runner.js', import.meta.url).href)}
      const [path, at] = process.argv.slice(1)
      while (Date.now() < Number(at)) {}
      try { acquireLock(path); console.log('won'); await new Promise((r) => setTimeout(r, 400)) } catch { console.log('lost') }`
    for (let round = 0; round < 8; round++) {
      writeFileSync(path, '999999')
      const at = String(Date.now() + 400)
      const outputs = await Promise.all(Array.from({ length: 6 }, () => new Promise((resolve) => {
        const child = spawn(process.execPath, ['--input-type=module', '-e', code, path, at])
        let out = ''
        child.stdout.on('data', (c) => { out += c })
        child.on('close', () => resolve(out.trim()))
      })))
      assert.equal(outputs.filter((o) => o === 'won').length, 1, `round ${round}: ${outputs}`)
      rmSync(path, { force: true })
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// --- secrets stay on the PC ---

test('the full token asks for exactly the permissions the pipeline needs, the narrow one for less', async () => {
  const bodies = []
  const fetch = async (url, init = {}) => {
    const json = (body) => ({ ok: true, status: 201, json: async () => body })
    if (url.endsWith('/installation')) return json({ id: 5 })
    const body = JSON.parse(init.body)
    bodies.push(body)
    return json({ token: 't', expires_at: 'x', permissions: { ...body.permissions, metadata: 'read' } })
  }
  const { generateKeyPairSync } = await import('node:crypto')
  const privateKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' })
  const minter = makeTokenMinter({ appId: '1', privateKey, repo: 'o/r', fetch })
  assert.equal(await minter('full'), 't')
  assert.deepEqual(bodies[0].permissions, REQUIRED_PERMISSIONS)
  await minter('issues')
  assert.deepEqual(bodies[1].permissions, { issues: 'write', contents: 'read' })
})

test('config: files must be mode 600, unknown model keys are dropped, the App id and key are required', () => {
  const dir = scratch()
  try {
    const put = (name, text, mode = 0o600) => { writeFileSync(join(dir, name), text); chmodSync(join(dir, name), mode) }
    assert.throws(() => loadConfig(dir), /app-id/)
    put('app-id', '123\n')
    put('app-key.pem', 'KEY', 0o644)
    assert.throws(() => loadConfig(dir), /600/)
    put('app-key.pem', 'KEY')
    put('modelo.env', '# comment\nFACTORY_MODEL=m1\nFACTORY_API_KEY=secret\nFACTORY_BROWSER=/usr/bin/chromium\nPATH=/evil\nGH_TOKEN=x\n')
    const config = loadConfig(dir)
    assert.equal(config.appId, '123')
    assert.equal(config.privateKey, 'KEY')
    assert.deepEqual(config.model, { FACTORY_MODEL: 'm1', FACTORY_API_KEY: 'secret', FACTORY_BROWSER: '/usr/bin/chromium' })
    put('modelo.env', 'FACTORY_MODEL=m1', 0o664)
    assert.throws(() => loadConfig(dir), /600/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the factory child gets an allowlist: model variables, the token, the repository, the output file, a browser; nothing else', () => {
  const parent = { PATH: '/bin', HOME: '/home/me', GH_TOKEN: 'user-login', AWS_SECRET: 'x', FACTORY_API_KEY: 'from-shell', SSH_AUTH_SOCK: '/s', ANTHROPIC_API_KEY: 'k' }
  const env = childEnv({ parent, home: '/tmp/h', token: 'app-token', repo: 'o/r', output: '/tmp/out', model: { FACTORY_MODEL: 'm', FACTORY_API_KEY: 'secret' } })
  assert.deepEqual(env, {
    PATH: '/bin', HOME: '/tmp/h', TMPDIR: '/tmp/h/tmp', GH_TOKEN: 'app-token', GITHUB_REPOSITORY: 'o/r', GITHUB_OUTPUT: '/tmp/out',
    GH_PROMPT_DISABLED: '1', FACTORY_MODEL: 'm', FACTORY_API_KEY: 'secret',
  })
})

// --- the scheduler ---

const tick = () => new Promise((resolve) => setImmediate(resolve))

test('backlog on start, never more than N at once, no task twice, stop lets the running ones finish', async () => {
  const issues = Array.from({ length: 5 }, (_, i) => issue(i + 1))
  const running = new Set()
  const finish = {}
  let peak = 0
  const started = []
  let stopping = false
  let polls = 0
  const loop = runLoop({
    paralelo: 2,
    poll: async () => { polls++; return issues },
    start: (n) => {
      started.push(n)
      running.add(n)
      peak = Math.max(peak, running.size)
      return new Promise((resolve) => { finish[n] = () => { running.delete(n); resolve() } })
    },
    eligible: (list, taken) => eligibleIssues(list, { owner: 'owner', taken, hasBranch: () => false }),
    sleep: async () => { await tick() },
    isStopping: () => stopping,
    log: () => {},
  })
  for (let i = 0; i < 20; i++) await tick()
  assert.deepEqual(started, [1, 2], 'the backlog is picked up at once, up to the limit')
  finish[1]()
  for (let i = 0; i < 20; i++) await tick()
  assert.deepEqual(started, [1, 2, 3], 'a freed slot is filled')
  stopping = true
  finish[2]()
  for (let i = 0; i < 20; i++) await tick()
  assert.deepEqual(started, [1, 2, 3], 'after stopping nothing new starts')
  let done = false
  loop.then(() => { done = true })
  for (let i = 0; i < 5; i++) await tick()
  assert.equal(done, false, 'the runner waits for the request still running')
  finish[3]()
  await loop
  assert.ok(peak <= 2)
  assert.ok(polls > 1)
})

test('a failing poll or task does not stop the loop and a task that ran is not run again', async () => {
  let stopping = false
  let call = 0
  const started = []
  await runLoop({
    paralelo: 3,
    poll: async () => { call++; if (call === 1) throw new Error('red caída'); return [issue(1)] },
    start: async (n) => { started.push(n); throw new Error('falló') },
    eligible: (list, taken) => eligibleIssues(list, { owner: 'owner', taken, hasBranch: () => false }),
    sleep: async () => { if (call >= 4) stopping = true },
    isStopping: () => stopping,
    log: () => {},
  })
  assert.deepEqual(started, [1])
})

// --- one request, end to end, with real git ---

function git(cwd, ...args) {
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' }).trim()
}

function fixture() {
  const base = scratch()
  const origin = join(base, 'origin.git')
  const root = join(base, 'repo')
  mkdirSync(origin)
  git(origin, 'init', '--bare', '-b', 'main')
  git(base, 'clone', origin, root)
  mkdirSync(join(root, 'content'), { recursive: true })
  writeFileSync(join(root, 'content/base.json'), '{}')
  writeFileSync(join(root, 'package.json'), '{}')
  git(root, 'add', '.')
  git(root, 'commit', '-m', 'base')
  git(root, 'branch', '-M', 'main')
  git(root, 'push', '-u', 'origin', 'main')
  mkdirSync(join(base, 'nm'))
  symlinkSync(join(base, 'nm'), join(root, 'node_modules'))
  return { base, origin, root }
}

// The real run for git; the factory child and gh are scripted.
function scriptedRun({ root, factory, calls }) {
  return async (cmd, args, options = {}) => {
    calls.push({ cmd: cmd.endsWith('node') ? 'node' : cmd, args, options })
    if (cmd === 'gh') {
      if (args[0] === 'issue' && args[1] === 'view') return { code: 0, stdout: 'OPEN\n', stderr: '' }
      if (args[0] === 'pr' && args[1] === 'create') return { code: 0, stdout: 'https://github.com/o/r/pull/42\n', stderr: '' }
      return { code: 0, stdout: '', stderr: '' }
    }
    if (cmd === process.execPath) return factory(args, options)
    return runCommand(cmd, args, options)
  }
}

function makeContext(f, overrides = {}) {
  const calls = []
  const minted = []
  return {
    calls, minted,
    context: {
      root: f.root, repo: 'o/r', tmpBase: f.base, model: { FACTORY_MODEL: 'm', FACTORY_API_KEY: 'model-secret' },
      remoteUrl: () => f.origin, log: () => {},
      mintToken: async (scope) => { minted.push(scope); return `token-${scope}` },
      ...overrides,
    },
  }
}

const writeOutputs = (options, values) => appendFileSync(options.env.GITHUB_OUTPUT, Object.entries(values).map(([k, v]) => `${k}=${v}`).join('\n') + '\n')

test('ok: its own worktree of origin/main, commits exactly the reported files, pushes tarea/N, opens the PR, records it, leaves nothing behind', async () => {
  const f = fixture()
  try {
    const seen = {}
    const { calls, context } = makeContext(f)
    context.run = scriptedRun({
      root: f.root, calls: calls,
      factory: (args, options) => {
        if (args.includes('--pr')) { seen.pr = args; return { code: 0, stdout: '', stderr: '' } }
        seen.cwd = options.cwd
        seen.env = options.env
        mkdirSync(join(options.cwd, 'content/campanas'), { recursive: true })
        writeFileSync(join(options.cwd, 'content/campanas/tarea-7.json'), '{"a":1}')
        writeFileSync(join(options.cwd, 'content/stray.json'), 'not reported')
        writeOutputs(options, { status: 'ok', profile: 'marketing', files: 'content/campanas/tarea-7.json' })
        return { code: 0, stdout: '', stderr: '' }
      },
    })
    const result = await runTask(7, context)
    assert.deepEqual(result, { number: 7, status: 'ok', outcome: 'pr', pr: 42 })

    // Its own throwaway worktree, not the repository itself.
    assert.notEqual(seen.cwd, f.root)
    assert.equal(existsSync(seen.cwd), false, 'the worktree is removed')
    assert.equal(git(f.root, 'worktree', 'list', '--porcelain').split('\n').filter((l) => l.startsWith('worktree ')).length, 1)
    assert.equal(git(f.root, 'status', '--porcelain', '--untracked-files=no'), '')

    // Exactly the reported file, on the remote, from origin/main.
    assert.equal(git(f.origin, 'show', '--name-only', '--format=', 'tarea/7'), 'content/campanas/tarea-7.json')
    assert.equal(git(f.origin, 'rev-parse', 'tarea/7~1'), git(f.origin, 'rev-parse', 'main'))
    assert.equal(git(f.origin, 'log', '-1', '--format=%s', 'tarea/7'), 'Tarea #7 (marketing)')
    assert.equal(git(f.root, 'branch', '--list', 'tarea/7'), '', 'no local branch left behind')

    // The child saw only the allowlist, with the narrow token; the PR step used the full one.
    assert.deepEqual(Object.keys(seen.env).sort(), ['FACTORY_API_KEY', 'FACTORY_MODEL', 'GH_PROMPT_DISABLED', 'GH_TOKEN', 'GITHUB_OUTPUT', 'GITHUB_REPOSITORY', 'HOME', 'PATH', 'TMPDIR'].sort())
    assert.equal(seen.env.GH_TOKEN, 'token-issues')
    const pr = calls.find((c) => c.cmd === 'gh' && c.args[0] === 'pr')
    assert.equal(pr.options.env.GH_TOKEN, 'token-full')
    assert.ok(pr.args.includes('Closes #7'))
    assert.ok(pr.args.includes('perfil:marketing'))
    assert.ok(pr.args.includes('tarea/7'))
    assert.deepEqual(seen.pr.slice(-4), ['--issue', '7', '--pr', '42'])
    assert.equal(calls.find((c) => c.args.includes('--pr')).options.env.FACTORY_API_KEY, undefined, 'the model key is not needed to record the PR')

    // No token in any git config, anywhere.
    for (const dir of [f.root, f.origin]) {
      const text = readdirSync(dir, { recursive: true }).filter((p) => /(^|\/)config$/.test(p) || /FETCH_HEAD$/.test(p)).map((p) => readFileSync(join(dir, p === 'config' ? 'config' : p), 'utf8')).join('\n')
      assert.ok(!text.includes('token-'), `no token in ${dir}`)
    }
    const push = calls.find((c) => c.cmd === 'git' && c.args.includes('push'))
    assert.ok(!push.args.join(' ').includes('token-full'), 'the token is not on the command line')
    assert.match(push.options.env.GIT_CONFIG_VALUE_0, /^Authorization: Basic /)
    assert.equal(readFileSync(join(f.root, '.git/config'), 'utf8').includes('extraheader'), false)
  } finally {
    rmSync(f.base, { recursive: true, force: true })
  }
})

test('rejected / failed / unchanged / crashed: the issue is closed as not planned with the workflow comment; ignored is left alone', async () => {
  for (const [status, expected] of [['rejected', 'close'], ['failed', 'close'], ['unchanged', 'close'], ['ignored', 'none'], [undefined, 'close']]) {
    const f = fixture()
    try {
      const { calls, context } = makeContext(f)
      context.run = scriptedRun({ root: f.root, calls, factory: (args, options) => { if (status) writeOutputs(options, { status }); return { code: status ? 0 : 2, stdout: '', stderr: 'boom' } } })
      const result = await runTask(5, context)
      assert.equal(result.outcome, expected === 'close' ? 'closed' : 'ignored', String(status))
      const close = calls.find((c) => c.cmd === 'gh' && c.args[0] === 'issue' && c.args[1] === 'close')
      if (expected === 'close') {
        assert.deepEqual(close.args.slice(0, 5), ['issue', 'close', '5', '--repo', 'o/r'])
        assert.ok(close.args.includes('not planned'))
        assert.ok(close.args.includes(`La factory no ha podido convertir esta petición en un cambio (resultado: ${status ?? 'error'}). Cierro la tarea.`))
        assert.equal(close.options.env.GH_TOKEN, 'token-issues')
      } else {
        assert.equal(close, undefined)
      }
      assert.equal(calls.some((c) => c.args.includes('push')), false, 'nothing is pushed')
      assert.equal(git(f.origin, 'branch', '--list', 'tarea/*'), '')
      assert.equal(readdirSync(f.base).filter((n) => n.startsWith('runner-')).length, 0, 'scratch removed')
    } finally {
      rmSync(f.base, { recursive: true, force: true })
    }
  }
})

test('a started issue is skipped: closed, or its branch already exists', async () => {
  const f = fixture()
  try {
    git(f.root, 'push', 'origin', 'HEAD:refs/heads/tarea/3')
    const { calls, context } = makeContext(f)
    context.run = scriptedRun({ root: f.root, calls, factory: () => assert.fail('the factory must not run') })
    assert.deepEqual(await runTask(3, context), { number: 3, outcome: 'skipped' })

    const closed = makeContext(f)
    closed.context.run = async (cmd, args, options) => (cmd === 'gh' && args[1] === 'view' ? { code: 0, stdout: 'CLOSED\n' } : scriptedRun({ root: f.root, calls: closed.calls, factory: () => assert.fail('no') })(cmd, args, options))
    assert.deepEqual(await runTask(4, closed.context), { number: 4, outcome: 'skipped' })
  } finally {
    rmSync(f.base, { recursive: true, force: true })
  }
})

test('the worktree and the scratch directory are removed even when the factory throws or a reported file is bad', async () => {
  for (const factory of [
    () => { throw new Error('child exploded') },
    (args, options) => { writeOutputs(options, { status: 'ok', profile: 'marketing', files: '../escape.json' }); return { code: 0 } },
    (args, options) => { writeOutputs(options, { status: 'ok', profile: 'marketing', files: 'content/nothing.json' }); return { code: 0 } },
    ...['.GIT/config', 'content/.git/x', ':(glob)*', '*', ':/', 'content/base.json,content/base.json', 'link/base.json', 'content/.GiT', 'content/*.json'].map((files) => (args, options) => {
      writeFileSync(join(options.cwd, 'content/extra.json'), 'x')
      symlinkSync(join(options.cwd, 'content'), join(options.cwd, 'link'))
      writeOutputs(options, { status: 'ok', profile: 'marketing', files }); return { code: 0 }
    }),
  ]) {
    const f = fixture()
    try {
      const { calls, context } = makeContext(f)
      context.run = scriptedRun({ root: f.root, calls, factory })
      await assert.rejects(runTask(9, context))
      assert.equal(git(f.root, 'worktree', 'list', '--porcelain').split('\n').filter((l) => l.startsWith('worktree ')).length, 1)
      assert.equal(readdirSync(f.base).filter((n) => n.startsWith('runner-')).length, 0)
      assert.equal(git(f.origin, 'branch', '--list', 'tarea/*'), '')
    } finally {
      rmSync(f.base, { recursive: true, force: true })
    }
  }
})

test('runCommand times out and kills a child, and reports its output', async () => {
  const slow = await runCommand(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { timeoutMs: 200 })
  assert.equal(slow.timedOut, true)
  const quick = await runCommand(process.execPath, ['-e', 'process.stdout.write("hola")'], {})
  assert.equal(quick.stdout, 'hola')
  assert.equal(quick.code, 0)
})

// --- the git steps before the push never see a token; the record and label failures are not silent ---

test('add, diff and commit run without any token; only the push carries it', async () => {
  const f = fixture()
  try {
    const { calls, context } = makeContext(f)
    context.run = scriptedRun({
      root: f.root, calls,
      factory: (args, options) => {
        if (args.includes('--pr')) return { code: 0 }
        mkdirSync(join(options.cwd, 'content/campanas'), { recursive: true })
        writeFileSync(join(options.cwd, 'content/campanas/tarea-7.json'), '{"a":1}')
        writeOutputs(options, { status: 'ok', profile: 'marketing', files: 'content/campanas/tarea-7.json' })
        return { code: 0 }
      },
    })
    await runTask(7, context)
    const gitCalls = calls.filter((c) => c.cmd === 'git')
    for (const name of ['add', 'diff', 'commit']) {
      const call = gitCalls.find((c) => c.args.includes(name) && !c.args.includes('worktree'))
      assert.ok(call, name)
      assert.equal(JSON.stringify(call.options.env).includes('token-'), false, `${name} has no token`)
      assert.equal(call.options.env.GIT_CONFIG_VALUE_0, undefined)
    }
    assert.match(gitCalls.find((c) => c.args.includes('push')).options.env.GIT_CONFIG_VALUE_0, /^Authorization/)
  } finally {
    rmSync(f.base, { recursive: true, force: true })
  }
})

test('a failed label or PR-record step is warned about, not reported as success', async () => {
  const f = fixture()
  try {
    const logs = []
    const { calls, context } = makeContext(f, { log: (m) => logs.push(m) })
    const inner = scriptedRun({
      root: f.root, calls,
      factory: (args, options) => {
        if (args.includes('--pr')) return { code: 1, stdout: '', stderr: 'no pude' }
        mkdirSync(join(options.cwd, 'content/campanas'), { recursive: true })
        writeFileSync(join(options.cwd, 'content/campanas/tarea-7.json'), '{"a":1}')
        writeOutputs(options, { status: 'ok', profile: 'marketing', files: 'content/campanas/tarea-7.json' })
        return { code: 0 }
      },
    })
    context.run = async (cmd, args, options) => (cmd === 'gh' && args[0] === 'label' ? { code: 1, stdout: '', stderr: 'denied' } : inner(cmd, args, options))
    const result = await runTask(7, context)
    assert.equal(result.outcome, 'pr')
    assert.ok(logs.some((l) => /#7: aviso.*etiqueta/.test(l)), logs.join('\n'))
    assert.ok(logs.some((l) => /#7: aviso.*estado/.test(l)), logs.join('\n'))
  } finally {
    rmSync(f.base, { recursive: true, force: true })
  }
})

// --- a second Ctrl+C ---

test('abortAll kills the children, removes their worktrees and scratch directories, and is safe to repeat', async () => {
  const f = fixture()
  try {
    const { calls, context } = makeContext(f)
    let seen
    let killed
    context.run = scriptedRun({
      root: f.root, calls,
      factory: async (args, options) => {
        seen = options.cwd
        const pending = runCommand(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { timeoutMs: 60000 })
        await tick()
        abortAll()
        killed = await pending
        abortAll()
        return { code: 1 }
      },
    })
    await assert.rejects(runTask(7, context))
    assert.equal(killed.timedOut, false)
    assert.notEqual(killed.code, 0, 'killed by the abort, not finished')
    assert.equal(existsSync(seen), false)
    assert.equal(git(f.root, 'worktree', 'list', '--porcelain').split('\n').filter((l) => l.startsWith('worktree ')).length, 1)
    assert.equal(readdirSync(f.base).filter((n) => n.startsWith('runner-')).length, 0)
  } finally {
    rmSync(f.base, { recursive: true, force: true })
  }
})

// --- the other mode switched on mid-run ---

test('the workflow is checked before each claim: enabling it stops claiming at once; an unreadable state skips the cycle', async () => {
  let checks = 0
  let sleeps = 0
  const started = []
  const logs = []
  await runLoop({
    paralelo: 1,
    poll: async () => [issue(1), issue(2), issue(3)],
    start: async (n) => { started.push(n) },
    eligible: (list, taken) => eligibleIssues(list, { owner: 'owner', taken, hasBranch: () => false }),
    guard: async () => {
      checks++
      if (checks === 1) throw new Error('sin red')
      if (checks === 3) throw Object.assign(new Error('workflow activado'), { fatal: true })
    },
    sleep: async () => { await tick(); sleeps++ },
    isStopping: () => sleeps > 30,
    log: (m) => logs.push(m),
  })
  assert.deepEqual(started, [1], 'nothing on the unreadable cycle, one on the good one, nothing after the fatal answer')
  assert.equal(checks, 3)
  assert.ok(logs.some((m) => /workflow activado/.test(m)))
})
