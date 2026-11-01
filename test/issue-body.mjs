// Reads back the request the intake writes in an issue body: one line of JSON inside a ```json block.
import { MAX_LENGTH } from '../lib/intake.js'

export function parseIssueBody(body) {
  const match = String(body ?? '').match(/```json\n(.*)\n```/)
  if (!match) return null
  try {
    const { perfil, peticion } = JSON.parse(match[1])
    if (typeof perfil !== 'string' || typeof peticion !== 'string' || !peticion.trim() || Array.from(peticion).length > MAX_LENGTH) return null
    return { profile: perfil, request: peticion }
  } catch {
    return null
  }
}
