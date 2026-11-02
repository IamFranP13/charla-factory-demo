// What the factory writes for people on a GitHub issue: the readable body and the final comments. Pure and web-standard
// (no Node imports): the intake runs it on Cloudflare Workers, the gate and the orchestrator under Node.
// The request text and anything a model wrote are untrusted: `escapar` makes them inert text. The fixed text written
// around them never holds a backtick, `<!--` or `@`.

import { PERFILES, ACCION, esPerfil } from './perfiles.js'

const ENTIDADES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '`': '&#96;', '[': '&#91;', ']': '&#93;' }
// U+2060 WORD JOINER: invisible, and it breaks what GitHub links after rendering. Entities are not enough there: GitHub
// decodes `&#64;ana` and `&#35;1` and still makes a mention and an issue link of them (checked with its markdown API).
const UNE = '\u2060'

// One line of HTML-safe text: no tag, comment, mention, link, autolink, image, code fence or issue reference can come
// out of it, in a paragraph or inside a <blockquote>.
export function escapar(texto) {
  return String(texto ?? '')
    .replace(/[@#]/g, (c) => c + UNE)
    .replace(/[&<>`[\]]/g, (c) => ENTIDADES[c])
    .replace(/www\./gi, (w) => w.slice(0, 3) + UNE + '.')
    .replaceAll('://', '&#58;//')
    .replace(/\r\n|[\r\n\u2028\u2029]/g, '<br>')
}

const ORIGENES = { web: 'formulario web', prueba: 'prueba del mantenedor' }

// The issue body: the request (quoted, readable), who asked and from where, then the block the factory reads
// (```json, one line) folded away. The first ```json block of the body is what `requestOf` and `parseState` find, and no
// text above it can hold a backtick, so the request can never forge it.
export function cuerpoLegible(perfil, peticion, origen = 'web') {
  const propio = esPerfil(perfil) ? PERFILES[perfil] : null
  const puede = propio ? propio.tipos.map((t) => ACCION[t]).join(', ') : 'nada'
  return [
    '## Petición de cambio para LIMONIA',
    '',
    `<blockquote>${escapar(peticion)}</blockquote>`,
    '',
    `- **Perfil:** ${propio?.nombre ?? 'desconocido'} (puede pedir: ${puede})`,
    `- **Origen:** ${(Object.hasOwn(ORIGENES, origen) ? ORIGENES[origen] : 'desconocido')}`,
    '',
    'Cuando la factory termine, escribirá el resultado en un comentario de esta issue.',
    '',
    '<details>',
    '<summary>Datos para la factory (no editar)</summary>',
    '',
    '```json',
    JSON.stringify({ perfil, peticion }),
    '```',
    '',
    '</details>',
    '',
  ].join('\n')
}

const pr = (n) => (Number.isInteger(n) && n > 0 ? `PR #${n}` : null)

// The one comment a task gets when it ends or waits for a person. `motivo` comes from a model or the request: escaped.
// tipo: mergeada | espera | cerrada | rechazada | fallida | sin_cambios
export function comentarioFinal({ tipo, pr: numero = null, ruta = null, motivo = null }) {
  const razon = escapar(motivo ?? '').trim()
  const con = (...partes) => partes.filter(Boolean).join(', ')
  switch (tipo) {
    case 'mergeada': return `✅ Mergeada en main por la puerta (${con(ruta && `ruta ${ruta}`, pr(numero))}). Se publica en la web en unos minutos.`
    case 'espera': return `⏳ Espera a una persona: ${con(pr(numero), ruta && `ruta ${ruta}`)}.`
    case 'cerrada': return `🚫 Cerrada sin publicar${pr(numero) ? ` (${pr(numero)})` : ''}.`
    case 'rechazada': return `❌ Rechazada${razon ? `: ${razon}` : '.'}`
    case 'fallida': return `⚠️ Fallida${razon ? `: ${razon}` : '.'}`
    case 'sin_cambios': return `Sin cambios${razon ? `: ${razon}` : '.'}`
    default: throw new Error(`unknown outcome: ${tipo}`)
  }
}
