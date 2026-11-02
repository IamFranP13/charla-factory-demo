import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gitNode } from '../lib/fabrica.js'
import { initialState, replaceState, parseState } from '../lib/estado.js'
import { issueFor } from '../lib/intake.js'
import {
  Refusal, hostGit, safeRelPath, walkTree, recheckArgs, commitMessage, pushCommand, scrub, trabajoNode, abrirPr, TAREA_RE,
} from '../lib/publicar.js'

const gitEnv = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', env: gitEnv }).trim()
const scratch = (fn) => async () => {
  const root = mkdtempSync(join(tmpdir(), 'publicar-'))
  try { await fn(root) } finally { rmSync(root, { recursive: true, force: true }) }
}
const put = (dir, file, text, mode) => {
  mkdirSync(join(dir, file, '..'), { recursive: true })
  writeFileSync(join(dir, file), text)
  if (mode) chmodSync(join(dir, file), mode)
}

// --- paths and the file walk ---------------------------------------------------------------------------------------

test('safeRelPath: plain relative paths only (no empty, dot or dot-dot segments, nothing outside the repo, no .git, no control characters)', () => {
  for (const ok of ['a.txt', 'content/campanas/tarea-1.json', 'src/components/Header.astro', 'ñandú/ü.txt']) assert.equal(safeRelPath(ok), ok)
  for (const bad of ['', '.', '..', './a', 'a/./b', 'a/../b', '../a', '/etc/passwd', 'a//b', 'a/', '.git/config', 'a/.git/hooks/x', 'a/.GIT/x', 'a\nb', 'a\u0000b', 'a\\b', `${'x'.repeat(201)}`, 'a/\u2028b', 'a/�']) {
    assert.throws(() => safeRelPath(bad), Refusal, JSON.stringify(bad))
  }
})

test('walkTree: takes regular files with their exec bit, skips .git, node_modules, .fabrica and build output at the top', scratch((root) => {
  put(root, 'a.txt', 'uno')
  put(root, 'content/b.json', '{}')
  put(root, 'run.sh', '#!/bin/sh', 0o755)
  execFileSync('mkfifo', [join(root, '.git')]) // never looked at
  symlinkSync('/opt/x', join(root, 'node_modules'))
  put(root, '.fabrica/resultado.json', '{}')
  put(root, 'dist/index.html', 'x')
  put(root, '.astro/cache', 'x')
  const files = walkTree(root)
  assert.deepEqual(files.map((f) => f.path), ['a.txt', 'content/b.json', 'run.sh'])
  assert.deepEqual(files.map((f) => f.exec), [false, false, true])
  assert.equal(files[0].size, 3)
}))

test('walkTree refuses a symlink (file or directory), a FIFO, an oversized file, too many files, a nested .git and a deep tree', scratch((root) => {
  const fresh = (name) => { const d = join(root, name); mkdirSync(d); put(d, 'ok.txt', 'ok'); return d }
  let d = fresh('link')
  symlinkSync('/etc/passwd', join(d, 'passwd'))
  assert.throws(() => walkTree(d), /enlace/)
  d = fresh('dirlink')
  symlinkSync('/etc', join(d, 'etc'))
  assert.throws(() => walkTree(d), /enlace/)
  d = fresh('fifo')
  execFileSync('mkfifo', [join(d, 'tubo')])
  assert.throws(() => walkTree(d), /regular/)
  d = fresh('big')
  put(d, 'grande.bin', 'x'.repeat(101))
  assert.throws(() => walkTree(d, { maxBytes: 100 }), /tamaño|grande/)
  d = fresh('many')
  for (let i = 0; i < 5; i++) put(d, `f${i}.txt`, 'x')
  assert.throws(() => walkTree(d, { maxFiles: 4 }), /demasiados/)
  assert.equal(walkTree(d, { maxFiles: 6 }).length, 6)
  d = fresh('nested')
  mkdirSync(join(d, 'sub/.git'), { recursive: true })
  put(d, 'sub/.git/config', 'x')
  assert.throws(() => walkTree(d), Refusal)
  d = fresh('deep')
  put(d, 'a/b/c/d/e/f.txt', 'x')
  assert.throws(() => walkTree(d, { maxDepth: 3 }), /profund/)
}))

