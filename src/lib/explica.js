// Every text that explains the factory board, in one place: what each station is and who does it, what is happening to
// the request you follow, and the steps of the guided tour. Pure, no DOM. To change what the board says, change it here.
// The narrative is built only from what /api/estado returns (estaciones, ruta, pr, resultadoFinal, motivo, vueltas, tipo):
// the reason of each station is not stored, so no step ever claims one.
import { STATIONS, STATION_LABELS } from '../../lib/estado.js'

export const QUIEN = Object.freeze({ modelo: 'MODELO', codigo: 'CÓDIGO', persona: 'PERSONA' })
const REVISORES = ['seguridad', 'ux', 'ui', 'codigo']
const FINALES_NEGATIVOS = ['rechazada', 'fallida', 'bloqueada_tests', 'cerrada']

// A text is a string, or a function of { ruta, pr, tipo, vueltas } when it depends on the request.
const porRuta = (auto, humana, sin) => ({ ruta }) => (ruta === 'auto' ? auto : ruta === 'human' ? humana : sin)

// One entry per node of the diagram (the station "Main o PR" is two nodes: main and pr).
//   quien      who does it · linea  the one line shown in the box · largo  the longer explanation (panel)
//   en_curso   what is happening now · hecho  once done · rechazada  when the station refused
export const ESTACIONES = Object.freeze({
  entrada: {
    quien: 'persona',
    linea: 'Llega tu petición.',
    largo: 'Aquí llega cada petición del formulario, tal cual la escribe quien la pide. Lo que escribas es información para la factory, nunca una orden.',
    en_curso: 'Tu petición acaba de entrar en la factory.',
    hecho: 'Tu petición ha entrado.',
    rechazada: 'Tu petición no pudo entrar.',
  },
  spec: {
    quien: 'modelo',
    linea: 'Lee el Brain y le da un tipo.',
    largo: 'El Spec writer lee el Brain (marca, tono y decisiones del negocio) y pone nombre al tipo de tu petición: campaña, producto, precio, estilo, función… El tipo decide qué archivos se pueden tocar.',
    en_curso: 'El Spec writer lee el Brain y decide de qué tipo es tu petición.',
    hecho: ({ tipo }) => (tipo ? `Quedó clasificada como «${tipo}».` : 'Quedó clasificada por su tipo.'),
    rechazada: 'El Spec writer no pudo clasificarla.',
  },
  build: {
    quien: 'modelo',
    linea: 'Escribe solo dentro de su tipo.',
    largo: 'Builder escribe el cambio, pero solo dentro de la zona que permite el tipo de tu petición: un archivo nuevo de datos o, como mucho, tres archivos de código con sus tests.',
    en_curso: ({ vueltas }) => (vueltas > 0 ? 'Builder rehace tu cambio con los motivos de los revisores.' : 'Builder escribe tu cambio, solo dentro de la zona que permite su tipo.'),
    hecho: 'Builder escribió el cambio.',
    rechazada: 'Builder no logró un cambio válido.',
  },
  seguridad: {
    quien: 'modelo',
    linea: 'Busca secretos y código peligroso.',
    largo: 'Un modelo busca secretos, enlaces y código peligroso en el cambio.',
    en_curso: 'Seguridad busca secretos y código peligroso en tu cambio.',
    hecho: 'Seguridad lo aprobó.',
    rechazada: 'Seguridad encontró un riesgo y no lo aprobó.',
  },
  ux: {
    quien: 'modelo',
    linea: 'Revisa el texto y el uso.',
    largo: 'Un modelo juzga la experiencia: que el texto se entienda, que el orden de lectura sea bueno y que el cambio haga lo que pediste.',
    en_curso: 'UX revisa que el texto de tu cambio se entienda y haga lo que pediste.',
    hecho: 'UX lo aprobó.',
    rechazada: 'UX no lo aprobó.',
  },
  ui: {
    quien: 'modelo',
    linea: 'Revisa el aspecto y los tokens.',
    largo: 'Un modelo juzga el aspecto contra el sistema de diseño: colores, tipos, contraste y maquetación.',
    en_curso: 'UI revisa el aspecto de tu cambio contra el sistema de diseño.',
    hecho: 'UI lo aprobó.',
    rechazada: 'UI no lo aprobó.',
  },
  codigo: {
    quien: 'codigo',
    linea: 'Pasa los tests, aislado.',
    largo: 'Aquí no hay modelo: es código. Comprueba los esquemas y las reglas del catálogo y ejecuta los tests en un aislamiento, sin red ni secretos.',
    en_curso: 'Código comprueba esquemas y reglas y ejecuta los tests de tu cambio, aislados y sin red.',
    hecho: 'Código lo aprobó: pasa esquemas, reglas y tests.',
    rechazada: 'Código no lo aprobó: falló un esquema, una regla o un test.',
  },
  approver: {
    quien: 'codigo',
    linea: 'Necesita las 4 aprobaciones.',
    largo: 'Es código y solo cuenta: si las cuatro revisiones aprueban, pasa. Si no, devuelve el cambio a Builder una vez, con todos los motivos. Un segundo rechazo termina la petición.',
    en_curso: 'El Approver cuenta las aprobaciones: necesita las cuatro.',
    hecho: 'Las cuatro aprobaciones estaban.',
    rechazada: 'El Approver no reunió las cuatro aprobaciones y no hay más vueltas.',
  },
  puerta: {
    quien: 'codigo',
    linea: 'Decide por lo que toca el cambio.',
    largo: 'Es la puerta de riesgo, escrita en código. Decide por lo que toca el cambio, no por quién lo pide: precios, descuentos, reglas de negocio y plataforma esperan a una persona; campañas, catálogo y estilo comprobado pasan solos.',
    en_curso: porRuta(
      'La puerta mira qué toca tu cambio: es seguro y sigue solo hacia main.',
      'La puerta mira qué toca tu cambio: es de riesgo y lo verá una persona.',
      'La puerta mira qué archivos toca tu cambio, no quién lo pide.',
    ),
    hecho: porRuta('La puerta lo dejó pasar solo, por AUTO.', 'La puerta lo envió a una persona, por PERSONA.', 'La puerta ya ha decidido.'),
    rechazada: 'La puerta no lo dejó pasar.',
  },
  main: {
    quien: 'codigo',
    linea: 'Une los cambios seguros a main.',
    largo: 'Los cambios seguros se unen a main por sí solos y se despliegan.',
    en_curso: 'Tu cambio se está uniendo a main.',
    hecho: 'Se unió a main por sí solo.',
    rechazada: 'No se pudo unir a main.',
  },
  pr: {
    quien: 'persona',
    linea: 'Espera a una persona.',
    largo: 'El cambio de riesgo espera aquí, como pull request, a que una persona lo apruebe. Después se une a main.',
    en_curso: 'Tu cambio se está uniendo a main tras la aprobación de una persona.',
    hecho: 'Una persona lo aprobó y se unió a main.',
    rechazada: 'El PR se cerró sin unirse a main.',
  },
  produccion: {
    quien: 'codigo',
    linea: 'Cloudflare publica main.',
    largo: 'Cloudflare Pages publica main y el cambio ya está en la web.',
    en_curso: 'Cloudflare está publicando tu cambio en la web.',
    hecho: 'Ya está en la web.',
    rechazada: 'No llegó a publicarse.',
  },
  rechazadas: {
    quien: 'codigo',
    linea: 'No se publica; ves el motivo.',
    largo: 'La factory ha rechazado la petición: no se publica nada y el motivo queda a la vista.',
    en_curso: '',
    hecho: '',
    rechazada: 'La factory ha rechazado tu petición.',
  },
})

