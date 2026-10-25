#!/usr/bin/env node
// Runs the whole factory locally against a battery of requests, with no network and no GitHub.
//
//   node scripts/simulate.mjs [--battery <file>] [--policy <file>] [--json]
//
// Model: FACTORY_PROVIDER=replay (default, free) or openai, like scripts/factory.mjs.
// Exit codes: 0 every request ended as expected · 1 some did not · 2 usage or setup error.

import { readFileSync } from 'node:fs'
import { parsePolicy } from '../lib/policy.js'
import { providersFromEnv } from '../lib/providers.js'
import { simulate, renderTable } from '../lib/simulate.js'

const repo = new URL('..', import.meta.url).pathname
const args = process.argv.slice(2)
const take = (flag) => {
  const i = args.indexOf(flag)
  return i === -1 ? undefined : args.splice(i, 2)[1]
}
const json = args.includes('--json')

try {
  const battery = JSON.parse(readFileSync(take('--battery') ?? `${repo}test/battery.json`, 'utf8'))
  const policy = parsePolicy(readFileSync(take('--policy') ?? `${repo}policy/risk.yaml`, 'utf8'))
  const { provider, reviewProvider } = providersFromEnv()
  const report = await simulate({ repo, battery, policy, provider, reviewProvider })
  console.log(json ? JSON.stringify(report) : renderTable(report))
  process.exit(report.totals.inesperadas ? 1 : 0)
} catch (error) {
  console.error(`simulate error: ${error.message}`)
  process.exit(2)
}
