#!/usr/bin/env node
// Runs one task through the factory and writes the resulting files into the working tree.
//
//   node scripts/factory.mjs --profile <marketing|producto|negocio> --request "<text>" [--id <n>]
//   node scripts/factory.mjs --issue <number>     CI: read the task from a GitHub issue, comment every station
//                                                 and keep the task state marker in the issue body up to date
//   node scripts/factory.mjs --issue <n> --pr <m> CI: record pull request m in the state of issue n (no model involved)
//
// Model: FACTORY_PROVIDER=replay (default, free) or openai (see README).
// Exit codes: 0 the factory ran (ok, rejected, failed or ignored: see "Result") · 2 usage or setup error.

import { writeFileSync, mkdirSync, appendFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { runFactory, loadProfiles, initialState, applyEvent, finishState, parseState, replaceState } from '../lib/factory.js'
import { providersFromEnv } from '../lib/providers.js'
import { gh, ghJson, repoSlug } from '../lib/github.js'
import { MAX_LENGTH } from '../lib/intake.js'

const root = new URL('..', import.meta.url).pathname
const STATUS_ICON = { ok: '✅', rejected: '⛔', error: '⚠️', failed: '❌', ignored: '⏭️', unchanged: '🟰', retry: '🔁' }

// The intake writes the request as one line of JSON inside a ```json block.
export function parseIssueBody(body) {
  const match = String(body ?? '').match(/```json\n(.*)\n```/)
  if (!match) return null
  try {
    const { perfil, peticion } = JSON.parse(match[1])
    if (typeof perfil !== 'string' || typeof peticion !== 'string' || !peticion.trim() || Array.from(peticion).length > MAX_LENGTH) return null
    return { profile: perfil, request: peticion }
  } catch {
    return null
  }
}

// Model-derived text is untrusted: inside a text fence, Markdown, links and @mentions do not render.
export function fence(text) {
  // "<!--" is neutralised too, so model text can never forge the factory:result marker.
  return `\`\`\`text\n${String(text).replaceAll('```', "'''").replaceAll('<!--', '< !--')}\n\`\`\``
}

async function main() {
  const args = process.argv.slice(2)
  const opt = (flag) => {
    const i = args.indexOf(flag)
    return i === -1 ? undefined : args[i + 1]
  }
  const issue = opt('--issue')
  const pr = opt('--pr')
  const profile = opt('--profile')
  const request = opt('--request')

  if (!issue && !(profile && request)) {
    console.error('Usage: factory.mjs --profile <profile> --request "<text>" [--id <n>]\n       factory.mjs --issue <number>')
    process.exit(2)
  }

  if (issue && pr !== undefined) return markPullRequest(issue, pr)

  const { provider, reviewProvider } = providersFromEnv()
  if (issue) await runIssue(issue, { provider, reviewProvider })
  else await runLocal({ id: opt('--id') ?? String(Date.now()), profile, request }, { provider, reviewProvider })
}

async function runLocal(task, providers) {
  console.log(`Task ${task.id} · ${task.profile} · model: ${providers.provider.name}\n`)
  const result = await runFactory({
    task, root, ...providers,
    trace: (e) => e.status !== 'en_curso' && console.log(`${e.station.padEnd(11)} ${e.status.padEnd(8)} ${e.detail}`),
  })
  writeFiles(result.files)
  console.log(`\nResult: ${result.status}${result.files.length ? ` → ${result.files.map((f) => f.path).join(', ')}` : ''}`)
  console.log(`Tokens: ${result.usage.input} in / ${result.usage.output} out`)
}

// Only the intake (which writes with the owner's token) may feed the factory.
function loadIssue(number) {
  const data = ghJson(`repos/${repoSlug()}/issues/${number}`)
  const owner = process.env.GITHUB_REPOSITORY_OWNER ?? repoSlug().split('/')[0]
  const parsed = parseIssueBody(data.body)
  const trusted = data.user?.login?.toLowerCase() === owner.toLowerCase() && parsed !== null
  return { data, parsed, trusted }
}

async function runIssue(number, providers) {
  const { data, parsed, trusted } = loadIssue(number)
  if (!trusted) {
    console.log(`Result: ignored (author ${data.user?.login}, request block ${parsed ? 'ok' : 'missing'})`)
    output({ status: 'ignored' })
    return
  }

  const task = { id: number, ...parsed }
  const profiles = loadProfiles(root)
  const label = profiles[task.profile]?.label ?? task.profile
  const started = Date.now()

  // The state marker lives in the issue body; it is rewritten on every station change.
  let body = data.body
  let state = initialState(task.profile)
  const publish = () => {
    try {
      body = replaceState(body, state)
      gh(['api', '-X', 'PATCH', `repos/${repoSlug()}/issues/${number}`, '--input', '-'], { input: JSON.stringify({ body }) })
    } catch (error) {
      console.error(`warning: could not update the state of issue #${number}: ${error.message}`)
    }
  }
  publish()
  comment(number, `🏭 **Tarea #${number} · ${label}** entra en la factory (modelo: \`${providers.provider.name}\`).`)

  const result = await runFactory({
    task, root, ...providers,
    trace: (e) => {
      state = applyEvent(state, e)
      publish()
      if (e.status === 'en_curso') return
      console.log(`${e.station.padEnd(11)} ${e.status.padEnd(8)} ${e.detail}`)
      const tokens = e.usage ? ` · ${e.usage.input + e.usage.output} tokens` : ''
      comment(number, `${STATUS_ICON[e.status] ?? '•'} **${e.station}** · ${e.status}${e.ms ? ` · ${(e.ms / 1000).toFixed(1)} s` : ''}${tokens}\n\n${fence(e.detail)}`)
    },
  })
  writeFiles(result.files)
  state = finishState(state, result.status)
  publish()

  const summary = { status: result.status, profile: task.profile, files: result.files.map((f) => f.path), attempts: result.attempts, usage: result.usage, ms: Date.now() - started }
  comment(number, `${STATUS_ICON[result.status]} **Resultado: ${result.status}**${summary.files.length ? ` → \`${summary.files.join('`, `')}\`` : ''}\n\n<!-- factory:result ${JSON.stringify(summary)} -->`)
  console.log(`\nResult: ${result.status}`)
  output({ status: result.status, profile: task.profile, files: summary.files.join(','), attempts: result.attempts, tokens_in: result.usage.input, tokens_out: result.usage.output })
}

// Read-modify-write of the state marker in an issue body. Returns the new state, or null when there is no marker.
export function updateIssueState(number, change) {
  const data = ghJson(`repos/${repoSlug()}/issues/${number}`)
  const current = parseState(data.body)
  if (!current) return null
  const next = change(current)
  gh(['api', '-X', 'PATCH', `repos/${repoSlug()}/issues/${number}`, '--input', '-'], { input: JSON.stringify({ body: replaceState(data.body, next) }) })
  return next
}

// The workflow opened pull request `pr` for the task: the task now waits at the gate (unless the gate already ruled).
function markPullRequest(number, pr) {
  const prNumber = Number(pr)
  if (!Number.isInteger(prNumber) || prNumber < 1) {
    console.error('--pr needs a pull request number')
    process.exit(2)
  }
  if (!loadIssue(number).trusted) {
    console.log('Result: ignored')
    return
  }
  const next = updateIssueState(number, (state) => ({
    ...state,
    pr: prNumber,
    ...(state.estaciones.puerta === 'pendiente' && { fase: 'puerta', estaciones: { ...state.estaciones, puerta: 'en_curso' } }),
    actualizado: new Date().toISOString(),
  }))
  console.log(next ? `Task #${number}: pull request #${prNumber} recorded` : `Task #${number} has no state marker`)
}

function writeFiles(files) {
  for (const f of files) {
    mkdirSync(dirname(join(root, f.path)), { recursive: true })
    writeFileSync(join(root, f.path), f.content)
  }
}

// A lost comment must not stop the factory: the result is still in the outputs and the PR.
function comment(number, body) {
  try {
    gh(['issue', 'comment', String(number), '--repo', repoSlug(), '--body-file', '-'], { input: body })
  } catch (error) {
    console.error(`warning: could not comment on issue #${number}: ${error.message}`)
  }
}

function output(values) {
  if (!process.env.GITHUB_OUTPUT) return
  appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(values).map(([k, v]) => `${k}=${v}`).join('\n') + '\n')
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`factory error: ${error.message}`)
    process.exit(2)
  })
}
