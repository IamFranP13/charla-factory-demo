#!/usr/bin/env node
// Puts the demo back to its starting point, before (or after) a talk or a rehearsal.
//
//   node scripts/reset-demo.mjs            shows what would change, touches nothing
//   node scripts/reset-demo.mjs --apply    does it: files, GitHub cleanup, commit and push to main
//   --no-push                              with --apply: no commit or push (files and GitHub only)
//   --root <dir>                           another checkout (tests)
//
// Files: removes the audience's files (content/*/tarea-N.json, catalogo/*/tarea-N.json, the feature folders
// src/features/tarea-N/ and the domain files src/domain/tarea-N*), copies the seed back (factory/seed/: the
// data, and the code with its two planted bugs, so a merged fix is undone) and reopens the policy hole (default: auto).
// GitHub: closes open factory PRs (branches tarea/N) and open requests, and removes the "entrada"
// label from every request so the board starts empty and the intake cap is free again.

import { readdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { isAudienceFile } from '../lib/factory.js'
import { gh, ghJson, repoSlug } from '../lib/github.js'

const SEED = 'factory/seed'
const POLICY = 'policy/risk.yaml'

export function resetFiles(root, { dryRun = false } = {}) {
  const changes = []

  for (const top of ['content', 'catalogo', 'src/features', 'src/domain']) {
    for (const path of walk(join(root, top))) {
      if (!isAudienceFile(path)) continue
      changes.push(relative(root, path))
      if (!dryRun) {
        rmSync(path)
        removeIfEmpty(dirname(path), join(root, top))
      }
    }
  }

  for (const path of walk(join(root, SEED))) {
    const target = relative(join(root, SEED), path)
    const seed = readFileSync(path, 'utf8')
    const live = existsSync(join(root, target)) ? readFileSync(join(root, target), 'utf8') : null
    if (live !== null && sameJson(live, seed)) continue
    changes.push(target)
    if (!dryRun) writeFileSync(join(root, target), seed)
  }

  const policy = readFileSync(join(root, POLICY), 'utf8')
  const open = policy.replace(/^default: .*$/m, 'default: auto')
  if (open !== policy) {
    changes.push(POLICY)
    if (!dryRun) writeFileSync(join(root, POLICY), open)
  }
  return changes
}

// A feature folder with no files left goes away too (never above `stop`).
function removeIfEmpty(dir, stop) {
  if (dir !== stop && dir.startsWith(stop) && readdirSync(dir).length === 0) rmSync(dir, { recursive: true })
}

function walk(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]))
}

function sameJson(a, b) {
  try {
    return JSON.stringify(JSON.parse(a)) === JSON.stringify(JSON.parse(b))
  } catch {
    return a === b
  }
}

function githubPlan() {
  const repo = repoSlug()
  const prs = JSON.parse(gh(['pr', 'list', '-R', repo, '--state', 'open', '--json', 'number,headRefName', '--limit', '100']))
    .filter((p) => /^tarea\/\d+$/.test(p.headRefName))
  const issues = ghJson(`repos/${repo}/issues?labels=entrada&state=all&per_page=100`).filter((i) => !i.pull_request)
  return { repo, prs, issues }
}

function main() {
  const args = process.argv.slice(2)
  const apply = args.includes('--apply')
  const push = !args.includes('--no-push')
  const rootIndex = args.indexOf('--root')
  const root = rootIndex === -1 ? new URL('..', import.meta.url).pathname : args[rootIndex + 1]
  process.env.GITHUB_REPOSITORY ??= 'IamFranP13/charla-factory-demo'

  const files = resetFiles(root, { dryRun: !apply })
  const { repo, prs, issues } = githubPlan()

  console.log(apply ? 'Reset de la demo:' : 'Reset de la demo (simulación; nada cambia):')
  console.log(files.length ? files.map((f) => `  fichero  ${f}`).join('\n') : '  ficheros: ya están en su estado inicial')
  for (const p of prs) console.log(`  cerrar   PR #${p.number} (${p.headRefName})`)
  for (const i of issues) console.log(`  ${i.state === 'open' ? 'cerrar y quitar «entrada» de' : 'quitar «entrada» de'} issue #${i.number}`)
  if (!apply) {
    console.log('\nPara aplicarlo: npm run reset-demo -- --apply')
    return
  }

  for (const p of prs) gh(['pr', 'close', String(p.number), '-R', repo, '--delete-branch', '--comment', 'Reset de la demo.'])
  for (const i of issues) {
    if (i.state === 'open') gh(['issue', 'close', String(i.number), '-R', repo, '--reason', 'not planned', '--comment', 'Reset de la demo.'])
    gh(['issue', 'edit', String(i.number), '-R', repo, '--remove-label', 'entrada'])
  }

  if (push && files.length) {
    const git = (...a) => execFileSync('git', a, { cwd: root, stdio: 'inherit' })
    git('add', '-A', '--', ...files)
    git('commit', '-m', 'chore: reset the demo (open hole, seed data, no audience content)')
    git('push', 'origin', 'HEAD:main')
  }
  console.log('\nHecho. Comprueba con: npm run preflight')
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main()
  } catch (error) {
    console.error(`reset error: ${error.stderr?.toString().trim() || error.message}`)
    process.exit(2)
  }
}
