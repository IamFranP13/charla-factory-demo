// Model providers. Both answer the same question: given a station, return JSON text and token usage.
//   replay: a deterministic fake model. Zero cost, zero network: it rehearses the whole pipeline.
//   openai: any OpenAI-compatible chat completions API (DeepSeek, OpenRouter, ...).

const SUSPICIOUS = /\.env\b|secret|secreto|token|contraseña|password|api[ _-]?key|clave privada|ignora (tus|las|todas)|ignore (all|previous|your)|system prompt|\bborra|elimina todo|rm -rf/i
const OFFENSIVE = /\b(idiota|imb[eé]cil|gilipollas|mierda|subnormal|puta)\b/i
// Colours that do not exist in the LIMONIA brand (olive, lemon, earth, warm white).
const OFF_PALETTE = /\b(rosa|rojo|roja|azul|morado|morada|fucsia|negro|negra|gris|violeta)\b/
const CAMPAIGN_COLORS = [
  ['oliva', /\b(oliva|verde)\b/],
  ['limon', /\b(limon|amarill[oa])\b/],
  ['tierra', /\b(tierra|marron|terracota)\b/],
  ['blanco', /\b(blanc[oa])\b/],
]

// Fruit and vegetable words the replay model recognises: [display name, category, emoji, usual origin].
const PRODUCE = {
  mango: ['Mango', 'fruta', '🥭', 'Costa Tropical, Granada'],
  aguacate: ['Aguacate', 'fruta', '🥑', 'Costa Tropical, Granada'],
  fresa: ['Fresa', 'fruta', '🍓', 'Huelva'],
  sandia: ['Sandía', 'fruta', '🍉', 'Almería'],
  melon: ['Melón', 'fruta', '🍈', 'Murcia'],
  melocoton: ['Melocotón', 'fruta', '🍑', 'Cieza, Murcia'],
  albaricoque: ['Albaricoque', 'fruta', '🍑', 'Vega del Segura'],
  ciruela: ['Ciruela', 'fruta', '🍑', 'Extremadura'],
  pera: ['Pera', 'fruta', '🍐', 'Lleida'],
  manzana: ['Manzana', 'fruta', '🍎', 'Lleida'],
  kiwi: ['Kiwi', 'fruta', '🥝', 'Galicia'],
  cereza: ['Cereza', 'fruta', '🍒', 'Valle del Jerte'],
  platano: ['Plátano', 'fruta', '🍌', 'Canarias'],
  pomelo: ['Pomelo', 'fruta', '🍊', 'Vega del Segura'],
  granada: ['Granada', 'fruta', '🍎', 'Elche'],
  calabacin: ['Calabacín', 'hortaliza', '🥒', 'Almería'],
  pepino: ['Pepino', 'hortaliza', '🥒', 'Almería'],
  berenjena: ['Berenjena', 'hortaliza', '🍆', 'Almería'],
  cebolla: ['Cebolla', 'hortaliza', '🧅', 'Murcia'],
  zanahoria: ['Zanahoria', 'hortaliza', '🥕', 'Murcia'],
  esparrago: ['Espárrago', 'hortaliza', '🌱', 'Navarra'],
  coliflor: ['Coliflor', 'hortaliza', '🥦', 'Murcia'],
  apio: ['Apio', 'hortaliza', '🥬', 'Murcia'],
  acelga: ['Acelga', 'hortaliza', '🥬', 'Murcia'],
  puerro: ['Puerro', 'hortaliza', '🌱', 'Murcia'],
  patata: ['Patata', 'hortaliza', '🥔', 'Murcia'],
}

// Destination words: country → [display country, default city, transit days, other cities].
const COUNTRIES = {
  italia: ['Italia', 'Milán', 3, { milan: 'Milán', roma: 'Roma' }],
  portugal: ['Portugal', 'Lisboa', 2, { lisboa: 'Lisboa', oporto: 'Oporto' }],
  belgica: ['Bélgica', 'Amberes', 3, { amberes: 'Amberes', bruselas: 'Bruselas' }],
  dinamarca: ['Dinamarca', 'Copenhague', 4, { copenhague: 'Copenhague' }],
  austria: ['Austria', 'Viena', 4, { viena: 'Viena' }],
  irlanda: ['Irlanda', 'Dublín', 5, { dublin: 'Dublín' }],
  suiza: ['Suiza', 'Zúrich', 3, { zurich: 'Zúrich' }],
  noruega: ['Noruega', 'Oslo', 5, { oslo: 'Oslo' }],
  finlandia: ['Finlandia', 'Helsinki', 6, { helsinki: 'Helsinki' }],
  grecia: ['Grecia', 'Atenas', 6, { atenas: 'Atenas' }],
  hungria: ['Hungría', 'Budapest', 4, { budapest: 'Budapest' }],
}

