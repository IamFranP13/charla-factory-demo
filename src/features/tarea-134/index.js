// "Destinos por precio de transporte": destinations sorted by transport price per kg.

export default {
  id: 'tarea-134',
  titulo: 'Destinos por precio de transporte',
  donde: 'catalogo',
  calcular(estado) {
    const filas = Object.entries(estado.destinos)
      .filter(([id]) => Number.isFinite(estado.transporte?.[id]?.eurPorKg))
      .map(([id, d]) => [d.ciudad + ', ' + d.pais, estado.transporte[id].eurPorKg])
      .sort((a, b) => a[1] - b[1])
    return { tipo: 'tabla', columnas: ['Destino', 'Transporte (€/kg)'], filas }
  },
}
