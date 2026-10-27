// Sends a request to the factory and refreshes the wall while the talk goes on.

const form = document.getElementById('peticion')
const estado = document.getElementById('estado')
const muro = document.getElementById('muro')
const PERFILES = { marketing: 'Marketing', producto: 'Producto', negocio: 'Negocio' }

form.addEventListener('submit', async (event) => {
  event.preventDefault()
  const button = form.querySelector('button')
  const data = new FormData(form)
  button.disabled = true
  estado.textContent = 'Enviando…'
  try {
    const response = await fetch('/api/peticion', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        peticion: data.get('peticion'),
        turnstile: data.get('cf-turnstile-response') ?? '',
      }),
    })
    const body = await response.json().catch(() => ({}))
    estado.textContent = response.ok
      ? `Recibida: tarea #${body.tarea}. Te ha tocado pedirlo como ${PERFILES[body.perfil] ?? body.perfil}. Mira el muro en unos minutos.`
      : body.error ?? 'No se ha podido enviar.'
    if (response.ok) form.reset()
  } catch {
    estado.textContent = 'No se ha podido enviar. ¿Hay conexión?'
  } finally {
    button.disabled = false
    window.turnstile?.reset()
  }
})

const escape = (v) => String(v).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch])

async function refreshWall() {
  try {
    const cards = await (await fetch('muro.json', { cache: 'no-store' })).json()
    for (const c of cards) {
      if (document.getElementById(c.id)) continue
      muro.insertAdjacentHTML('beforeend', `<article class="card ${escape(c.color ?? 'amarillo')} nueva" id="${escape(c.id)}">
        ${c.emoji ? `<span class="emoji">${escape(c.emoji)}</span>` : ''}
        <p>${escape(c.texto)}</p>
        ${c.autor ? `<footer>— ${escape(c.autor)}</footer>` : ''}
      </article>`)
    }
  } catch {
    // Offline or mid-deploy: try again on the next tick.
  }
}

setInterval(refreshWall, 20000)