export function replayProvider() {
  return {
    name: 'replay',
    async complete({ station, task }) {
      const answer = REPLAY[station]?.(task)
      if (!answer) throw new Error(`replay: no answer for station "${station}"`)
      return { text: JSON.stringify(answer), usage: { input: 0, output: 0 } }
    },
  }
}

const REPLAY = {
  // Refuses what a Spec writer is told to refuse: secrets, rule changes, destruction.
  spec: (t) => {
    if (SUSPICIOUS.test(t.task.request)) return { rechazar: true, motivo: 'la petición intenta manipular la factory (secretos, reglas o borrado)' }
    return { resumen: `${t.profile.label}: ${clean(t.task.request, 120)}`, criterios: ['cumple el formato del fichero', 'texto en español', 'respeta la marca y las decisiones del Brain'] }
  },

  build: (t) => {
    if (t.task.profile === 'marketing') return campaign(t)
    if (t.task.profile === 'producto') return productOrDestination(t)
    return business(t)
  },

  seguridad: (t) => {
    const text = `${t.task.request}\n${(t.files ?? []).map((f) => f.content).join('\n')}`
    if (SUSPICIOUS.test(text)) return { aprobado: false, motivo: 'intenta manipular la factory (secretos, reglas o borrado)' }
    if (OFFENSIVE.test(text)) return { aprobado: false, motivo: 'contenido ofensivo' }
    return { aprobado: true, motivo: 'contenido apto para el público' }
  },

  ux: (t) => {
    for (const file of t.files ?? []) {
      if (!file.path.startsWith('content/campanas/')) continue
      const { texto } = JSON.parse(file.content)
      const letters = texto.replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñ]/g, '')
      if (letters.length >= 12 && texto === texto.toUpperCase()) return { aprobado: false, motivo: 'el texto está todo en mayúsculas: se lee como un grito' }
      if (/plazo de entrega|entrega(mos)? en \d+|en 24 ?h/i.test(texto)) return { aprobado: false, motivo: 'promete un plazo de entrega, y la marca no lo hace en campañas' }
    }
    return { aprobado: true, motivo: 'texto claro y en el tono de la marca' }
  },

  ui: (t) => {
    const asked = norm(unquoted(t.task.request))
    if ((t.files ?? []).some((f) => f.path.startsWith('content/campanas/')) && OFF_PALETTE.test(asked)) {
      return { aprobado: false, motivo: 'el color pedido no está en la paleta de marca (oliva, limón, tierra, blanco)' }
    }
    return { aprobado: true, motivo: 'encaja con la paleta y el diseño de la marca' }
  },
}

// --- Marketing: one campaign card ---

function campaign(t) {
  const request = t.task.request
  const quote = quoted(request)
  const color = CAMPAIGN_COLORS.find(([, pattern]) => pattern.test(norm(unquoted(request))))?.[0] ?? 'oliva'
  let titulo, texto
  if (quote) {
    texto = clean(quote, 160)
    titulo = titleFrom(texto)
  } else {
    texto = capitalize(clean(stripLead(request), 160))
    titulo = titleFrom(texto)
  }
  return { ficheros: [{ ruta: t.assigned[0], contenido: { titulo, texto, color } }] }
}

// --- Producto: a new product or a new destination ---

function productOrDestination(t) {
  const request = t.task.request
  const n = norm(request)
  const produce = Object.keys(PRODUCE).map((key) => ({ key, at: n.search(new RegExp(`\\b${key}s?\\b`)) })).filter((m) => m.at !== -1).sort((a, b) => a.at - b.at)[0]
  const country = Object.keys(COUNTRIES).find((key) => new RegExp(`\\b${key}\\b`).test(n))
    ?? Object.keys(COUNTRIES).find((key) => Object.keys(COUNTRIES[key][3]).some((city) => new RegExp(`\\b${city}\\b`).test(n)))
  const wantsDestination = country && (!produce || /destino|exportar|enviar|envio|mercado|pais|ciudad/.test(n))

  if (wantsDestination) {
    const [pais, defaultCity, diasTransito, cities] = COUNTRIES[country]
    const city = Object.entries(cities).find(([key]) => new RegExp(`\\b${key}\\b`).test(n))?.[1] ?? defaultCity
    return { ficheros: [{ ruta: path(t, 'destinos'), contenido: { pais, ciudad: city, diasTransito } }] }
  }
  const [nombre, categoria, emoji, usual] = produce ? PRODUCE[produce.key] : [capitalize(clean(stripLead(request), 40)), 'fruta', '🌱', 'Murcia']
  const from = request.match(/\bde ([A-ZÁÉÍÓÚÑ][\wáéíóúñ]+)/)?.[1]
  const origen = from && !produce?.key.startsWith(from.toLowerCase()) ? from : usual
  return { ficheros: [{ ruta: path(t, 'productos'), contenido: { nombre, categoria, origen, descripcion: clean(`${nombre} de ${origen}, recién cosechado y listo para exportar a Europa.`, 160), emoji, disponible: true } }] }
}

