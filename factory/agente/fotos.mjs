// Runs inside the screenshots container (no network), from the platform's code on main mounted at /opt/limonia:
// the site before the change (the base commit of the clone) against the site with the candidate files, as PNGs in /salida.
// stdin: { "base": "<sha>", "files": ["src/styles/global.css", ...] } (the changed files of the estilo surface).
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderSite } from './lib/render.js'

const input = JSON.parse(readFileSync(0, 'utf8'))
if (!/^[0-9a-f]{40}$/.test(input.base) || !Array.isArray(input.files) || input.files.length > 10) throw new Error('entrada no válida')
const paths = input.files.map((p) => {
  if (typeof p !== 'string' || !/^[\w./-]{1,200}$/.test(p) || p.split('/').includes('..') || p.startsWith('/')) throw new Error('ruta no válida')
  return p
})

// The base commit as a plain tree, with the dependencies linked.
const scratch = mkdtempSync(join(tmpdir(), 'fotos-'))
const base = join(scratch, 'base')
mkdirSync(base)
execFileSync('sh', ['-c', 'git -C /work archive "$0" | tar -x -C "$1"', input.base, base], { stdio: ['ignore', 'inherit', 'inherit'] })
symlinkSync('/opt/limonia/node_modules', join(base, 'node_modules'), 'dir')

// Chromium needs --no-sandbox without capabilities; this container has no network and renders only the site it just built.
const browser = join(scratch, 'chromium')
writeFileSync(browser, '#!/bin/sh\nexec chromium --no-sandbox "$@"\n')
chmodSync(browser, 0o755)

const files = paths.map((path) => ({ path, content: readFileSync(join('/work', path), 'utf8') }))
const shots = await renderSite(base, files, { browser })
for (const shot of shots) writeFileSync(join('/salida', `${shot.id}.png`), Buffer.from(shot.dataUrl.split(',')[1], 'base64'))
console.log(`${shots.length} capturas`)
