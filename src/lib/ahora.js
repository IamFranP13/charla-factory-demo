// What /tarea/ shows of a task: the strip of seven segments, the "ahora" card and the live light. Pure, no DOM: the page paints
// what comes out, as text. Everything the card says while the task runs is computed here from the state of the stations
// (never from the stored activity line, which lags and outlives its phase); the only text of the factory it passes on is the
// agent's last actions, each reviewer's own reason and the reason a task stopped, cleaned again because this is the last stop.
import { MENSAJES, enlaceFor } from '../../lib/estado.js'

const TOTAL = 7
const PALABRAS = { ok: 'Hecho', en_curso: 'En curso', pendiente: 'Pendiente', rechazada: 'Se detuvo aquí', error: 'Se detuvo aquí', espera: 'Espera a una persona' }
const PARADOS = ['rechazada', 'error']
const REVISORES = [['seguridad', 'Seguridad'], ['ux', 'UX'], ['ui', 'UI'], ['codigo', 'Código']]
const TRABAJANDO = {
  seguridad: 'Mira qué toca el cambio…',
  ux: 'Mira las capturas de la web…',
  ui: 'Mira las capturas contra el diseño…',
  codigo: 'Ejecuta las pruebas y el build…',
}
const QUE_HACE = {
  seguridad: 'Seguridad mira qué toca el cambio',
  ux: 'UX mira las capturas de la web con tu cambio',
  ui: 'UI mira las capturas contra el diseño',
  codigo: 'Código ejecuta las pruebas y el build',
}
const PALABRA_REVISOR = { ok: 'Aprueba', en_curso: 'Trabajando', pendiente: 'Espera', rechazada: 'Rechaza', error: 'Ha fallado' }
const TIPOS_ACCION = ['lee', 'edita', 'escribe', 'busca', 'comando', 'empieza']
const FINALES = ['desplegada', 'esperando_persona', 'rechazada', 'sin_cambios', 'fallida', 'cerrada', 'bloqueada_tests']
// Where each station of the factory sits on the strip (the stop is named by the segment, not by the station).
const SEGMENTO_DE = { entrada: 'Entrada', spec: 'Agente', build: 'Agente', seguridad: 'Seguridad', ux: 'UX', ui: 'UI', codigo: 'Código', approver: 'Approver', puerta: 'Puerta', merge: 'Main o PR', produccion: 'Producción' }
const SEGMENTOS = [['entrada', 'Entrada'], ['agente', 'Agente'], ['revision', 'Revisión'], ['approver', 'Approver'], ['puerta', 'Puerta'], ['merge', 'Main o PR'], ['produccion', 'Producción']]

// Plain text, one line, at most 160 characters (the factory cleaned it already; this is the page's own check).
const limpio = (valor) => (typeof valor === 'string' ? Array.from(valor.replace(/[\p{Cc}\p{Cf}\u2028\u2029<>\s]+/gu, ' ').trim()).slice(0, 160).join('') : '')

// A group of stations as one: a refusal or an error wins, then work in progress.
function agrupar(estados, enCurso = false) {
  if (estados.includes('error')) return 'error'
  // While the task runs a refusal is an objection: the approver may still send it back.
  if (estados.includes('rechazada') && !enCurso) return 'rechazada'
  if (estados.every((e) => e === 'ok')) return 'ok'
  if (estados.every((e) => e === 'pendiente')) return 'pendiente'
  return 'en_curso'
}

function segmentosDe(tarea, final) {
  const valor = (id) => (['pendiente', 'en_curso', 'ok', 'rechazada', 'error'].includes(tarea?.estaciones?.[id]) ? tarea.estaciones[id] : 'pendiente')
  if (final === 'desplegada') return SEGMENTOS.map(([id, nombre]) => ({ id, nombre, estado: 'ok', palabra: PALABRAS.ok }))
  const puerta = valor('puerta')
  const merge = valor('merge')
  const estados = {
    entrada: valor('entrada'),
    agente: agrupar([valor('spec'), valor('build')]),
    revision: agrupar(REVISORES.map(([id]) => valor(id)), final === 'en_curso'),
    approver: valor('approver'),
    puerta: final === 'esperando_persona' ? 'espera' : puerta,
    // Merged, waiting for the deploy to be confirmed; the gate let it through, the merge has not started.
    merge: merge === 'pendiente' && puerta === 'ok' && final === 'en_curso' ? 'en_curso' : merge,
    produccion: valor('produccion') === 'pendiente' && merge === 'ok' ? 'en_curso' : valor('produccion'),
  }
  return SEGMENTOS.map(([id, nombre]) => ({ id, nombre, estado: estados[id], palabra: PALABRAS[estados[id]] }))
}

