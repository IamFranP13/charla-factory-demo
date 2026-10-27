import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, cpSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const repo = new URL('..', import.meta.url).pathname
const script = join(repo, 'scripts/validate-content.mjs')

// A scratch copy of just the data the validator reads.
function scratch() {
  const root = mkdtempSync(join(tmpdir(), 'validate-'))
  for (const path of ['content/campanas', 'catalogo', 'data', 'config']) cpSync(join(repo, path), join(root, path), { recursive: true })
  return root
}

const run = (root) => spawnSync(process.execPath, [script, root], { encoding: 'utf8' })

test('the repository content is valid', () => {
  const root = scratch()
  try {
    const result = run(root)
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /válido/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a broken file exits 1 and is named', () => {
  const root = scratch()
  try {
    writeFileSync(join(root, 'catalogo/productos/limon-fino.json'), '{"nombre":"<b>x</b>"}')
    writeFileSync(join(root, 'data/precios.json'), '{"limon-fino": -3}')
    const result = run(root)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /catalogo\/productos\/limon-fino\.json/)
    assert.match(result.stderr, /data\/precios\.json/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a price for a product that does not exist fails the cross-file check', () => {
  const root = scratch()
  try {
    writeFileSync(join(root, 'data/precios.json'), '{"fantasma": 1.5}')
    const result = run(root)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /fantasma/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
