// Rehearsal copies of the repository for tests and simulations.
// The audience changes the live repository during a talk (new cards, a new price, new figures),
// so a copy starts from the platform plus a fixed seed state: it behaves the same before and after.

import { cpSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { isAudienceFile } from './factory.js'

const SEED = 'factory/seed'

export function rehearsalCopy(repo, root, entries) {
  for (const entry of entries) {
    cpSync(join(repo, entry), join(root, entry), { recursive: true, filter: (src) => !isAudienceFile(src) })
  }
  if (existsSync(join(repo, SEED))) cpSync(join(repo, SEED), root, { recursive: true })
}
