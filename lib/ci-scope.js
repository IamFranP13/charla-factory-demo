// How much CI a change needs. A pull request that only adds or changes JSON files directly in the new-file folders
// of factory/kinds.yaml (campaigns, products, destinations) is data the build validates (scripts/validate-content.mjs):
// it gets the build without the full suite. Anything else, or anything unclear, gets the full CI. Pure.

const DATA_FILE = /^[\w.-]+\.json$/

export const dataFolders = (kinds) =>
  Object.values(kinds ?? {}).filter((k) => k?.newFile === true).flatMap((k) => k.folders ?? [])

// `changes`: [{ status, path }] as `git diff --name-status --no-renames` gives them. Returns 'datos' or 'completo'.
export function ciScope(changes, kinds) {
  const folders = dataFolders(kinds)
  if (!Array.isArray(changes) || changes.length === 0 || folders.length === 0) return 'completo'
  const isData = ({ status, path }) => {
    if (status !== 'A' && status !== 'M') return false
    const folder = folders.find((f) => typeof path === 'string' && path.startsWith(f))
    const name = folder ? path.slice(folder.length) : ''
    return DATA_FILE.test(name) && !name.startsWith('.')
  }
  return changes.every(isData) ? 'datos' : 'completo'
}
