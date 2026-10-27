import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rehearsalCopy } from '../lib/rehearsal.js'

const repo = new URL('..', import.meta.url).pathname

// A repository after a talk: the audience added cards and changed the price and the figures.
function liveRepo() {
  const root = mkdtempSync(join(tmpdir(), 'live-'))
  cpSync(join(repo, 'factory'), join(root, 'factory'), { recursive: true })
  for (const [path, value] of Object.entries({
    'content/muro/bienvenida.json': { texto: 'semilla' },
    'content/muro/tarea-7.json': { texto: 'del público' },
    'content/secciones/tarea-8.json': { titulo: 'del público', cuerpo: 'x' },
    'config/entradas.json': { precio: 0, aforo: 200 },
    'data/cifras.json': { asistentes: 999 },
  })) {
    mkdirSync(join(root, path, '..'), { recursive: true })
    writeFileSync(join(root, path), JSON.stringify(value))
  }
  return root
}

test('a rehearsal copy keeps the platform and seed content, drops audience files and resets the seed state', () => {
  const live = liveRepo()
  const copy = mkdtempSync(join(tmpdir(), 'copy-'))
  rehearsalCopy(live, copy, ['content', 'config', 'data', 'factory'])

  assert.ok(existsSync(join(copy, 'content/muro/bienvenida.json')))
  assert.equal(existsSync(join(copy, 'content/muro/tarea-7.json')), false)
  assert.equal(existsSync(join(copy, 'content/secciones/tarea-8.json')), false)
  const seed = (p) => JSON.parse(readFileSync(join(repo, 'factory/seed', p), 'utf8'))
  assert.deepEqual(JSON.parse(readFileSync(join(copy, 'config/entradas.json'), 'utf8')), seed('config/entradas.json'))
  assert.deepEqual(JSON.parse(readFileSync(join(copy, 'data/cifras.json'), 'utf8')), seed('data/cifras.json'))
})

test('the seed files are valid content', async () => {
  const { validateFile } = await import('../lib/schemas.js')
  for (const p of ['config/entradas.json', 'data/cifras.json']) {
    assert.deepEqual(validateFile(p, readFileSync(join(repo, 'factory/seed', p), 'utf8')), { ok: true, errors: [] }, p)
  }
})
