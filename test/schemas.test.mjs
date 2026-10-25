import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateFile } from '../lib/schemas.js'

const json = (value) => JSON.stringify(value)

test('a wall card with text, author, emoji and color is valid', () => {
  const result = validateFile('content/muro/hola-sala.json', json({ texto: 'Hola desde la fila 3', autor: 'Ana', emoji: '👋', color: 'amarillo' }))
  assert.deepEqual(result, { ok: true, errors: [] })
})

test('a wall card needs text of at most 140 characters', () => {
  assert.equal(validateFile('content/muro/a.json', json({})).ok, false)
  assert.equal(validateFile('content/muro/a.json', json({ texto: 'x'.repeat(141) })).ok, false)
  assert.equal(validateFile('content/muro/a.json', json({ texto: 'x'.repeat(140) })).ok, true)
})

test('plain text only: HTML and links are rejected', () => {
  for (const texto of ['<script>alert(1)</script>', 'mira https://example.com', 'a > b']) {
    const result = validateFile('content/muro/a.json', json({ texto }))
    assert.equal(result.ok, false, texto)
  }
})

test('unknown fields and unknown colors are rejected', () => {
  assert.equal(validateFile('content/muro/a.json', json({ texto: 'hola', extra: 1 })).ok, false)
  assert.equal(validateFile('content/muro/a.json', json({ texto: 'hola', color: 'fucsia' })).ok, false)
})

test('a section has a title and a body', () => {
  assert.equal(validateFile('content/secciones/faq.json', json({ titulo: 'FAQ', cuerpo: 'Preguntas al final.' })).ok, true)
  assert.equal(validateFile('content/secciones/faq.json', json({ titulo: 'FAQ' })).ok, false)
})

test('data files hold short text or number values', () => {
  assert.equal(validateFile('data/cifras.json', json({ asistentes: 120, ciudad: 'Valencia' })).ok, true)
  assert.equal(validateFile('data/cifras.json', json({ lista: [1, 2] })).ok, false)
})

test('config/entradas.json holds a non-negative price and a capacity', () => {
  assert.equal(validateFile('config/entradas.json', json({ precio: 0, aforo: 200 })).ok, true)
  assert.equal(validateFile('config/entradas.json', json({ precio: -5, aforo: 200 })).ok, false)
})

test('file names are lowercase slugs ending in .json', () => {
  assert.equal(validateFile('content/muro/Hola Sala.json', json({ texto: 'hola' })).ok, false)
  assert.equal(validateFile('content/muro/../../x.json', json({ texto: 'hola' })).ok, false)
})

test('files outside the content folders have no schema', () => {
  const result = validateFile('policy/risk.yaml', 'default: auto')
  assert.equal(result.ok, false)
  assert.match(result.errors[0], /no schema/)
})

test('invalid JSON is reported, not thrown', () => {
  const result = validateFile('content/muro/a.json', '{nope')
  assert.equal(result.ok, false)
  assert.match(result.errors[0], /JSON/)
})
