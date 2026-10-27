// Tests that run model code need a Node with the network switch of the permission model (see lib/sandbox.js: the
// sandbox refuses to run without it). On a Node without it they cannot run: the refusal itself is what
// test/sandbox.test.mjs checks (with `sandboxTest`, which asserts it instead of the behaviour).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { networkSwitchAvailable } from '../lib/sandbox.js'

export const hasSandbox = networkSwitchAvailable()
const REFUSAL = /interruptor de red|--allow-net/

/** A test that needs the sandbox: skipped, with the reason, on a Node that has no network switch. */
export function needsSandbox(name, options, fn) {
  if (typeof options === 'function') [options, fn] = [{}, options]
  return test(name, { ...options, skip: !hasSandbox && `Node ${process.version} has no --allow-net: the sandbox refuses to run (see sandbox.test.mjs)` }, fn)
}

/** A sandbox test whose body runs model code: on a Node with no network switch it must fail closed with the clear refusal. */
export function sandboxTest(name, options, fn) {
  if (typeof options === 'function') [options, fn] = [{}, options]
  if (hasSandbox) return test(name, options, fn)
  return test(`${name} [Node without --allow-net: refuses]`, { ...options, timeout: 20000 }, async () => {
    await assert.rejects(async () => fn(), REFUSAL)
  })
}

/**
 * Checks a rule of the calculator without importing the domain in the test process (a pull request can change it, and
 * CI has secrets in reach): `body` runs as a test INSIDE the sandbox, with `presupuestar`, `estado` and `assert` in scope,
 * laid over `root` as a test file of its own. Resolves to the runSuite result; the output says what failed.
 */
export async function probeDomain(root, body) {
  const { runSuite } = await import('../lib/sandbox.js')
  const content = `import { test } from 'node:test'
import assert from 'node:assert/strict'
import { presupuestar } from './presupuesto.js'
import { cargarEstado } from '../../__estado-node.js'
const estado = cargarEstado(new URL('../../', import.meta.url).pathname)
test('sonda del dominio', async () => {
${body}
})
`
  return runSuite(root, [{ path: 'src/domain/tarea-0-sonda.test.mjs', content }])
}
