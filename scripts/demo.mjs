#!/usr/bin/env node
// Runs the whole factory with one command: the checks, the model proxy, then the factory. Ctrl+C once: the factory stops
// taking tasks and lets the running ones finish; when it exits the proxy stops. Ctrl+C again: forwarded, so the factory
// kills its agents and returns their tasks to the queue, and then the proxy stops.
//
//   npm run demo -- [options of npm run fabrica, e.g. --origen web]
//
// The children run in their own process group (detached) so a Ctrl+C in the terminal reaches only this script, which
// decides what each child gets. Exit codes: the factory's · 1 a check failed or the proxy did not start · 130 stopped
// before the factory started.
import { spawn as realSpawn, spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import { join } from 'node:path'
import { comprobaciones, formatear, passed, runtimeDir } from '../lib/entorno.js'
import { proxyNode } from '../lib/fabrica.js'
import { depsReales } from './comprobar.mjs'

const root = join(import.meta.dirname, '..')
const PROXY_CONTAINER = 'limonia-proxy'
const POLL_MS = 500

export async function run(argv, deps) {
  const { out, err, signals, spawn, alive, sleep, stopProxy } = deps
  const dir = deps.root
  const runtime = runtimeDir({ env: deps.env, fs: deps.fs, uid: deps.uid, tmp: deps.tmp })
  if (!runtime.ok) {
    err(`demo: ${runtime.error}\n    → ${runtime.arreglo}`)
    return 1
  }
  const env = { ...deps.env, ...runtime.env }
  const checked = await deps.checks(env)
  for (const line of checked.lines) out(line)
  if (!checked.ok) {
    err('demo: no arranco: hay comprobaciones en rojo (✗). Corrígelas y vuelve a ejecutar `npm run demo`.')
    return 1
  }

  let interrupts = 0
  let factory = null
  let stopping = false
  let wake = () => {}
  const off = signals.on(() => {
    interrupts++
    if (factory) {
      factory.kill('SIGINT')
      out(interrupts === 1
        ? 'Ctrl+C: la fábrica deja de coger tareas y termina las que lleva. Otro Ctrl+C las cancela. Después se para el proxy.'
        : 'Ctrl+C otra vez: la fábrica cancela los agentes y devuelve las tareas a la cola…')
    } else out('Ctrl+C: paro antes de empezar.')
    wake()
  })

  const startedProxy = !(await alive())
  let proxy = null
  let proxyExit = null // { code, signal } once it has exited
  const shutdown = () => {
    if (!startedProxy) return
    stopping = true
    stopProxy()
    if (proxy && proxyExit === null) proxy.kill('SIGTERM')
  }

  try {
    if (startedProxy) {
      out('Arranco el proxy del modelo…')
      proxy = spawn(process.execPath, [join(dir, 'scripts/proxy-red.mjs'), 'up'], { cwd: dir, env, stdio: 'inherit', detached: true })
      proxy.on('error', (error) => { proxyExit = { code: null, signal: null, error } })
      proxy.on('exit', (code, signal) => { proxyExit = { code, signal }; wake() })
      let waited = 0
      const limit = deps.waitMs ?? 60_000
      while (!(await alive())) {
        if (proxyExit) {
          err(`demo: el proxy no ha arrancado (${proxyExit.error ? proxyExit.error.message : `salió con código ${proxyExit.code ?? proxyExit.signal}`}). Mira el mensaje de arriba: suele ser la credencial o Docker (\`npm run comprobar\`).`)
          return 1
        }
        if (interrupts > 0) return 130
        if (waited >= limit) {
          err(`demo: el proxy no responde tras ${Math.round(limit / 1000)} s. Mira \`docker logs ${PROXY_CONTAINER}\` y ejecuta \`npm run comprobar\`.`)
          return 1
        }
        await Promise.race([sleep(POLL_MS), new Promise((resolve) => { wake = resolve })])
        waited += POLL_MS
      }
      if (interrupts > 0) return 130
      out('Proxy listo.')
    } else out('El proxy ya estaba en marcha: lo uso y lo dejo en marcha al terminar.')

    const code = await new Promise((resolve) => {
      factory = spawn(process.execPath, [join(dir, 'scripts/fabrica.mjs'), ...argv], { cwd: dir, env, stdio: 'inherit', detached: true })
      factory.on('error', (error) => { err(`demo: no se pudo arrancar la fábrica: ${error.message}`); resolve(1) })
      factory.on('exit', (status, signal) => resolve(status ?? (signal ? 130 : 1)))
      if (proxy) {
        proxy.on('exit', () => {
          if (stopping) return
          err('demo: el proxy se ha parado. Paro la fábrica (SIGINT).')
          factory.kill('SIGINT')
        })
      }
    })
    return code
  } finally {
    off()
    shutdown()
  }
}

export function depsReal() {
  const exec = (cmd, args) => spawnSync(cmd, args, { stdio: 'ignore' })
  const sockets = (env) => join(env.XDG_RUNTIME_DIR, 'limonia', 'proxy-admin.sock')
  let env = process.env
  return {
    env: process.env,
    fs,
    uid: process.getuid(),
    root,
    checks: async (childEnv) => {
      env = childEnv
      const results = await comprobaciones(depsReales(runtimeDir({ env: childEnv, fs, uid: process.getuid() }), childEnv))
      return { ok: passed(results), lines: formatear(results) }
    },
    alive: () => proxyNode({ socket: sockets(env) }).alive(),
    spawn: realSpawn,
    stopProxy: () => exec('docker', ['stop', PROXY_CONTAINER]),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    signals: {
      on(fn) {
        process.on('SIGINT', fn)
        process.on('SIGTERM', fn)
        return () => { process.off('SIGINT', fn); process.off('SIGTERM', fn) }
      },
    },
    out: console.log,
    err: console.error,
  }
}

if (import.meta.main) {
  const code = await run(process.argv.slice(2), depsReal())
  process.exit(code)
}
