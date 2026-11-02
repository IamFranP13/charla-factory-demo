// The checks of `npm run comprobar` and the runtime directory of `npm run demo`. Pure: everything that touches the outside
// (commands, files, environment, the proxy) is injected, so the tests need no Docker, no gh and no WSL.
//
// deps: { env, fs, exec(cmd, args, { cwd }) -> { status, stdout }, root, uid, home, nodeVersion, proxyAlive(), runtime?, tmp? }
// `fs` is the node:fs surface used here: statSync, lstatSync, readFileSync, mkdirSync, chmodSync, accessSync.
import { join } from 'node:path'

export const IMAGE = 'limonia-agente:dev'
export const NETWORK = 'limonia-agentes'

const MNT_WINDOWS = /^\/mnt\/[a-z](\/|$)/i
const CREDENTIAL_KIND = /^sk-ant-(oat|api)/

// The directory the proxy admin socket lives in (`<dir>/limonia/proxy-admin.sock`, in the proxy script and in the factory).
// The proxy script falls back to /tmp and the factory to /tmp/limonia-<uid> when XDG_RUNTIME_DIR is unset, so they would
// disagree: this picks one directory and the caller passes it to both as XDG_RUNTIME_DIR.
// A WSL without systemd leaves it unset (or points it at a directory that does not exist).
export function runtimeDir({ env, fs, uid, tmp = '/tmp' }) {
  const set = env.XDG_RUNTIME_DIR
  if (set) {
    try {
      const st = fs.statSync(set)
      if (st.isDirectory() && st.uid === uid && (st.mode & 0o022) === 0) {
        fs.accessSync(set, 7) // R_OK | W_OK | X_OK
        return { ok: true, dir: set, fallback: false, env: { XDG_RUNTIME_DIR: set } }
      }
    } catch { /* unusable: use the fallback */ }
  }
  const dir = join(tmp, `limonia-${uid}`)
  const why = set ? `XDG_RUNTIME_DIR (${set}) no es un directorio tuyo y escribible` : 'XDG_RUNTIME_DIR no está definida'
  let st = null
  try { st = fs.lstatSync(dir) } catch { /* does not exist yet */ }
  if (st === null) {
    try {
      fs.mkdirSync(dir, { mode: 0o700 })
      fs.chmodSync(dir, 0o700)
    } catch (error) {
      return { ok: false, dir, error: `no se puede crear ${dir}: ${error.message}`, arreglo: `Crea tú el directorio con: mkdir -m 700 ${dir}` }
    }
  } else if (!st.isDirectory() || st.isSymbolicLink() || st.uid !== uid || (st.mode & 0o777) !== 0o700) {
    return {
      ok: false,
      dir,
      error: `${dir} ya existe y no es un directorio tuyo con permisos 700 (${why})`,
      arreglo: `Revisa quién lo creó (ls -ld ${dir}); si es tuyo y sobra, bórralo y vuelve a ejecutar`,
    }
  }
  return { ok: true, dir, fallback: true, why, env: { XDG_RUNTIME_DIR: dir } }
}

const check = (id, required, ok, mensaje, arreglo = null) => ({ id, required, ok, mensaje, arreglo })

function nodeCheck({ fs, root, nodeVersion }) {
  let expected = ''
  try { expected = fs.readFileSync(join(root, '.node-version'), 'utf8').trim() } catch { /* reported below */ }
  const actual = String(nodeVersion).replace(/^v/, '')
  const ok = expected !== '' && (actual === expected || actual.startsWith(`${expected}.`))
  if (ok) return check('node', true, true, `Node ${actual} (el del proyecto: ${expected})`)
  return check('node', true, false, `Node ${actual}, pero el proyecto usa ${expected || '(no se puede leer .node-version)'}`,
    `Instala Node ${expected || '26'} (por ejemplo con nvm: nvm install ${expected || '26'} && nvm use ${expected || '26'}) y vuelve a ejecutar`)
}

function wslCheck({ env, fs }) {
  let version = ''
  try { version = fs.readFileSync('/proc/version', 'utf8') } catch { /* not Linux */ }
  const inWsl = Boolean(env.WSL_DISTRO_NAME) || /microsoft/i.test(version)
  return inWsl
    ? check('wsl', false, true, `Dentro de WSL${env.WSL_DISTRO_NAME ? ` (${env.WSL_DISTRO_NAME})` : ''}`)
    : check('wsl', false, false, 'No es WSL (informativo: en Linux nativo también funciona)')
}

function repoCheck({ root }) {
  if (MNT_WINDOWS.test(root)) {
    return check('repo', true, false, `El repositorio está en el disco de Windows (${root})`,
      'Clónalo dentro de la carpeta de WSL (cd ~ && git clone …): en /mnt/c fallan los permisos 600 y los montajes de Docker')
  }
  return check('repo', true, true, `Repositorio fuera de /mnt/c (${root})`)
}