// --- take the work: clean clone, apply, commit ----------------------------------------------------------------------------

async function world(root) {
  const source = join(root, 'real')
  mkdirSync(source)
  git(source, 'init', '-q', '-b', 'main')
  put(source, 'a.txt', 'uno')
  put(source, 'viejo.txt', 'borrar')
  put(source, 'content/campanas/x.json', '{"x":1}')
  put(source, 'run.sh', '#!/bin/sh', 0o644)
  git(source, 'add', '.')
  git(source, 'commit', '-qm', 'uno')
  git(source, 'update-ref', 'refs/remotes/origin/main', 'HEAD')
  const copias = join(root, 'copias')
  const copy = await gitNode({ source, copias, fetch: false }).prepare({ numero: 5 })
  return { source, copias, copy }
}

test('tomar: compares the copy\'s files with a clean clone of the base, applies adds, edits and deletions, commits as the factory with the host message', scratch(async (root) => {
  const { source, copias, copy } = await world(root)
  put(copy.dir, 'a.txt', 'dos') // edit
  put(copy.dir, 'content/campanas/tarea-5.json', '{"nueva":true}') // add
  rmSync(join(copy.dir, 'viejo.txt')) // delete
  chmodSync(join(copy.dir, 'run.sh'), 0o755) // exec bit
  put(copy.dir, '.fabrica/resultado.json', '{}')
  const calls = []
  const node = trabajoNode({ source, copias, git: (cwd, args, options) => { calls.push({ cwd, args }); return hostGit(cwd, args, options) } })
  // The copy's own git is hostile: a FIFO as config, a hook, junk as HEAD. None of it may be read or run.
  rmSync(join(copy.dir, '.git/config'))
  execFileSync('mkfifo', [join(copy.dir, '.git/config')])
  writeFileSync(join(copy.dir, '.git/hooks/pre-commit'), `#!/bin/sh\ntouch ${join(root, 'HOOK-RAN')}\n`, { mode: 0o755 })
  writeFileSync(join(copy.dir, '.git/HEAD'), 'basura')

  const made = await node.tomar({ dir: copy.dir, base: copy.base, numero: 5, resumen: 'Campaña\nañadida \u202e con   saltos' })
  assert.equal(made.clone, node.dir(5))
  assert.deepEqual([...made.files].sort(), ['a.txt', 'content/campanas/tarea-5.json', 'run.sh', 'viejo.txt'])
  assert.deepEqual(made.added, ['content/campanas/tarea-5.json'], 'added: only the paths the commit creates')
  assert.ok(calls.length > 0)
  assert.ok(calls.every((c) => c.cwd !== copy.dir && !c.cwd.startsWith(`${copy.dir}/`) && !JSON.stringify(c.args).includes(copy.dir)), 'no git call targets the copy')
  assert.ok(!existsSync(join(root, 'HOOK-RAN')))

  const clone = made.clone
  assert.equal(git(clone, 'log', '-1', '--format=%an <%ae>|%cn <%ce>'), 'Fábrica LIMONIA <fabrica@limonia.invalid>|Fábrica LIMONIA <fabrica@limonia.invalid>')
  assert.equal(git(clone, 'log', '-1', '--format=%s'), 'Tarea #5: Campaña añadida con saltos')
  assert.equal(git(clone, 'rev-parse', '--abbrev-ref', 'HEAD'), 'tarea/5')
  assert.equal(git(clone, 'rev-parse', 'HEAD~1'), copy.base)
  assert.equal(git(clone, 'diff', '--name-status', 'HEAD~1', 'HEAD').split('\n').sort().join('|'), 'A\tcontent/campanas/tarea-5.json|D\tviejo.txt|M\ta.txt|M\trun.sh')
  assert.match(git(clone, 'ls-tree', 'HEAD', 'run.sh'), /^100755/)
  assert.equal(readFileSync(join(clone, 'a.txt'), 'utf8'), 'dos')
  const commitCall = calls.find((c) => c.args.includes('commit'))
  assert.ok(commitCall.args.includes('core.hooksPath=/dev/null'), 'hooks are switched off')
  assert.ok(!git(clone, 'ls-files').includes('.fabrica'))
}))

