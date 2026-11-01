// A factory pull request that conflicts with main is rebuilt on the current main, at most once. Pure: GitHub and the
// clock are injected, so the decision is tested with fixtures. The pull request list, the branch names and the issue
// bodies are untrusted: nothing here is used as anything but data.

export const MAX_CHECKS = 6
export const CHECK_DELAY_MS = 5000
const BRANCH = /^tarea\/([1-9]\d{0,8})$/
const MOTIVO = 'conflicto con main por segunda vez'

const sameRepo = (a, b) => typeof a === 'string' && a.toLowerCase() === b.toLowerCase()

// The factory's pull requests: open, against main, from tarea/<n> in this very repository (not a fork).
export function candidates(pulls, repo, base = 'main') {
  const found = []
  for (const pull of Array.isArray(pulls) ? pulls : []) {
    const task = BRANCH.exec(pull?.head?.ref ?? '')?.[1]
    if (!task || pull.state !== 'open' || pull.base?.ref !== base || !sameRepo(pull.head?.repo?.full_name, repo)) continue
    if (!Number.isInteger(pull.number)) continue
    found.push({ pull, task: Number(task) })
  }
  return found
}

// `mergeable` is null while GitHub computes it: ask again a bounded number of times, then leave it (null).
export async function mergeableOf(github, number, sleep, delay = CHECK_DELAY_MS) {
  for (let i = 1; i <= MAX_CHECKS; i++) {
    const { mergeable } = await github.pull(number)
    if (typeof mergeable === 'boolean') return mergeable
    if (i < MAX_CHECKS) await sleep(delay)
  }
  return null
}

const REBUILD_COMMENT = 'La rama de esta tarea tiene conflictos con `main`, que ha cambiado desde que la factory la construyó. Cierro el pull request y la rehago sobre el `main` actual. Se reconstruye una sola vez.'
const GIVE_UP_COMMENT = 'Esta tarea vuelve a tener conflictos con `main` por segunda vez y la factory solo la reconstruye una vez. Cierro la tarea.'

// github: { pulls, pull(n), task(n) → { open, trusted, state } | null, updateState(n, change), comment(n, body),
//           closePull(n), deleteBranch(ref), closeIssue(n), relabel(n) }
// Returns what happened to each factory pull request. A failure on one never stops the others. A step that fails
// after the flag is written is reported and never retried: at most once wins over finishing the rebuild.
export async function rebuildConflicts({ repo, github, sleep, delay }) {
  const results = []
  for (const { pull, task } of candidates(await github.pulls(), repo)) {
    const entry = { pr: pull.number, tarea: task }
    try {
      const info = await github.task(task)
      // The issue must be the factory's, still open, and its state must point at this very pull request.
      if (!info?.open || !info.trusted || info.state?.pr !== pull.number) {
        results.push({ ...entry, accion: 'ignorada' })
        continue
      }
      const mergeable = await mergeableOf(github, pull.number, sleep, delay)
      if (mergeable !== false) {
        results.push({ ...entry, accion: mergeable === null ? 'pendiente' : 'limpia' })
        continue
      }
      const again = info.state.reconstruida === true
      // The record comes first: if it cannot be written nothing is closed, so a task is never rebuilt twice.
      const next = await github.updateState(task, (state) => ({ ...state, ...(again ? { motivo: MOTIVO } : { reconstruida: true }), actualizado: new Date().toISOString() }))
      if (!next) {
        results.push({ ...entry, accion: 'ignorada' })
        continue
      }
      await github.comment(task, again ? GIVE_UP_COMMENT : REBUILD_COMMENT)
      await github.closePull(pull.number)
      await github.deleteBranch(`tarea/${task}`)
      // The factory runs again when the issue gets its label back (the guard wants the branch gone).
      if (again) await github.closeIssue(task)
      else await github.relabel(task)
      results.push({ ...entry, accion: again ? 'cerrada' : 'reconstruida' })
    } catch (error) {
      results.push({ ...entry, accion: 'error', error: String(error?.message ?? error).slice(0, 300) })
    }
  }
  return results
}
