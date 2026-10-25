#!/usr/bin/env node
// Runs one task through the factory and writes the resulting files into the working tree.
//
//   node scripts/factory.mjs --profile <marketing|producto|negocio> --request "<text>" [--id <n>]
//   node scripts/factory.mjs --issue <number>     CI: read the task from a GitHub issue, comment every station
//
// Model: FACTORY_PROVIDER=replay (default, free) or openai (see README).
// Exit codes: 0 the factory ran (ok, rejected, failed or ignored: see "Result") · 2 usage or setup error.

import { writeFileSync, mkdirSync, appendFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { runFactory, loadProfiles } from '../lib/factory.js'
import { providersFromEnv } from '../lib/providers.js'
import { gh, ghJson, repoSlug } from '../lib/github.js'
import { MAX_LENGTH } from '../lib/intake.js'

const root = new URL('..', import.meta.url).pathname
const STATUS_ICON = { ok: '✅', rejected: '⛔', error: '⚠️', failed: '❌', ignored: '⏭️' }

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
  const profile = opt('--profile')
  const request = opt('--request')

  if (!issue && !(profile && request)) {
    console.error('Usage: factory.mjs --profile <profile> --request "<text>" [--id <n>]\n       factory.mjs --issue <number>')
    process.exit(2)
  }

  const { provider, reviewProvider } = providersFromEnv()
  if (issue) await runIssue(issue, { provider, reviewProvider })
  else await runLocal({ id: opt('--id') ?? String(Date.now()), profile, request }, { provider, reviewProvider })
}

async function runLocal(task, providers) {
  console.log(`Task ${task.id} · ${task.profile} · model: ${providers.provider.name}\n`)
  const result = await runFactory({
    task, root, ...providers,
    trace: (e) => console.log(`${e.station.padEnd(11)} ${e.status.padEnd(8)} ${e.detail}`),
  })
  writeFiles(result.files)
  console.log(`\nResult: ${result.status}${result.files.length ? ` → ${result.files.map((f) => f.path).join(', ')}` : ''}`)
  console.log(`Tokens: ${result.usage.input} in / ${result.usage.output} out`)
}

async function runIssue(number, providers) {
  const data = ghJson(`repos/${repoSlug()}/issues/${number}`)
  const owner = process.env.GITHUB_REPOSITORY_OWNER ?? repoSlug().split('/')[0]
  const parsed = parseIssueBody(data.body)

  // Only the intake (which writes with the owner's token) may feed the factory.
  if (data.user?.login?.toLowerCase() !== owner.toLowerCase() || !parsed) {
    console.log(`Result: ignored (author ${data.user?.login}, request block ${parsed ? 'ok' : 'missing'})`)
    output({ status: 'ignored' })
    return
  }

  const task = { id: number, ...parsed }
  const profiles = loadProfiles(root)
  const label = profiles[task.profile]?.label ?? task.profile
  const started = Date.now()
  comment(number, `🏭 **Tarea #${number} · ${label}** entra en la factory (modelo: \`${providers.provider.name}\`).`)

  const result = await runFactory({
    task, root, ...providers,
    trace: (e) => {
      console.log(`${e.station.padEnd(11)} ${e.status.padEnd(8)} ${e.detail}`)
      const tokens = e.usage ? ` · ${e.usage.input + e.usage.output} tokens` : ''
      comment(number, `${STATUS_ICON[e.status] ?? '•'} **${e.station}** · ${e.status}${e.ms ? ` · ${(e.ms / 1000).toFixed(1)} s` : ''}${tokens}\n\n${fence(e.detail)}`)
    },
  })
  writeFiles(result.files)

  const summary = { status: result.status, profile: task.profile, files: result.files.map((f) => f.path), attempts: result.attempts, usage: result.usage, ms: Date.now() - started }
  comment(number, `${STATUS_ICON[result.status]} **Resultado: ${result.status}**${summary.files.length ? ` → \`${summary.files.join('`, `')}\`` : ''}\n\n<!-- factory:result ${JSON.stringify(summary)} -->`)
  console.log(`\nResult: ${result.status}`)
  output({ status: result.status, profile: task.profile, files: summary.files.join(','), attempts: result.attempts, tokens_in: result.usage.input, tokens_out: result.usage.output })
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
