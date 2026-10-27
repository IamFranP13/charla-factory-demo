// Read-modify-write of the task state marker in an issue body. It lives apart from the factory (lib/factory.js) so
// the gate, which runs with a write token on a pull request, loads nothing but the GitHub wrapper and the state.

import { gh, ghJson, repoSlug } from './github.js'
import { parseState, replaceState } from './estado.js'

/** Returns the new state, or null when the issue has no marker. */
export function updateIssueState(number, change) {
  const data = ghJson(`repos/${repoSlug()}/issues/${number}`)
  const current = parseState(data.body)
  if (!current) return null
  const next = change(current)
  gh(['api', '-X', 'PATCH', `repos/${repoSlug()}/issues/${number}`, '--input', '-'], { input: JSON.stringify({ body: replaceState(data.body, next) }) })
  return next
}