test('cambios: the diff over the base and the text before/after of each changed file, read from the host-made clone', scratch(async (root) => {
  const { source, copias, copy } = await world(root)
  put(copy.dir, 'a.txt', 'dos')
  put(copy.dir, 'content/campanas/tarea-5.json', '{"nueva":true}')
  rmSync(join(copy.dir, 'viejo.txt'))
  const node = trabajoNode({ source, copias })
  const made = await node.tomar({ dir: copy.dir, base: copy.base, numero: 5, resumen: 'x' })
  const changes = await node.cambios({ clone: made.clone, base: copy.base, files: made.files })
  assert.match(changes.diff, /^diff --git a\/a\.txt b\/a\.txt/m)
  assert.match(changes.diff, /\+dos/)
  assert.match(changes.diff, /\+\{"nueva":true\}/)
  assert.equal(changes.antes['a.txt'], 'uno')
  assert.equal(changes.antes['content/campanas/tarea-5.json'], null)
  assert.deepEqual(changes.despues.map((f) => [f.path, f.content]).sort(), [['a.txt', 'dos'], ['content/campanas/tarea-5.json', '{"nueva":true}']])
  await assert.rejects(node.cambios({ clone: made.clone, base: 'nope', files: [] }), /base/)
}))

test('tomar: an unchanged copy makes no commit; a refused file ends in a Refusal and nothing is committed', scratch(async (root) => {
  const { source, copias, copy } = await world(root)
  const node = trabajoNode({ source, copias })
  const none = await node.tomar({ dir: copy.dir, base: copy.base, numero: 5, resumen: 'nada' })
  assert.deepEqual(none.files, [])
  assert.equal(git(none.clone, 'rev-parse', 'HEAD'), copy.base)

  symlinkSync('/etc/passwd', join(copy.dir, 'enlace'))
  await assert.rejects(node.tomar({ dir: copy.dir, base: copy.base, numero: 5, resumen: 'x' }), Refusal)
  rmSync(join(copy.dir, 'enlace'))
  execFileSync('mkfifo', [join(copy.dir, 'tubo')])
  await assert.rejects(node.tomar({ dir: copy.dir, base: copy.base, numero: 5, resumen: 'x' }), Refusal)
  rmSync(join(copy.dir, 'tubo'))
  put(copy.dir, 'gigante.bin', 'x'.repeat(2_000_001))
  await assert.rejects(node.tomar({ dir: copy.dir, base: copy.base, numero: 5, resumen: 'x' }), Refusal)
}))

test('tomar: the clone starts from the recorded base even when origin/main has moved on', scratch(async (root) => {
  const { source, copias, copy } = await world(root)
  put(source, 'nuevo-en-main.txt', 'x')
  git(source, 'add', '.')
  git(source, 'commit', '-qm', 'main avanza')
  git(source, 'update-ref', 'refs/remotes/origin/main', 'HEAD')
  put(copy.dir, 'b.txt', 'b')
  const made = await trabajoNode({ source, copias }).tomar({ dir: copy.dir, base: copy.base, numero: 5, resumen: 'b' })
  assert.deepEqual(made.files, ['b.txt'])
  assert.equal(git(made.clone, 'rev-parse', 'HEAD~1'), copy.base)
}))

