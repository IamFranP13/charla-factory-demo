#!/usr/bin/env node
// Usage: node scripts/build.mjs   (TURNSTILE_SITE_KEY is read from the environment, optional)
import { buildSite } from '../lib/build.js'

const root = new URL('..', import.meta.url).pathname
const result = buildSite(root, { turnstileSiteKey: process.env.TURNSTILE_SITE_KEY ?? '' })

if (!result.ok) {
  console.error('Build failed:\n' + result.errors.map((e) => `  - ${e}`).join('\n'))
  process.exit(1)
}
console.log(`Built dist/: ${result.cards} cards, ${result.sections} sections`)
