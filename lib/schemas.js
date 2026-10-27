// What a valid file looks like, per folder. The factory validates every file an agent writes
// against these schemas, and the build refuses to publish anything that does not match.

export const COLORS = ['amarillo', 'verde', 'azul', 'rosa', 'naranja']
export const CAMPAIGN_COLORS = ['oliva', 'limon', 'tierra', 'blanco']

const SLUG = /^[a-z0-9][a-z0-9-]{0,63}\.json$/
const UNSAFE = /[<>]|:\/\/|www\./i

const text = (max, { required = true } = {}) => ({ kind: 'text', max, required })
const number = ({ min = -Infinity, max = Infinity, integer = false } = {}) => ({ kind: 'number', min, max, integer, required: true })
const bool = () => ({ kind: 'bool', required: true })
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/

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
  {
    folder: 'config/',
    only: 'transporte.json',
    check: (value) => checkMap(value, (v) => (v && typeof v === 'object' && !Array.isArray(v) ? checkFields(v, { eurPorKg: number({ min: 0, max: 10 }), minimo: number({ min: 0, max: 5000 }) }) : 'must be an object')),
  },
  {
    folder: 'content/campanas/',
    fields: {
      titulo: text(60),
      texto: text(160),
      color: { kind: 'enum', values: CAMPAIGN_COLORS, required: true },
      emoji: text(8, { required: false }),
      cta: text(30, { required: false }),
    },
  },
  {
    folder: 'catalogo/productos/',
    fields: {
      nombre: text(40),
      categoria: { kind: 'enum', values: ['fruta', 'hortaliza'], required: true },
      origen: text(40),
      descripcion: text(160),
      emoji: text(8),
      disponible: bool(),
    },
  },
  {
    folder: 'catalogo/destinos/',
    fields: { pais: text(40), ciudad: text(40), diasTransito: number({ min: 1, max: 30, integer: true }) },
  },
  {
    folder: 'data/',
    only: 'precios.json',
    check: (value) => checkMap(value, (v) => checkValue(v, number({ min: 0, max: 100 })) ?? (v > 0 ? null : 'must be greater than 0')),
  },
  {
    folder: 'data/',
    only: 'descuentos.json',
    check: checkDiscounts,
  },
  { folder: 'data/', free: true },
]

// An `only` schema wins for its exact file; otherwise the first schema of the folder applies.
export function schemaFor(path) {
  const inFolder = SCHEMAS.filter((s) => path.startsWith(s.folder) && !path.slice(s.folder.length).includes('/'))
  const name = path.slice(path.lastIndexOf('/') + 1)
  return inFolder.find((s) => s.only === name) ?? inFolder.find((s) => !s.only || s.free) ?? inFolder[0]
}

export function validateFile(path, raw) {
  const schema = schemaFor(path)
  if (!schema) return fail(`${path}: no schema for this folder`)

  const name = path.slice(schema.folder.length)
  if (!SLUG.test(name)) return fail(`${path}: file name must be a lowercase slug ending in .json`)
  if (schema.only && !schema.free && name !== schema.only) return fail(`${path}: only ${schema.folder}${schema.only} is allowed`)

  let value
  try {
    value = JSON.parse(raw)
  } catch {
    return fail(`${path}: invalid JSON`)
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail(`${path}: must be a JSON object`)

  const errors = schema.check ? schema.check(value) : schema.free ? checkFree(value) : checkFields(value, schema.fields)
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

// An object keyed by an id (product or destination) whose values are checked one by one.
// `checkEntry` returns an error string, an array of errors or null.
function checkMap(value, checkEntry) {
  const errors = []
  const keys = Object.keys(value)
  if (keys.length === 0 || keys.length > 200) errors.push('must have between 1 and 200 entries')
  for (const key of keys) {
    if (!ID.test(key)) errors.push(`invalid id "${key}"`)
    const result = checkEntry(value[key])
    for (const error of [result ?? []].flat()) errors.push(`"${key}" ${error}`)
  }
  return errors
}

function checkDiscounts(value) {
  const errors = []
  for (const key of Object.keys(value)) if (key !== 'tramos') errors.push(`unknown field "${key}"`)
  const tramos = value.tramos
  if (!Array.isArray(tramos)) return [...errors, 'missing field "tramos" (a list)']
  if (tramos.length < 1 || tramos.length > 5) errors.push('"tramos" must have between 1 and 5 entries')
  const tier = { desdeKg: number({ min: 0, integer: true }), porcentaje: number({ min: 0, max: 50 }) }
  tramos.forEach((t, i) => {
    if (!t || typeof t !== 'object' || Array.isArray(t)) return errors.push(`"tramos[${i}]" must be an object`)
    for (const e of checkFields(t, tier)) errors.push(`"tramos[${i}]" ${e}`)
    if (i > 0 && typeof t.desdeKg === 'number' && t.desdeKg <= tramos[i - 1]?.desdeKg) errors.push(`"tramos[${i}]" desdeKg must be greater than the previous tier`)
  })
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
    if (v > rule.max) return `must be at most ${rule.max}`
    if (rule.integer && !Number.isInteger(v)) return 'must be an integer'
  }
  if (rule.kind === 'bool' && typeof v !== 'boolean') return 'must be true or false'
  if (rule.kind === 'enum' && !rule.values.includes(v)) return `must be one of ${rule.values.join(', ')}`
  return null
}

const fail = (error) => ({ ok: false, errors: [error] })
