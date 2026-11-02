// "Del más barato al más caro": the priced products of the catalogue, in price order.

export default {
  id: 'ordenar-catalogo',
  titulo: 'Del más barato al más caro',
  donde: 'catalogo',
  calcular(estado) {
    const items = Object.entries(estado.productos)
      .filter(([id, producto]) => producto.disponible && estado.precios[id] > 0)
      .map(([id, producto]) => ({ nombre: producto.nombre, precio: estado.precios[id] }))
      .sort((a, b) => a.precio - b.precio)
      .map(({ nombre, precio }) => ({ texto: nombre, valor: `${precio.toFixed(2).replace('.', ',')} €/kg` }))
    return { tipo: 'lista', items }
  },
}
