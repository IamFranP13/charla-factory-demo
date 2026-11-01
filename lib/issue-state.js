// Read-modify-write of the task state marker in an issue body. It lives apart from the factory (lib/factory.js) so
// the gate, which runs with a write token on a pull request, loads nothing but the GitHub wrapper and the state.

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
