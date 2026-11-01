#!/usr/bin/env node
// The closing numbers, read from GitHub: every issue labelled "entrada" and its pull request.
//
//   GITHUB_REPOSITORY=owner/repo node scripts/numbers.mjs [--json]
//   FACTORY_PRICE_IN / FACTORY_PRICE_OUT: euros per million tokens (input / output), for the cost line.

import { ghJson, repoSlug } from '../lib/github.js'
import { resultFromComments, summarize, renderNumbers, pullForTask } from '../lib/numbers.js'

const repo = repoSlug()
const issues = ghJson(`repos/${repo}/issues?labels=entrada&state=all&per_page=100`, { paginate: true }).filter((i) => !i.pull_request)
const pulls = ghJson(`repos/${repo}/pulls?state=all&per_page=100`, { paginate: true })

const tasks = issues.map((issue) => {
  const result = resultFromComments(ghJson(`repos/${repo}/issues/${issue.number}/comments?per_page=100`, { paginate: true }))
  const pr = pullForTask(pulls, issue.number, repo)
  return {
    result,
    pr: pr ? { merged: Boolean(pr.merged_at), blocked: pr.labels?.some((l) => l.name === 'necesita-humano') ?? false } : null,
  }
})

const numbers = summarize(tasks, { priceIn: Number(process.env.FACTORY_PRICE_IN ?? 0), priceOut: Number(process.env.FACTORY_PRICE_OUT ?? 0) })
console.log(process.argv.includes('--json') ? JSON.stringify(numbers) : renderNumbers(numbers))
