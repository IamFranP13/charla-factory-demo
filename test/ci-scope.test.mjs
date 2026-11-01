import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse } from 'yaml'
import { ciScope, dataFolders } from '../lib/ci-scope.js'

const kinds = parse(readFileSync(new URL('../factory/kinds.yaml', import.meta.url), 'utf8'))
const ch = (status, path) => ({ status, path })

test('dataFolders: the new-file folders of factory/kinds.yaml', () => {
  assert.deepEqual(dataFolders(kinds), ['content/campanas/', 'catalogo/productos/', 'catalogo/destinos/'])
})

test('ciScope: only added or modified JSON directly in a new-file folder is "datos"', () => {
  assert.equal(ciScope([ch('A', 'content/campanas/tarea-38.json')], kinds), 'datos')
  assert.equal(ciScope([ch('A', 'catalogo/productos/tarea-39.json'), ch('M', 'catalogo/destinos/italia.json')], kinds), 'datos')
})

test('ciScope: anything else runs the full CI', () => {
  const full = (changes) => assert.equal(ciScope(changes, kinds), 'completo', JSON.stringify(changes))
  full([])
  full([ch('A', 'content/campanas/tarea-38.json'), ch('M', 'src/styles/global.css')])
  full([ch('D', 'content/campanas/tarea-38.json')])
  full([ch('R100', 'content/campanas/tarea-38.json')])
  full([ch('A', 'content/campanas/sub/tarea-38.json')])
  full([ch('A', 'content/campanas/tarea-38.js')])
  full([ch('M', 'data/precios.json')])
  full([ch('A', 'src/features/tarea-40/index.js')])
  full([ch('M', 'factory/kinds.yaml')])
  full([ch('A', 'content/campanas/../../scripts/x.json')])
  full([ch('A', '')])
})

// A throwaway repository with a base commit and one more commit on top, like the merge ref CI checks out.
function repoWith(files) {
  const dir = mkdtempSync(join(tmpdir(), 'ci-scope-'))
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' })
  git('init', '-q')
  git('config', 'user.email', 't@t')
  git('config', 'user.name', 't')
  mkdirSync(join(dir, 'factory'))
  cpSync(new URL('../factory/kinds.yaml', import.meta.url), join(dir, 'factory/kinds.yaml'))
  git('add', '-A')
  git('commit', '-qm', 'base')
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true })
    writeFileSync(join(dir, path), body)
  }
  git('add', '-A')
  git('commit', '-qm', 'change')
  return dir
}

const script = new URL('../scripts/ci-scope.mjs', import.meta.url).pathname
const runScript = (cwd, env) => {
  const out = join(cwd, 'out.txt')
  writeFileSync(out, '')
  const r = spawnSync(process.execPath, [script, '--root', cwd], { cwd, encoding: 'utf8', env: { PATH: process.env.PATH, GITHUB_OUTPUT: out, ...env } })
  return { ...r, output: readFileSync(out, 'utf8') }
}

test('scripts/ci-scope.mjs: a pull request that only adds a campaign gets scope=datos', () => {
  const dir = repoWith({ 'content/campanas/tarea-1.json': '{}' })
  try {
    const r = runScript(dir, { GITHUB_EVENT_NAME: 'pull_request' })
    assert.equal(r.status, 0, r.stderr)
    assert.equal(r.output, 'scope=datos\n')
    assert.match(r.stdout, /datos/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('scripts/ci-scope.mjs: platform changes, pushes and unreadable history get scope=completo', () => {
  const platform = repoWith({ 'content/campanas/tarea-1.json': '{}', 'lib/x.js': '' })
  const data = repoWith({ 'content/campanas/tarea-1.json': '{}' })
  try {
    assert.equal(runScript(platform, { GITHUB_EVENT_NAME: 'pull_request' }).output, 'scope=completo\n')
    assert.equal(runScript(data, { GITHUB_EVENT_NAME: 'push' }).output, 'scope=completo\n', 'every push to main runs the full CI')
    rmSync(join(data, '.git'), { recursive: true, force: true })
    const broken = runScript(data, { GITHUB_EVENT_NAME: 'pull_request' })
    assert.equal(broken.status, 0)
    assert.equal(broken.output, 'scope=completo\n', 'fails closed')
  } finally {
    rmSync(platform, { recursive: true, force: true })
    rmSync(data, { recursive: true, force: true })
  }
})
