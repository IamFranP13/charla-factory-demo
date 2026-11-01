// The kinds (factory/kinds.yaml) name what a request may change and which ones are code or visual.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'
import { TIPOS } from '../lib/estado.js'

const repo = new URL('..', import.meta.url).pathname
const loadKinds = (root) => parse(readFileSync(join(root, 'factory/kinds.yaml'), 'utf8'))

const ALL = ['campana', 'producto', 'destino', 'precios', 'descuentos', 'transporte', 'estilo', 'bug', 'feature', 'cambio']

test('the kinds are the ten of the contract, each with the surface the code enforces', () => {
  const kinds = loadKinds(repo)
  assert.deepEqual(Object.keys(kinds), ALL)
  assert.deepEqual(TIPOS, ALL)
  assert.deepEqual([kinds.campana.folders, kinds.campana.newFile], [['content/campanas/'], true])
  assert.deepEqual([kinds.producto.folders, kinds.producto.newFile], [['catalogo/productos/'], true])
  assert.deepEqual([kinds.destino.folders, kinds.destino.newFile], [['catalogo/destinos/'], true])
  assert.deepEqual([kinds.precios.files, kinds.precios.newFile], [['data/precios.json'], false])
  assert.deepEqual([kinds.descuentos.files, kinds.descuentos.newFile], [['data/descuentos.json'], false])
  assert.deepEqual([kinds.transporte.files, kinds.transporte.newFile], [['config/transporte.json'], false])
  assert.deepEqual([kinds.estilo.files.length, kinds.estilo.newFile, kinds.estilo.visual], [6, false, true])
  for (const code of ['bug', 'feature', 'cambio']) assert.equal(kinds[code].code, true, code)
  assert.deepEqual([kinds.bug.scope, kinds.feature.scope, kinds.cambio.scope], [['features', 'domain'], ['features'], ['domain']])
  for (const data of ['campana', 'producto', 'destino', 'precios', 'descuentos', 'transporte']) assert.notEqual(kinds[data].code, true, data)
  for (const kind of Object.values(kinds)) assert.ok(kind.description.length > 10)
})