test('commitMessage: Tarea #n: one sanitised line of at most 72 characters', () => {
  assert.equal(commitMessage(7, 'Hola\n\nmundo'), 'Tarea #7: Hola mundo')
  assert.equal(commitMessage(7, '\u202e\u0007'), 'Tarea #7: cambios de la fábrica')
  assert.ok(Array.from(commitMessage(7, 'x'.repeat(500))).length <= 72 + 'Tarea #7: '.length)
})

// --- the re-check container ----------------------------------------------------------------------------------------

test('recheckArgs: a new container with no network, no capabilities, limits, the clone at /work, no environment secret', () => {
  const args = recheckArgs({ numero: 7, dir: '/copias/t7.limpio', ids: { uid: 1000, gid: 1000 } })
  const flag = (f) => args[args.indexOf(f) + 1]
  assert.deepEqual(args.slice(0, 2), ['run', '--rm'])
  assert.equal(flag('--name'), 'limonia-verif-t7')
  assert.equal(flag('--network'), 'none')
  assert.equal(args.filter((a) => a === '--network').length, 1)
  assert.equal(flag('--cap-drop'), 'ALL')
  assert.equal(flag('--security-opt'), 'no-new-privileges')
  assert.equal(flag('--user'), '1000:1000')
  for (const f of ['--cpus', '--memory', '--pids-limit', '--tmpfs']) assert.ok(args.includes(f), f)
  assert.ok(args.some((a) => a.startsWith('/tmp:') && a.split(':')[1].split(',').includes('exec')), 'the tests run helper scripts from /tmp (docker mounts tmpfs noexec by default)')
  assert.ok(args.some((a) => a.includes('source=/copias/t7.limpio') && a.includes('target=/work')))
  const envs = args.flatMap((a, i) => (a === '-e' ? [args[i + 1]] : []))
  assert.ok(envs.every((e) => !/token|key|secret|sk-|ANTHROPIC/i.test(e)), envs.join(','))
  assert.ok(!args.some((a) => /docker\.sock|--privileged/.test(a)))
  const image = args.indexOf('limonia-agente:dev')
  assert.deepEqual(args.slice(image + 1), ['sh', '-c', 'npm test && npm run build'])
})

// --- the push -------------------------------------------------------------------------------------------------------------

test('pushCommand: the token travels in the environment only, never in argv; explicit url, forced hooks off, no remote name', () => {
  const token = 'gho_SECRETTOKEN123'
  const { args, env } = pushCommand({ repo: 'owner/repo', numero: 5, token, base: { PATH: '/bin' } })
  assert.ok(!JSON.stringify(args).includes(token))
  assert.ok(!JSON.stringify(args).includes(Buffer.from(`x-access-token:${token}`).toString('base64')))
  assert.ok(args.includes('https://github.com/owner/repo.git'))
  assert.ok(args.includes('+refs/heads/tarea/5:refs/heads/tarea/5'))
  assert.ok(args.includes('core.hooksPath=/dev/null'))
  assert.ok(args.includes('--no-verify'))
  assert.ok(!args.includes('origin'))
  assert.equal(env.GIT_CONFIG_NOSYSTEM, '1')
  assert.equal(env.GIT_CONFIG_GLOBAL, '/dev/null')
  assert.equal(env.GIT_TERMINAL_PROMPT, '0')
  assert.match(env.GIT_CONFIG_KEY_0, /extraheader/i)
  assert.ok(env.GIT_CONFIG_VALUE_0.includes(Buffer.from(`x-access-token:${token}`).toString('base64')))
  assert.throws(() => pushCommand({ repo: 'owner/repo; rm', numero: 5, token }), /repo/)
  assert.throws(() => pushCommand({ repo: 'owner/repo', numero: 'x', token }), /tarea/)
})

test('scrub: neither the token nor its base64 form survives in a message', () => {
  const token = 'gho_SECRETTOKEN123'
  const b64 = Buffer.from(`x-access-token:${token}`).toString('base64')
  const text = scrub(`fatal: ${token} y ${b64}`, token)
  assert.ok(!text.includes(token) && !text.includes(b64))
})

