// Code kinds (bug, feature, cambio) around the factory: policy, providers, task state, the planted bugs,
// the feature registry and the reset. (The factory run itself is in factory-code.test.mjs, the isolation in sandbox.test.mjs.)
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parsePolicy, routeFor } from '../lib/policy.js'
import { openAIProvider, providersFromEnv } from '../lib/providers.js'
import { initialState, applyEvent, finishState, renderState, parseState, replaceState } from '../lib/estado.js'
import { derivar } from '../lib/estado.js'
import { rehearsalCopy } from '../lib/rehearsal.js'
import { resetFiles } from '../scripts/reset-demo.mjs'
import { buildFeatures } from '../scripts/build-features.mjs'
import { paraPagina } from '../src/lib/features.js'
import { cargarEstado } from '../src/domain/estado-node.js'

const repo = new URL('..', import.meta.url).pathname
const scratches = []
const scratch = (entries = ['content', 'catalogo', 'data', 'config', 'brain', 'src', 'factory', 'policy']) => {
  const root = mkdtempSync(join(tmpdir(), 'desarrollo-'))
  scratches.push(root)
  rehearsalCopy(repo, root, entries)
  // The live policy default changes after a talk (the fix is `default: human`); a copy starts from the open hole.
  if (existsSync(join(root, 'policy/risk.yaml'))) writeFileSync(join(root, 'policy/risk.yaml'), readFileSync(join(root, 'policy/risk.yaml'), 'utf8').replace(/^default:.*$/m, 'default: auto'))
  return root
}
after(() => scratches.forEach((dir) => rmSync(dir, { recursive: true, force: true })))
const read = (root, path) => readFileSync(join(root, path), 'utf8')
const write = (root, path, content) => {
  mkdirSync(join(root, path, '..'), { recursive: true })
  writeFileSync(join(root, path), content)
}

// --- policy: code goes by what it touches, whatever the default is ---

const livePolicy = (route) => parsePolicy(readFileSync(join(repo, 'policy/risk.yaml'), 'utf8').replace(/^default:.*$/m, `default: ${route}`))

test('policy: a feature goes alone to production, the domain needs a human, the rest of src/ stays the platform (default auto or human)', () => {
  for (const route of ['auto', 'human']) {
    const policy = livePolicy(route)
    const via = (file) => routeFor(policy, [file]).route
    for (const file of ['src/features/tarea-90/index.js', 'src/features/tarea-90/index.test.mjs', 'src/features/ordenar-catalogo/index.js']) {
      assert.equal(via(file), 'auto', `${file} (default ${route})`)
      assert.equal(routeFor(policy, [file]).files[0].rule, file.endsWith('index.js') ? 'src/features/*/index.js' : 'src/features/*/index.test.mjs')
    }
    for (const file of ['src/domain/presupuesto.js', 'src/domain/limite.test.mjs', 'src/domain/estado-node.js']) assert.equal(via(file), 'human', file)
    for (const file of ['src/features/contrato.js', 'src/features/index.js', 'src/features/tarea-90/otra.js', 'src/features/tarea-90/sub/index.js', 'src/features/tarea-90/package.json', 'src/pages/index.astro', 'src/components/Features.astro', 'src/lib/features.js', 'scripts/build-features.mjs', 'lib/sandbox.js']) {
      assert.equal(via(file), 'human', `${file} (default ${route})`)
    }
  }
})

test('policy: the feature and domain rules come before the rule of the platform, and a mixed change takes the strictest route', () => {
  const policy = livePolicy('auto')
  const first = (glob) => policy.rules.findIndex((r) => r.paths.includes(glob))
  const platform = policy.rules.findIndex((r) => r.paths.includes('src/**'))
  assert.ok(platform >= 0)
  for (const glob of ['src/features/*/index.js', 'src/features/*/index.test.mjs', 'src/domain/**']) assert.ok(first(glob) >= 0 && first(glob) < platform, glob)
  assert.equal(routeFor(policy, ['src/features/tarea-9/index.js', 'src/domain/presupuesto.js']).route, 'human')
  assert.equal(routeFor(policy, ['src/features/tarea-9/index.js', 'src/features/tarea-9/index.test.mjs']).route, 'auto')
  assert.equal(routeFor(policy, ['src/features/tarea-9/index.js', 'src/features/contrato.js']).route, 'human')
})

// --- providers ---

