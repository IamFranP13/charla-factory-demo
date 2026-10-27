#!/usr/bin/env node
// The risk gate.
//
//   node scripts/gate.mjs <file>...         which route these changed files take
//   node scripts/gate.mjs --json <file>...  same, as JSON
//   node scripts/gate.mjs --pr <number>     CI: judge a pull request (files and approvals read from GitHub)
//                                           and record the verdict in the task state of the linked issue
//   node scripts/gate.mjs --closed <number> CI: a pull request was closed: record the merge (or the refusal) in that state
//   --policy <path>                         use another policy file (default: policy/risk.yaml)
//
// Exit codes: 0 pass · 1 blocked (waiting for a human) · 2 the gate itself failed (fails closed).

import { readFileSync, appendFileSync } from 'node:fs'
import { parsePolicy, routeFor, verdict, originAllowsAuto } from '../lib/policy.js'
import { pullRequest, pullRequestFiles, pullRequestReviews, approvalsAtHead, repoSlug } from '../lib/github.js'
import { updateIssueState } from './factory.mjs'

const args = process.argv.slice(2)
const take = (flag) => {
  const i = args.indexOf(flag)
  if (i === -1) return undefined
  const [, value] = args.splice(i, 2)
  return value
}
const json = args.includes('--json') && args.splice(args.indexOf('--json'), 1)
const policyPath = take('--policy') ?? new URL('../policy/risk.yaml', import.meta.url).pathname
const pr = take('--pr')
const closed = take('--closed')

try {
  const policy = parsePolicy(readFileSync(policyPath, 'utf8'))
  if (closed) markClosed(closed)
  else if (pr) judgePullRequest(policy, pr)
  else explain(policy, args)
} catch (error) {
  console.error(`gate error: ${error.stderr?.toString().trim() || error.message}`)
  process.exit(2)
}

function explain(policy, files) {
  const result = routeFor(policy, files)
  if (json) {
    console.log(JSON.stringify(result))
    return
  }
  console.log(table(result))
}

function judgePullRequest(policy, number) {
  // One read of the PR: the head judged here is the head that gets merged (--match-head-commit).
  const pr = pullRequest(number)
  const head = pr.head?.sha
  if (!head) throw new Error('the pull request has no head sha')
  const files = routeFor(policy, pullRequestFiles(number, pr.changed_files))
  const origin = originAllowsAuto(policy, { author: pr.user?.login, headRepo: pr.head?.repo?.full_name, repo: repoSlug() })
  // Origin can only make a change stricter, never looser.
  const result = files.route === 'auto' && !origin.ok ? { ...files, route: 'human' } : files
  const reviews = result.route === 'human' ? pullRequestReviews(number) : []
  const approvals = approvalsAtHead(reviews, head)
  const decision = verdict({ route: result.route, approvals, approvers: policy.approvers })

  const why = files.route === 'auto' && !origin.ok ? `\nOrigin: ${origin.reason}` : ''
  const report = `${table(result)}${why}\n\n${decision.pass ? 'PASS' : 'BLOCKED'}: ${decision.reason}`
  console.log(report)
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `route=${result.route}\nmerge=${decision.merge}\npass=${decision.pass}\nhead=${head}\n`)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Risk gate\n\n\`\`\`\n${report}\n\`\`\`\n`)

  // The verdict reaches the task state of the linked issue; it never changes the verdict itself.
  const puerta = decision.pass ? 'ok' : changesRequested(reviews, policy.approvers) ? 'rechazada' : 'en_curso'
  markTask(pr, (state) => ({
    ...state,
    pr: Number(number),
    ruta: result.route,
    fase: decision.pass ? 'merge' : 'puerta',
    estaciones: { ...state.estaciones, puerta, ...(decision.pass && state.estaciones.merge !== 'ok' && { merge: 'en_curso' }) },
    actualizado: new Date().toISOString(),
  }))
  process.exit(decision.pass ? 0 : 1)
}

// The pull request was closed: merged → the change is in main (production deploys it next); not merged → refused.
function markClosed(number) {
  const pr = pullRequest(number)
  markTask(pr, (state) => {
    const estaciones = { ...state.estaciones }
    if (pr.merged) {
      estaciones.merge = 'ok'
      return { ...state, estaciones, fase: 'produccion', actualizado: new Date().toISOString() }
    }
    estaciones[estaciones.puerta === 'ok' ? 'merge' : 'puerta'] = 'rechazada'
    return { ...state, estaciones, actualizado: new Date().toISOString() }
  })
}

// An approver's latest review is "changes requested".
function changesRequested(reviews, approvers) {
  const latest = new Map()
  for (const review of reviews) if (['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'].includes(review.state)) latest.set(review.user.login, review)
  const allowed = new Set(approvers.map((a) => a.toLowerCase()))
  return [...latest.values()].some((r) => r.state === 'CHANGES_REQUESTED' && allowed.has(r.user.login.toLowerCase()))
}

// The factory's pull request is tarea/<n> in this very repository; n is the task's issue.
// Anything else (a fork, another branch name) is not a task and touches no issue.
function markTask(pr, change) {
  const issue = /^tarea\/(\d+)$/.exec(pr.head?.ref ?? '')?.[1]
  if (!issue || pr.head?.repo?.full_name?.toLowerCase() !== repoSlug().toLowerCase()) return
  try {
    updateIssueState(issue, change)
  } catch (error) {
    console.error(`warning: could not update the state of issue #${issue}: ${error.stderr?.toString().trim() || error.message}`)
  }
}

function table({ route, files }) {
  const width = Math.max(4, ...files.map((f) => f.file.length))
  const rows = files.map((f) => `${f.file.padEnd(width)}  ${f.route.padEnd(5)}  ${f.rule}`)
  return [`${'FILE'.padEnd(width)}  ROUTE  RULE`, ...rows, '', `Route: ${route}`].join('\n')
}
