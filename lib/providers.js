// Model providers. Both answer the same question: given a station, return JSON text and token usage.
//   replay: a deterministic fake model. Zero cost, zero network: it rehearses the whole pipeline.
//   openai: any OpenAI-compatible chat completions API (DeepSeek, OpenRouter, ...).

const SUSPICIOUS = /\.env\b|secret|secreto|token|contraseña|password|api[ _-]?key|clave privada|ignora (tus|las|todas)|ignore (all|previous|your)|system prompt|borra|elimina todo|rm -rf/i
const OFFENSIVE = /idiota|imb[eé]cil|gilipollas|mierda|subnormal|puta/i
const COLOR_WORDS = { verde: 'verde', azul: 'azul', rosa: 'rosa', naranja: 'naranja', amarilla: 'amarillo', amarillo: 'amarillo' }

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
  spec: (t) => ({ resumen: `${t.profile.label}: ${clean(t.task.request, 120)}`, criterios: ['cumple el formato del fichero', 'texto en español'] }),

  build: (t) => {
    const request = t.task.request
    if (t.assignedPath?.startsWith('content/muro/')) {
      const color = Object.entries(COLOR_WORDS).find(([w]) => new RegExp(`\\b${w}\\b`, 'i').test(request))?.[1]
      return { ficheros: [{ ruta: t.assignedPath, contenido: { texto: quoted(request) ?? clean(request, 140), ...(color && { color }) } }] }
    }
    if (t.assignedPath?.startsWith('content/secciones/')) {
      const topic = request.match(/secci[oó]n (?:de|sobre|con) (.+)/i)?.[1] ?? request
      return { ficheros: [{ ruta: t.assignedPath, contenido: { titulo: capitalize(clean(topic, 60)), cuerpo: `Esta sección la ha pedido el público durante la charla: ${clean(request, 500)}.` } }] }
    }
    const price = request.match(/precio[^0-9]*(\d+(?:[.,]\d+)?)/i)
    if (price) {
      const current = JSON.parse(t.existing['config/entradas.json'] ?? '{"precio":0,"aforo":0}')
      return { ficheros: [{ ruta: 'config/entradas.json', contenido: { ...current, precio: Number(price[1].replace(',', '.')) } }] }
    }
    const current = JSON.parse(t.existing['data/cifras.json'] ?? '{}')
    const count = request.match(/asistentes[^0-9]*(\d+)/i)
    const change = count ? { asistentes: Number(count[1]) } : { nota: clean(request, 120) }
    return { ficheros: [{ ruta: 'data/cifras.json', contenido: { ...current, ...change } }] }
  },

  moderacion: (t) => {
    const text = `${t.task.request}\n${(t.files ?? []).map((f) => f.content).join('\n')}`
    if (SUSPICIOUS.test(text)) return { aprobado: false, motivo: 'intenta manipular la factory (secretos, reglas o borrado)' }
    if (OFFENSIVE.test(text)) return { aprobado: false, motivo: 'contenido ofensivo' }
    return { aprobado: true, motivo: 'contenido apto para el público' }
  },

  calidad: () => ({ aprobado: true, motivo: 'la sección cumple la spec' }),
}

// Plain text that will always pass the schema: no HTML, no links, bounded length.
function clean(text, max) {
  const plain = String(text).replace(/[<>]/g, '').replace(/\S*(:\/\/|www\.)\S*/gi, '').replace(/\s+/g, ' ').trim()
  return ([...plain].slice(0, max).join('').trim() || 'Petición del público')
}

function quoted(text) {
  const m = String(text).match(/[«"“]([^»"”]{1,200})[»"”]/) ?? String(text).match(/que diga:?\s+(.+)$/i)
  return m ? clean(m[1], 140) : null
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