test('openai provider: 1000 output tokens by default, more when the station asks (code)', async () => {
  const bodies = []
  const fetchImpl = async (url, init) => {
    bodies.push(JSON.parse(init.body))
    return new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }], usage: {} }), { status: 200 })
  }
  const p = openAIProvider({ url: 'https://a', key: 'k', model: 'm', fetchImpl })
  await p.complete({ messages: [] })
  await p.complete({ messages: [], maxTokens: 4000 })
  assert.deepEqual(bodies.map((b) => b.max_tokens), [1000, 4000])
})

test('providers from env: FACTORY_CODE_MODEL is optional and only changes the model that builds code', () => {
  const base = { FACTORY_PROVIDER: 'openai', FACTORY_API_URL: 'https://a', FACTORY_API_KEY: 'k', FACTORY_MODEL: 'builder-model' }
  const withCode = providersFromEnv({ ...base, FACTORY_CODE_MODEL: 'coder-model' })
  assert.equal(withCode.provider.name, 'openai:builder-model')
  assert.equal(withCode.codeProvider.name, 'openai:coder-model')
  assert.equal(providersFromEnv(base).codeProvider.name, 'openai:builder-model')
  assert.equal(providersFromEnv({ ...base, FACTORY_CODE_MODEL: '' }).codeProvider.name, 'openai:builder-model', 'an unset Actions variable arrives as an empty string')
  const replay = providersFromEnv({})
  assert.equal(replay.codeProvider, replay.provider)
})

// --- task state ---

test('state: the type decided by the spec travels with the task, and nothing else can set it', () => {
  let state = initialState('negocio', '2026-01-01T00:00:00.000Z')
  assert.equal('tipo' in state, false)
  state = applyEvent(state, { station: 'spec', status: 'ok', tipo: 'bug' })
  assert.equal(state.tipo, 'bug')
  assert.equal(applyEvent(state, { station: 'build', status: 'ok', tipo: 'feature' }).tipo, 'bug', 'only the spec event sets it')
  assert.equal('tipo' in applyEvent(initialState('negocio'), { station: 'spec', status: 'ok', tipo: 'mejora' }), false)
  assert.equal(applyEvent(initialState('marketing'), { station: 'spec', status: 'ok', tipo: 'precios' }).tipo, 'precios', 'any profile can have any kind')
  assert.equal('tipo' in applyEvent(initialState('negocio'), { station: 'spec', status: 'en_curso', tipo: 'bug' }), false)
  assert.equal(finishState(state, 'ok').tipo, 'bug')
  const body = replaceState('```json\n{"perfil":"negocio","peticion":"x"}\n```\n', state)
  assert.equal(parseState(body).tipo, 'bug')
  assert.equal(parseState(body.replace('"tipo":"bug"', '"tipo":"<script>"')).tipo, undefined)
  assert.match(renderState(state), /"tipo":"bug"/)
})

test('state: derivar publishes the kind (null when there is none) and links a deployed change to the page of its kind, not of its profile', () => {
  const issue = (state, labels = [{ name: 'perfil:negocio' }]) => ({ number: 5, title: 'x', labels, updated_at: '2026-01-01T00:00:00.000Z', body: `\`\`\`json\n{"perfil":"negocio","peticion":"x"}\n\`\`\`\n\n${renderState(state)}\n` })
  const state = applyEvent(initialState('negocio'), { station: 'spec', status: 'ok', tipo: 'feature' })
  assert.equal(derivar(issue(state)).tipo, 'feature')
  assert.equal(derivar(issue(initialState('marketing'), [{ name: 'perfil:marketing' }])).tipo, null)
  const deployed = { ...state, resultado: 'ok', estaciones: { ...state.estaciones, merge: 'ok', produccion: 'ok' } }
  assert.equal(derivar(issue(deployed)).enlace, '/')
  const price = { ...deployed, tipo: 'precios', perfil: 'marketing' }
  assert.equal(derivar(issue(price, [{ name: 'perfil:marketing' }])).enlace, '/presupuesto/', 'a price asked by Marketing shows in the calculator')
  assert.equal(derivar(issue({ ...price, perfil: 'negocio', tipo: undefined })).enlace, '/presupuesto/', 'without a kind the profile says (negocio)')
})

// --- the planted bugs: on main, with CI green, and restored by the reset ---

test('the planted bugs are in the seed, byte for byte (the reset puts them back)', () => {
  for (const file of ['src/domain/presupuesto.js', 'src/features/ordenar-catalogo/index.js']) {
    assert.ok(existsSync(join(repo, 'factory/seed', file)), file)
  }
  const domain = read(repo, 'factory/seed/src/domain/presupuesto.js')
  assert.match(domain, /\.filter\(\(t\) => t\.desdeKg < kgTotal\)/, 'the discount is skipped at the exact kilos of the tier')
  const sorted = read(repo, 'factory/seed/src/features/ordenar-catalogo/index.js')
  assert.match(sorted, /\.sort\(\(a, b\) => b\.precio - a\.precio\)/, 'the cheapest-to-dearest list is reversed')
})