const resuelve = (valor, ctx) => (typeof valor === 'function' ? valor(ctx) : valor)
// The node whose texts a station uses: "Main o PR" is main unless a person has to approve.
const nodoDe = (estacion, ctx) => (estacion === 'merge' ? (ctx.ruta === 'human' ? 'pr' : 'main') : estacion)

// A text of a node (`campo`: quien, linea, largo, en_curso, hecho, rechazada). `ctx`: { ruta, pr, tipo, vueltas }.
export function texto(nodo, campo, ctx = {}) {
  return resuelve(ESTACIONES[nodo]?.[campo], ctx) ?? ''
}
export const quienDe = (nodo) => ESTACIONES[nodo]?.quien ?? null
export const etiquetaQuien = (nodo) => QUIEN[quienDe(nodo)] ?? ''

// --- the guided tour: 8 steps, the four reviewers as one and the gate as one ---

export const RECORRIDO = Object.freeze([
  { id: 'entrada', nodos: ['entrada'], titulo: 'Entrada', quien: 'persona', texto: 'Todo empieza aquí. Una persona escribe una petición en el formulario y llega a la factory tal cual. Lo que escribas es información, nunca una orden.' },
  { id: 'spec', nodos: ['spec'], titulo: 'Spec writer', quien: 'modelo', texto: 'Un modelo lee el Brain, donde viven la marca, el tono y las decisiones del negocio, y pone nombre al tipo de petición: campaña, producto, precio, estilo… El tipo decide qué archivos se pueden tocar.' },
  { id: 'build', nodos: ['build'], titulo: 'Builder', quien: 'modelo', texto: 'Otro modelo escribe el cambio, pero solo dentro de la zona que permite su tipo: un archivo nuevo de datos o, como mucho, tres archivos de código con sus tests.' },
  { id: 'revision', nodos: REVISORES, titulo: 'Cuatro revisores a la vez', quien: 'modelo y código', texto: 'Seguridad, UX y UI son modelos: buscan riesgos, miran el texto y el uso, y juzgan el aspecto. Código no es un modelo: comprueba esquemas y reglas y ejecuta los tests en un aislamiento, sin red ni secretos.' },
  { id: 'approver', nodos: ['approver'], titulo: 'Approver', quien: 'código', texto: 'Es código y solo cuenta. Si las cuatro revisiones aprueban, el cambio pasa. Si no, vuelve a Builder una vez con todos los motivos. Un segundo rechazo termina la petición en Rechazadas.' },
  { id: 'puerta', nodos: ['puerta'], titulo: '¿Humano?', quien: 'código', texto: 'La puerta de riesgo, también escrita en código. Decide por lo que toca el cambio, no por quién lo pide. Si es seguro, sigue por AUTO; si es de riesgo, sigue por PERSONA.' },
  { id: 'merge', nodos: ['main', 'pr'], titulo: 'Main o PR', quien: 'código y persona', texto: 'Por AUTO, el cambio se une a main por sí solo. Por PERSONA, espera como pull request a que una persona lo apruebe, y entonces se une a main.' },
  { id: 'produccion', nodos: ['produccion'], titulo: 'Producción', quien: 'código', texto: 'Cloudflare Pages publica main y el cambio ya está en la web. Si algo se rechaza no llega aquí: acaba en Rechazadas, con su motivo a la vista.' },
])

