#!/usr/bin/env node
// Tells CI how much it has to run for the checked-out change (lib/ci-scope.js), as `scope=datos|completo` in
// GITHUB_OUTPUT. On a pull request CI checks out the merge ref: its first parent is the base, so HEAD^1..HEAD is
// exactly what the pull request changes. Every push to main gets the full CI. Fails closed: any error is `completo`.
//
//   node scripts/ci-scope.mjs [--root <dir>]
//
// Exit codes: 0 always (the answer is the scope, never a failure of CI).

import { readFileSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { parse } from 'yaml'
import { ciScope } from '../lib/ci-scope.js'

const args = process.argv.slice(2)
const root = args.includes('--root') ? args[args.indexOf('--root') + 1] : new URL('..', import.meta.url).pathname

function scope() {
  if (process.env.GITHUB_EVENT_NAME !== 'pull_request') return 'completo'
  try {
    const kinds = parse(readFileSync(join(root, 'factory/kinds.yaml'), 'utf8'))
    // `:<old mode> <new mode> <old sha> <new sha> <status>\t<path>` per changed file.
    const diff = execFileSync('git', ['diff', '--raw', '--no-renames', 'HEAD^1', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    const changes = diff.split('\n').filter(Boolean).map((line) => {
      const [meta, path] = line.split('\t')
      const [, mode, , , status] = meta.split(' ')
      return { status, path, mode }
    })
    return ciScope(changes, kinds)
  } catch {
    return 'completo'
  }
}

const result = scope()
console.log(`ci-scope: ${result}`)
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `scope=${result}\n`)
