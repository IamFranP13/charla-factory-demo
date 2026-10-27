// Polls a JSON endpoint every 5 seconds. `alRecibir(body)` returns true when there is nothing more to wait for.
// A failed request (offline, 404 for a task the 10 s cache does not know yet) never stops the polling.
export const CADA_MS = 5000

export function sondear(url, alRecibir, alFallar = () => {}) {
  let timer
  let parado = false
  async function vuelta() {
    try {
      const response = await fetch(url, { cache: 'no-store' })
      const body = await response.json().catch(() => ({}))
      if (response.ok) {
        if (alRecibir(body)) parado = true
      } else {
        alFallar(response.status)
      }
    } catch {
      alFallar(0)
    }
    if (!parado) timer = setTimeout(vuelta, CADA_MS)
  }
  vuelta()
  return () => {
    parado = true
    clearTimeout(timer)
  }
}