const path = (t, folder) => t.assigned.find((p) => p.startsWith(`catalogo/${folder}/`))

// --- Negocio: prices, discounts and transport tariffs (changes to existing files) ---

function business(t) {
  const request = t.task.request
  const n = norm(request)
  const estado = t.estado ?? { productos: {}, destinos: {}, precios: {}, descuentos: { tramos: [] }, transporte: {} }
  const current = (p) => JSON.parse(t.existing[p] ?? '{}')
  const files = []

  if (/precio/.test(n)) {
    const prices = current('data/precios.json')
    const id = findProduct(n, estado) ?? n.match(/precio\s+de(?:l| la| los| las)?\s+([a-z0-9]+)/)?.[1]
    const relative = n.match(/(sub\w*|aument\w*|increment\w*|baj\w*|reduc\w*|rebaj\w*)\b.*?(\d+(?:[.,]\d+)?)\s*%/)
    const absolute = request.match(/precio[^0-9]*(\d+(?:[.,]\d+)?)/i)
    if (id && relative && prices[id] > 0) {
      const factor = 1 + (/^(baj|reduc|rebaj)/.test(relative[1]) ? -1 : 1) * Number(relative[2].replace(',', '.')) / 100
      files.push(['data/precios.json', { ...prices, [id]: round(prices[id] * factor) }])
    } else if (id && absolute) {
      files.push(['data/precios.json', { ...prices, [id]: round(Number(absolute[1].replace(',', '.'))) }])
    }
  }

  if (/descuento|tramo/.test(n)) {
    const discounts = current('data/descuentos.json')
    const tiers = discounts.tramos ?? []
    const pct = request.match(/(\d+(?:[.,]\d+)?)\s*%/)
    const kg = request.match(/(\d{1,3}(?:\.\d{3})+|\d+)\s*(?:kg|kilos?)/i)
    if (pct && kg) {
      const desdeKg = Number(kg[1].replaceAll('.', ''))
      const porcentaje = Number(pct[1].replace(',', '.'))
      const next = [...tiers.filter((x) => x.desdeKg !== desdeKg), { desdeKg, porcentaje }].sort((x, y) => x.desdeKg - y.desdeKg)
      files.push(['data/descuentos.json', { ...discounts, tramos: next }])
    } else if (pct && tiers.length) {
      files.push(['data/descuentos.json', { ...discounts, tramos: tiers.map((x, i) => (i === tiers.length - 1 ? { ...x, porcentaje: Number(pct[1].replace(',', '.')) } : x)) }])
    }
  }

  if (/transporte|envio|flete/.test(n)) {
    const tariffs = current('config/transporte.json')
    const ids = /todos los destinos/.test(n) ? Object.keys(tariffs) : [findDestination(n, estado) ?? n.match(/(?:transporte|envio|flete)s?\s+a(?:l)?\s+([a-z0-9]+)/)?.[1]].filter(Boolean)
    const perKg = request.match(/(\d+(?:[.,]\d+)?)\s*(?:euros?|€)?\s*(?:por|\/)\s*(?:kilo|kg)/i)
    const minimum = request.match(/m[ií]nimo(?:\s+de)?\s*(\d+(?:[.,]\d+)?)/i)
    const free = /gratis|gratuito|sin coste|sin costes|sin cargo/.test(n)
    const change = free ? { eurPorKg: 0, minimo: 0 } : { ...(perKg && { eurPorKg: Number(perKg[1].replace(',', '.')) }), ...(minimum && { minimo: Number(minimum[1].replace(',', '.')) }) }
    if (ids.length && Object.keys(change).length) {
      files.push(['config/transporte.json', { ...tariffs, ...Object.fromEntries(ids.map((id) => [id, { ...(tariffs[id] ?? { eurPorKg: 0, minimo: 0 }), ...change }])) }])
    }
  }

  // Nothing understood: hand back the prices file as it is (the factory ends the task as "unchanged").
  if (files.length === 0) files.push(['data/precios.json', current('data/precios.json')])
  return { ficheros: files.slice(0, 2).map(([ruta, contenido]) => ({ ruta, contenido })) }
}

