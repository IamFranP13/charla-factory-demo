// Files created for the audience (content/*/tarea-<n>.json, catalogo/*/tarea-<n>.json, src/features/tarea-<n>/,
// src/domain/tarea-<n>*.js and tarea-<n>*.test.mjs).
// Rehearsal copies of the repository and the demo reset leave them out, so tests behave the same before and after a talk.
export const isAudienceFile = (path) =>
  /(^|[\\/])(content|catalogo)[\\/][^\\/]+[\\/]tarea-\d+\.json$/.test(path) ||
  /(^|[\\/])src[\\/]features[\\/]tarea-\d+([\\/]|$)/.test(path) ||
  /(^|[\\/])src[\\/]domain[\\/]tarea-\d+(-[^\\/]*)?\.(js|test\.mjs)$/.test(path)