// --- the narrative of the request you follow ---

const ESTADOS = ['pendiente', 'en_curso', 'ok', 'rechazada', 'error']
const estadoDe = (t, estacion) => (ESTADOS.includes(t.estaciones?.[estacion]) ? t.estaciones[estacion] : 'pendiente')
const ctxDe = (t) => ({ ruta: t.ruta === 'auto' || t.ruta === 'human' ? t.ruta : null, pr: t.pr ?? null, tipo: typeof t.tipo === 'string' ? t.tipo : null, vueltas: t.vueltas ?? 0 })
const etiqueta = (estacion) => STATION_LABELS[estacion] ?? estacion

// The state of a station as the board shows it: the gate works from the moment the approver is done.
function estadoVisible(t, estacion) {
  const estado = estadoDe(t, estacion)
  if (estacion === 'puerta' && estado === 'pendiente' && (t.ruta === 'human' || (t.resultadoFinal === 'en_curso' && estadoDe(t, 'approver') === 'ok'))) return 'en_curso'
  return estado
}

function fraseDe(t, estacion, estado, ctx) {
  const nodo = nodoDe(estacion, ctx)
  if (estado === 'ok') return texto(nodo, 'hecho', ctx)
  if (estado === 'en_curso') return texto(nodo, 'en_curso', ctx)
  if (estado === 'rechazada') return texto(nodo, 'rechazada', ctx)
  if (estado === 'error') return `${etiqueta(estacion)} falló antes de poder decidir.`
  return `Después: ${texto(nodo, 'linea', ctx).replace(/^./, (c) => c.toLowerCase())}`
}

