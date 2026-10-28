import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, cpSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resetFiles } from '../scripts/reset-demo.mjs'
import { rehearsalCopy } from '../lib/rehearsal.js'

const repo = new URL('..', import.meta.url).pathname

// A repository after a talk: audience files, a free transport, the policy hole closed.
// It starts from a rehearsal copy (the seed), never from the live data, which the audience changes.
function afterTalk() {
  const root = mkdtempSync(join(tmpdir(), 'reset-'))
  rehearsalCopy(repo, root, ['content', 'catalogo', 'data', 'config', 'factory', 'policy'])
  const write = (path, value) => {
    mkdirSync(join(root, path, '..'), { recursive: true })
    writeFileSync(join(root, path), typeof value === 'string' ? value : JSON.stringify(value))
  }
  write('content/campanas/tarea-9.json', { titulo: 'x', texto: 'y', color: 'limon' })
  write('catalogo/destinos/tarea-10.json', { pais: 'Italia', ciudad: 'Milán', diasTransito: 3 })
  write('catalogo/productos/tarea-12.json', { nombre: 'Kiwi', categoria: 'fruta', origen: 'Murcia', descripcion: 'x', emoji: '🥝', disponible: true })
  const t = JSON.parse(readFileSync(join(root, 'config/transporte.json'), 'utf8'))
  t['alemania-hamburgo'] = { eurPorKg: 0, minimo: 0 }
  write('config/transporte.json', t)
  write('policy/risk.yaml', readFileSync(join(root, 'policy/risk.yaml'), 'utf8').replace(/^default: .*/m, 'default: human'))
  return root
}

const json = (root, path) => JSON.parse(readFileSync(join(root, path), 'utf8'))

test('resetFiles removes audience files, restores the seed data and reopens the hole', () => {
  const root = afterTalk()
  const changes = resetFiles(root)
  assert.equal(existsSync(join(root, 'content/campanas/tarea-9.json')), false)
  assert.equal(existsSync(join(root, 'catalogo/destinos/tarea-10.json')), false)
  assert.equal(existsSync(join(root, 'catalogo/productos/tarea-12.json')), false)
  for (const path of ['data/precios.json', 'data/descuentos.json', 'config/transporte.json']) {
    assert.deepEqual(json(root, path), json(root, `factory/seed/${path}`), path)
  }
  assert.match(readFileSync(join(root, 'policy/risk.yaml'), 'utf8'), /^default: auto$/m)
  assert.ok(existsSync(join(root, 'content/campanas')), 'the seed campaigns stay')
  assert.deepEqual(changes.sort(), [
    'catalogo/destinos/tarea-10.json',
    'catalogo/productos/tarea-12.json',
    'config/transporte.json',
    'content/campanas/tarea-9.json',
    'policy/risk.yaml',
  ])
})

test('resetFiles puts the planted hero bug back after the factory fixed it', () => {
  const root = afterTalk()
  const hero = ['src/styles/global.css', 'src/components/Paisaje.astro']
  for (const path of hero) writeFileSync(join(root, path), `${readFileSync(join(root, path), 'utf8')}\n/* arreglado */\n`)
  const changes = resetFiles(root)
  for (const path of hero) {
    assert.equal(readFileSync(join(root, path), 'utf8'), readFileSync(join(repo, 'factory/seed', path), 'utf8'), path)
    assert.ok(changes.includes(path), path)
  }
  assert.match(readFileSync(join(root, 'factory/seed/src/styles/global.css'), 'utf8'), /\.paisaje \{ position: absolute; inset: auto 0 0 0; width: 100%; height: 100%;/, 'the seed keeps the landscape over the whole hero')
})

test('resetFiles on a clean repository changes nothing', () => {
  const root = afterTalk()
  resetFiles(root)
  assert.deepEqual(resetFiles(root), [])
})

// The CLI talks to GitHub through gh; here gh is a stub that records calls.
function fakeGh() {
  const dir = mkdtempSync(join(tmpdir(), 'gh-'))
  writeFileSync(join(dir, 'gh'), `#!/bin/sh
printf '%s\\n' "$*" >> "${dir}/calls"
case "$*" in
  *"pr list"*) printf '%s\\n' '[{"number":16,"headRefName":"tarea/15"},{"number":20,"headRefName":"otra-rama"}]' ;;
  *"issues?labels=entrada"*) printf '%s\\n' '[{"number":9,"state":"closed"},{"number":15,"state":"open"},{"number":21,"state":"open","pull_request":{}}]' ;;
  *) ;;
esac
`)
  chmodSync(join(dir, 'gh'), 0o755)
  return { dir, env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, GITHUB_REPOSITORY: 'o/r' } }
}

test('without --apply it only prints the plan and touches nothing', () => {
  const root = afterTalk()
  const gh = fakeGh()
  const r = spawnSync(process.execPath, [join(repo, 'scripts/reset-demo.mjs'), '--root', root], { encoding: 'utf8', env: gh.env })
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /content\/campanas\/tarea-9\.json/)
  assert.match(r.stdout, /PR #16/)
  assert.doesNotMatch(r.stdout, /PR #20/)
  assert.match(r.stdout, /issue #15/)
  assert.match(r.stdout, /--apply/)
  assert.ok(existsSync(join(root, 'content/campanas/tarea-9.json')))
  assert.doesNotMatch(readFileSync(join(gh.dir, 'calls'), 'utf8'), /close|edit/)
})

test('with --apply --no-push it resets files and cleans GitHub: closes factory PRs and issues, removes the entrada label', () => {
  const root = afterTalk()
  const gh = fakeGh()
  const r = spawnSync(process.execPath, [join(repo, 'scripts/reset-demo.mjs'), '--root', root, '--apply', '--no-push'], { encoding: 'utf8', env: gh.env })
  assert.equal(r.status, 0, r.stderr)
  const calls = readFileSync(join(gh.dir, 'calls'), 'utf8')
  assert.match(calls, /pr close 16 .*--delete-branch/)
  assert.doesNotMatch(calls, /pr close 20/)
  assert.match(calls, /issue close 15/)
  assert.doesNotMatch(calls, /issue close 9/)
  for (const n of [9, 15]) assert.match(calls, new RegExp(`issue edit ${n} .*--remove-label entrada`))
  assert.doesNotMatch(calls, /issue edit 21/)
  assert.equal(existsSync(join(root, 'content/campanas/tarea-9.json')), false)
})
