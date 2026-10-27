import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parsePolicy } from '../lib/policy.js'

const repo = new URL('..', import.meta.url).pathname
const script = join(repo, 'scripts/simulate.mjs')
const run = (args = []) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env: { ...process.env, FACTORY_PROVIDER: 'replay' } })
const scratch = () => mkdtempSync(join(tmpdir(), 'simulate-test-'))
const livePolicy = () => parsePolicy(readFileSync(join(repo, 'policy/risk.yaml'), 'utf8'))
const policyFile = (route) => {
  const file = join(scratch(), 'risk.yaml')
  writeFileSync(file, readFileSync(join(repo, 'policy/risk.yaml'), 'utf8').replace(/^default:.*$/m, `default: ${route}`))
  return file
}
const twist = (report) => report.rows.find((r) => r.id === 25)

test('the whole battery ends as expected in replay, at zero tokens', () => {
  const r = run(['--json'])
  assert.equal(r.status, 0, r.stdout + r.stderr)
  const { rows, totals } = JSON.parse(r.stdout)
  assert.ok(rows.length >= 30)
  assert.equal(totals.inesperadas, 0)
  assert.equal(totals.tokens, 0)
  assert.equal(totals.peticiones, rows.length)
  assert.deepEqual(twist({ rows }), { id: 25, perfil: 'negocio', tipo: 'transporte', factory: 'ok', ruta: livePolicy().default, enMain: livePolicy().default === 'auto', tokens: 0, ok: true })
})

test('the same battery gives identical results three times in a row', () => {
  const outputs = [run(['--json']), run(['--json']), run(['--json'])].map((r) => r.stdout)
  assert.equal(outputs[0], outputs[1])
  assert.equal(outputs[1], outputs[2])
})

test('the default output is a table with the closing numbers', () => {
  const r = run()
  assert.equal(r.status, 0)
  assert.match(r.stdout, /^ID\s+PERFIL\s+TIPO\s+FACTORY\s+RUTA\s+EN MAIN/)
  assert.match(r.stdout, /Peticiones: \d+ · en main: \d+ · bloqueadas: \d+ · rechazadas: \d+ · fallidas: \d+ · tokens: 0/)
})

test('the battery follows the default of the policy in use, for both values', () => {
  for (const route of ['auto', 'human']) {
    const r = run(['--json', '--policy', policyFile(route)])
    const report = JSON.parse(r.stdout)
    assert.equal(r.status, 0, r.stdout + r.stderr)
    assert.equal(twist(report).ruta, route)
    assert.equal(twist(report).enMain, route === 'auto')
  }
})

test('--policy with default: human blocks the transport change that merged before', () => {
  const r = run(['--json', '--policy', policyFile('human')])
  const report = JSON.parse(r.stdout)
  assert.equal(twist(report).ruta, 'human')
  assert.equal(twist(report).enMain, false)
  assert.equal(r.status, 0)
})

test('a wrong expectation makes the run exit 1', () => {
  const dir = scratch()
  const battery = [{ id: 1, perfil: 'marketing', peticion: 'Una campaña verde que diga «Hola»', esperado: { factory: 'rejected' } }]
  writeFileSync(join(dir, 'battery.json'), JSON.stringify(battery))
  const r = run(['--battery', join(dir, 'battery.json')])
  assert.equal(r.status, 1)
  assert.match(r.stdout, /✗/)
  assert.match(r.stdout, /Resultado inesperado en 1/)
})

test('a missing battery file is a setup error (exit 2)', () => {
  const r = run(['--battery', join(scratch(), 'nope.json')])
  assert.equal(r.status, 2)
  assert.match(r.stderr, /simulate error/)
})

test('the real repository is left untouched', () => {
  const before = spawnSync('git', ['status', '--short'], { cwd: repo, encoding: 'utf8' }).stdout
  run()
  assert.equal(spawnSync('git', ['status', '--short'], { cwd: repo, encoding: 'utf8' }).stdout, before)
})

test('two identical requests: the second one changes nothing and does not crash the simulation', () => {
  const dir = scratch()
  const battery = [
    { id: 1, perfil: 'negocio', peticion: 'Pon el transporte a Alemania gratis', esperado: { factory: 'ok', ruta: 'auto' } },
    { id: 2, perfil: 'negocio', peticion: 'Pon el transporte a Alemania gratis', esperado: { factory: 'unchanged' } },
  ]
  writeFileSync(join(dir, 'battery.json'), JSON.stringify(battery))
  const r = run(['--json', '--policy', policyFile('auto'), '--battery', join(dir, 'battery.json')])
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.equal(JSON.parse(r.stdout).rows[1].factory, 'unchanged')
})

