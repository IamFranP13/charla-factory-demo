// Build-time data for the pages. Runs in Node during `astro build` (cwd = repository root).
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cargarEstado } from '../../lib/estado-node.js'

const root = process.cwd()

export const estado = cargarEstado(root)

export function campanas() {
  const folder = join(root, 'content/campanas')
  return readdirSync(folder)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => ({ id: name.slice(0, -'.json'.length), ...JSON.parse(readFileSync(join(folder, name), 'utf8')) }))
}

/** Catalog products in file order, with their price per kg (null when none is set). */
export function productos() {
  return Object.entries(estado.productos).map(([id, producto]) => ({ id, ...producto, precioKg: estado.precios[id] ?? null }))
}

export function destinos() {
  return Object.entries(estado.destinos).map(([id, destino]) => ({ id, ...destino, tarifa: estado.transporte[id] ?? null }))
}
