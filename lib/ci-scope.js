// How much CI a change needs. A pull request that only adds new regular JSON files directly in the new-file folders
// of factory/kinds.yaml (campaigns, products, destinations: what the factory writes) is data the build validates
// (scripts/validate-content.mjs): it gets the build without the full suite. An edit of an existing data file is not
// (the sample orders of factory/muestras.json are only checked by the suite), nor a symlink or a submodule.
// Anything else, or anything unclear, gets the full CI. Pure.

const DATA_FILE = /^[\w.-]+\.json$/
const REGULAR_FILE = '100644'

export const dataFolders = (kinds) =>
  Object.values(kinds ?? {}).filter((k) => k?.newFile === true).flatMap((k) => k.folders ?? [])

// `changes`: [{ status, path, mode }] as `git diff --raw --no-renames` gives them (mode: the new one). Returns 'datos' or 'completo'.
export function ciScope(changes, kinds) {
  const folders = dataFolders(kinds)
  if (!Array.isArray(changes) || changes.length === 0 || folders.length === 0) return 'completo'
  const isData = ({ status, path, mode }) => {
    if (status !== 'A' || mode !== REGULAR_FILE) return false
    const folder = folders.find((f) => typeof path === 'string' && path.startsWith(f))
    const name = folder ? path.slice(folder.length) : ''
    return DATA_FILE.test(name) && !name.startsWith('.')
  }
  return changes.every(isData) ? 'datos' : 'completo'
}
