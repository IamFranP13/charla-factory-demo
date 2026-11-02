#!/usr/bin/env node
// Checks that this PC can run the factory (Linux or WSL2 with Docker): one line per check, ✓ or ✗ with the fix.
// The logic lives in lib/entorno.js; this only wires the real commands and files.
//
//   npm run comprobar
//
// Exit codes: 0 every required check passes · 1 one does not.
import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { comprobaciones, formatear, passed, runtimeDir } from '../lib/entorno.js'
import { proxyNode } from '../lib/fabrica.js'

const root = join(import.meta.dirname, '..')

export function exec(cmd, args, { cwd } = {}) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: 20_000 })
  return { status: r.status ?? 127, stdout: r.stdout ?? '' }
}

// The real dependencies of the checks. `runtime` is the runtime directory already chosen (see lib/entorno.js).
export function depsReales(runtime, env = process.env) {
  const socket = join(runtime.dir ?? '/tmp', 'limonia', 'proxy-admin.sock')
  return {
    env, fs, exec, root, runtime,
    uid: process.getuid(), home: homedir(), nodeVersion: process.version,
    proxyAlive: () => proxyNode({ socket }).alive(),
  }
}

export async function run({ env = process.env, deps = depsReales, out = console.log, tmp } = {}) {
  const runtime = runtimeDir({ env, fs, uid: process.getuid(), tmp })
  if (runtime.ok) env.XDG_RUNTIME_DIR = runtime.dir
  const results = await comprobaciones(deps(runtime, env))
  for (const line of formatear(results)) out(line)
  const ok = passed(results)
  out(ok ? '\nTodo listo: puedes ejecutar `npm run demo`.' : '\nHay comprobaciones en rojo (✗): corrígelas y vuelve a ejecutar `npm run comprobar`.')
  return ok ? 0 : 1
}

if (import.meta.main) process.exit(await run())
