// The cheapest available product of each category.
export default {
  id: 'tarea-24',
  titulo: 'El más barato de cada categoría',
  donde: 'catalogo',
  calcular(estado) {
    const mejores = {}
    for (const [id, producto] of Object.entries(estado.productos)) {
      const precio = estado.precios[id]
      if (!producto.disponible || !(precio > 0)) continue
      if (!mejores[producto.categoria] || precio < mejores[producto.categoria].precio) mejores[producto.categoria] = { nombre: producto.nombre, precio }
    }
    const filas = Object.entries(mejores).map(([categoria, mejor]) => [categoria === 'fruta' ? 'Fruta' : 'Hortaliza', mejor.nombre, mejor.precio.toFixed(2).replace('.', ',') + ' €/kg'])
    return { tipo: 'tabla', columnas: ['Categoría', 'Producto', 'Precio'], filas }
  },
}