test('with the bugs, the calculator shows no discount at exactly 1.000 kg and the list puts the dearest first', async () => {
  const root = scratch()
  const estado = cargarEstado(root)
  const { presupuestar } = await import(join(root, 'src/domain/presupuesto.js'))
  const pedido = (kg) => presupuestar({ lineas: [{ productoId: 'limon-verna', kg }], destinoId: 'alemania-hamburgo' }, estado)
  assert.equal(pedido(1000).descuento.porcentaje, 0)
  assert.equal(pedido(1001).descuento.porcentaje, 3)
  const { features } = await buildFeatures(root)
  const prices = features.find((f) => f.id === 'ordenar-catalogo').resultado.items.map((i) => Number(i.valor.replace(',', '.').replace(' €/kg', '')))
  assert.deepEqual(prices, [...prices].sort((a, b) => b - a))
})

test('no test of the repository pins the planted bugs: their exact-boundary tests are gone, the rest stays', () => {
  const domainTests = read(repo, 'factory/seed/src/domain/domain.test.mjs')
  assert.doesNotMatch(domainTests, /discount boundaries/)
  assert.doesNotMatch(read(repo, 'factory/seed/src/features/ordenar-catalogo/index.test.mjs'), /barato|cheapest|ascending|order/i)
  assert.match(domainTests, /kg boundaries: 1 and 100000 are valid/)
})

test('reset: audience features and every code change are undone, the seed (with its bugs) comes back', () => {
  const root = scratch()
  write(root, 'src/features/tarea-12/index.js', 'export default {}\n')
  write(root, 'src/features/tarea-12/index.test.mjs', '\n')
  write(root, 'src/features/tarea-13/index.js', 'export default {}\n')
  write(root, 'src/domain/presupuesto.js', read(root, 'src/domain/presupuesto.js').replace('t.desdeKg < kgTotal', 't.desdeKg <= kgTotal'))
  write(root, 'src/domain/tarea-12-limite-descuento.test.mjs', 'x')
  write(root, 'src/domain/tarea-13.js', 'export const x = 1\n')
  write(root, 'src/features/ordenar-catalogo/index.js', read(root, 'src/features/ordenar-catalogo/index.js').replace('b.precio - a.precio', 'a.precio - b.precio'))

  const planned = resetFiles(root, { dryRun: true })
  assert.ok(existsSync(join(root, 'src/features/tarea-12/index.js')), 'a dry run changes nothing')

  const changes = resetFiles(root)
  assert.deepEqual(changes, planned)
  assert.deepEqual(changes.sort(), [
    'src/domain/presupuesto.js',
    'src/domain/tarea-12-limite-descuento.test.mjs',
    'src/domain/tarea-13.js',
    'src/features/ordenar-catalogo/index.js',
    'src/features/tarea-12/index.js',
    'src/features/tarea-12/index.test.mjs',
    'src/features/tarea-13/index.js',
  ])
  assert.equal(existsSync(join(root, 'src/features/tarea-12')), false, 'the empty folder goes too')
  assert.equal(existsSync(join(root, 'src/features/tarea-13')), false)
  assert.match(read(root, 'src/domain/presupuesto.js'), /t\.desdeKg < kgTotal/)
  assert.match(read(root, 'src/features/ordenar-catalogo/index.js'), /b\.precio - a\.precio/)
  assert.deepEqual(resetFiles(root), [], 'idempotent')
  assert.equal(existsSync(join(root, 'src/domain/tarea-12-limite-descuento.test.mjs')), false, 'a test the factory added next to the domain would turn CI red once its fix is undone')
  assert.ok(existsSync(join(root, 'src/domain/domain.test.mjs')), 'the platform files of the domain stay')
})

test('rehearsal copies leave out the audience features and start from the seeded code', () => {
  const live = scratch()
  write(live, 'src/features/tarea-12/index.js', 'export default {}\n')
  write(live, 'src/domain/presupuesto.js', 'export const roto = true\n')
  const copy = mkdtempSync(join(tmpdir(), 'desarrollo-copy-'))
  scratches.push(copy)
  rehearsalCopy(live, copy, ['src', 'factory'])
  assert.equal(existsSync(join(copy, 'src/features/tarea-12')), false)
  assert.equal(read(copy, 'src/domain/presupuesto.js'), read(repo, 'factory/seed/src/domain/presupuesto.js'))
  assert.ok(existsSync(join(copy, 'src/features/ordenar-catalogo/index.js')))
})

