#!/usr/bin/env node
// After a push to main: every open factory pull request that conflicts with main is closed and its task goes back to
// the orchestrator's queue (`npm run fabrica` works it again on the current main), at most once per task (lib/rebuild.js).
//
//   node scripts/rebuild.mjs
//
// Needs GITHUB_REPOSITORY and GH_TOKEN: the factory App token. Runs the code of main only.
// Exit codes: 0 done · 1 some pull request could not be processed · 2 usage or setup error.

import { pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { gh, ghJson, repoSlug } from '../lib/github.js'
import { parseState, resetState } from '../lib/estado.js'
import { updateIssueState } from '../lib/issue-state.js'
import { rebuildConflicts } from '../lib/rebuild.js'

// A call whose target may already be gone (or already be right): 404 and 422 "does not exist" are not failures.
function tolerant(args, options) {
  try {
    return gh(args, options)
  } catch (error) {
    if (/HTTP (404|422)|Not Found|does not exist/i.test(`${error.stderr ?? ''}${error.message}`)) return ''
    throw error
  }
}

function githubCalls(repo) {
  const api = `repos/${repo}`
  const owner = (process.env.GITHUB_REPOSITORY_OWNER ?? repo.split('/')[0]).toLowerCase()
  const patch = (path, body) => gh(['api', '-X', 'PATCH', path, '--input', '-'], { input: JSON.stringify(body) })
  return {
    pulls: () => ghJson(`${api}/pulls?state=open&per_page=100`, { paginate: true }),
    pull: (number) => ghJson(`${api}/pulls/${number}`),
    // Only the intake (the owner's token) files tasks: anyone else's issue is not the factory's.
    task: (number) => {
      const data = ghJson(`${api}/issues/${number}`)
      return { open: data.state === 'open' && !data.pull_request, trusted: data.user?.login?.toLowerCase() === owner, state: parseState(data.body) }
    },
    updateState: (number, change) => updateIssueState(number, change),
    comment: (number, body) => gh(['api', '-X', 'POST', `${api}/issues/${number}/comments`, '--input', '-'], { input: JSON.stringify({ body }) }),
    closePull: (number) => patch(`${api}/pulls/${number}`, { state: 'closed' }),
    deleteBranch: (ref) => tolerant(['api', '-X', 'DELETE', `${api}/git/refs/heads/${ref}`]),
    closeIssue: (number) => patch(`${api}/issues/${number}`, { state: 'closed', state_reason: 'not_planned' }),
    // Pending again, no claim and no pull request; `reconstruida` stays so the at-most-once rule holds.
    requeue: (number) => updateIssueState(number, (state) => resetState(state)),
  }
}

async function main() {
  if (process.argv.includes('--help')) {
    console.log('Usage: rebuild.mjs\nRebuild (once) the factory pull requests that conflict with main. Needs GITHUB_REPOSITORY and GH_TOKEN.')
    return
  }
  let repo
  try {
    repo = repoSlug()
  } catch (error) {
    console.error(`rebuild: ${error.message}`)
    process.exit(2)
  }
  const results = await rebuildConflicts({ repo, github: githubCalls(repo), sleep: delay })
  for (const r of results) console.log(`${r.pr ? `#${r.pr} ` : ''}(tarea ${r.tarea}): ${r.accion}${r.error ? ` · ${r.error}` : ''}`)
  if (results.length === 0) console.log('No open factory pull requests.')
  if (results.some((r) => r.accion === 'error')) process.exit(1)
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`rebuild error: ${error.message}`)
    process.exit(2)
  })
}