function dockerChecks({ exec, root }) {
  const run = (args) => exec('docker', args, { cwd: root })
  const version = run(['version', '--format', '{{.Server.Version}}'])
  const dockerOk = version.status === 0 && String(version.stdout).trim() !== ''
  const out = [dockerOk
    ? check('docker', true, true, `Docker responde (versión ${String(version.stdout).trim()})`)
    : check('docker', true, false, 'Docker no responde',
      'Abre Docker Desktop y activa Settings → Resources → WSL integration para tu Ubuntu; luego prueba: docker version')]
  const image = dockerOk && run(['image', 'inspect', IMAGE]).status === 0
  out.push(image
    ? check('imagen', true, true, `Imagen ${IMAGE} construida`)
    : check('imagen', true, false, `Falta la imagen ${IMAGE}${dockerOk ? '' : ' (Docker no responde)'}`, 'Constrúyela con: npm run agente:imagen'))
  const network = dockerOk && run(['network', 'inspect', NETWORK]).status === 0
  out.push(network
    ? check('red', true, true, `Red ${NETWORK} creada`)
    : check('red', true, false, `Falta la red ${NETWORK}${dockerOk ? '' : ' (Docker no responde)'}`, 'Créala con: npm run proxy:red'))
  return out
}

// Never returns or prints the token: only whether it looks right.
function credentialCheck({ env, fs, home }) {
  const path = env.LIMONIA_CREDENCIAL || join(home, '.config/limonia/claude-credencial')
  const bad = (mensaje, arreglo) => check('credencial', true, false, mensaje, arreglo)
  const regenerate = 'Genera el token con `claude setup-token` (dentro de la imagen: docker run --rm -it limonia-agente:dev claude setup-token) o ejecuta scripts/instalar-wsl.sh'
  let st
  try { st = fs.statSync(path) } catch { return bad(`No existe el fichero de credencial (${path})`, regenerate) }
  if (!st.isFile()) return bad(`La credencial (${path}) no es un fichero normal`, regenerate)
  const mode = st.mode & 0o777
  if (mode !== 0o600 && mode !== 0o400) {
    return bad(`La credencial (${path}) tiene permisos ${mode.toString(8)}; debe ser 600`, `Ejecuta: chmod 600 ${path}`)
  }
  let text
  try { text = fs.readFileSync(path, 'utf8') } catch { return bad(`No se puede leer la credencial (${path})`, `Ejecuta: chmod 600 ${path}`) }
  const value = text.replace(/\r?\n$/, '')
  if (value === '' || /[\r\n]/.test(value) || /\s/.test(value)) {
    return bad(`La credencial (${path}) debe ser una sola línea, sin espacios`, `Vuelve a pegar el token: ${regenerate}`)
  }
  if (!CREDENTIAL_KIND.test(value)) {
    return bad(`La credencial (${path}) no empieza por sk-ant-oat… ni sk-ant-api…`, `Vuelve a pegar el token: ${regenerate}`)
  }
  return check('credencial', true, true, `Credencial correcta (${path}, modo ${mode.toString(8)}, tipo ${value.startsWith('sk-ant-oat') ? 'oat' : 'api'})`)
}

function githubCheck({ exec, root }) {
  const gh = (args) => exec('gh', args, { cwd: root })
  const fix = 'Instala gh (https://cli.github.com) y ejecuta: gh auth login'
  if (gh(['auth', 'status']).status !== 0) return check('gh', true, false, 'gh no tiene la sesión iniciada', fix)
  const login = String(gh(['api', 'user', '-q', '.login']).stdout ?? '').trim()
  const repo = gh(['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'])
  const owner = String(repo.stdout ?? '').trim().split('/')[0]
  if (login === '') return check('gh', true, false, 'gh no dice quién eres (¿sesión caducada?)', fix)
  if (repo.status !== 0 || owner === '') {
    return check('gh', true, false, 'gh no encuentra el repositorio de este directorio', 'Ejecuta dentro del clon del repositorio (git remote -v debe apuntar a GitHub)')
  }
  if (login !== owner) {
    return check('gh', true, false, `gh está como ${login}, pero el repositorio es de ${owner}`, `Ejecuta: gh auth login (entra como ${owner}) o gh auth switch`)
  }
  return check('gh', true, true, `gh como ${login}, dueño del repositorio`)
}

function runtimeCheck(runtime) {
  if (!runtime.ok) return check('runtime', true, false, runtime.error, runtime.arreglo)
  const how = runtime.fallback ? `${runtime.dir} (${runtime.why}; se usa este directorio)` : runtime.dir
  return check('runtime', true, true, `Directorio del socket del proxy: ${how}`)
}

// All checks in the order they are shown. Never throws.
export async function comprobaciones(deps) {
  const runtime = deps.runtime ?? runtimeDir({ env: deps.env, fs: deps.fs, uid: deps.uid, tmp: deps.tmp })
  const alive = await Promise.resolve(deps.proxyAlive()).then(Boolean, () => false)
  return [
    nodeCheck(deps),
    wslCheck(deps),
    repoCheck(deps),
    ...dockerChecks(deps),
    credentialCheck(deps),
    githubCheck(deps),
    runtimeCheck(runtime),
    alive
      ? check('proxy', false, true, 'El proxy está en marcha')
      : check('proxy', false, false, 'El proxy no está en marcha (informativo: `npm run demo` lo arranca)'),
  ]
}

export const passed = (results) => results.every((r) => r.ok || !r.required)

// One line per check; the fix (when failing) on the next one.
export function formatear(results) {
  const lines = []
  for (const r of results) {
    lines.push(`${r.ok ? '✓' : r.required ? '✗' : '–'} ${r.mensaje}`)
    if (!r.ok && r.arreglo) lines.push(`    → ${r.arreglo}`)
  }
  return lines
}
