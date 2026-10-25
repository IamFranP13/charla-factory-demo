import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const repo = new URL('..', import.meta.url).pathname
const script = join(repo, 'scripts/simulate.mjs')
const run = (args = []) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env: { ...process.env, FACTORY_PROVIDER: 'replay' } })
const scratch = () => mkdtempSync(join(tmpdir(), 'simulate-test-'))
const price = (report) => report.rows.find((r) => r.id === 26)

test('the whole battery ends as expected in replay, at zero tokens', () => {
  const r = run(['--json'])
  assert.equal(r.status, 0, r.stdout + r.stderr)
  const { rows, totals } = JSON.parse(r.stdout)
  assert.ok(rows.length >= 30)
  assert.equal(totals.inesperadas, 0)
  assert.equal(totals.tokens, 0)
  assert.equal(totals.peticiones, rows.length)
  assert.deepEqual(price({ rows }), { id: 26, perfil: 'negocio', factory: 'ok', ruta: 'auto', enMain: true, tokens: 0, ok: true })
})

test('the same battery gives identical results three times in a row', () => {
  const outputs = [run(['--json']), run(['--json']), run(['--json'])].map((r) => r.stdout)
  assert.equal(outputs[0], outputs[1])
  assert.equal(outputs[1], outputs[2])
})

test('the default output is a table with the closing numbers', () => {
  const r = run()
  assert.equal(r.status, 0)
  assert.match(r.stdout, /^ID\s+PERFIL\s+FACTORY\s+RUTA\s+EN MAIN/)
  assert.match(r.stdout, /Peticiones: \d+ · en main: \d+ · bloqueadas: \d+ · rechazadas: \d+ · fallidas: \d+ · tokens: 0/)
})

test('--policy with default: human blocks the price change that merged before', () => {
  const dir = scratch()
  const fixed = readFileSync(join(repo, 'policy/risk.yaml'), 'utf8').replace('default: auto', 'default: human')
  writeFileSync(join(dir, 'risk.yaml'), fixed)
  const r = run(['--json', '--policy', join(dir, 'risk.yaml')])
  const report = JSON.parse(r.stdout)
  assert.equal(price(report).ruta, 'human')
  assert.equal(price(report).enMain, false)
  // The battery expects the old behaviour for this case, so the run reports it.
  assert.equal(r.status, 1)
})

test('a wrong expectation makes the run exit 1', () => {
  const dir = scratch()
  const battery = [{ id: 1, perfil: 'marketing', peticion: 'Una tarjeta verde que diga «Hola»', esperado: { factory: 'rejected' } }]
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
