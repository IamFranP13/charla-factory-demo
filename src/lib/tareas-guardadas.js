// The task numbers this browser has sent, newest last. Only numbers are stored.
export const CLAVE = 'limonia:tareas'
export const MAX_GUARDADAS = 20

export function leer() {
  try {
    const lista = JSON.parse(localStorage.getItem(CLAVE) ?? '[]')
    return Array.isArray(lista) ? lista.filter((n) => Number.isInteger(n) && n > 0).slice(-MAX_GUARDADAS) : []
  } catch {
    return []
  }
}

export function guardar(numero) {
  if (!Number.isInteger(numero) || numero < 1) return leer()
  const lista = [...leer().filter((n) => n !== numero), numero].slice(-MAX_GUARDADAS)
  try {
    localStorage.setItem(CLAVE, JSON.stringify(lista))
  } catch {
    // Private mode or full storage: the link right after sending still works.
  }
  return lista
}
