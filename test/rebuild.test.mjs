import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { issueFor } from '../lib/intake.js'
import { initialState, replaceState, parseState } from '../lib/estado.js'
import { candidates, mergeableOf, rebuildConflicts, MAX_CHECKS } from '../lib/rebuild.js'

const REPO = 'owner/repo'
const script = new URL('../scripts/rebuild.mjs', import.meta.url).pathname

const pull = (number, task, extra = {}) => ({ number, state: 'open', base: { ref: 'main' }, head: { ref: `tarea/${task}`, repo: { full_name: REPO } }, ...extra })
const stateFor = (pr, extra = {}) => ({ ...initialState('marketing'), pr, resultado: 'ok', ...extra })

// A fake GitHub: records every write, in order.
function fake({ pulls = [], mergeable = {}, tasks = {}, failOn = null, updateReturns } = {}) {
  const calls = []
  const seen = {}
  const write = (name) => (...args) => {
    calls.push([name, ...args])
    if (failOn === name) throw new Error(`boom ${name}`)
  }
  return {
    calls,
    github: {
      pulls: () => pulls,
      pull: (n) => {
        const queue = mergeable[n] ?? [false]
        const i = seen[n] = (seen[n] ?? 0) + 1
        return { number: n, mergeable: queue[Math.min(i, queue.length) - 1] }
      },
      task: (n) => tasks[n] ?? null,
      updateState: (n, change) => {
        calls.push(['updateState', n])
        if (failOn === 'updateState') throw new Error('boom updateState')
        if (updateReturns !== undefined) return updateReturns
        const next = change(tasks[n].state)
        tasks[n] = { ...tasks[n], state: next }
        return next
      },
      comment: write('comment'),
      closePull: (n) => {
        write('closePull')(n)
        for (const t of Object.values(tasks)) if (t?.state?.pr === n) t.prClosed = true
      },
      deleteBranch: write('deleteBranch'),
      // The tasks a run left half way: rebuilt, their pull request closed, the factory not yet restarted.
      closeIssue: write('closeIssue'),
      relabel: (n) => {
        write('relabel')(n)
        tasks[n].restarted = true
      },
    },
    sleeps: () => seen,
  }
}
const open = (pr, extra = {}) => ({ open: true, trusted: true, state: stateFor(pr, extra) })
const names = (calls) => calls.map((c) => c[0])
const run = (f, extra = {}) => rebuildConflicts({ repo: REPO, github: f.github, sleep: async () => {}, ...extra })

test('candidates: only open PRs on tarea/<n> of this repository against main; names and forks are untrusted', () => {
  const list = [
    pull(1, 1),
    pull(2, 2, { head: { ref: 'tarea/2', repo: { full_name: 'evil/repo' } } }),
    pull(3, 3, { head: { ref: 'tarea/3x', repo: { full_name: REPO } } }),
    pull(4, 4, { head: { ref: 'tarea/4/../../x', repo: { full_name: REPO } } }),
    pull(5, 5, { base: { ref: 'otra' } }),
    pull(6, 6, { head: { ref: 'tarea/6', repo: null } }),
    pull(7, 7, { state: 'closed' }),
    pull(8, 8, { head: { ref: 'tarea/08', repo: { full_name: REPO } } }),
    pull(9, 9, { head: { ref: 'tarea/9', repo: { full_name: REPO.toUpperCase() } } }),
    null,
    'x',
  ]
  assert.deepEqual(candidates(list, REPO).map((c) => [c.pull.number, c.task]), [[1, 1], [9, 9]])
})

test('mergeableOf: asks again while GitHub computes it, a bounded number of times, then gives up with null', async () => {
  const f = fake({ mergeable: { 1: [null, null, false] } })
  assert.equal(await mergeableOf(f.github, 1, async () => {}), false)
  assert.equal(f.sleeps()[1], 3)
  const never = fake({ mergeable: { 1: [null] } })
  assert.equal(await mergeableOf(never.github, 1, async () => {}), null)
  assert.equal(never.sleeps()[1], MAX_CHECKS)
  const clean = fake({ mergeable: { 1: [true] } })
  assert.equal(await mergeableOf(clean.github, 1, async () => {}), true)
  assert.equal(clean.sleeps()[1], 1)
})

test('a conflicting factory PR is recorded as rebuilt, closed, its branch deleted and the task relabelled, in that order', async () => {
  const f = fake({ pulls: [pull(11, 5)], tasks: { 5: open(11) } })
  const result = await run(f)
  assert.deepEqual(names(f.calls), ['updateState', 'comment', 'closePull', 'deleteBranch', 'relabel'])
  assert.deepEqual(f.calls.slice(2).map((c) => c.slice(1)), [[11], ['tarea/5'], [5]])
  assert.equal(f.calls[1][1], 5)
  assert.match(f.calls[1][2], /conflicto/)
  assert.match(f.calls[1][2], /una sola vez/)
  assert.equal(f.github.task(5).state.reconstruida, true)
  assert.deepEqual(result, [{ pr: 11, tarea: 5, accion: 'reconstruida' }])
})

