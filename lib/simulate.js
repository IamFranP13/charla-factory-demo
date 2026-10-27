// Runs the whole pipeline without network or GitHub, in a throwaway copy of the repo:
// request → factory → files on a branch → risk gate → merge to main (auto) or blocked PR (human).

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { runFactory } from './factory.js'
import { rehearsalCopy } from './rehearsal.js'
import { routeFor } from './policy.js'
import { buildSite } from './build.js'

const COPIED = ['content', 'data', 'config', 'factory', 'policy', 'site', 'AGENTS.md']

export async function simulate({ repo, battery, policy, provider, reviewProvider = provider }) {
  const root = mkdtempSync(join(tmpdir(), 'simulate-'))
  try {
    rehearsalCopy(repo, root, COPIED)
    const git = (...args) => execFileSync('git', ['-c', 'user.name=factory', '-c', 'user.email=factory@example.invalid', ...args], { cwd: root, stdio: 'pipe' })
    git('init', '-q', '-b', 'main')
    git('add', '-A')
    git('commit', '-q', '-m', 'initial')

    const rows = []
    for (const item of battery) {
      const task = { id: item.id, profile: item.perfil, request: item.peticion }
      const result = await runFactory({ task, root, provider, reviewProvider, trace: () => {} })
      const row = { id: item.id, perfil: item.perfil, factory: result.status, ruta: null, enMain: false, tokens: result.usage.input + result.usage.output }

      if (result.status === 'ok') {
        const branch = `tarea-${item.id}`
        git('checkout', '-q', '-b', branch)
        for (const file of result.files) {
          mkdirSync(dirname(join(root, file.path)), { recursive: true })
          writeFileSync(join(root, file.path), file.content)
        }
        git('add', '-A')
        git('commit', '-q', '-m', `Tarea ${item.id}`)
        row.ruta = routeFor(policy, result.files.map((f) => f.path)).route
        git('checkout', '-q', 'main')
        if (row.ruta === 'auto') {
          git('merge', '-q', '--ff-only', branch)
          row.enMain = true
          if (!buildSite(root).ok) row.factory = 'build-failed'
        }
      }

      const expected = item.esperado ?? {}
      row.ok = row.factory === expected.factory && (expected.ruta === undefined || row.ruta === expected.ruta)
      rows.push(row)
    }
    return { rows, totals: totalsOf(rows) }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

export function totalsOf(rows) {
  const count = (pred) => rows.filter(pred).length
  return {
    peticiones: rows.length,
    enMain: count((r) => r.enMain),
    bloqueadas: count((r) => r.ruta === 'human'),
    rechazadas: count((r) => r.factory === 'rejected'),
    fallidas: count((r) => r.factory !== 'ok' && r.factory !== 'rejected'),
    tokens: rows.reduce((sum, r) => sum + r.tokens, 0),
    inesperadas: count((r) => !r.ok),
  }
}

export function renderTable({ rows, totals }) {
  const line = (cols) => cols.map((c, i) => String(c).padEnd([4, 11, 10, 6, 8, 3][i])).join('  ').trimEnd()
  return [
    line(['ID', 'PERFIL', 'FACTORY', 'RUTA', 'EN MAIN', 'OK']),
    ...rows.map((r) => line([r.id, r.perfil, r.factory, r.ruta ?? '-', r.enMain ? 'sí' : 'no', r.ok ? '✓' : '✗'])),
    '',
    `Peticiones: ${totals.peticiones} · en main: ${totals.enMain} · bloqueadas: ${totals.bloqueadas} · rechazadas: ${totals.rechazadas} · fallidas: ${totals.fallidas} · tokens: ${totals.tokens}`,
    totals.inesperadas ? `Resultado inesperado en ${totals.inesperadas} petición(es).` : 'Todas las peticiones acabaron como se esperaba.',
  ].join('\n')
}
