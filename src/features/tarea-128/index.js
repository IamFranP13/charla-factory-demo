// "Más barato por categoría": the cheapest priced product of each category.

export default {
  id: 'tarea-128',
  titulo: 'Producto más barato por categoría',
  donde: 'catalogo',
  calcular(estado) {
    const mejor = {}
    for (const id of Object.keys(estado.productos)) {
      const p = estado.precios[id]
      const prod = estado.productos[id] || {}
      if (!Number.isFinite(p) || p <= 0) continue
      const cat = prod.categoria || 'otros'
      if (!mejor[cat] || p < mejor[cat].p) mejor[cat] = { p, nombre: prod.nombre || id }
    }
    const cats = Object.keys(mejor).sort()
    if (cats.length === 0) return { tipo: 'texto', texto: 'Todavía no hay productos con precio.' }
    return {
      tipo: 'tabla',
      columnas: ['Categoría', 'Producto', '€/kg'],
      filas: cats.map((c) => [c, mejor[c].nombre, mejor[c].p.toFixed(2).replace('.', ',')]),
    }
  },
}
