// es-ES formatting shared by the pages and the browser calculator.
const euro = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' })
const entero = new Intl.NumberFormat('es-ES')

export const eur = (value) => euro.format(value)
export const kg = (value) => `${entero.format(value)} kg`
