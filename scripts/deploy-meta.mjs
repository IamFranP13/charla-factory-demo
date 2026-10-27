#!/usr/bin/env node
// Writes dist/deploy.json = {commit, builtAt}: the commit this build was made from.
// /api/estado reads it to confirm that a merged change is in production.
//
//   node scripts/deploy-meta.mjs [--out <dir>]   (default: dist)
//
// The commit is CF_PAGES_COMMIT_SHA on Cloudflare Pages, or `git rev-parse HEAD` locally.
// Exit codes: 0 written · 1 no commit could be found.

import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

const SHA = /^[0-9a-f]{40}$/
const root = new URL('..', import.meta.url).pathname
const args = process.argv.slice(2)
const out = args.includes('--out') ? args[args.indexOf('--out') + 1] : join(root, 'dist')

function gitHead() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return ''
  }
}

const commit = [process.env.CF_PAGES_COMMIT_SHA, gitHead()].map((c) => (c ?? '').trim().toLowerCase()).find((c) => SHA.test(c))
if (!commit) {
  console.error('deploy-meta: no commit found (CF_PAGES_COMMIT_SHA is not set and this is not a git checkout)')
  process.exit(1)
}

mkdirSync(out, { recursive: true })
writeFileSync(join(out, 'deploy.json'), `${JSON.stringify({ commit, builtAt: new Date().toISOString() })}\n`)
console.log(`deploy.json: ${commit}`)
