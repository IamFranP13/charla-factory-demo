// Browser side of the diagram: paints a task (`pintar`) on the boxes Diagrama.astro drew, fits the canvas to the screen
// and moves the task chips of the board. Every dynamic text goes through textContent.
import { pintar } from '../lib/diagrama.js'

const reducido = () => matchMedia('(prefers-reduced-motion: reduce)').matches

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

const MAX_FICHAS = 4
const MOVER_MS = 900

// The chips of the board: up to four `#N` per step ("+k" beyond), animated (FLIP) to their new step.
export function crearFichas(raiz) {
  const fichas = new Map()
  const masPorCaja = new Map()

  function ficha(numero) {
    let el = fichas.get(numero)
    if (!el) {
      el = document.createElement('span')
      el.className = 'ficha'
      el.textContent = `#${numero}`
      el.dataset.n = String(numero)
      fichas.set(numero, el)
      el.dataset.nueva = ''
    }
    return el
  }

  // `pasos`: { <paso>: [numbers, newest first] }. `rechazadas`, `desplegadas`: the numbers held in their box before they leave.
  function pintarFichas(pasos, { rechazadas = new Set(), desplegadas = new Set(), seguida = null } = {}) {
    const antes = new Map([...fichas].filter(([, el]) => el.isConnected).map(([n, el]) => [n, el.getBoundingClientRect()]))
    const presentes = new Set()
    for (const [id, numeros] of Object.entries(pasos)) {
      const caja = raiz.querySelector(`[data-paso="${id}"]`)
      const contenedor = caja.querySelector('[data-fichas]')
      const visibles = numeros.slice(0, MAX_FICHAS)
      const elementos = visibles.map((n) => {
        const el = ficha(n)
        presentes.add(n)
        el.classList.toggle('ficha--rechazada', rechazadas.has(n))
        el.classList.toggle('ficha--desplegada', desplegadas.has(n))
        el.classList.toggle('ficha--seguida', n === seguida)
        return el
      })
      if (numeros.length > MAX_FICHAS) {
        let mas = masPorCaja.get(id)
        if (!mas) {
          mas = document.createElement('span')
          mas.className = 'ficha ficha--mas'
          masPorCaja.set(id, mas)
        }
        mas.textContent = `+${numeros.length - MAX_FICHAS}`
        elementos.push(mas)
      } else {
        masPorCaja.get(id)?.remove()
      }
      contenedor.replaceChildren(...elementos)
      const contador = caja.querySelector('[data-n]')
      contador.textContent = String(numeros.length)
      contador.hidden = numeros.length === 0
      caja.toggleAttribute('data-ocupada', numeros.length > 0)
    }
    for (const [n, el] of fichas) {
      if (!presentes.has(n)) {
        el.remove()
        fichas.delete(n)
      }
    }
    if (reducido()) return
    for (const [n, el] of fichas) {
      const antesRect = antes.get(n)
      if (!antesRect) {
        el.animate([{ opacity: 0, transform: 'scale(.6)' }, { opacity: 1, transform: 'none' }], { duration: 500, easing: 'ease-out' })
        continue
      }
      const ahora = el.getBoundingClientRect()
      const dx = antesRect.left - ahora.left
      const dy = antesRect.top - ahora.top
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: MOVER_MS, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' })
    }
  }

  // A chip leaves its box towards a counter (rejected, in production) and disappears: a copy flies over the page.
  function retirar(numero, destino) {
    const el = fichas.get(numero)
    if (!el) return Promise.resolve()
    fichas.delete(numero)
    const a = el.getBoundingClientRect()
    el.remove()
    if (reducido() || !destino) return Promise.resolve()
    const b = destino.getBoundingClientRect()
    const copia = el.cloneNode(true)
    copia.classList.add('ficha--vuelo')
    copia.style.cssText = `position:fixed;left:${a.left}px;top:${a.top}px;margin:0;transform-origin:0 0;z-index:20;pointer-events:none`
    document.body.append(copia)
    const dx = b.left + b.width / 2 - a.left - a.width / 2
    const dy = b.top + b.height / 2 - a.top - a.height / 2
    const vuelo = copia.animate(
      [{ transform: 'none', opacity: 1 }, { transform: `translate(${dx}px, ${dy}px) scale(.5)`, opacity: 0 }],
      { duration: 1100, easing: 'ease-in', fill: 'forwards' },
    )
    return vuelo.finished.catch(() => {}).then(() => copia.remove())
  }

  return { pintarFichas, retirar }
}