// --- the workflow's script: open the PR ------------------------------------------------------------------------------------

const OWNER = 'owner'
function github({ issue = {}, branch = true, pulls = [], created = 31 } = {}) {
  const calls = []
  const body = issueFor('marketing', 'Una campaña').body
  const data = { number: 9, state: 'open', user: { login: OWNER }, labels: [{ name: 'entrada' }, { name: 'perfil:marketing' }], body: replaceState(body, initialState('marketing')), ...issue }
  let state = parseState(data.body)
  return {
    calls,
    getState: () => state,
    api: {
      issue: async () => data,
      branchExists: async (ref) => { calls.push(`branch:${ref}`); return branch },
      openPulls: async (head) => { calls.push(`pulls:${head}`); return pulls },
      createPull: async (p) => { calls.push(`pull:${JSON.stringify(p)}`); return { number: created } },
      ensureLabel: async (name) => calls.push(`label+${name}`),
      addLabels: async (n, labels) => calls.push(`labels:${n}:${labels}`),
      recordPull: async (n, pr) => { calls.push(`state:${n}:${pr}`); state = { ...state, pr } },
    },
  }
}

test('abrirPr: only a plain task number is accepted', async () => {
  for (const bad of ['', '0', '01', '1; rm -rf', '1e3', '-1', ' 9', '9\n', '1234567890', 'tarea/9', undefined, 9]) {
    assert.equal(TAREA_RE.test(String(bad)) && typeof bad === 'string', false, JSON.stringify(bad))
    const g = github()
    await assert.rejects(abrirPr({ tarea: bad, owner: OWNER, github: g.api }), /tarea/, JSON.stringify(bad))
    assert.deepEqual(g.calls, [], 'nothing is touched')
  }
})

test('abrirPr: opens tarea/<n> → main as "Tarea #n · perfil" with body "Closes #n" and the perfil label, then records the number', async () => {
  const g = github()
  const pr = await abrirPr({ tarea: '9', owner: OWNER, github: g.api })
  assert.equal(pr, 31)
  assert.deepEqual(g.calls, [
    'branch:tarea/9',
    `pulls:${OWNER}:tarea/9`,
    `pull:${JSON.stringify({ title: 'Tarea #9 · marketing', head: 'tarea/9', base: 'main', body: 'Closes #9' })}`,
    'label+perfil:marketing',
    'labels:31:perfil:marketing',
    'state:9:31',
  ])
})

test('abrirPr refuses: a missing branch, a closed issue, someone else\'s issue, an issue that is not in the queue, a pull request, a task that already has a PR', async () => {
  const cases = [
    [{ branch: false }, /rama/],
    [{ issue: { state: 'closed' } }, /abierta/],
    [{ issue: { user: { login: 'intruso' } } }, /dueño/],
    [{ issue: { labels: [{ name: 'otra' }] } }, /entrada/],
    [{ issue: { pull_request: {} } }, /abierta/],
    [{ issue: { user: { login: 'OWNER' }, body: 'sin petición' } }, /estado/],
  ]
  for (const [options, motivo] of cases) {
    const g = github(options)
    await assert.rejects(abrirPr({ tarea: '9', owner: OWNER, github: g.api }), motivo, JSON.stringify(options))
    assert.ok(!g.calls.some((c) => c.startsWith('pull:')), 'no pull request opened')
  }
})

test('abrirPr: asked twice, it does not open a second pull request; it records the existing one', async () => {
  const g = github({ pulls: [{ number: 44 }] })
  assert.equal(await abrirPr({ tarea: '9', owner: OWNER, github: g.api }), 44)
  assert.ok(!g.calls.some((c) => c.startsWith('pull:')))
  assert.ok(g.calls.includes('state:9:44'))
})