// A product named in the request: its full name, or else its first word ("limón" → the first lemon priced).
function findProduct(n, estado) {
  const order = (id) => { const i = Object.keys(estado.precios).indexOf(id); return i === -1 ? Infinity : i }
  const entries = Object.entries(estado.productos)
  const full = entries.filter(([, p]) => n.includes(norm(p.nombre))).sort(([a, p], [b, q]) => q.nombre.length - p.nombre.length || order(a) - order(b))
  if (full.length) return full[0][0]
  const first = entries.filter(([, p]) => new RegExp(`\\b${norm(p.nombre).split(' ')[0]}s?\\b`).test(n)).sort(([a], [b]) => order(a) - order(b))
  return first[0]?.[0]
}

function findDestination(n, estado) {
  return Object.entries(estado.destinos).find(([, d]) => [d.pais, d.ciudad].some((name) => new RegExp(`\\b${norm(name)}\\b`).test(n)))?.[0]
}

// --- helpers ---

const norm = (text) => String(text).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
const round = (x) => Math.round(x * 100) / 100

// Plain text that will always pass the schema: no HTML, no links, bounded length.
function clean(text, max) {
  const plain = String(text).replace(/[<>]/g, '').replace(/\S*(:\/\/|www\.)\S*/gi, '').replace(/\s+/g, ' ').trim()
  return ([...plain].slice(0, max).join('').trim() || 'Petición del público')
}

function quoted(text) {
  const m = String(text).match(/[«"“]([^»"”]{1,200})[»"”]/) ?? String(text).match(/que diga:?\s+(.+)$/i)
  return m ? m[1] : null
}

const unquoted = (text) => String(text).replace(/[«"“][^»"”]*[»"”]/g, ' ')

// "Un banner para anunciar las rebajas" → "las rebajas"
const stripLead = (text) => String(text).replace(/^\s*(?:una?|haz|crea|escribe|pon)\s+(?:una?\s+)?(?:campa[ñn]a|banner|mensaje|tarjeta|producto)\s+(?:de\s+|para\s+(?:anunciar\s+)?|sobre\s+)?/i, '')

// First clause or first six words, as a title.
function titleFrom(text) {
  const clause = text.split(/[.,;:!?]/)[0]
  const words = clause.split(/\s+/).slice(0, 6).join(' ').replace(/[.,;:!?]+$/, '')
  return capitalize(clean(words, 60))
}

const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1)

export function openAIProvider({ url, key, model, timeoutMs = 60000, fetchImpl = fetch }) {
  if (!url || !key || !model) throw new Error('openai provider needs url, key and model')
  return {
    name: `openai:${model}`,
    async complete({ messages }) {
      const response = await fetchImpl(`${url.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({ model, messages, temperature: 0.2, max_tokens: 1000, response_format: { type: 'json_object' } }),
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!response.ok) throw new Error(`model API answered ${response.status}: ${(await response.text()).slice(0, 200)}`)
      const body = await response.json()
      const text = body.choices?.[0]?.message?.content
      if (typeof text !== 'string') throw new Error('model API answered without content')
      return { text, usage: { input: body.usage?.prompt_tokens ?? 0, output: body.usage?.completion_tokens ?? 0 } }
    },
  }
}

// FACTORY_PROVIDER=replay (default, free) or openai.
// Reviewers may use another model (ideally another family) via FACTORY_REVIEW_* variables.
// An unset repository variable reaches Actions as an empty string, so empty also means replay.
export function providersFromEnv(env = process.env) {
  if ((env.FACTORY_PROVIDER || 'replay') === 'replay') {
    const p = replayProvider()
    return { provider: p, reviewProvider: p }
  }
  if (env.FACTORY_PROVIDER !== 'openai') throw new Error(`unknown FACTORY_PROVIDER "${env.FACTORY_PROVIDER}"`)
  const provider = openAIProvider({ url: env.FACTORY_API_URL, key: env.FACTORY_API_KEY, model: env.FACTORY_MODEL })
  const reviewProvider = env.FACTORY_REVIEW_MODEL
    ? openAIProvider({
        url: env.FACTORY_REVIEW_API_URL ?? env.FACTORY_API_URL,
        key: env.FACTORY_REVIEW_API_KEY ?? env.FACTORY_API_KEY,
        model: env.FACTORY_REVIEW_MODEL,
      })
    : provider
  return { provider, reviewProvider }
}