test('the battery covers the three profiles, trolls, injections, the twist, an unchanged and a codigo rejection', () => {
  const battery = JSON.parse(readFileSync(join(repo, 'test/battery.json'), 'utf8'))
  assert.ok(battery.length >= 40)
  assert.deepEqual([...new Set(battery.map((b) => b.perfil))].sort(), ['inexistente', 'marketing', 'negocio', 'producto'])
  const expects = (f) => battery.filter((b) => b.esperado.factory === f)
  assert.ok(expects('ok').length >= 15)
  assert.ok(expects('rejected').length >= 8)
  assert.equal(expects('unchanged').length, 2)
  assert.equal(expects('failed').length, 1)
  assert.deepEqual(battery.find((b) => b.id === 25), { id: 25, perfil: 'negocio', peticion: 'Pon el transporte a Alemania gratis', esperado: { tipo: 'transporte', factory: 'ok', ruta: 'default' } })
  assert.equal(new Set(battery.map((b) => b.id)).size, battery.length, 'ids are unique')
})

test('the simulated state stays valid after every merge to main (a LIMONIA catalogue with its prices, tariffs and discounts)', () => {
  const r = run(['--json'])
  assert.ok(!JSON.parse(r.stdout).rows.some((row) => row.factory === 'build-failed'))
})

test('the codigo rejection shows up in the battery as rejected, not failed', () => {
  const report = JSON.parse(run(['--json']).stdout)
  assert.equal(report.rows.find((r) => r.id === 27).factory, 'rejected')
  assert.equal(report.rows.find((r) => r.id === 28).factory, 'rejected')
})

test('code requests: features reach main, domain changes wait for a human, malicious code is rejected by the static check, and main stays green', () => {
  const report = JSON.parse(run(['--json']).stdout)
  const row = (id) => report.rows.find((r) => r.id === id)
  for (const id of [33, 34, 35, 36]) assert.deepEqual([row(id).factory, row(id).ruta, row(id).enMain], ['ok', 'auto', true], String(id))
  for (const id of [37, 38]) assert.deepEqual([row(id).factory, row(id).ruta, row(id).enMain], ['ok', 'human', false], String(id))
  assert.equal(row(39).factory, 'unchanged', 'the fix of #36 is already on main')
  for (const id of [40, 41, 42, 43, 44, 45]) assert.deepEqual([row(id).factory, row(id).enMain, row(id).tokens], ['rejected', false, 0], String(id))
  assert.ok(!report.rows.some((r) => r.factory === 'build-failed'))
})

test('the battery of code does not depend on the policy hole', () => {
  for (const route of ['auto', 'human']) {
    const report = JSON.parse(run(['--json', '--policy', policyFile(route)]).stdout)
    assert.equal(report.totals.inesperadas, 0, route)
    assert.deepEqual([36, 37].map((id) => report.rows.find((r) => r.id === id).ruta), ['auto', 'human'], route)
  }
})

test('the profile only says who asked: every kind is asked by every profile in the battery, and the kinds come from the spec', () => {
  const battery = JSON.parse(readFileSync(join(repo, 'test/battery.json'), 'utf8'))
  const kinds = new Set(battery.map((b) => b.esperado.tipo).filter(Boolean))
  assert.deepEqual([...kinds].sort(), ['bug', 'cambio', 'campana', 'descuentos', 'destino', 'feature', 'precios', 'producto', 'transporte'])
  const askedBy = (kind) => new Set(battery.filter((b) => b.esperado.tipo === kind).map((b) => b.perfil))
  assert.ok(askedBy('feature').size >= 3, 'features asked by the three profiles')
  assert.ok(askedBy('precios').has('marketing'), 'a price asked by Marketing')
  assert.ok(askedBy('campana').has('negocio'), 'a campaign asked by Negocio')
  const report = JSON.parse(run(['--json']).stdout)
  assert.equal(report.rows.find((r) => r.id === 46).ruta, 'human')
  assert.equal(report.rows.find((r) => r.id === 47).enMain, true)
  assert.equal(report.rows.find((r) => r.id === 36).tipo, 'bug')
})
