// Thin wrapper over the gh CLI (preinstalled on GitHub Actions runners).
// Every call throws on failure: callers fail closed.

import { execFileSync } from 'node:child_process'

export function gh(args, { input } = {}) {
  return execFileSync('gh', args, { encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'pipe'] })
}

export function ghJson(path, { paginate = false } = {}) {
  const args = paginate ? ['api', '--paginate', '--slurp', path] : ['api', path]
  const value = JSON.parse(gh(args))
  // --slurp wraps every page in an outer array.
  return paginate && Array.isArray(value) ? value.flat(1) : value
}

export function repoSlug() {
  const slug = process.env.GITHUB_REPOSITORY
  if (!slug) throw new Error('GITHUB_REPOSITORY is not set')
  return slug
}

export function pullRequest(pr) {
  return ghJson(`repos/${repoSlug()}/pulls/${pr}`)
}

// Both sides of a rename count: moving a protected file elsewhere still touches it.
// The files API stops at 3000 entries: if it returns fewer than the PR reports, the list is
// incomplete and judging it would fail open, so we refuse.
export function pullRequestFiles(pr, expected = pullRequest(pr).changed_files) {
  const files = ghJson(`repos/${repoSlug()}/pulls/${pr}/files?per_page=100`, { paginate: true })
  if (files.length !== expected) throw new Error(`the files API returned ${files.length} files but the pull request has ${expected} (changed_files): the list is incomplete`)
  return [...new Set(files.flatMap((f) => [f.filename, f.previous_filename].filter(Boolean)))]
}

export function pullRequestReviews(pr) {
  return ghJson(`repos/${repoSlug()}/pulls/${pr}/reviews?per_page=100`, { paginate: true })
}

// An approval counts only if it is that user's latest decision and it was made on the current head:
// pushing new commits after an approval invalidates it.
export function approvalsAtHead(reviews, headSha) {
  const latest = new Map()
  for (const review of reviews) {
    if (!['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'].includes(review.state)) continue
    latest.set(review.user.login, review)
  }
  return [...latest.values()].filter((r) => r.state === 'APPROVED' && r.commit_id === headSha).map((r) => r.user.login)
}
