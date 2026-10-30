// Browser side of the diagram: paints a task (`pintar`) on the dial and the list of stations Diagrama.astro drew.
// Every dynamic text goes through textContent; the look comes from data-estado.
import { pintar, NOMBRES_REVISORES } from '../lib/diagrama.js'

const TEXTO = { hecha: 'Hecho', actual: 'En curso', parada: 'Se detuvo aquí', pendiente: 'Pendiente', neutro: 'Pendiente' }
const MARCA = { hecha: '✓', actual: '●', parada: '✕' }
const REVISOR = { ok: ['✓', 'aprueba'], en_curso: ['●', 'revisa'], rechazada: ['✕', 'rechaza'], error: ['✕', 'ha fallado'] }
const PARADO = ['rechazada', 'error']

// The state of a station of the page from the step `pintar` computes: the gate also covers Main o PR.
function estacion(paso, pasos) {
  const valor = paso === 'puerta' ? (PARADO.includes(pasos.destino) ? pasos.destino : pasos.puerta === 'ok' && pasos.destino === 'en_curso' ? 'en_curso' : pasos.puerta) : pasos[paso]
  if (valor === 'ok') return 'hecha'
  if (valor === 'en_curso') return 'actual'
  return PARADO.includes(valor) ? 'parada' : 'pendiente'
}

// A task (or null for the neutral page) painted on the dial and the list inside `raiz`.
export function aplicar({ ruta, dial }, tarea) {
  const pintado = tarea ? pintar(tarea) : null
  const estados = {}
  for (const li of ruta.querySelectorAll('[data-paso]')) {
    const id = li.dataset.paso
    const estado = pintado ? estacion(id, pintado.pasos) : 'neutro'
    estados[id] = estado
    li.dataset.estado = estado
    li.querySelector('.estacion__marca').textContent = MARCA[estado] ?? String([...ruta.children].indexOf(li) + 1)
    li.querySelector('[data-texto-estado]').textContent = TEXTO[estado]
    const etiqueta = li.querySelector('[data-etiqueta]')
    const texto = pintado ? (pintado.etiquetas[id] ?? (id === 'puerta' ? pintado.etiquetas.destino : '') ?? '') : ''
    etiqueta.textContent = texto
    etiqueta.hidden = !texto
  }
  for (const revisor of ruta.querySelectorAll('[data-revisor]')) {
    const id = revisor.dataset.revisor
    const valor = pintado ? pintado.revisores[id] : 'neutro'
    const [marca, palabra] = REVISOR[valor] ?? ['', '']
    revisor.dataset.estado = valor
    revisor.querySelector('.rev__m').textContent = marca
    revisor.querySelector('.rev__t').textContent = palabra ? `${NOMBRES_REVISORES[id]} ${palabra}` : NOMBRES_REVISORES[id]
  }
  const ids = [...ruta.querySelectorAll('[data-paso]')].map((li) => li.dataset.paso)
  for (const seg of dial.querySelectorAll('[data-seg]')) {
    const estado = estados[seg.dataset.seg]
    seg.dataset.estado = estado
    const texto = seg.querySelector('text')
    texto.textContent = MARCA[estado] ?? String(ids.indexOf(seg.dataset.seg) + 1)
  }
  const primera = ids.findIndex((id) => estados[id] !== 'hecha')
  const completas = primera === -1
  dial.querySelector('[data-centro]').textContent = String(completas ? ids.length : primera + 1)
  dial.querySelector('title').textContent = pintado
    ? completas ? `Las ${ids.length} estaciones están hechas` : `Estación ${primera + 1} de ${ids.length}`
    : 'Progreso de la petición'
  return pintado
}