// --- the registry the pages read ---

const feature = (id, body) => `export default { id: '${id}', titulo: 'Sección ${id}', donde: 'catalogo', calcular(estado) { return ${body} } }\n`

test('buildFeatures: every feature is computed in the isolation; a broken one is skipped, not fatal', async () => {
  const root = scratch()
  write(root, 'src/features/tarea-1/index.js', feature('tarea-1', "{ tipo: 'lista', items: [{ texto: 'a', valor: 1 }] }"))
  write(root, 'src/features/tarea-2/index.js', feature('tarea-2', "(() => { throw new Error('roto') })()"))
  write(root, 'src/features/tarea-3/index.js', 'esto no es javascript')
  const { features, omitidas } = await buildFeatures(root, { timeoutMs: 5000 })
  assert.deepEqual(features.map((f) => f.id), ['ordenar-catalogo', 'tarea-1'])
  assert.deepEqual(omitidas.map((o) => o.id), ['tarea-2', 'tarea-3'])
})

test('build-features script: writes the generated registry as data, reports what it skipped and never fails the build', () => {
  const root = scratch()
  write(root, 'src/features/tarea-2/index.js', feature('tarea-2', "(() => { throw new Error('roto') })()"))
  const run = spawnSync(process.execPath, [join(repo, 'scripts/build-features.mjs'), '--root', root], { encoding: 'utf8' })
  assert.equal(run.status, 0, run.stdout + run.stderr)
  assert.match(run.stdout, /tarea-2.*omitida/)
  const generated = read(root, 'src/features/index.js')
  assert.match(generated, /^\/\/ Generated by scripts\/build-features\.mjs/)
  assert.doesNotMatch(generated, /import |require|calcular/, 'data only: no code of a feature is imported by the site')
  assert.ok(readdirSync(join(root, 'src/features')).includes('index.js'))
  // The registry is a plain data module.
  const data = JSON.parse(generated.slice(generated.indexOf('export default ') + 'export default '.length).trim())
  assert.deepEqual(data.map((f) => f.id), ['ordenar-catalogo'])
})

test('build-features script: with no features at all the registry is empty', () => {
  const root = scratch()
  rmSync(join(root, 'src/features/ordenar-catalogo'), { recursive: true })
  const run = spawnSync(process.execPath, [join(repo, 'scripts/build-features.mjs'), '--root', root], { encoding: 'utf8' })
  assert.equal(run.status, 0, run.stdout + run.stderr)
  assert.match(read(root, 'src/features/index.js'), /export default \[\]/)
})

test('the generated registry stays out of git', () => {
  const ignored = spawnSync('git', ['check-ignore', 'src/features/index.js'], { cwd: repo, encoding: 'utf8' })
  assert.equal(ignored.status, 0)
})

test('paraPagina: only the features of the page, and anything malformed is dropped instead of breaking the page', () => {
  const ok = (id, donde = 'catalogo', resultado = { tipo: 'texto', texto: 'hola' }) => ({ id, titulo: `T ${id}`, donde, resultado })
  const registro = [
    ok('a'),
    ok('b', 'inicio'),
    ok('c', 'catalogo', { tipo: 'lista', items: [{ texto: 'x', valor: 3 }] }),
    ok('d', 'catalogo', { tipo: 'html', texto: '<b>' }),
    ok('e', 'catalogo', { tipo: 'tabla', columnas: ['A'], filas: [['x', 'y']] }),
    null,
    42,
    { id: 'f' },
    { ...ok('g'), titulo: '<script>alert(1)</script>' },
    { ...ok('h'), resultado: { get tipo() { throw new Error('boom') } } },
  ]
  assert.deepEqual(paraPagina(registro, 'catalogo').map((f) => f.id), ['a', 'c'])
  assert.deepEqual(paraPagina(registro, 'inicio').map((f) => f.id), ['b'])
  assert.deepEqual(paraPagina(registro, 'presupuesto'), [])
  assert.deepEqual(paraPagina(registro, 'catalogo')[1].resultado, { tipo: 'lista', items: [{ texto: 'x', valor: '3' }] })
  assert.deepEqual(paraPagina(undefined, 'catalogo'), [])
  assert.deepEqual(paraPagina('nope', 'catalogo'), [])
})
