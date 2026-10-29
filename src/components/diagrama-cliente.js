// Browser side of the diagram: paints a task (`pintar`) on the boxes Diagrama.astro drew.
// Every dynamic text goes through textContent.
import { pintar } from '../lib/diagrama.js'

// A task (or null for the neutral board) painted on the steps inside `raiz`.
export function aplicar(raiz, tarea) {
  const pintado = tarea ? pintar(tarea) : null
  for (const paso of raiz.querySelectorAll('[data-paso]')) {
    const id = paso.dataset.paso
    paso.dataset.estado = pintado ? pintado.pasos[id] : 'neutro'
    const etiqueta = paso.querySelector('[data-etiqueta]')
    const texto = pintado?.etiquetas[id] ?? ''
    etiqueta.textContent = texto
    etiqueta.hidden = !texto
    if (id === 'destino') paso.querySelector('[data-nombre]').textContent = pintado ? pintado.destino : 'Main o PR'
  }
  for (const revisor of raiz.querySelectorAll('[data-revisor]')) revisor.dataset.estado = pintado ? pintado.revisores[revisor.dataset.revisor] : 'neutro'
  return pintado
}
