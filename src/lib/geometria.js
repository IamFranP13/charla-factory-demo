// The factory flow diagram as data: where every node sits, the connectors between them and the slots where the
// request tokens rest. Pure, no DOM: the page renders it as SVG on the server and the client script reads the same
// numbers to place and move the tokens. Two layouts: horizontal (wide screens) and vertical (laptops and phones).

import { ESTACIONES } from './explica.js'

export const REVISORES = ['seguridad', 'ux', 'ui', 'codigo']
export const TOKEN = Object.freeze({ ancho: 42, alto: 26, paso: 46 })

// Names, sublabels and the order of every node (one entry per node, in flow order). What each node does, and who does it,
// is said in src/lib/explica.js: `hace` below is its longer text.
const BASE = {
  entrada: { nombre: 'Entrada', sub: 'formulario', paso: 1 },
  spec: { nombre: 'Spec writer', sub: 'clasifica el tipo', paso: 2 },
  build: { nombre: 'Builder', sub: 'escribe el cambio', paso: 3 },
  seguridad: { nombre: 'Seguridad', sub: 'secretos · riesgo', paso: 4 },
  ux: { nombre: 'UX', sub: 'texto · uso', paso: 5 },
  ui: { nombre: 'UI', sub: 'aspecto · tokens', paso: 6 },
  codigo: { nombre: 'Código', sub: 'tests · reglas', paso: 7 },
  approver: { nombre: 'Approver', sub: '4 aprobaciones', paso: 8 },
  puerta: { nombre: '¿Humano?', sub: '', paso: 9 },
  main: { nombre: 'Main', sub: 'merge directo', paso: 10 },
  pr: { nombre: 'PR', sub: 'espera revisión', paso: 10 },
  produccion: { nombre: 'Producción', sub: 'ya en la web', paso: 11 },
  rechazadas: { nombre: 'Rechazadas', sub: 'no se publica', paso: 0 },
}
export const NODOS = Object.freeze(Object.fromEntries(Object.entries(BASE).map(([id, n]) => [id, Object.freeze({ ...n, hace: ESTACIONES[id].largo })])))
export const IDS_NODOS = Object.keys(NODOS)

// The line in each box is drawn at 14 px: about 6.9 px a character. It wraps on whole words, in at most two lines.
export const CARACTERES_POR_PX = 1 / 6.9
export const LINEAS_NODO = 2
export function envuelve(texto, max) {
  const lineas = []
  let actual = ''
  for (const palabra of String(texto).split(/\s+/).filter(Boolean)) {
    if (actual && actual.length + 1 + palabra.length > max) {
      lineas.push(actual)
      actual = palabra
    } else {
      actual = actual ? `${actual} ${palabra}` : palabra
    }
  }
  return actual ? [...lineas, actual] : lineas
}

const R = (n, dy = 0) => ({ x: n.x + n.w, y: n.y + n.h / 2 + dy })
const L = (n, dy = 0) => ({ x: n.x, y: n.y + n.h / 2 + dy })
const T = (n, dx = 0) => ({ x: n.x + n.w / 2 + dx, y: n.y })
const B = (n, dx = 0) => ({ x: n.x + n.w / 2 + dx, y: n.y + n.h })
export const cx = (n) => n.x + n.w / 2
export const cy = (n) => n.y + n.h / 2

// An orthogonal polyline with rounded corners (quarter arcs of radius 8) as an SVG path.
export function trazo(pts, r = 8) {
  let d = `M${pts[0].x} ${pts[0].y}`
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i - 1]
    const c = pts[i]
    const n = pts[i + 1]
    if (!n) {
      d += ` L${c.x} ${c.y}`
      break
    }
    const l1 = Math.hypot(c.x - p.x, c.y - p.y)
    const l2 = Math.hypot(n.x - c.x, n.y - c.y)
    const rr = Math.min(r, l1 / 2, l2 / 2)
    const a = { x: c.x - ((c.x - p.x) / l1) * rr, y: c.y - ((c.y - p.y) / l1) * rr }
    const b = { x: c.x + ((n.x - c.x) / l2) * rr, y: c.y + ((n.y - c.y) / l2) * rr }
    d += ` L${a.x} ${a.y} Q${c.x} ${c.y} ${b.x} ${b.y}`
  }
  return d
}

// The centre of the label of a connector, on its longest segment.
export function etiquetaPos(e, w) {
  let mejor = 0
  let bi = 1
  for (let i = 1; i < e.pts.length; i++) {
    const largo = Math.hypot(e.pts[i].x - e.pts[i - 1].x, e.pts[i].y - e.pts[i - 1].y)
    if (largo > mejor) {
      mejor = largo
      bi = i
    }
  }
  const a = e.pts[bi - 1]
  const b = e.pts[bi]
  const mx = (a.x + b.x) / 2
  const my = (a.y + b.y) / 2
  switch (e.lpos) {
    case 'arriba': return { x: mx, y: my - 14 }
    case 'abajo': return { x: mx, y: my + 20 }
    case 'derecha': return { x: mx + w / 2 + 8, y: my }
    case 'der': return { x: b.x - w / 2 - 8, y: my }
    case 'izq': return { x: a.x + w / 2 - 4, y: my - 14 }
    case 'centro-v': return { x: a.x, y: e.ly ?? 352 }
    default: return { x: mx, y: my }
  }
}
export const anchoEtiqueta = (texto) => texto.length * 6.9 + 12

