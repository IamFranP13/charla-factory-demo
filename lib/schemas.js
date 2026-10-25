// What a valid file looks like, per folder. The factory validates every file an agent writes
// against these schemas, and the build refuses to publish anything that does not match.

export const COLORS = ['amarillo', 'verde', 'azul', 'rosa', 'naranja']

const SLUG = /^[a-z0-9][a-z0-9-]{0,63}\.json$/
const UNSAFE = /[<>]|:\/\/|www\./i

const text = (max, { required = true } = {}) => ({ kind: 'text', max, required })
const number = ({ min = -Infinity, integer = false } = {}) => ({ kind: 'number', min, integer, required: true })

const SCHEMAS = [
  {
    folder: 'content/muro/',
    fields: {
      texto: text(140),
      autor: text(40, { required: false }),
      emoji: text(8, { required: false }),
      color: { kind: 'enum', values: COLORS, required: false },
    },
  },
  {
    folder: 'content/secciones/',
    fields: { titulo: text(60), cuerpo: text(600) },
  },
  {
    folder: 'config/',
    only: 'entradas.json',
    fields: { precio: number({ min: 0 }), aforo: number({ min: 0, integer: true }) },
  },
  { folder: 'data/', free: true },
]

export function schemaFor(path) {
  return SCHEMAS.find((s) => path.startsWith(s.folder) && !path.slice(s.folder.length).includes('/'))
}

export function validateFile(path, raw) {
  const schema = schemaFor(path)
  if (!schema) return fail(`${path}: no schema for this folder`)

  const name = path.slice(schema.folder.length)
  if (!SLUG.test(name)) return fail(`${path}: file name must be a lowercase slug ending in .json`)
  if (schema.only && name !== schema.only) return fail(`${path}: only ${schema.folder}${schema.only} is allowed`)

  let value
  try {
    value = JSON.parse(raw)
  } catch {
    return fail(`${path}: invalid JSON`)
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail(`${path}: must be a JSON object`)

  const errors = schema.free ? checkFree(value) : checkFields(value, schema.fields)
  return { ok: errors.length === 0, errors: errors.map((e) => `${path}: ${e}`) }
}

function checkFields(value, fields) {
  const errors = []
  for (const key of Object.keys(value)) {
    if (!(key in fields)) errors.push(`unknown field "${key}"`)
  }
  for (const [key, rule] of Object.entries(fields)) {
    if (!(key in value)) {
      if (rule.required) errors.push(`missing field "${key}"`)
      continue
    }
    const error = checkValue(value[key], rule)
    if (error) errors.push(`"${key}" ${error}`)
  }
  return errors
}

// data/ holds simple key/value figures: short text or numbers, nothing nested.
function checkFree(value) {
  const errors = []
  const keys = Object.keys(value)
  if (keys.length === 0 || keys.length > 20) errors.push('must have between 1 and 20 fields')
  for (const key of keys) {
    if (!/^[a-z][a-z0-9_]{0,29}$/.test(key)) errors.push(`invalid field name "${key}"`)
    const v = value[key]
    const error = typeof v === 'number' ? checkValue(v, number()) : checkValue(v, text(120))
    if (error) errors.push(`"${key}" ${error}`)
  }
  return errors
}

function checkValue(v, rule) {
  if (rule.kind === 'text') {
    if (typeof v !== 'string') return 'must be text'
    if (v.trim().length === 0) return 'must not be empty'
    if ([...v].length > rule.max) return `must be at most ${rule.max} characters`
    if (UNSAFE.test(v)) return 'must be plain text (no HTML, no links)'
  }
  if (rule.kind === 'number') {
    if (typeof v !== 'number' || !Number.isFinite(v)) return 'must be a number'
    if (v < rule.min) return `must be at least ${rule.min}`
    if (rule.integer && !Number.isInteger(v)) return 'must be an integer'
  }
  if (rule.kind === 'enum' && !rule.values.includes(v)) return `must be one of ${rule.values.join(', ')}`
  return null
}

const fail = (error) => ({ ok: false, errors: [error] })