function revisoresDe(tarea, final = 'en_curso') {
  const motivos = tarea?.motivos && typeof tarea.motivos === 'object' ? tarea.motivos : {}
  return REVISORES.map(([id, nombre]) => {
    const estado = ['pendiente', 'en_curso', 'ok', 'rechazada', 'error'].includes(tarea?.estaciones?.[id]) ? tarea.estaciones[id] : 'pendiente'
    // A working reviewer has no reason yet: whatever is stored belongs to an earlier round.
    const texto = estado === 'en_curso' ? TRABAJANDO[id] : estado === 'pendiente' ? '' : limpio(Object.hasOwn(motivos, id) ? motivos[id] : '')
    // A finished task that never got to ask this reviewer: it was not reached, it is not waiting.
    const sinLlegar = estado === 'pendiente' && final !== 'en_curso'
    return { id, nombre, estado, palabra: sinLlegar ? 'No llegó a revisar' : PALABRA_REVISOR[estado], texto }
  })
}

function accionesDe(tarea) {
  if (!Array.isArray(tarea?.acciones)) return []
  return tarea.acciones
    .map((a) => ({ tipo: a?.tipo, texto: limpio(a?.texto) }))
    .filter((a) => TIPOS_ACCION.includes(a.tipo) && a.texto)
    .slice(0, 3)
    .map(({ tipo, texto }) => {
      const corte = texto.indexOf(' ')
      return { tipo, verbo: corte === -1 ? texto : texto.slice(0, corte), resto: corte === -1 ? '' : texto.slice(corte + 1) }
    })
}

const listaY = (nombres) => (nombres.length > 1 ? `${nombres.slice(0, -1).join(', ')} y ${nombres.at(-1)}` : nombres[0])

// What the card says of a task that is still running, by the segment it is in (the first one not done).
function faseActiva(tarea, segmentos) {
  const indice = segmentos.findIndex((s) => s.estado !== 'ok')
  const segmento = segmentos[indice]
  const estaciones = tarea?.estaciones ?? {}
  switch (segmento.id) {
    case 'entrada':
      return { titulo: 'Tu petición acaba de entrar', linea: 'Tu petición está en la cola' }
    case 'agente': {
      if (segmento.estado === 'pendiente') return { titulo: 'Tu petición espera su turno', linea: 'Tu petición está en la cola' }
      const otraVuelta = (tarea?.vueltas ?? 0) > 0
      return {
        titulo: 'El agente escribe el cambio',
        linea: estaciones.spec === 'en_curso' ? 'El agente lee tu petición' : otraVuelta ? 'El approver ha pedido otra vuelta: el agente corrige el cambio' : 'El agente está escribiendo el cambio',
        acciones: true,
      }
    }
    case 'revision': {
      const trabajando = REVISORES.filter(([id]) => estaciones[id] === 'en_curso')
      const linea = trabajando.length === 1 ? QUE_HACE[trabajando[0][0]]
        : trabajando.length > 1 ? `Trabajando: ${listaY(trabajando.map(([, nombre]) => nombre))}`
          : estaciones && REVISORES.some(([id]) => estaciones[id] === 'rechazada') ? 'Hay objeciones: el approver decidirá'
            : segmento.estado === 'pendiente' ? 'Preparando las revisiones' : 'Las cuatro revisiones han terminado'
      return { titulo: 'Cuatro revisiones a la vez', linea, revisores: true }
    }
    case 'approver':
      return { titulo: 'El approver decide', linea: 'El approver pesa las cuatro opiniones' }
    case 'puerta':
      return { titulo: 'La puerta elige la ruta', linea: 'La puerta revisa qué toca el cambio' }
    case 'merge':
      return { titulo: 'Tu cambio entra en main', linea: 'Fusionando en main' }
    default:
      return { titulo: 'Llegando a la web', linea: 'Publicando en la web' }
  }
}

