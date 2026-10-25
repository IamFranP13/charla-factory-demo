// The closing numbers: what the factory did with the audience's requests.

const MARKER = /<!-- factory:result (.+?) -->/

// The factory comments with GITHUB_TOKEN: anyone else's marker is a forgery.
const FACTORY_COMMENTER = 'github-actions[bot]'

export function resultFromComments(comments) {
  for (const { body, user } of [...comments].reverse()) {
    if (user?.login !== FACTORY_COMMENTER) continue
    const match = String(body ?? '').match(MARKER)
    if (!match) continue
    try {
      return JSON.parse(match[1])
    } catch {
      return null
    }
  }
  return null
}

// tasks: [{ result: <factory result or null>, pr: { merged, blocked } | null }]
// prices in euros per million tokens.
export function summarize(tasks, { priceIn = 0, priceOut = 0 } = {}) {
  const done = tasks.filter((t) => t.result)
  const input = done.reduce((n, t) => n + (t.result.usage?.input ?? 0), 0)
  const output = done.reduce((n, t) => n + (t.result.usage?.output ?? 0), 0)
  const ms = done.reduce((n, t) => n + (t.result.ms ?? 0), 0)
  return {
    peticiones: tasks.length,
    enMain: tasks.filter((t) => t.pr?.merged).length,
    bloqueadas: tasks.filter((t) => t.pr && !t.pr.merged && t.pr.blocked).length,
    rechazadas: done.filter((t) => t.result.status === 'rejected').length,
    fallidas: done.filter((t) => t.result.status === 'failed').length,
    enCurso: tasks.length - done.length,
    tokens: input + output,
    coste: (input * priceIn + output * priceOut) / 1e6,
    tiempoMedioS: done.length ? Math.round(ms / done.length / 1000) : 0,
  }
}

export function renderNumbers(s) {
  const euros = s.coste.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const rows = [
    ['Peticiones', s.peticiones],
    ['En producción', s.enMain],
    ['Esperando a una persona', s.bloqueadas],
    ['Rechazadas por los revisores', s.rechazadas],
    ['Fallidas', s.fallidas],
    ['En curso', s.enCurso],
    ['Tokens', s.tokens.toLocaleString('es-ES')],
    ['Coste total', `${euros} €`],
    ['Tiempo medio', `${s.tiempoMedioS} s`],
  ]
  return rows.map(([k, v]) => `${k.padEnd(30)} ${v}`).join('\n')
}

// The factory's pull request for a task: branch tarea/<n> in this very repository (not a fork).
export function pullForTask(pulls, number, repo) {
  return pulls.find((p) => p.head?.ref === `tarea/${number}` && p.head?.repo?.full_name?.toLowerCase() === repo.toLowerCase())
}
