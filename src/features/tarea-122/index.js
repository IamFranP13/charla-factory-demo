// "Precio medio por kilo": the average price per kg of the priced products.

export default {
  id: 'tarea-122',
  titulo: 'Precio medio por kilo',
  donde: 'catalogo',
  calcular(estado) {
    const precios = Object.keys(estado.productos)
      .map((id) => estado.precios[id])
      .filter((p) => Number.isFinite(p) && p > 0)
    if (precios.length === 0) return { tipo: 'texto', texto: 'Todavía no hay productos con precio.' }
    const media = precios.reduce((a, b) => a + b, 0) / precios.length
    return { tipo: 'texto', texto: `Precio medio del catálogo: ${media.toFixed(2).replace('.', ',')} €/kg` }
  },
}
