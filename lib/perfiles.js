// The profiles a requester chooses from, and what each one may ask for (odd/tasks/perfil-elegido.md).
// A chosen profile proves nothing (anyone can pick Negocio), so it only restricts: the risk gate still decides what
// merges by what the diff touches, never by who asked. Pure and web-standard: the intake, the factory and the pages
// read it.

export const PERFILES = {
  marketing: { nombre: 'Marketing', tipos: ['campana', 'estilo', 'bug'] },
  producto: { nombre: 'Producto', tipos: ['producto', 'destino', 'feature', 'bug'] },
  negocio: { nombre: 'Negocio', tipos: ['precios', 'descuentos', 'transporte', 'cambio', 'bug'] },
}

// What a kind does, as the end of "Marketing no puede …" and of the list on the request page.
export const ACCION = {
  campana: 'crear campañas',
  producto: 'añadir productos',
  destino: 'añadir destinos',
  precios: 'cambiar precios',
  descuentos: 'cambiar descuentos',
  transporte: 'cambiar tarifas de transporte',
  estilo: 'cambiar el aspecto de la web',
  bug: 'arreglar fallos',
  feature: 'añadir secciones nuevas',
  cambio: 'cambiar reglas del presupuesto',
}

export const esPerfil = (value) => typeof value === 'string' && Object.hasOwn(PERFILES, value)

// The surfaces of factory/kinds.yaml (test/perfiles.test.mjs keeps them in step).
const CARPETAS = [['content/campanas/', 'campana'], ['catalogo/productos/', 'producto'], ['catalogo/destinos/', 'destino']]
const ARCHIVOS = {
  'data/precios.json': 'precios',
  'data/descuentos.json': 'descuentos',
  'config/transporte.json': 'transporte',
  'src/styles/global.css': 'estilo',
  'src/components/Paisaje.astro': 'estilo',
  'src/components/CampanaCard.astro': 'estilo',
  'src/components/ProductoCard.astro': 'estilo',
  'src/components/Header.astro': 'estilo',
  'src/components/Footer.astro': 'estilo',
}
const FEATURE = /^src\/features\/([^/]+)\//

// The kinds a changed path may belong to, or null when it is outside every kind (the gate's business, not the
// profile's). `added` lists the paths the change creates: a feature whose index.js is new is a new section.
export function tiposDe(path, added = []) {
  if (Object.hasOwn(ARCHIVOS, path)) return [ARCHIVOS[path]]
  for (const [carpeta, tipo] of CARPETAS) if (path.startsWith(carpeta) && path.length > carpeta.length) return [tipo]
  const feature = FEATURE.exec(path)
  if (feature) return added.includes(`src/features/${feature[1]}/index.js`) ? ['feature'] : ['bug']
  if (path.startsWith('src/domain/')) return ['bug', 'cambio']
  return null
}

// null when the profile may ask for every file of the change; else the public reason, naming who may ask for it.
export function fueraDePerfil(perfil, files, added = []) {
  const propio = esPerfil(perfil) ? PERFILES[perfil] : null
  for (const path of files) {
    const tipos = tiposDe(path, added)
    if (!tipos || (propio && tipos.some((t) => propio.tipos.includes(t)))) continue
    const accion = ACCION[tipos[0]]
    if (!propio) return `Esta petición no tiene un perfil válido: no puede ${accion}.`
    const otro = Object.values(PERFILES).find((p) => p.tipos.includes(tipos[0]))
    return `${propio.nombre} no puede ${accion}: pídelo como ${otro.nombre}.`
  }
  return null
}
