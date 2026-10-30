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
    // It never reads `messages` (a string, or an array of text and image parts), so images change nothing.
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
    const kind = classify(t)
    if (kind === null) return { rechazar: true, motivo: 'solo puedo hacer campañas, productos y destinos, cambios de precios, descuentos y transporte, arreglos del aspecto de la web y pequeños cambios de código (un bug, una funcionalidad o una regla); esto no encaja' }
    if (kind === 'estilo') return { tipo: kind, resumen: `Aspecto: ${clean(t.task.request, 120)}`, criterios: ['usa solo los tokens del sistema de diseño', 'el texto y los botones no se solapan con la ilustración', 'no cambia código ni contenido'] }
    if (CODE_KINDS.includes(kind)) return { tipo: kind, resumen: `Código: ${clean(t.task.request, 120)}`, criterios: ['el código cumple el contrato de las features', 'incluye su test', 'texto en español'] }
    return { tipo: kind, resumen: `${t.profile.label}: ${clean(t.task.request, 120)}`, criterios: ['cumple el formato del fichero', 'texto en español', 'respeta la marca y las decisiones del Brain'] }
  },

  build: (t) => {
    // The kind the spec named decides; with none (a spec that named no kind), the default kind of the profile.
    const kind = t.kind ?? t.profile.kinds[0]
    if (CODE_KINDS.includes(kind)) return development(t)
    if (kind === 'estilo') return style(t)
    if (kind === 'campana') return campaign(t)
    if (kind === 'producto' || kind === 'destino') return productOrDestination(t)
    return business(t)
  },

  seguridad: (t) => {
    // A visual change is judged as a whole by the static check of code; here only what was asked can be suspicious.
    const text = isStyle(t) ? t.task.request : `${t.task.request}\n${(t.files ?? []).map((f) => f.content).join('\n')}`
    if (SUSPICIOUS.test(text)) return { aprobado: false, motivo: 'intenta manipular la factory (secretos, reglas o borrado)' }
    if (OFFENSIVE.test(text)) return { aprobado: false, motivo: 'contenido ofensivo' }
    if (isStyle(t)) return { aprobado: true, motivo: 'solo cambia el aspecto: sin código nuevo, sin enlaces ni recursos externos' }
    return { aprobado: true, motivo: 'contenido apto para el público' }
  },

  ux: (t) => {
    if (isStyle(t)) return { aprobado: true, motivo: 'el texto y los botones están sobre su tarjeta y las fotos quedan en su sitio: se lee de un vistazo' }
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
    if (isStyle(t)) return { aprobado: true, motivo: 'usa solo los tokens del sistema de diseño y el texto ya no se solapa con las fotos' }
    const asked = norm(unquoted(t.task.request))
    if ((t.files ?? []).some((f) => f.path.startsWith('content/campanas/')) && OFF_PALETTE.test(asked)) {
      return { aprobado: false, motivo: 'el color pedido no está en la paleta de marca (oliva, limón, tierra, blanco)' }
    }
    return { aprobado: true, motivo: 'encaja con la paleta y el diseño de la marca' }
  },
}

// --- Estilo: the look of the site (the replay model knows one fix: the planted hero) ---

const isStyle = (t) => t.kind === 'estilo'

// The planted hero bug: the picture field of the hero (the cut lemon and the Vega photograph) is taken out of its grid
// cell and spread over the whole hero, so the lemon climbs behind the heading, the sentence and the buttons and the
// photograph lands on the origins. The fix, in the stylesheet alone: the hero is a two-column grid again, the card has its
// own ground, and the field goes back to its cell, clipped, with the disc at its size. Each pair is a whole rule of global.css.
const HERO_FIX = [
  [
    '.hero{position:relative;padding:0 var(--margen) var(--margen);min-height:clamp(560px,calc(100svh - 84px),840px);overflow:hidden}',
    '.hero{display:grid;grid-template-columns:1fr 1fr;gap:var(--hueco);padding:0 var(--margen) var(--margen);min-height:clamp(560px,calc(100svh - 84px),840px);overflow:hidden}',
  ],
  [
    '.hero__tarjeta{position:relative;z-index:1;display:flex;flex-direction:column;background:transparent;border-top-right-radius:var(--cuarto);overflow:hidden}',
    '.hero__tarjeta{display:flex;flex-direction:column;background:var(--crema);border-top-right-radius:var(--cuarto);overflow:hidden}',
  ],
  [
    '.hero__campo{position:absolute;inset:0;background:transparent;overflow:visible;z-index:0}',
    '.hero__campo{position:relative;background:var(--limon);overflow:hidden;min-height:420px;border-top-left-radius:0}',
  ],
  [
    '.hero__disco{position:absolute;top:50%;left:12%;width:150%;aspect-ratio:1;translate:0 -50%;border-radius:50%;overflow:hidden;z-index:0}',
    '.hero__disco{position:absolute;top:50%;right:-24%;width:min(118%,calc(100svh + 120px));aspect-ratio:1;translate:0 -50%;border-radius:50%;overflow:hidden;z-index:0}',
  ],
]

