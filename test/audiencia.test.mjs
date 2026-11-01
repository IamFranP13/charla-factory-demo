import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isAudienceFile } from '../lib/audiencia.js'

test('audience files are recognised so rehearsal copies can leave them out', () => {
  assert.equal(isAudienceFile('/repo/content/campanas/tarea-12.json'), true)
  assert.equal(isAudienceFile('catalogo/productos/tarea-1.json'), true)
  assert.equal(isAudienceFile('/repo/catalogo/destinos/tarea-1.json'), true)
  assert.equal(isAudienceFile('/repo/content/campanas/huerta-de-murcia.json'), false)
  assert.equal(isAudienceFile('/repo/catalogo/productos/limon-verna.json'), false)
  assert.equal(isAudienceFile('/repo/content/campanas'), false)
  assert.equal(isAudienceFile('/repo/data/tarea-1.json'), false)
})