// { W, H, N: nodes by id, E: connectors, F: the frame of the parallel review }.
// A connector with `oculta` is never drawn: it only exists to be lit (Builder to a reviewer, a reviewer to the approver).
export function geometria(vertical) {
  const N = {}
  const E = []
  const F = {}
  const mk = (id, x, y, w, h, o = {}) => (N[id] = { id, x, y, w, h, cap: Math.floor((w - 8) / TOKEN.paso), dx: 6, dy: h - 31, ...o })
  if (!vertical) {
    const NH = 128
    const NW = 156
    const P = 152
    const TOP = 84
    const M = 16
    const mid = TOP + (3 * P + NH) / 2
    let x = M
    const nodo = (id, w, o = {}) => {
      mk(id, x, mid - NH / 2, w, NH, o)
      x += w
    }
    nodo('entrada', 140, { term: true, dx: 10 })
    x += 36
    nodo('spec', NW)
    x += 36
    nodo('build', NW)
    x += 46
    const rx = x
    REVISORES.forEach((id, i) => mk(id, rx, TOP + i * P, NW, NH))
    x += NW + 46
    nodo('approver', NW, { focal: true })
    x += 46
    mk('puerta', x, mid - 108, 224, 216, { dec: true, dx: 48, dy: 152, cap: 2 })
    x += 224 + 52
    nodo('main', NW)
    x += 40
    nodo('produccion', 150, { term: true, dx: 10 })
    const W = x + M
    const H = TOP + 3 * P + NH + 28
    const LOW = mid + 108 + 64
    mk('pr', cx(N.puerta) - NW / 2, LOW, NW, NH)
    mk('rechazadas', N.approver.x, LOW, NW, NH, { term: true, err: true, dx: 10 })
    Object.assign(F, { x: rx - 14, y: TOP - 36, w: NW + 28, h: 3 * P + NH + 36 + 16, t: 'REVISIÓN EN PARALELO' })
    const bus1 = N.build.x + N.build.w + 23
    const bus2 = rx + NW + 23
    E.push(
      { id: 'e1', a: 'entrada', b: 'spec', pts: [R(N.entrada), L(N.spec)] },
      { id: 'e2', a: 'spec', b: 'build', pts: [R(N.spec), L(N.build)] },
    )
    for (const id of REVISORES) {
      const r = N[id]
      E.push({ id: `f-${id}`, a: 'build', b: id, pts: [R(N.build), { x: bus1, y: mid }, { x: bus1, y: cy(r) }, L(r)] })
      E.push({ id: `j-${id}`, a: id, b: 'approver', pts: [R(r), { x: bus2, y: cy(r) }, { x: bus2, y: mid }, L(N.approver)] })
    }
    E.push(
      { id: 'e-ap', a: 'approver', b: 'puerta', pts: [R(N.approver), L(N.puerta)] },
      { id: 'e-auto', a: 'puerta', b: 'main', pts: [R(N.puerta), L(N.main)], lab: 'AUTO', lpos: 'arriba' },
      { id: 'e-per', a: 'puerta', b: 'pr', pts: [B(N.puerta), T(N.pr)], lab: 'PERSONA', lpos: 'derecha' },
      { id: 'e-prm', a: 'pr', b: 'main', pts: [R(N.pr), { x: cx(N.main), y: cy(N.pr) }, B(N.main)], lab: 'TRAS APROBAR', lpos: 'arriba' },
      { id: 'e-mp', a: 'main', b: 'produccion', pts: [R(N.main), L(N.produccion)] },
      { id: 'e-rech', a: 'approver', b: 'rechazadas', pts: [B(N.approver), T(N.rechazadas)], lab: '2.º RECHAZO', lpos: 'derecha' },
      { id: 'e-vuelta', a: 'approver', b: 'build', vuelta: true, pts: [T(N.approver), { x: cx(N.approver), y: 24 }, { x: cx(N.build), y: 24 }, T(N.build)], lab: 'VUELVE A BUILD · SOLO 1 VEZ', lpos: 'arriba' },
    )
    return { W, H, N, E, F }
  }

  // Vertical: a single column, the four reviewers in a 2 × 2 frame. Every y follows from the one before it.
  const W = 372
  const cxm = 210
  const sw = 240
  const sx = cxm - sw / 2
  const NV = 124
  mk('entrada', sx, 8, sw, NV, { term: true, dx: 12 })
  mk('spec', sx, 8 + NV + 36, sw, NV)
  mk('build', sx, 8 + 2 * (NV + 36), sw, NV)
  const fy = N.build.y + NV + 40
  const fila1 = fy + 36
  const fila2 = fila1 + NV + 12
  Object.assign(F, { x: 44, y: fy, w: 316, h: fila2 + NV + 24 - fy, t: 'REVISIÓN EN PARALELO' })
  mk('seguridad', 52, fila1, 156, NV)
  mk('ux', 218, fila1, 142, NV)
  mk('ui', 52, fila2, 156, NV)
  mk('codigo', 218, fila2, 142, NV)
  const fin = fy + F.h
  const ay = fin + 36
  mk('approver', 52, ay, 132, NV, { focal: true })
  mk('rechazadas', 228, ay, 132, NV, { term: true, err: true, dx: 8 })
  const py = ay + NV + 36
  mk('puerta', cxm - 120, py, 240, 176, { dec: true, dx: 70, dy: 128, cap: 2 })
  const my = py + 176 + 32
  mk('main', 52, my, 136, NV)
  mk('pr', 224, my, 136, NV)
  mk('produccion', sx, my + NV + 44, sw, NV, { term: true, dx: 12 })
  const H = N.produccion.y + NV + 28
  E.push(
    { id: 'e1', a: 'entrada', b: 'spec', pts: [B(N.entrada), T(N.spec)] },
    { id: 'e2', a: 'spec', b: 'build', pts: [B(N.spec), T(N.build)] },
    { id: 'f-in', a: 'build', b: 'marco', pts: [B(N.build), { x: cxm, y: F.y }] },
  )
  const entra = {
    seguridad: [{ x: cxm, y: fy + 12 }, { x: cx(N.seguridad), y: fy + 12 }, T(N.seguridad)],
    ux: [{ x: cxm, y: fy + 12 }, { x: cx(N.ux), y: fy + 12 }, T(N.ux)],
    ui: [{ x: cxm, y: fy + 20 }, { x: cxm, y: cy(N.ui) }, R(N.ui)],
    codigo: [{ x: cxm, y: fy + 20 }, { x: cxm, y: cy(N.codigo) }, L(N.codigo)],
  }
  for (const id of REVISORES) {
    E.push({ id: `f-${id}`, a: 'build', b: id, oculta: true, pts: [B(N.build), ...entra[id]] })
    E.push({ id: `j-${id}`, a: id, b: 'approver', oculta: true, pts: [B(N[id]), { x: cx(N[id]), y: fin + 12 }, { x: cx(N.approver), y: fin + 18 }, T(N.approver)] })
  }
  E.push({ id: 'j-out', a: 'marco', b: 'approver', pts: [{ x: cxm, y: F.y + F.h }, { x: cxm, y: fin + 12 }, { x: cx(N.approver), y: fin + 12 }, T(N.approver)] })
  E.push(
    { id: 'e-ap', a: 'approver', b: 'puerta', pts: [B(N.approver), { x: cx(N.approver), y: ay + NV + 12 }, { x: cxm, y: ay + NV + 12 }, T(N.puerta)] },
    { id: 'e-auto', a: 'puerta', b: 'main', pts: [L(N.puerta), { x: N.main.x + 14, y: cy(N.puerta) }, { x: N.main.x + 14, y: N.main.y }], lab: 'AUTO', lpos: 'izq' },
    { id: 'e-per', a: 'puerta', b: 'pr', pts: [R(N.puerta), { x: N.pr.x + N.pr.w - 14, y: cy(N.puerta) }, { x: N.pr.x + N.pr.w - 14, y: N.pr.y }], lab: 'PERSONA', lpos: 'der' },
    { id: 'e-prm', a: 'pr', b: 'main', pts: [L(N.pr), R(N.main)], lab: 'OK', lpos: 'abajo' },
    { id: 'e-mp', a: 'main', b: 'produccion', pts: [B(N.main, -32), { x: N.main.x + N.main.w / 2 - 32, y: N.produccion.y }] },
    { id: 'e-rech', a: 'approver', b: 'rechazadas', pts: [R(N.approver), L(N.rechazadas)], lab: 'NO', lpos: 'arriba' },
    { id: 'e-vuelta', a: 'approver', b: 'build', vuelta: true, pts: [L(N.approver), { x: 30, y: cy(N.approver) }, { x: 30, y: cy(N.build) }, L(N.build)], lab: 'A BUILD', lpos: 'centro-v', ly: N.build.y + NV + 20 },
  )
  return { W, H, N, E, F }
}

// Where the tokens of a node rest: a row of slots; when they do not fit the last slot becomes "+N" (`colapsa`).
// `lista` is the ordered list of request numbers in the node. Returns { out: [{ numero, x, y, visible }], colapsa, masX, masY, resto }.
export function slotsDe(nodo, lista) {
  const cap = nodo.cap
  const colapsa = lista.length > cap
  const baseX = nodo.dec ? cx(nodo) - (cap * TOKEN.paso - 4) / 2 : nodo.x + nodo.dx
  const y = nodo.y + nodo.dy
  const out = lista.map((numero, i) => {
    const visible = !colapsa || i < cap - 1
    return { numero, x: baseX + (visible ? i : cap - 1) * TOKEN.paso, y, visible }
  })
  return { out, colapsa, masX: baseX + (cap - 1) * TOKEN.paso, masY: y, resto: colapsa ? lista.length - (cap - 1) : 0 }
}