const GITHUB = /^https:\/\/github\.com\/[A-Za-z0-9](?:[A-Za-z0-9-]*)\/[A-Za-z0-9._-]+\/pull\/\d+$/
// Only the exact paths enlaceFor (lib/estado.js) can give; a browser reads `/\evil.com` as another site.
const ENLACES_DEL_SITIO = ['/', '/catalogo/', '/presupuesto/']
const rutaDelSitio = (ruta) => (typeof ruta === 'string' && ENLACES_DEL_SITIO.includes(ruta) ? ruta : null)

// `tarea`: one entry of /api/estado. `cola`: the pull requests waiting for a person (they carry the address).
export function vistaAhora(tarea, { cola = [] } = {}) {
  const final = FINALES.includes(tarea?.resultadoFinal) ? tarea.resultadoFinal : 'en_curso'
  const segmentos = segmentosDe(tarea, final)
  const indice = segmentos.findIndex((s) => s.estado !== 'ok')
  const parada = segmentos.findIndex((s) => PARADOS.includes(s.estado))
  const donde = indice === -1 ? `Los ${TOTAL} pasos, hechos`
    : parada !== -1 ? `Se detuvo en el paso ${parada + 1} de ${TOTAL}: ${segmentos[parada].nombre}`
      : final === 'sin_cambios' ? 'Sin cambios en la web'
        : `Paso ${indice + 1} de ${TOTAL}: ${segmentos[indice].nombre}`
  const vista = { final, segmentos, donde, titulo: MENSAJES[final], linea: '', detalle: '', acciones: [], revisores: null, enlace: null }

  if (final === 'en_curso') {
    const fase = faseActiva(tarea, segmentos)
    return { ...vista, titulo: fase.titulo, linea: fase.linea, acciones: fase.acciones ? accionesDe(tarea) : [], revisores: fase.revisores ? revisoresDe(tarea) : null }
  }

  const donde2 = SEGMENTO_DE[tarea?.estacion] ?? segmentos[Math.max(parada, 0)].nombre
  const motivo = limpio(tarea?.motivo)
  const detenida = `Se detuvo en: ${donde2}.${motivo ? ` Motivo: ${motivo}` : ''}`
  if (final === 'desplegada') {
    vista.enlace = { texto: 'Ver el cambio en la web', href: rutaDelSitio(tarea?.enlace) ?? enlaceFor(tarea?.perfil, tarea?.tipo) }
  } else if (final === 'esperando_persona') {
    const pr = Number.isInteger(tarea?.pr) ? tarea.pr : null
    vista.detalle = `Esta petición toca algo que decide una persona.${pr ? ` PR #${pr} abierto.` : ''}`
    const url = pr ? (Array.isArray(cola) ? cola : []).find((q) => q?.pr === pr)?.url : null
    if (typeof url === 'string' && GITHUB.test(url)) vista.enlace = { texto: `Ver el PR #${pr}`, href: url }
  } else if (final === 'rechazada' || final === 'fallida') {
    vista.detalle = `${detenida.replace(/\.?$/, '.')} Nadie ha tocado la web.`
    if (final === 'rechazada') vista.revisores = revisoresDe(tarea, final)
  } else if (final === 'bloqueada_tests' || final === 'cerrada') {
    vista.detalle = detenida
  }
  return vista
}

const hace = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min`
}

// The small honest light under the title: how old the last read of /api/estado is. `ultima`/`ahora` in ms (null: no read yet).
export function frescura({ ultima, ahora, terminada }) {
  if (ultima === null || ultima === undefined) return { texto: 'Buscando tu petición…', luz: false, fin: false }
  const edad = ahora - ultima
  if (terminada) return { texto: `Terminada · última lectura hace ${hace(edad)}`, luz: false, fin: true }
  if (edad > 20_000) return { texto: 'Sin conexión con la factory. Reintentando…', luz: false, fin: false }
  return { texto: `En vivo · actualizado hace ${hace(edad)}`, luz: true, fin: false }
}
