// What each profile may ask for, and the kinds of a change read from its paths (odd/tasks/perfil-elegido.md, S3-S4).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { PERFILES, tiposDe, fueraDePerfil } from '../lib/perfiles.js'
import { TIPOS } from '../lib/estado.js'

const kinds = parse(readFileSync(new URL('../factory/kinds.yaml', import.meta.url), 'utf8'))

test('each profile asks for its own area, and anyone may report a bug', () => {
  assert.deepEqual(Object.keys(PERFILES), ['marketing', 'producto', 'negocio'])
  assert.deepEqual(PERFILES.marketing.tipos, ['campana', 'estilo', 'bug'])
  assert.deepEqual(PERFILES.producto.tipos, ['producto', 'destino', 'feature', 'bug'])
  assert.deepEqual(PERFILES.negocio.tipos, ['precios', 'descuentos', 'transporte', 'cambio', 'bug'])
  assert.deepEqual([PERFILES.marketing.nombre, PERFILES.producto.nombre, PERFILES.negocio.nombre], ['Marketing', 'Producto', 'Negocio'])
  // Every kind belongs to at least one profile, and only known kinds are named.
  const named = new Set(Object.values(PERFILES).flatMap((p) => p.tipos))
  assert.deepEqual([...named].sort(), [...TIPOS].sort())
})

test('the kinds of a path follow the surfaces of factory/kinds.yaml', () => {
  for (const tipo of ['campana', 'producto', 'destino']) assert.deepEqual(tiposDe(`${kinds[tipo].folders[0]}tarea-7.json`), [tipo])
  for (const tipo of ['precios', 'descuentos', 'transporte']) assert.deepEqual(tiposDe(kinds[tipo].files[0]), [tipo])
  for (const file of kinds.estilo.files) assert.deepEqual(tiposDe(file), ['estilo'], file)
  // Code: a feature added is a feature; a feature changed is a bug fix; the domain is a fix or a rule change.
  assert.deepEqual(tiposDe('src/features/tarea-7/index.js', ['src/features/tarea-7/index.js']), ['feature'])
  assert.deepEqual(tiposDe('src/features/tarea-7/index.test.mjs', ['src/features/tarea-7/index.js', 'src/features/tarea-7/index.test.mjs']), ['feature'])
  assert.deepEqual(tiposDe('src/features/ordenar-catalogo/index.js'), ['bug'])
  assert.deepEqual(tiposDe('src/features/ordenar-catalogo/index.test.mjs', ['src/features/ordenar-catalogo/index.test.mjs']), ['bug'])
  assert.deepEqual(tiposDe('src/domain/presupuesto.js'), ['bug', 'cambio'])
  // Outside every surface: no kind (the profile does not limit it; the gate sends it to a person).
  for (const file of ['lib/fabrica.js', 'src/pages/index.astro', 'policy/risk.yaml', 'content/campanas', 'data/precios.json.bak']) assert.equal(tiposDe(file), null, file)
})

test('a change inside the profile passes; one outside it gives the reason and who may ask for it', () => {
  assert.equal(fueraDePerfil('marketing', ['content/campanas/tarea-3.json'], ['content/campanas/tarea-3.json']), null)
  assert.equal(fueraDePerfil('marketing', ['src/styles/global.css', 'src/features/ordenar-catalogo/index.js']), null)
  assert.equal(fueraDePerfil('negocio', ['data/precios.json', 'src/domain/presupuesto.js']), null)
  assert.equal(fueraDePerfil('producto', ['src/features/tarea-4/index.js', 'src/features/tarea-4/index.test.mjs'], ['src/features/tarea-4/index.js', 'src/features/tarea-4/index.test.mjs']), null)
  // Anyone may fix a bug, in a feature or in the domain.
  for (const perfil of Object.keys(PERFILES)) assert.equal(fueraDePerfil(perfil, ['src/domain/presupuesto.js']), null, perfil)
  // Files outside every surface are the gate's business.
  assert.equal(fueraDePerfil('marketing', ['lib/fabrica.js', 'README.md']), null)

  assert.equal(fueraDePerfil('marketing', ['data/precios.json']), 'Marketing no puede cambiar precios: pídelo como Negocio.')
  assert.equal(fueraDePerfil('marketing', ['content/campanas/tarea-3.json', 'config/transporte.json']), 'Marketing no puede cambiar tarifas de transporte: pídelo como Negocio.')
  assert.equal(fueraDePerfil('negocio', ['content/campanas/tarea-3.json'], ['content/campanas/tarea-3.json']), 'Negocio no puede crear campañas: pídelo como Marketing.')
  assert.equal(fueraDePerfil('negocio', ['src/features/tarea-4/index.js'], ['src/features/tarea-4/index.js']), 'Negocio no puede añadir secciones nuevas: pídelo como Producto.')
  assert.equal(fueraDePerfil('producto', ['src/styles/global.css']), 'Producto no puede cambiar el aspecto de la web: pídelo como Marketing.')
  for (const [perfil, file, motivo] of [
    ['marketing', 'catalogo/productos/tarea-1.json', 'Marketing no puede añadir productos: pídelo como Producto.'],
    ['negocio', 'catalogo/destinos/tarea-1.json', 'Negocio no puede añadir destinos: pídelo como Producto.'],
    ['producto', 'data/descuentos.json', 'Producto no puede cambiar descuentos: pídelo como Negocio.'],
  ]) assert.equal(fueraDePerfil(perfil, [file], [file]), motivo)
  // An unknown profile (an issue written by hand) may ask for nothing that has a kind: fail closed.
  assert.equal(fueraDePerfil('desconocido', ['content/campanas/tarea-3.json']), 'Esta petición no tiene un perfil válido: no puede crear campañas.')
  assert.equal(fueraDePerfil('desconocido', ['lib/fabrica.js']), null)
})
