// The factory App's identity, minted on the maintainer's PC: a JWT signed with the App's private key (RS256, node:crypto,
// no dependency) is exchanged for an installation token limited to this repository. Nothing here logs or returns the key.

import { createSign } from 'node:crypto'

const API = 'https://api.github.com'
const LEVELS = { read: 1, write: 2, admin: 3 }

// What the runner needs to push a branch, open the pull request and write the task state.
export const REQUIRED_PERMISSIONS = { contents: 'write', pull_requests: 'write', issues: 'write' }

const base64url = (value) => Buffer.from(value).toString('base64url')

export function signJwt({ appId, privateKey, now = Date.now() }) {
  const seconds = Math.floor(now / 1000)
  // Issued a minute in the past (clock drift), valid well under the 10 minutes GitHub allows.
  const unsigned = `${base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${base64url(JSON.stringify({ iat: seconds - 60, exp: seconds + 480, iss: String(appId) }))}`
  try {
    return `${unsigned}.${createSign('RSA-SHA256').update(unsigned).sign(privateKey).toString('base64url')}`
  } catch {
    // The underlying error can quote parts of the key: say only what is wrong.
    throw new Error('la clave privada de la App no es válida (se espera un PEM RSA)')
  }
}

/** The entries of `needed` that `granted` does not reach, as "permission: level". */
export function missingPermissions(granted, needed) {
  return Object.entries(needed)
    .filter(([name, level]) => (LEVELS[granted?.[name]] ?? 0) < LEVELS[level])
    .map(([name, level]) => `${name}: ${level}`)
}

const headersFor = (jwt) => ({ Authorization: `Bearer ${jwt}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'charla-factory-runner' })

/** Fails closed unless the installation on `repo` grants `needs`. Mints no token: it only reads the installation. */
export async function checkInstallation({ appId, privateKey, repo, needs = REQUIRED_PERMISSIONS, fetch = globalThis.fetch, now = Date.now() }) {
  const [owner, name, ...rest] = String(repo).split('/')
  if (!owner || !name || rest.length) throw new Error(`el repositorio debe ser owner/repo (recibido: ${repo})`)
  const installation = await fetch(`${API}/repos/${owner}/${name}/installation`, { headers: headersFor(signJwt({ appId, privateKey, now })) })
  if (!installation.ok) throw new Error(`GitHub no encuentra la App instalada en ${repo} (HTTP ${installation.status})`)
  const missing = missingPermissions((await installation.json()).permissions, needs)
  if (missing.length) throw new Error(`la instalación de la App no concede los permisos necesarios: falta ${missing.join(', ')}`)
}

/**
 * An installation token for `repo` ("owner/name").
 * `permissions` asks for a narrower token than the installation has; `needs` (default: `permissions`) is checked
 * against what GitHub says it granted, and the call fails closed when anything is missing.
 * @returns {Promise<{token: string, expiresAt: string, permissions: object}>}
 */
export async function mintInstallationToken({ appId, privateKey, repo, permissions, needs = permissions, fetch = globalThis.fetch, now = Date.now() }) {
  const [owner, name, ...rest] = String(repo).split('/')
  if (!owner || !name || rest.length) throw new Error(`el repositorio debe ser owner/repo (recibido: ${repo})`)
  const jwt = signJwt({ appId, privateKey, now })
  const headers = headersFor(jwt)

  const installation = await fetch(`${API}/repos/${owner}/${name}/installation`, { headers })
  if (!installation.ok) throw new Error(`GitHub no encuentra la App instalada en ${repo} (HTTP ${installation.status})`)
  const { id } = await installation.json()

  const body = { repositories: [name], ...(permissions && { permissions }) }
  const response = await fetch(`${API}/app/installations/${id}/access_tokens`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!response.ok) throw new Error(`GitHub no ha dado el token de la App (HTTP ${response.status})`)
  const granted = await response.json()

  const missing = needs ? missingPermissions(granted.permissions, needs) : []
  if (missing.length) throw new Error(`la instalación de la App no concede los permisos necesarios: falta ${missing.join(', ')}`)
  if (typeof granted.token !== 'string' || !granted.token) throw new Error('GitHub no ha devuelto ningún token')
  return { token: granted.token, expiresAt: granted.expires_at, permissions: granted.permissions }
}
