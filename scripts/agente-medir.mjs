// Measures the start-up of the agent container: N bare starts, and one start that checks the tools and builds the site.
// Needs Docker and the image (npm run agente:imagen); needs no credential.
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const IMAGE = 'limonia-agente:dev'
const N = 5
const root = join(import.meta.dirname, '..')

const seconds = (args, opts = {}) => {
  const t0 = process.hrtime.bigint()
  const r = spawnSync('docker', args, { encoding: 'utf8', ...opts })
  const s = Number(process.hrtime.bigint() - t0) / 1e9
  if (r.status !== 0) throw new Error(`docker ${args.join(' ')} failed:\n${r.stdout}${r.stderr}`)
  return { s, out: r.stdout.trim() }
}
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
const report = (label, xs) => console.log(`${label.padEnd(34)} median ${median(xs).toFixed(2)} s   max ${Math.max(...xs).toFixed(2)} s   (n=${xs.length})`)

const dir = realpathSync(mkdtempSync(join(tmpdir(), 'agente-medir-')))
try {
  const bare = Array.from({ length: N }, () => seconds(['run', '--rm', IMAGE, 'true']).s)
  report('start (docker run … true)', bare)

  // A throwaway copy of the committed tree, without .git
  execFileSync('sh', ['-c', 'git archive HEAD | tar -x -C "$1"', 'sh', dir], { cwd: root })
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim() // the copy has no .git
  const mount = ['run', '--rm', '-e', `CF_PAGES_COMMIT_SHA=${sha}`, '-v', `${dir}:/work`, '--user', `${process.getuid()}:${process.getgid()}`, IMAGE]
  for (const cmd of [['claude', '--version'], ['node', '--version']]) {
    const r = seconds([...mount, ...cmd])
    console.log(`${cmd.join(' ').padEnd(34)} ${r.s.toFixed(2)} s   ${r.out}`)
  }
  const build = seconds([...mount, 'npm', 'run', 'build'])
  console.log(`${'npm run build (linked deps)'.padEnd(34)} ${build.s.toFixed(2)} s`)
  console.log('For comparison: Actions took about 22 s just to start.')
} finally {
  // The build may leave files owned by the container user; the mount used our uid, so this is plain.
  rmSync(dir, { recursive: true, force: true })
}
