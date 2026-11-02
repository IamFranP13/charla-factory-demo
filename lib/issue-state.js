// Read-modify-write of the task state marker in an issue body. It is kept small so
// the gate, which runs with a write token on a pull request, loads nothing but the GitHub wrapper and the state.

import { execFile } from 'node:child_process'
import { gh, ghJson, repoSlug } from './github.js'
import { parseState, replaceState } from './estado.js'

/** Returns the new state, or null when the issue has no marker. A change that returns the very same state writes
 * nothing, so it can never undo a concurrent write. */
export function updateIssueState(number, change) {
  const data = ghJson(`repos/${repoSlug()}/issues/${number}`)
  const current = parseState(data.body)
  if (!current) return null
  const next = change(current)
  if (next === current) return next
  gh(['api', '-X', 'PATCH', `repos/${repoSlug()}/issues/${number}`, '--input', '-'], { input: JSON.stringify({ body: replaceState(data.body, next) }) })
  return next
}

/** One comment on the issue, unless the very same text is already there: a re-run of a workflow never says it twice.
 * The text is written by the factory (lib/issue-texto.js escapes whatever a model wrote). Returns whether it posted. */
export function commentIssue(number, text) {
  const comments = ghJson(`repos/${repoSlug()}/issues/${number}/comments?per_page=100`, { paginate: true })
  if (Array.isArray(comments) && comments.some((c) => c?.body === text)) return false
  gh(['api', '-X', 'POST', `repos/${repoSlug()}/issues/${number}/comments`, '--input', '-'], { input: JSON.stringify({ body: text }) })
  return true
}

// The same calls without blocking the event loop, for the factory, where several tasks share one process.
// Every call throws on failure (the message carries gh's stderr): callers fail closed.
export function ghAsync(args, { input } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(Object.assign(error, { stderr }))
      else resolve(stdout)
    })
    child.stdin.on('error', () => {})
    child.stdin.end(input)
  })
}

export async function ghJsonAsync(path, { paginate = false } = {}) {
  const value = JSON.parse(await ghAsync(paginate ? ['api', '--paginate', '--slurp', path] : ['api', path]))
  return paginate && Array.isArray(value) ? value.flat(1) : value
}

/** updateIssueState without blocking. Callers keep one write at a time per task (the read-modify-write is not atomic on
 * GitHub's side); writes of different tasks may interleave. */
export async function updateIssueStateAsync(number, change) {
  const data = await ghJsonAsync(`repos/${repoSlug()}/issues/${number}`)
  const current = parseState(data.body)
  if (!current) return null
  const next = change(current)
  if (next === current) return next
  await ghAsync(['api', '-X', 'PATCH', `repos/${repoSlug()}/issues/${number}`, '--input', '-'], { input: JSON.stringify({ body: replaceState(data.body, next) }) })
  return next
}
