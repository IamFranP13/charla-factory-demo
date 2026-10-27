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
    'content/campanas/bienvenida.json': { titulo: 'semilla', texto: 'x', color: 'oliva' },
    'content/campanas/tarea-7.json': { titulo: 'del público', texto: 'x', color: 'oliva' },
    'catalogo/productos/limon-verna.json': { nombre: 'Limón' },
    'catalogo/productos/tarea-8.json': { nombre: 'del público' },
    'catalogo/destinos/tarea-9.json': { pais: 'del público' },
    'config/transporte.json': { 'alemania-hamburgo': { eurPorKg: 0, minimo: 0 } },
    'data/precios.json': { 'limon-verna': 99 },
    'data/descuentos.json': { tramos: [{ desdeKg: 1, porcentaje: 50 }] },
  })) {
    mkdirSync(join(root, path, '..'), { recursive: true })
    writeFileSync(join(root, path), JSON.stringify(value))
  }
  return root
}

test('a rehearsal copy keeps the platform and seed content, drops audience files and resets the seed state', () => {
  const live = liveRepo()
  const copy = mkdtempSync(join(tmpdir(), 'copy-'))
  rehearsalCopy(live, copy, ['content', 'catalogo', 'config', 'data', 'factory'])

  assert.ok(existsSync(join(copy, 'content/campanas/bienvenida.json')))
  assert.ok(existsSync(join(copy, 'catalogo/productos/limon-verna.json')))
  for (const gone of ['content/campanas/tarea-7.json', 'catalogo/productos/tarea-8.json', 'catalogo/destinos/tarea-9.json']) {
    assert.equal(existsSync(join(copy, gone)), false, gone)
  }
  const seed = (p) => JSON.parse(readFileSync(join(repo, 'factory/seed', p), 'utf8'))
  for (const p of ['config/transporte.json', 'data/precios.json', 'data/descuentos.json']) {
    assert.deepEqual(JSON.parse(readFileSync(join(copy, p), 'utf8')), seed(p), p)
  }
})

test('the seed files are valid content', async () => {
  const { validateFile } = await import('../lib/schemas.js')
  for (const p of ['config/transporte.json', 'data/precios.json', 'data/descuentos.json']) {
    assert.deepEqual(validateFile(p, readFileSync(join(repo, 'factory/seed', p), 'utf8')), { ok: true, errors: [] }, p)
  }
})

test('the old wall, sections, figures and ticket config are gone, seed copies included', () => {
  for (const gone of ['content/muro', 'content/secciones', 'data/cifras.json', 'config/entradas.json', 'factory/seed/data/cifras.json', 'factory/seed/config/entradas.json']) {
    assert.equal(existsSync(join(repo, gone)), false, gone)
  }
})
