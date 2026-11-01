#!/usr/bin/env node
// Opens the pull request tarea/<n> → main as the factory App (run by the abrir-pr workflow, from the code of main).
//
//   node scripts/publicar-pr.mjs --comprobar <n>   only checks that <n> is a plain task number (no token needed)
//   node scripts/publicar-pr.mjs <n>               checks the branch and the issue, opens the pull request, records its number
//
// Needs GITHUB_REPOSITORY and GH_TOKEN (the factory App token). It reads data about the branch; it never runs its code.
// Exit codes: 0 done · 1 refused or failed · 2 usage error.
import { pathToFileURL } from 'node:url'
import { gh, ghJson, repoSlug } from '../lib/github.js'
import { updateIssueState } from '../lib/issue-state.js'
import { TAREA_RE, abrirPr } from '../lib/publicar.js'

const post = (path, body) => JSON.parse(gh(['api', '-X', 'POST', path, '--input', '-'], { input: JSON.stringify(body) }) || 'null')

function githubCalls(repo) {
  const api = `repos/${repo}`
  return {
    issue: (n) => ghJson(`${api}/issues/${n}`),
    branchExists(ref) {
      try {
        ghJson(`${api}/git/ref/heads/${ref}`)
        return true
      } catch (error) {
        if (/HTTP 404|Not Found/i.test(`${error.stderr ?? ''}${error.message}`)) return false
        throw error
      }
    },
    openPulls: (head) => ghJson(`${api}/pulls?state=open&base=main&head=${encodeURIComponent(head)}&per_page=5`),
    createPull: (data) => post(`${api}/pulls`, data),
    ensureLabel(name) {
      try {
        post(`${api}/labels`, { name, color: 'fbca04' })
      } catch (error) {
        if (!/HTTP 422|already_exists/i.test(`${error.stderr ?? ''}${error.message}`)) throw error
      }
    },
    addLabels: (number, labels) => post(`${api}/issues/${number}/labels`, { labels }),
    recordPull: (n, pr) => updateIssueState(n, (state) => (state.pr === pr ? state : { ...state, pr, actualizado: new Date().toISOString() })),
  }
}

async function main() {
  const args = process.argv.slice(2)
  const checkOnly = args[0] === '--comprobar'
  const tarea = checkOnly ? args[1] : args[0]
  if (args.includes('--help') || typeof tarea !== 'string' || args.length > (checkOnly ? 2 : 1)) {
    console.log('Usage: publicar-pr.mjs [--comprobar] <task number>')
    process.exit(args.includes('--help') ? 0 : 2)
  }
  if (!TAREA_RE.test(tarea)) {
    console.error('publicar-pr: la tarea debe ser un número de tarea (sin ceros a la izquierda)')
    process.exit(1)
  }
  if (checkOnly) return
  const repo = repoSlug()
  const pr = await abrirPr({ tarea, owner: repo.split('/')[0], github: githubCalls(repo) })
  console.log(`Pull request #${pr} para la tarea #${tarea}`)
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`publicar-pr: ${error.message}`)
    process.exit(1)
  })
}
