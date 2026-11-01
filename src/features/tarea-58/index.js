// How long each destination takes, from the nearest to the farthest.
export default {
  id: 'tarea-58',
  titulo: 'Días de tránsito de cada destino',
  donde: 'catalogo',
  calcular(estado) {
    const items = Object.values(estado.destinos)
      .slice()
      .sort((a, b) => a.diasTransito - b.diasTransito || a.ciudad.localeCompare(b.ciudad))
      .map((d) => ({ texto: d.ciudad + ', ' + d.pais, valor: d.diasTransito + (d.diasTransito === 1 ? ' día' : ' días') }))
    return { tipo: 'lista', items }
  },
}
