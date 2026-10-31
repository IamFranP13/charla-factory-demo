import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, createVerify } from 'node:crypto'
import { signJwt, mintInstallationToken, missingPermissions, REQUIRED_PERMISSIONS } from '../lib/app-token.js'

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' })
const b64 = (s) => Buffer.from(s, 'base64url').toString()

// A fake GitHub: records requests and answers the two calls the minting needs.
function fakeGithub({ permissions = { contents: 'write', pull_requests: 'write', issues: 'write', metadata: 'read' }, installation = { status: 200, body: { id: 77 } } } = {}) {
  const calls = []
  const fetch = async (url, init = {}) => {
    calls.push({ url, init })
    const json = (status, body) => ({ ok: status < 300, status, json: async () => body })
    if (url.endsWith('/installation')) return json(installation.status, installation.body)
    return json(201, { token: 'ghs_secret_token', expires_at: '2030-01-01T00:00:00Z', permissions })
  }
  return { calls, fetch }
}

test('the JWT is RS256, signed with the App key, issued by the App id and short-lived', () => {
  const jwt = signJwt({ appId: '123', privateKey: pem, now: 1_700_000_000_000 })
  const [header, payload, signature] = jwt.split('.')
  assert.deepEqual(JSON.parse(b64(header)), { alg: 'RS256', typ: 'JWT' })
  const claims = JSON.parse(b64(payload))
  assert.equal(claims.iss, '123')
  assert.ok(claims.exp - claims.iat <= 600, 'GitHub rejects a JWT valid for more than 10 minutes')
  assert.ok(claims.iat <= 1_700_000_000, 'issued in the past to tolerate clock drift')
  const verify = createVerify('RSA-SHA256').update(`${header}.${payload}`)
  assert.ok(verify.verify(publicKey, Buffer.from(signature, 'base64url')))
})

test('mints an installation token for this repository only and returns what was granted', async () => {
  const gh = fakeGithub()
  const out = await mintInstallationToken({ appId: '1', privateKey: pem, repo: 'o/r', needs: REQUIRED_PERMISSIONS, fetch: gh.fetch })
  assert.equal(out.token, 'ghs_secret_token')
  assert.equal(out.permissions.contents, 'write')
  assert.match(gh.calls[0].url, /\/repos\/o\/r\/installation$/)
  assert.match(gh.calls[0].init.headers.Authorization, /^Bearer ey/)
  assert.match(gh.calls[1].url, /\/app\/installations\/77\/access_tokens$/)
  assert.deepEqual(JSON.parse(gh.calls[1].init.body).repositories, ['r'])
})

test('a narrower token can be requested and its permissions are sent', async () => {
  const gh = fakeGithub({ permissions: { issues: 'write', contents: 'read', metadata: 'read' } })
  const wanted = { issues: 'write', contents: 'read' }
  await mintInstallationToken({ appId: '1', privateKey: pem, repo: 'o/r', permissions: wanted, fetch: gh.fetch })
  assert.deepEqual(JSON.parse(gh.calls[1].init.body).permissions, wanted)
})

test('fails closed when the installation does not grant what is needed, without leaking the token', async () => {
  const gh = fakeGithub({ permissions: { contents: 'write', pull_requests: 'read', metadata: 'read' } })
  await assert.rejects(
    mintInstallationToken({ appId: '1', privateKey: pem, repo: 'o/r', needs: REQUIRED_PERMISSIONS, fetch: gh.fetch }),
    (error) => /pull_requests/.test(error.message) && /issues/.test(error.message) && !error.message.includes('ghs_secret_token'),
  )
})

test('fails closed when the App is not installed or GitHub refuses', async () => {
  const gh = fakeGithub({ installation: { status: 404, body: { message: 'Not Found' } } })
  await assert.rejects(mintInstallationToken({ appId: '1', privateKey: pem, repo: 'o/r', fetch: gh.fetch }), /404/)
  await assert.rejects(mintInstallationToken({ appId: '1', privateKey: 'not a key', repo: 'o/r', fetch: gh.fetch }), (e) => !e.message.includes('not a key'))
  await assert.rejects(mintInstallationToken({ appId: '1', privateKey: pem, repo: 'bad', fetch: gh.fetch }), /owner\/repo/)
})

test('missingPermissions compares levels: read < write < admin, absent is missing', () => {
  assert.deepEqual(missingPermissions({ issues: 'admin', contents: 'write' }, { issues: 'write', contents: 'write' }), [])
  assert.deepEqual(missingPermissions({ issues: 'read' }, { issues: 'write', contents: 'read' }), ['issues: write', 'contents: read'])
})
