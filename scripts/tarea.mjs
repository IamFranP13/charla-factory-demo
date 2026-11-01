#!/usr/bin/env node
// Files one test request as the maintainer, with the owner's `gh`, in the exact format of the intake and with the label
// `origen:prueba`: the factory takes it by default (`npm run fabrica`), while requests from the web wait for `--origen web`.
//
//   npm run tarea -- [--perfil marketing|producto|negocio] "texto"
//
// Exit codes: 0 filed · 1 GitHub failure · 2 usage error.
import { pathToFileURL } from 'node:url'
import { gh as realGh } from '../lib/github.js'
import { checkPeticion, issueFor, MAX_LENGTH, MIN_LENGTH, PROFILES } from '../lib/intake.js'

const USAGE = `Uso: npm run tarea -- [--perfil ${Object.keys(PROFILES).join('|')}] "texto"
  texto          la petición, de ${MIN_LENGTH} a ${MAX_LENGTH} caracteres, entre comillas
  --perfil P     quién la pide (por defecto marketing)
  --ayuda        esta ayuda

Crea una issue con tu \`gh\`, igual que la web pero con la etiqueta origen:prueba, y escribe su número.
\`npm run fabrica\` coge por defecto solo las de origen prueba.`

export async function run(argv, { gh = realGh, out = console.log, err = console.error } = {}) {
  const usage = (message) => { err(`tarea: ${message}\n${USAGE}`); return 2 }
  let perfil = 'marketing'
  const texts = []
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--ayuda' || argv[i] === '--help') { out(USAGE); return 0 }
    if (argv[i] === '--perfil') {
      perfil = argv[++i]
      if (!Object.hasOwn(PROFILES, perfil ?? '')) return usage(`--perfil debe ser ${Object.keys(PROFILES).join(', ')}`)
    } else if (argv[i].startsWith('--')) return usage(`opción desconocida: ${argv[i]}`)
    else texts.push(argv[i])
  }
  if (texts.length === 0) return usage('falta el texto de la petición')
  if (texts.length > 1) return usage('pasa un solo texto, entre comillas')
  const checked = checkPeticion(texts[0])
  if (checked.error) return usage(checked.error)

  try {
    const repo = process.env.GITHUB_REPOSITORY || gh(['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner']).trim()
    const issue = JSON.parse(gh(['api', '-X', 'POST', `repos/${repo}/issues`, '--input', '-'], { input: JSON.stringify(issueFor(perfil, checked.peticion, 'prueba')) }))
    if (!Number.isInteger(issue?.number)) throw new Error('GitHub no devolvió el número de la issue')
    out(`Tarea de prueba #${issue.number} creada (perfil ${perfil}, origen prueba).`)
    return 0
  } catch (error) {
    err(`tarea: no se pudo crear la issue: ${String(error?.message ?? error).split('\n')[0]}`)
    return 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await run(process.argv.slice(2))
