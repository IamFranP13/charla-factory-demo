import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { debounced } from '../lib/entorno.js'

const source = readFileSync(join(import.meta.dirname, '../scripts/fabrica.mjs'), 'utf8')

test('fabrica.mjs counts a SIGINT that arrives twice at once as one Ctrl+C, and a later one as the second', () => {
  // The same wiring as the script: interrupt() escalates on each call it receives.
  let t = 0
  let interrupts = 0
  const handler = debounced(() => { interrupts++ }, { now: () => t })
  handler(); t += 20; handler()
  assert.equal(interrupts, 1)
  t += 1500; handler()
  assert.equal(interrupts, 2)
  assert.match(source, /process\.on\('SIGINT', debounced\(/)
})

test('fabrica.mjs treats SIGTERM and SIGHUP as an abort (the second Ctrl+C): kill agents, release claims', () => {
  assert.match(source, /process\.on\('SIGTERM'/)
  assert.match(source, /process\.on\('SIGHUP'/)
  assert.match(source, /fabrica\.interrupt\(\)\s*\n?\s*fabrica\.interrupt\(\)|abort/)
})
