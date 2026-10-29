// The factory flow diagram as data: where every node sits, the connectors between them and the slots where the
// request tokens rest. Pure, no DOM: the page renders it as SVG on the server and the client script reads the same
// numbers to place and move the tokens. Two layouts: horizontal (wide screens) and vertical (laptops and phones).

export const REVISORES = ['seguridad', 'ux', 'ui', 'codigo']
export const TOKEN = Object.freeze({ ancho: 42, alto: 26, paso: 46 })

// Names, sublabels and what each node does, as the board says them (one entry per node, in flow order).
export const NODOS = Object.freeze({
  entrada: { nombre: 'Entrada', sub: 'formulario', paso: 1, hace: 'Aquí llega cada petición del formulario, tal cual la escribe quien la pide.' },
  spec: { nombre: 'Spec writer', sub: 'clasifica el tipo', paso: 2, hace: 'Lee brain/ (marca, tono, decisiones) y clasifica la petición en un tipo: eso decide qué archivos se pueden tocar.' },
  build: { nombre: 'Builder', sub: 'escribe el cambio', paso: 3, hace: 'Escribe el cambio dentro de la superficie de su tipo: un archivo nuevo de datos o, como mucho, 3 archivos de código con sus tests.' },
  seguridad: { nombre: 'Seguridad', sub: 'secretos · riesgo', paso: 4, hace: 'Busca secretos y código peligroso.' },
  ux: { nombre: 'UX', sub: 'texto · uso', paso: 5, hace: 'Juzga la experiencia: el texto, el orden de lectura y si el cambio hace lo que se pidió.' },
  ui: { nombre: 'UI', sub: 'aspecto · tokens', paso: 6, hace: 'Juzga el aspecto contra el sistema de diseño: tokens, contraste y maquetación.' },
  codigo: { nombre: 'Código', sub: 'tests · reglas', paso: 7, hace: 'Comprueba esquemas y reglas del catálogo y ejecuta los tests en un sandbox sin red ni secretos. Es código, no un modelo.' },
  approver: { nombre: 'Approver', sub: '4 aprobaciones', paso: 8, hace: 'Cuenta las cuatro aprobaciones: si están las cuatro pasa; si no, vuelve a Builder una vez con todos los motivos. Un segundo rechazo termina la petición.' },
  puerta: { nombre: '¿Humano?', sub: '', paso: 9, hace: 'Decide el diff, no quien lo pide: precios, descuentos, dominio y plataforma esperan a una persona; campañas, catálogo y estilo con comprobación pasan solos.' },
  main: { nombre: 'Main', sub: 'merge directo', paso: 10, hace: 'Los cambios seguros se unen a main por sí solos y se despliegan.' },
  pr: { nombre: 'PR', sub: 'espera revisión', paso: 10, hace: 'El cambio de riesgo espera aquí, como pull request, a que una persona lo apruebe; después se une a main.' },
  produccion: { nombre: 'Producción', sub: 'ya en la web', paso: 11, hace: 'Ya está en la web.' },
  rechazadas: { nombre: 'Rechazadas', sub: 'no se publica', paso: 0, hace: 'La factory ha rechazado la petición: no se publica y el motivo queda a la vista.' },
})
export const IDS_NODOS = Object.keys(NODOS)

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
    case 'centro-v': return { x: a.x, y: 352 }
    default: return { x: mx, y: my }
  }
}
export const anchoEtiqueta = (texto) => texto.length * 6.9 + 12