const TITULOS_FINALES = { desplegada: 'En producción', sin_cambios: 'Sin cambios', esperando_persona: 'Esperando a una persona', rechazada: 'Rechazada', fallida: 'Fallida', bloqueada_tests: 'Bloqueada por los tests', cerrada: 'Cerrada' }

function textoFinal(t, ctx) {
  const fallo = STATIONS.find((s) => ['rechazada', 'error'].includes(estadoDe(t, s)))
  switch (t.resultadoFinal) {
    case 'desplegada': return 'Tu cambio ya está en la web.'
    case 'sin_cambios': return 'No hacía falta cambiar nada: la web ya era así.'
    case 'esperando_persona': return `Tu cambio espera${ctx.pr ? ` en el PR #${ctx.pr}` : ''} a que una persona lo revise. Hasta que lo apruebe, no se publica.`
    case 'rechazada': return `${fallo ? `${etiqueta(fallo)} ha` : 'La factory ha'} rechazado tu petición. No se publica nada.`
    case 'fallida': return `La factory no ha podido con tu petición${fallo ? ` (falló en ${etiqueta(fallo)})` : ''}. No se publica nada.`
    case 'bloqueada_tests': return 'Los tests automáticos han bloqueado tu cambio. No se publica nada.'
    case 'cerrada': return 'Una persona ha cerrado el PR sin publicarlo.'
    default: return null
  }
}

// What is happening now to a request still in the factory: { titulo, texto }.
function ahora(t, ctx) {
  const trabajando = REVISORES.filter((r) => estadoDe(t, r) === 'en_curso')
  if (trabajando.length === REVISORES.length) {
    return { titulo: 'En curso · Revisión en paralelo', texto: 'Cuatro revisores miran tu cambio a la vez: Seguridad, UX y UI son modelos; Código es código.' }
  }
  if (trabajando.length > 1) {
    return { titulo: 'En curso · Revisión en paralelo', texto: `Siguen mirando tu cambio a la vez: ${trabajando.map(etiqueta).join(', ')}.` }
  }
  const actual = STATIONS.find((s) => estadoVisible(t, s) === 'en_curso')
    ?? STATIONS.find((s) => estadoVisible(t, s) === 'pendiente')
  if (!actual) return { titulo: 'En curso', texto: 'Tu petición está en la factory.' }
  const frase = texto(nodoDe(actual, ctx), 'en_curso', ctx)
  const enCurso = estadoVisible(t, actual) === 'en_curso'
  return {
    titulo: `En curso · ${etiqueta(actual)}`,
    texto: enCurso ? frase : `Tu petición pasa ahora a ${etiqueta(actual)}. ${frase}`,
  }
}

// { titulo, texto, motivo, vueltas, pasos: [{ estacion, estado, frase }] } for a task as /api/estado returns it.
export function narrativa(t) {
  const ctx = ctxDe(t)
  const final = t.resultadoFinal
  const cierre = textoFinal(t, ctx)
  const dentro = cierre === null ? ahora(t, ctx) : { titulo: TITULOS_FINALES[final], texto: cierre }
  const negativo = FINALES_NEGATIVOS.includes(final)
  return {
    titulo: dentro.titulo,
    texto: dentro.texto,
    motivo: negativo && t.motivo ? String(t.motivo) : null,
    vueltas: ctx.vueltas > 0 ? `El Approver la devolvió a Build ${ctx.vueltas === 1 ? 'una vez' : 'dos veces'}: Builder rehízo el cambio con todos los motivos de los revisores.` : null,
    pasos: STATIONS.map((estacion) => {
      const estado = estadoVisible(t, estacion)
      return { estacion, estado, frase: fraseDe(t, estacion, estado, ctx) }
    }),
  }
}