function style(t) {
  const css = 'src/styles/global.css'
  const current = t.existing[css] ?? ''
  const todo = HERO_REQUEST.test(norm(t.task.request)) ? HERO_FIX.filter(([buscar]) => current.includes(buscar)) : []
  // Nothing it knows how to fix (or already fixed): hand the stylesheet back as it is, and the factory ends the task as "unchanged".
  if (todo.length === 0) return { ficheros: [{ ruta: css, contenido: current }] }
  return { ficheros: [{ ruta: css, cambios: todo.map(([buscar, reemplazar]) => ({ buscar, reemplazar })) }] }
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
  const wantsDestination = t.kind ? t.kind === 'destino' && country : country && (!produce || /destino|exportar|enviar|envio|mercado|pais|ciudad/.test(n))

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

  // Only the files of the kind the spec named. Nothing understood: hand back the first one as it is (the factory ends the task as "unchanged").
  const allowed = t.surface.files
  const mine = files.filter(([ruta]) => allowed.includes(ruta))
  if (mine.length === 0) mine.push([allowed[0], current(allowed[0])])
  return { ficheros: mine.slice(0, 2).map(([ruta, contenido]) => ({ ruta, contenido })) }
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

// --- Which kind a request is (the replay model classifies by keywords; a real Spec writer reasons) ---

const CODE_KINDS = ['bug', 'feature', 'cambio']
// Things the factory does not do: the look of the whole site.
// The look of the page: the hero, its landscape and what sits on it, or something that "no se ve bien".
const HERO_REQUEST = /\b(hero|paisaje|portada|colinas)\b/
const LOOKS_WRONG = /\b(hero|paisaje|portada|colinas|pie de pagina)\b|\b(no )?se (ve|ven|lee|leen)\b.*\b(bien|mal|feo|fea|pequen\w+|cortad\w+|tapad\w+)\b|\bno se (ve|ven|lee|leen)\b|\b(solapa\w*|tapa\w*|encima del texto)\b/
const OFF_LIMITS = /\b(logo|tipograf\w*|css|rediseno\w*|toda la web|los estilos|estilos de la web)\b/

// A kind from factory/kinds.yaml, null when the request is not something the factory does, or undefined when
// nothing in the text says (the profile's default kind then applies).
function classify(t) {
  const code = matchDev(t.task.request)
  if (code) return code.tipo
  const n = norm(unquoted(t.task.request))
  if (OFF_LIMITS.test(n)) return null
  if (LOOKS_WRONG.test(n) && !/campana|banner|mensaje/.test(n)) return 'estilo'
  if (/campana|banner|mensaje|tarjeta/.test(n)) return 'campana'
  // Figures first: "transporte a Italia" is a tariff, not a destination, and "precio de la patata" is a price.
  if (/precio/.test(n)) return 'precios'
  if (/descuento|tramo/.test(n)) return 'descuentos'
  if (/transporte|envio|flete/.test(n)) return 'transporte'
  const produce = Object.keys(PRODUCE).some((key) => new RegExp(`\\b${key}s?\\b`).test(n))
  const country = Object.keys(COUNTRIES).some((key) => new RegExp(`\\b${key}\\b`).test(n) || Object.keys(COUNTRIES[key][3]).some((city) => new RegExp(`\\b${city}\\b`).test(n)))
  if (country && (!produce || /destino|exportar|enviar|mercado|pais|ciudad/.test(n))) return 'destino'
  if (produce || /\b(producto|catalogo)\b/.test(n)) return 'producto'
  return t.profile.kinds[0]
}

// --- Code: prepared patches (the replay model cannot write code; it knows these) ---

// What the replay model recognises as a code request. Attempts to reach the machine produce code that does it,
// so the static check of the factory has something to stop.
function matchDev(request) {
  const n = norm(request)
  const bugWords = /\b(bug|mal|reves|incorrect\w*|error|falla\w*|arregl\w*|corrig\w*|no se aplica|no aplica|no funciona\w*)\b/
  if (/process\.env|\bentorno\b/.test(n)) return { kind: 'entorno', tipo: 'feature' }
  if (/\bfetch\b|api de internet/.test(n)) return { kind: 'fetch', tipo: 'feature' }
  if (/node:fs|import\(|\bleer? (?:un )?fichero|\blee (?:un )?fichero/.test(n)) return { kind: 'fichero', tipo: 'feature' }
  if (/\beval\b/.test(n)) return { kind: 'eval', tipo: 'feature' }
  // A rule of the calculator ("regla"), not a tier of the data: "descuento del 8 % desde 2.000 kg" is data.
  if (/descuento/.test(n) && /15\s*%/.test(n) && /50\.?000/.test(n) && /\b(regla|norma|politica)\b/.test(n)) return { kind: 'descuento-extra', tipo: 'cambio' }
  if (/descuento/.test(n) && (/(1\.?000|limite|exact|justo|tramo)/.test(n) || /no (se )?(aplica|funciona)/.test(n)) && bugWords.test(n)) return { kind: 'bug-descuento', tipo: 'bug' }
  if (/(barato|caro|orden)/.test(n) && bugWords.test(n)) return { kind: 'bug-orden', tipo: 'bug' }
  if (/mas (barato|economic)/.test(n) && /categor/.test(n)) return { kind: 'mas-barato', tipo: 'feature' }
  if (/transito/.test(n) && /destino/.test(n)) return { kind: 'transito', tipo: 'feature' }
  if (/precio (medio|promedio)|media de(?:l)? precio/.test(n)) return { kind: 'precio-medio', tipo: 'feature' }
  return null
}

function development(t) {
  const found = matchDev(t.task.request)
  const id = `tarea-${t.task.id}`
  const dir = `src/features/${id}`
  const existing = (file) => t.existing[file] ?? ''
  const edit = (ruta, buscar, reemplazar) => ({ ruta, cambios: [{ buscar, reemplazar }] })
  // A fix whose code is not there any more: hand the file back as it is (the factory ends the task as "unchanged").
  const asIs = (ruta) => ({ ficheros: [{ ruta, contenido: existing(ruta) }] })

  switch (found?.kind) {
    case 'mas-barato':
      return { ficheros: [{ ruta: `${dir}/index.js`, contenido: CHEAPEST(id) }, { ruta: `${dir}/index.test.mjs`, contenido: CHEAPEST_TEST }] }
    case 'transito':
      return { ficheros: [{ ruta: `${dir}/index.js`, contenido: TRANSIT(id) }, { ruta: `${dir}/index.test.mjs`, contenido: TRANSIT_TEST }] }
    case 'precio-medio':
      return { ficheros: [{ ruta: `${dir}/index.js`, contenido: AVERAGE(id) }, { ruta: `${dir}/index.test.mjs`, contenido: AVERAGE_TEST }] }
    case 'entorno':
      return evil(dir, id, "texto: String(process.env.HOME)")
    case 'fetch':
      return evil(dir, id, "texto: String(fetch('https://example.com/precios'))")
    case 'fichero':
      return evil(dir, id, "texto: String(import('node:fs'))")
    case 'eval':
      return evil(dir, id, "texto: String(eval('1 + 1'))")
    case 'bug-orden': {
      const index = 'src/features/ordenar-catalogo/index.js'
      const spec = 'src/features/ordenar-catalogo/index.test.mjs'
      if (!existing(index).includes('b.precio - a.precio')) return asIs(index)
      return { ficheros: [edit(index, '.sort((a, b) => b.precio - a.precio)', '.sort((a, b) => a.precio - b.precio)'), { ruta: spec, contenido: `${existing(spec).trimEnd()}\n${ORDER_TEST}` }] }
    }
    case 'bug-descuento': {
      const domain = 'src/domain/presupuesto.js'
      if (!existing(domain).includes('t.desdeKg < kgTotal')) return asIs(domain)
      return { ficheros: [edit(domain, 't.desdeKg < kgTotal', 't.desdeKg <= kgTotal'), { ruta: `src/domain/${id}-limite-descuento.test.mjs`, contenido: BOUNDARY_TEST }] }
    }
    case 'descuento-extra': {
      const domain = 'src/domain/presupuesto.js'
      if (existing(domain).includes('DESCUENTO_EXTRA')) return asIs(domain)
      return {
        ficheros: [
          {
            ruta: domain,
            cambios: [
              { buscar: 'export const MAX_KG = 100000', reemplazar: 'export const MAX_KG = 100000\n\n// Extra tier decided by the business: 15 % from 50,000 kg, whatever data/descuentos.json says.\nexport const DESCUENTO_EXTRA = { desdeKg: 50000, porcentaje: 15 }' },
              { buscar: 'const porcentaje = tramo ? tramo.porcentaje : 0', reemplazar: 'const porcentaje = Math.max(tramo ? tramo.porcentaje : 0, kgTotal >= DESCUENTO_EXTRA.desdeKg ? DESCUENTO_EXTRA.porcentaje : 0)' },
            ],
          },
          { ruta: `src/domain/${id}-descuento-extra.test.mjs`, contenido: EXTRA_TEST },
        ],
      }
    }
    default:
      return { ficheros: [{ ruta: `${dir}/index.js`, contenido: '' }] }
  }
}

// A feature that reaches for the machine, with a harmless test: only the static check can tell.
function evil(dir, id, body) {
  const index = `export default {\n  id: '${id}',\n  titulo: 'Sección de prueba',\n  donde: 'catalogo',\n  calcular() {\n    return { tipo: 'texto', ${body} }\n  },\n}\n`
  return { ficheros: [{ ruta: `${dir}/index.js`, contenido: index }, { ruta: `${dir}/index.test.mjs`, contenido: TITLE_TEST }] }
}

const HEADER = "import { test } from 'node:test'\nimport assert from 'node:assert/strict'\n"
const TITLE_TEST = `${HEADER}import feature from './index.js'\n\ntest('has a title', () => assert.ok(feature.titulo.length > 0))\n`

const CHEAPEST = (id) => `// The cheapest available product of each category.
export default {
  id: '${id}',
  titulo: 'El más barato de cada categoría',
  donde: 'catalogo',
  calcular(estado) {
    const mejores = {}
    for (const [id, producto] of Object.entries(estado.productos)) {
      const precio = estado.precios[id]
      if (!producto.disponible || !(precio > 0)) continue
      if (!mejores[producto.categoria] || precio < mejores[producto.categoria].precio) mejores[producto.categoria] = { nombre: producto.nombre, precio }
    }
    const filas = Object.entries(mejores).map(([categoria, mejor]) => [categoria === 'fruta' ? 'Fruta' : 'Hortaliza', mejor.nombre, mejor.precio.toFixed(2).replace('.', ',') + ' €/kg'])
    return { tipo: 'tabla', columnas: ['Categoría', 'Producto', 'Precio'], filas }
  },
}
`
const CHEAPEST_TEST = `${HEADER}import feature from './index.js'

const estado = {
  productos: {
    limon: { nombre: 'Limón', categoria: 'fruta', disponible: true },
    naranja: { nombre: 'Naranja', categoria: 'fruta', disponible: true },
    lechuga: { nombre: 'Lechuga', categoria: 'hortaliza', disponible: true },
    uva: { nombre: 'Uva', categoria: 'fruta', disponible: false },
  },
  precios: { limon: 1.3, naranja: 0.78, lechuga: 0.65, uva: 0.1 },
}

test('shows the cheapest available product of each category', () => {
  assert.deepEqual(feature.calcular(estado).filas, [['Fruta', 'Naranja', '0,78 €/kg'], ['Hortaliza', 'Lechuga', '0,65 €/kg']])
})
`

const TRANSIT = (id) => `// How long each destination takes, from the nearest to the farthest.
export default {
  id: '${id}',
  titulo: 'Días de tránsito de cada destino',
  donde: 'catalogo',
  calcular(estado) {
    const items = Object.values(estado.destinos)
      .slice()
      .sort((a, b) => a.diasTransito - b.diasTransito || a.ciudad.localeCompare(b.ciudad))
      .map((d) => ({ texto: d.ciudad + ', ' + d.pais, valor: d.diasTransito + (d.diasTransito === 1 ? ' día' : ' días') }))
    return { tipo: 'lista', items }
  },
}
`
const TRANSIT_TEST = `${HEADER}import feature from './index.js'

const estado = {
  destinos: {
    a: { pais: 'Alemania', ciudad: 'Hamburgo', diasTransito: 4 },
    b: { pais: 'Francia', ciudad: 'Rungis', diasTransito: 1 },
  },
}

test('lists every destination with its days, nearest first', () => {
  assert.deepEqual(feature.calcular(estado).items, [{ texto: 'Rungis, Francia', valor: '1 día' }, { texto: 'Hamburgo, Alemania', valor: '4 días' }])
})
`

const AVERAGE = (id) => `// The mean price per kilo of the products that can be quoted.
export default {
  id: '${id}',
  titulo: 'Precio medio por kilo',
  donde: 'catalogo',
  calcular(estado) {
    const precios = Object.entries(estado.productos).filter(([id, p]) => p.disponible && estado.precios[id] > 0).map(([id]) => estado.precios[id])
    if (precios.length === 0) return { tipo: 'texto', texto: 'Todavía no hay productos con precio.' }
    const media = precios.reduce((a, b) => a + b, 0) / precios.length
    return { tipo: 'texto', texto: 'Precio medio: ' + media.toFixed(2).replace('.', ',') + ' €/kg (' + precios.length + ' productos con precio)' }
  },
}
`
const AVERAGE_TEST = `${HEADER}import feature from './index.js'

const estado = {
  productos: { a: { disponible: true }, b: { disponible: true }, c: { disponible: false }, d: { disponible: true } },
  precios: { a: 1, b: 2, c: 9 },
}

test('averages the available products that have a price', () => {
  assert.equal(feature.calcular(estado).texto, 'Precio medio: 1,50 €/kg (2 productos con precio)')
})

test('says so when nothing has a price', () => {
  assert.equal(feature.calcular({ productos: {}, precios: {} }).texto, 'Todavía no hay productos con precio.')
})
`

const ORDER_TEST = `
test('lists from the cheapest to the most expensive', () => {
  assert.deepEqual(feature.calcular(estado).items.map((i) => i.texto), ['Limón Verna', 'Tomate Raf'])
})
`

const QUOTE_ESTADO = (tiers) => `const estado = {
  productos: { limon: { nombre: 'Limón', disponible: true } },
  destinos: { hamburgo: { pais: 'Alemania' } },
  precios: { limon: 1 },
  descuentos: { tramos: [${tiers}] },
  transporte: { hamburgo: { eurPorKg: 0, minimo: 0 } },
}
const con = (kg) => presupuestar({ lineas: [{ productoId: 'limon', kg }], destinoId: 'hamburgo' }, estado).descuento.porcentaje
`
const BOUNDARY_TEST = `${HEADER}import { presupuestar } from './presupuesto.js'

${QUOTE_ESTADO('{ desdeKg: 1000, porcentaje: 3 }, { desdeKg: 5000, porcentaje: 6 }')}
test('the discount applies at exactly the kilos of the tier', () => {
  assert.equal(con(999), 0)
  assert.equal(con(1000), 3)
  assert.equal(con(4999), 3)
  assert.equal(con(5000), 6)
})
`
const EXTRA_TEST = `${HEADER}import { presupuestar } from './presupuesto.js'

${QUOTE_ESTADO('{ desdeKg: 1000, porcentaje: 3 }, { desdeKg: 20000, porcentaje: 10 }')}
test('15 % from 50,000 kg, the tiers of the data below', () => {
  assert.equal(con(20001), 10)
  assert.equal(con(49999), 10)
  assert.equal(con(50000), 15)
  assert.equal(con(100000), 15)
})
`

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
    // `messages[].content` is a string or, with screenshots, an array of text and image_url parts: sent unchanged.
    async complete({ messages, maxTokens }) {
      const response = await fetchImpl(`${url.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({ model, messages, temperature: 0.2, max_tokens: maxTokens ?? 1000, response_format: { type: 'json_object' } }),
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
// Reviewers may use another model (ideally another family) via FACTORY_REVIEW_* variables, and the Builder of
// code via FACTORY_CODE_MODEL. For a visual change (estilo) the ux and ui reviewers receive screenshots, so
// FACTORY_REVIEW_MODEL (or FACTORY_MODEL when it is unset) must be a vision model.
// An unset repository variable reaches Actions as an empty string, so empty also means replay.
export function providersFromEnv(env = process.env) {
  if ((env.FACTORY_PROVIDER || 'replay') === 'replay') {
    const p = replayProvider()
    return { provider: p, reviewProvider: p, codeProvider: p }
  }
  if (env.FACTORY_PROVIDER !== 'openai') throw new Error(`unknown FACTORY_PROVIDER "${env.FACTORY_PROVIDER}"`)
  const provider = openAIProvider({ url: env.FACTORY_API_URL, key: env.FACTORY_API_KEY, model: env.FACTORY_MODEL })
  const reviewProvider = env.FACTORY_REVIEW_MODEL
    ? openAIProvider({
        url: env.FACTORY_REVIEW_API_URL || env.FACTORY_API_URL,
        key: env.FACTORY_REVIEW_API_KEY || env.FACTORY_API_KEY,
        model: env.FACTORY_REVIEW_MODEL,
      })
    : provider
  // The Builder of code may use its own model (FACTORY_CODE_MODEL); without it the main model builds code too.
  const codeProvider = env.FACTORY_CODE_MODEL
    ? openAIProvider({ url: env.FACTORY_API_URL, key: env.FACTORY_API_KEY, model: env.FACTORY_CODE_MODEL })
    : provider
  return { provider, reviewProvider, codeProvider }
}