// { W, H, N: nodes by id, E: connectors, F: the frame of the parallel review }.
// A connector with `oculta` is never drawn: it only gives the tokens a way to travel (reviewer to reviewer, build to a reviewer).
export function geometria(vertical) {
  const N = {}
  const E = []
  const F = {}
  const mk = (id, x, y, w, h, o = {}) => (N[id] = { id, x, y, w, h, cap: Math.floor((w - 8) / TOKEN.paso), dx: 6, dy: h - 31, ...o })
  if (!vertical) {
    const NH = 108
    const NW = 156
    const P = 160
    const TOP = 84
    const M = 16
    const mid = TOP + (3 * P + NH) / 2
    let x = M
    const nodo = (id, w, o = {}) => {
      mk(id, x, mid - NH / 2, w, NH, o)
      x += w
    }
    nodo('entrada', 116, { term: true, dx: 10 })
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
    mk('puerta', x, mid - 88, 196, 176, { dec: true, dx: 48, dy: 108, cap: 2 })
    x += 196 + 52
    nodo('main', NW)
    x += 40
    nodo('produccion', 150, { term: true, dx: 10 })
    const W = x + M
    const H = TOP + 3 * P + NH + 28
    const LOW = mid + 88 + 64
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
    for (const a of REVISORES) for (const b of REVISORES) {
      if (a !== b) E.push({ id: `t-${a}-${b}`, a, b, oculta: true, pts: [L(N[a]), { x: bus1, y: cy(N[a]) }, { x: bus1, y: cy(N[b]) }, L(N[b])] })
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

  // Vertical: a single column, the four reviewers in a 2 × 2 frame.
  const W = 372
  const H = 1180
  const cxm = 210
  const sw = 240
  const sx = cxm - sw / 2
  mk('entrada', sx, 8, sw, 84, { term: true, dx: 12 })
  mk('spec', sx, 128, sw, 84)
  mk('build', sx, 248, sw, 84)
  Object.assign(F, { x: 44, y: 372, w: 316, h: 240, t: 'REVISIÓN EN PARALELO' })
  mk('seguridad', 52, 408, 156, 84)
  mk('ux', 218, 408, 142, 84)
  mk('ui', 52, 504, 156, 84)
  mk('codigo', 218, 504, 142, 84)
  mk('approver', 52, 648, 132, 84, { focal: true })
  mk('rechazadas', 228, 648, 132, 84, { term: true, err: true, dx: 8 })
  mk('puerta', cxm - 120, 768, 240, 140, { dec: true, dx: 70, dy: 92, cap: 2 })
  mk('main', 52, 940, 136, 84)
  mk('pr', 224, 940, 136, 84)
  mk('produccion', sx, 1068, sw, 84, { term: true, dx: 12 })
  E.push(
    { id: 'e1', a: 'entrada', b: 'spec', pts: [B(N.entrada), T(N.spec)] },
    { id: 'e2', a: 'spec', b: 'build', pts: [B(N.spec), T(N.build)] },
    { id: 'f-in', a: 'build', b: 'marco', pts: [B(N.build), { x: cxm, y: F.y }] },
  )
  const entra = {
    seguridad: [{ x: cxm, y: 384 }, { x: cx(N.seguridad), y: 384 }, T(N.seguridad)],
    ux: [{ x: cxm, y: 384 }, { x: cx(N.ux), y: 384 }, T(N.ux)],
    ui: [{ x: cxm, y: 392 }, { x: cxm, y: cy(N.ui) }, R(N.ui)],
    codigo: [{ x: cxm, y: 392 }, { x: cxm, y: cy(N.codigo) }, L(N.codigo)],
  }
  for (const id of REVISORES) {
    E.push({ id: `f-${id}`, a: 'build', b: id, oculta: true, pts: [B(N.build), ...entra[id]] })
    E.push({ id: `j-${id}`, a: id, b: 'approver', oculta: true, pts: [B(N[id]), { x: cx(N[id]), y: 624 }, { x: cx(N.approver), y: 630 }, T(N.approver)] })
  }
  E.push({ id: 'j-out', a: 'marco', b: 'approver', pts: [{ x: cxm, y: F.y + F.h }, { x: cxm, y: 624 }, { x: cx(N.approver), y: 624 }, T(N.approver)] })
  for (const a of REVISORES) for (const b of REVISORES) {
    if (a !== b) E.push({ id: `t-${a}-${b}`, a, b, oculta: true, pts: [{ x: cx(N[a]), y: cy(N[a]) }, { x: cx(N[b]), y: cy(N[b]) }] })
  }
  E.push(
    { id: 'e-ap', a: 'approver', b: 'puerta', pts: [B(N.approver), { x: cx(N.approver), y: 744 }, { x: cxm, y: 744 }, T(N.puerta)] },
    { id: 'e-auto', a: 'puerta', b: 'main', pts: [L(N.puerta), { x: N.main.x + 14, y: cy(N.puerta) }, { x: N.main.x + 14, y: N.main.y }], lab: 'AUTO', lpos: 'izq' },
    { id: 'e-per', a: 'puerta', b: 'pr', pts: [R(N.puerta), { x: N.pr.x + N.pr.w - 14, y: cy(N.puerta) }, { x: N.pr.x + N.pr.w - 14, y: N.pr.y }], lab: 'PERSONA', lpos: 'der' },
    { id: 'e-prm', a: 'pr', b: 'main', pts: [L(N.pr), R(N.main)], lab: 'OK', lpos: 'abajo' },
    { id: 'e-mp', a: 'main', b: 'produccion', pts: [B(N.main, -32), { x: N.main.x + N.main.w / 2 - 32, y: N.produccion.y }] },
    { id: 'e-rech', a: 'approver', b: 'rechazadas', pts: [R(N.approver), L(N.rechazadas)], lab: 'NO', lpos: 'arriba' },
    { id: 'e-vuelta', a: 'approver', b: 'build', vuelta: true, pts: [L(N.approver), { x: 30, y: cy(N.approver) }, { x: 30, y: cy(N.build) }, L(N.build)], lab: 'A BUILD', lpos: 'centro-v' },
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

// The way a token takes from one node to another: the connectors in order (breadth first) and the points they pass.
// `conVuelta`: the request went back to Build in between, so it travels the dashed loop (to the approver if it was not
// there, then back to Build, then on to where it is now). Returns { aristas, puntos }, or null when there is no way
// (the token then slides straight to its place).
export function camino(geo, a, b, { conVuelta = false } = {}) {
  const trayecto = (desde, hasta) => {
    if (desde === hasta) return []
    const cola = [[desde, []]]
    const vistos = new Set([desde])
    while (cola.length) {
      const [n, via] = cola.shift()
      for (const e of geo.E) {
        if (e.a !== n || vistos.has(e.b) || !geo.N[e.b]) continue
        const siguiente = [...via, e]
        if (e.b === hasta) return siguiente
        vistos.add(e.b)
        cola.push([e.b, siguiente])
      }
    }
    return null
  }
  let aristas
  if (conVuelta) {
    const ida = a === 'approver' ? [] : trayecto(a, 'approver')
    const resto = trayecto('build', b)
    aristas = ida && resto ? [...ida, geo.E.find((e) => e.vuelta), ...resto] : null
  } else if (b === 'rechazadas' && ['entrada', 'spec', 'build'].includes(a)) {
    aristas = null
  } else {
    aristas = trayecto(a, b)
  }
  if (!aristas || aristas.length === 0) return null
  const puntos = []
  for (const e of aristas) {
    for (const p of e.pts) {
      const ultimo = puntos[puntos.length - 1]
      if (!ultimo || ultimo.x !== p.x || ultimo.y !== p.y) puntos.push(p)
    }
  }
  return { aristas, puntos }
}