test('at most once: a task already rebuilt that conflicts again is closed with a clear comment, never rebuilt', async () => {
  const f = fake({ pulls: [pull(12, 6)], tasks: { 6: open(12, { reconstruida: true }) } })
  const result = await run(f)
  assert.deepEqual(names(f.calls), ['updateState', 'comment', 'closePull', 'deleteBranch', 'closeIssue'])
  assert.ok(!names(f.calls).includes('relabel'))
  assert.match(f.calls[1][2], /segunda vez/)
  assert.match(f.calls[1][2], /Cierro la tarea/)
  assert.match(f.github.task(6).state.motivo, /conflicto/)
  assert.deepEqual(result, [{ pr: 12, tarea: 6, accion: 'cerrada' }])
})

test('no conflict, or mergeable still unknown after the bounded retries: nothing is touched', async () => {
  const f = fake({ pulls: [pull(1, 1), pull(2, 2)], mergeable: { 1: [true], 2: [null] }, tasks: { 1: open(1), 2: open(2) } })
  const result = await run(f)
  assert.deepEqual(f.calls, [])
  assert.deepEqual(result, [{ pr: 1, tarea: 1, accion: 'limpia' }, { pr: 2, tarea: 2, accion: 'pendiente' }])
})

test('a PR whose issue is not the factory\'s is left alone: closed issue, other author, no state, or a state for another PR', async () => {
  const tasks = {
    1: { ...open(1), open: false },
    2: { ...open(2), trusted: false },
    3: { open: true, trusted: true, state: null },
    4: open(99),
    5: null,
  }
  const f = fake({ pulls: [1, 2, 3, 4, 5].map((n) => pull(n, n)), tasks })
  const result = await run(f)
  assert.deepEqual(f.calls, [])
  assert.deepEqual(result.map((r) => r.accion), Array(5).fill('ignorada'))
})

test('fails closed: if the flag cannot be written nothing is closed; one failing PR does not stop the others', async () => {
  const f = fake({ pulls: [pull(1, 1)], tasks: { 1: open(1) }, failOn: 'updateState' })
  const result = await run(f)
  assert.deepEqual(names(f.calls), ['updateState'])
  assert.equal(result[0].accion, 'error')

  const g = fake({ pulls: [pull(1, 1), pull(2, 2)], tasks: { 1: open(1), 2: open(2) }, failOn: 'closePull' })
  const out = await run(g)
  assert.deepEqual(out.map((r) => r.accion), ['error', 'error'])
  assert.equal(names(g.calls).filter((n) => n === 'updateState').length, 2, 'the second PR was still tried')
})

test('the retry flag survives the factory rewriting the state, and a forged one in the request is ignored', () => {
  const filed = issueFor('marketing', 'Una campaña que diga «hola»')
  const flagged = replaceState(filed.body, { ...initialState('marketing'), reconstruida: true })
  assert.equal(parseState(flagged).reconstruida, true)
  // The factory restarts the task from scratch: the flag stays.
  assert.equal(parseState(replaceState(flagged, initialState('marketing'))).reconstruida, true)
  assert.equal(parseState(replaceState(filed.body, initialState('marketing'))).reconstruida, undefined)
})

test('scripts/rebuild.mjs: usage error without the repository, and --help', () => {
  const bare = spawnSync(process.execPath, [script], { encoding: 'utf8', env: { PATH: process.env.PATH } })
  assert.equal(bare.status, 2)
  assert.match(bare.stderr, /GITHUB_REPOSITORY/)
  const help = spawnSync(process.execPath, [script, '--help'], { encoding: 'utf8', env: { PATH: process.env.PATH } })
  assert.equal(help.status, 0)
  assert.match(help.stdout, /rebuild/)
})

test('a step that fails after the pull request is closed is reported and never retried: at most once wins', async () => {
  const f = fake({ pulls: [pull(1, 1)], tasks: { 1: open(1) }, failOn: 'deleteBranch' })
  assert.equal((await run(f))[0].accion, 'error')
  assert.ok(!names(f.calls).includes('relabel'))
  const later = fake({ pulls: [], tasks: { 1: { ...f.github.task(1), prClosed: true } } })
  assert.deepEqual(await run(later), [])
  assert.deepEqual(later.calls, [], 'no open pull request: nothing is touched')
})

test('if the state marker cannot be updated (missing) nothing is closed', async () => {
  const f = fake({ pulls: [pull(1, 1)], tasks: { 1: open(1) }, updateReturns: null })
  const result = await run(f)
  assert.deepEqual(names(f.calls), ['updateState'])
  assert.equal(result[0].accion, 'ignorada')
})
