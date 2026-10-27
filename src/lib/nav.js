// Main navigation. `pronto` entries render as a disabled "Pronto" slot until their page exists.
export const NAV = [
  { href: '/', label: 'Inicio' },
  { href: '/catalogo/', label: 'Catálogo' },
  { href: '/presupuesto/', label: 'Presupuesto' },
  { href: '/factory/', label: 'Factory', pronto: true },
]
