// Linear for the agent lane: the GraphQL calls (personal API key, injected fetch), and the small pure pieces around
// them (the progress comment, which comments are an answer). Platform code: it never imports src/.

export const ENDPOINT = 'https://api.linear.app/graphql'
export const DEFAULT_LABEL = 'factory'
export const FAILED_LABEL = 'factory-fallida'
// Hidden in every comment the agent lane writes, so its own comments are never read back as the owner's answer.
export const MARKER = '<!-- factory-agente -->'

const STAGE_NAMES = {
  triage: 'triaje',
  investigating: 'investigando',
  implementing: 'implementando',
  verifying: 'verificando',
  pr: 'abriendo la PR',
  waiting: 'esperando tu respuesta',
  failed: 'fallida',
}

// --- Pure pieces ---

export function formatElapsed(ms) {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(seconds / 60)
  return minutes ? `${minutes} min ${String(seconds % 60).padStart(2, '0')} s` : `${seconds} s`
}

/** The one comment that is edited as the run advances. */
export function renderProgress({ stage, elapsedMs = 0, tokens = 0, cost = 0, note, pr }) {
  const lines = [
    `Agente · etapa: ${STAGE_NAMES[stage] ?? stage}`,
    `Tiempo: ${formatElapsed(elapsedMs)} · Tokens: ${tokens} · Coste: $${Number(cost).toFixed(2)}`,
  ]
  if (pr) lines.push(`PR: ${pr}`)
  if (note) lines.push('', note)
  return `${lines.join('\n')}\n\n${MARKER}`
}

export const renderQuestion = (question) => `El agente necesita una decisión para seguir. Responde con un comentario nuevo en esta tarea:\n\n${question}\n\n${MARKER}`

/**
 * The owner's comments written after `since` (an ISO time), oldest first, as one answer; null when there is none.
 * Only comments by the API key's own user count, and never the ones the lane wrote itself.
 */
export function answerAfter(comments, { since, viewerId }) {
  const answers = comments
    .filter((c) => c.user?.id === viewerId && !String(c.body ?? '').includes(MARKER) && Date.parse(c.createdAt) > Date.parse(since))
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
  return answers.length ? answers.map((c) => c.body.trim()).join('\n\n') : null
}

/** The team's states by role: unstarted (Todo), started (In Progress), review (In Review) and completed (Done). */
export function pickStates(states) {
  const byType = (type) => states.filter((s) => s.type === type).sort((a, b) => a.position - b.position)
  const named = (list, name) => list.find((s) => s.name.toLowerCase() === name)
  const started = byType('started')
  const unstarted = byType('unstarted')
  const completed = byType('completed')
  const progress = named(started, 'in progress') ?? started[0]
  const picked = {
    todo: named(unstarted, 'todo') ?? unstarted[0],
    progress,
    review: named(started, 'in review') ?? progress,
    done: named(completed, 'done') ?? completed[0],
  }
  const missing = Object.entries(picked).filter(([, s]) => !s).map(([role]) => role)
  if (missing.length) throw new Error(`al equipo de Linear le faltan estados (${missing.join(', ')})`)
  return picked
}

// --- The client ---

const ISSUE_FIELDS = 'id identifier title description url labels { nodes { id name } }'

/** A Linear client. `fetch` is injected; every call throws on an HTTP or GraphQL error. */
export function createLinear({ apiKey, fetch = globalThis.fetch }) {
  const call = async (query, variables = {}) => {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: apiKey },
      body: JSON.stringify({ query, variables }),
    })
    if (!response.ok) throw new Error(`Linear respondió HTTP ${response.status}`)
    const body = await response.json()
    if (body.errors?.length) throw new Error(`Linear: ${body.errors.map((e) => e.message).join('; ')}`)
    return body.data
  }

  return {
    /** The API key's user, the team's states and its labels; creates the failure label when it is missing. */
    async setup({ team, label = DEFAULT_LABEL }) {
      const { viewer } = await call('query { viewer { id } }')
      const { teams } = await call('query($key: String!) { teams(filter: { key: { eq: $key } }) { nodes { id key states { nodes { id name type position } } } } }', { key: team })
      const found = teams.nodes[0]
      if (!found) throw new Error(`no existe el equipo de Linear ${team}`)
      const labelId = async (name, create) => {
        const { issueLabels } = await call('query($name: String!) { issueLabels(filter: { name: { eq: $name } }) { nodes { id team { key } } } }', { name })
        const match = issueLabels.nodes.find((l) => l.team?.key === team) ?? issueLabels.nodes.find((l) => !l.team)
        if (match) return match.id
        if (!create) throw new Error(`no existe la etiqueta de Linear ${name}`)
        const made = await call('mutation($input: IssueLabelCreateInput!) { issueLabelCreate(input: $input) { issueLabel { id } } }', { input: { name, teamId: found.id } })
        return made.issueLabelCreate.issueLabel.id
      }
      return {
        viewerId: viewer.id,
        teamId: found.id,
        states: pickStates(found.states.nodes),
        labels: { entrada: await labelId(label, false), fallida: await labelId(FAILED_LABEL, true) },
      }
    },

    /** The team's issues with the label in an unstarted state, oldest first. */
    async candidates({ team, label = DEFAULT_LABEL, first = 50 }) {
      const { issues } = await call(
        `query($team: String!, $label: String!, $first: Int!) { issues(first: $first, orderBy: createdAt, filter: { team: { key: { eq: $team } }, labels: { some: { name: { eq: $label } } }, state: { type: { eq: "unstarted" } } }) { nodes { ${ISSUE_FIELDS} createdAt } } }`,
        { team, label, first },
      )
      return issues.nodes.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
    },

    async comments(issueId) {
      const { issue } = await call('query($id: String!) { issue(id: $id) { comments(first: 100) { nodes { id body createdAt user { id } } } } }', { id: issueId })
      return issue.comments.nodes
    },

    async createComment(issueId, body) {
      const { commentCreate } = await call('mutation($input: CommentCreateInput!) { commentCreate(input: $input) { comment { id createdAt } } }', { input: { issueId, body } })
      return commentCreate.comment
    },

    async updateComment(id, body) {
      await call('mutation($id: String!, $input: CommentUpdateInput!) { commentUpdate(id: $id, input: $input) { success } }', { id, input: { body } })
    },

    async moveTo(issueId, stateId) {
      await call('mutation($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success } }', { id: issueId, input: { stateId } })
    },

    /** Replaces one label with another and moves the issue, in one update. */
    async swapLabel(issueId, { remove, add, stateId }) {
      const { issue } = await call('query($id: String!) { issue(id: $id) { labels { nodes { id } } } }', { id: issueId })
      const labelIds = [...new Set([...issue.labels.nodes.map((l) => l.id).filter((id) => id !== remove), add])]
      await call('mutation($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success } }', { id: issueId, input: { labelIds, ...(stateId && { stateId }) } })
    },
  }
}
