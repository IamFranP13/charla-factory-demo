// "Días de tránsito": the transit days to each destination.

export default {
  id: 'tarea-116',
  titulo: 'Días de tránsito por destino',
  donde: 'catalogo',
  calcular(estado) {
    const filas = Object.values(estado.destinos)
      .filter((d) => Number.isFinite(d.diasTransito))
      .map((d) => [d.ciudad + ', ' + d.pais, d.diasTransito])
      .sort((a, b) => a[1] - b[1])
    return { tipo: 'tabla', columnas: ['Destino', 'Días de tránsito'], filas }
  },
}
