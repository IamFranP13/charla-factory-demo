// The risk gate: pure functions over the policy file and the list of changed files.
// No model is involved anywhere in this file. That is the point.

import { parse } from 'yaml'

const ROUTES = ['auto', 'human']

export function parsePolicy(text) {
  const raw = parse(text) ?? {}
  if (!ROUTES.includes(raw.default)) throw new Error(`policy: "default" must be one of ${ROUTES.join(', ')}`)

  const approvers = raw.approvers ?? []
  if (!Array.isArray(approvers) || approvers.some((a) => typeof a !== 'string')) throw new Error('policy: "approvers" must be a list of GitHub logins')

  const rules = raw.rules ?? []
  if (!Array.isArray(rules)) throw new Error('policy: "rules" must be a list')
  rules.forEach((rule, i) => {
    if (!Array.isArray(rule?.paths) || rule.paths.length === 0 || rule.paths.some((p) => typeof p !== 'string' || !p)) {
      throw new Error(`policy: rule ${i + 1} needs a non-empty "paths" list`)
    }
    if (!ROUTES.includes(rule.route)) throw new Error(`policy: rule ${i + 1} "route" must be one of ${ROUTES.join(', ')}`)
  })

  if (raw.factory !== undefined && typeof raw.factory !== 'string') throw new Error('policy: "factory" must be the GitHub login of the factory App bot')

  return { default: raw.default, factory: raw.factory ?? '', approvers, rules }
}

export function routeFor(policy, changedFiles) {
  // Nothing to judge is suspicious, not harmless.
  if (changedFiles.length === 0) return { route: 'human', files: [] }

  const files = changedFiles.map((file) => {
    for (const rule of policy.rules) {
      const glob = rule.paths.find((p) => matchesGlob(file, p))
      if (glob) return { file, route: rule.route, rule: glob }
    }
    return { file, route: policy.default, rule: 'default' }
  })
  const route = files.some((f) => f.route === 'human') ? 'human' : 'auto'
  return { route, files }
}

// Who opened the pull request matters for one thing only: auto-merge.
// Only the factory App, from a branch of this very repository, may merge without a human.
// A missing "factory" login fails closed: nothing is auto.
export function originAllowsAuto(policy, { author, headRepo, repo }) {
  const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a !== '' && a.toLowerCase() === b.toLowerCase()
  if (same(author, policy.factory) && same(headRepo, repo)) return { ok: true, reason: 'opened by the factory from this repository' }
  return { ok: false, reason: `not opened by the factory from this repository (author ${author ?? 'unknown'}, head ${headRepo ?? 'unknown'})` }
}

export function verdict({ route, approvals, approvers }) {
  if (route === 'auto') return { pass: true, merge: true, reason: 'low risk: merges by itself' }

  const allowed = new Set(approvers.map((a) => a.toLowerCase()))
  const approver = approvals.find((login) => allowed.has(login.toLowerCase()))
  if (approver) return { pass: true, merge: false, reason: `approved by ${approver}` }

  const who = approvers.length ? approvers.join(', ') : 'nobody (no approvers configured)'
  return { pass: false, merge: false, reason: `high risk: waiting for approval from ${who}` }
}

// Minimal glob: "**" matches across folders, "*" within one folder segment.
export function matchesGlob(path, glob) {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i]
    if (ch === '*' && glob[i + 1] === '*') {
      re += '.*'
      i++
    } else if (ch === '*') {
      re += '[^/]*'
    } else {
      re += ch.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    }
  }
  return new RegExp(`^${re}$`).test(path)
}
