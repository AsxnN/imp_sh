import type { ModoManejoCodigo, Rule } from './types'

/**
 * Modelo de empaque de 3 modos (definido por la categoría del producto).
 *  - PALETIZADO:   unidad -> empaque -> fila -> paleta (paletas con tag RFID)
 *  - PICKING_CAJA: unidad -> caja (control por conteo, sin paletas ni tags)
 *  - SERIALIZADO:  1 unidad = 1 número de serie (sin tag)
 */
export type ModoActivo = 'PALETIZADO' | 'PICKING_CAJA' | 'SERIALIZADO'

export const MODOS_ACTIVOS: ModoActivo[] = ['PALETIZADO', 'PICKING_CAJA', 'SERIALIZADO']

export const MODO_INFO: Record<ModoActivo, { label: string; resumen: string }> = {
  PALETIZADO: {
    label: 'Paletizado',
    resumen: 'Unidad, empaque, fila y paleta. Paletas con tag RFID; máximo 1 pucho con 1 empaque abierto.'
  },
  PICKING_CAJA: {
    label: 'Por caja',
    resumen: 'Unidad y caja, sin paletizar. Se controla por cajas cerradas y máximo 1 caja abierta.'
  },
  SERIALIZADO: {
    label: 'Serializado',
    resumen: 'Maquinaria y equipos. Cada unidad se identifica por su número de serie de fábrica.'
  }
}

export function normalizarModo(modo?: ModoManejoCodigo | null): ModoActivo {
  const m = (modo || 'PALETIZADO').toUpperCase()
  return (MODOS_ACTIVOS as string[]).includes(m) ? (m as ModoActivo) : 'PALETIZADO'
}

export function etiquetaModo(modo?: ModoManejoCodigo | null): string {
  return MODO_INFO[normalizarModo(modo)].label
}

export type TipoEmpaque = 'CAJA' | 'PAQUETE' | 'BOLSA' | 'ROLLO' | 'FARDO'

export const TIPOS_EMPAQUE: { value: TipoEmpaque; singular: string; plural: string }[] = [
  { value: 'CAJA', singular: 'caja', plural: 'cajas' },
  { value: 'PAQUETE', singular: 'paquete', plural: 'paquetes' },
  { value: 'BOLSA', singular: 'bolsa', plural: 'bolsas' },
  { value: 'ROLLO', singular: 'rollo', plural: 'rollos' },
  { value: 'FARDO', singular: 'fardo', plural: 'fardos' }
]

export function nombreEmpaque(tipo?: string | null, cantidad = 2): string {
  const t = TIPOS_EMPAQUE.find((x) => x.value === (tipo || 'CAJA')) ?? TIPOS_EMPAQUE[0]
  return cantidad === 1 ? t.singular : t.plural
}

const EMPAQUES_FEMENINOS = ['CAJA', 'BOLSA']

/** Concuerda un adjetivo con el empaque: concordar('CAJA', 2, 'cerrad') = 'cerradas'. */
export function concordar(tipo: string | null | undefined, cantidad: number, raiz: string): string {
  const fem = EMPAQUES_FEMENINOS.includes((tipo || 'CAJA').toUpperCase())
  return `${raiz}${fem ? 'a' : 'o'}${cantidad === 1 ? '' : 's'}`
}

export function capitalizar(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1)
}

export type CalculoPaleta = {
  unidadesPorEmpaque: number
  empaquesPorFila: number
  filasPorPaleta: number
  empaquesPorPaleta: number
  unidadesPorPaleta: number
}

export function calcularPaleta(unidadesPorEmpaque: unknown, empaquesPorFila: unknown, filasPorPaleta: unknown): CalculoPaleta {
  const u = Math.max(0, Math.floor(Number(unidadesPorEmpaque) || 0))
  const e = Math.max(0, Math.floor(Number(empaquesPorFila) || 0))
  const f = Math.max(0, Math.floor(Number(filasPorPaleta) || 0))
  return {
    unidadesPorEmpaque: u,
    empaquesPorFila: e,
    filasPorPaleta: f,
    empaquesPorPaleta: e * f,
    unidadesPorPaleta: e * f * u
  }
}

/** Lee la regla de empaque en el lenguaje del negocio (empaques por fila / filas por paleta). */
export function leerRegla(rule: Rule | null | undefined): CalculoPaleta & { tipoEmpaque: string } {
  const calc = calcularPaleta(
    rule?.unidades_por_caja ?? 0,
    rule?.cajas_por_camada ?? rule?.cajas_por_camita ?? 0,
    rule?.numero_camadas ?? rule?.camitas_por_paleta ?? 0
  )
  return { ...calc, tipoEmpaque: rule?.tipo_empaque || 'CAJA' }
}

/** Una línea legible del empaque, p. ej. "20 u/paquete · 11 paquetes por fila · 9 filas". */
export function describirEmpaque(rule: Rule | null | undefined, modo?: ModoManejoCodigo | null): string {
  if (!rule) return 'Sin empaque asignado'
  const r = leerRegla(rule)
  const singular = nombreEmpaque(r.tipoEmpaque, 1)
  const plural = nombreEmpaque(r.tipoEmpaque, 2)
  if (normalizarModo(modo) === 'PICKING_CAJA') {
    return `${r.unidadesPorEmpaque} u/${singular}`
  }
  return `${r.unidadesPorEmpaque} u/${singular} · ${r.empaquesPorFila} ${plural} por fila · ${r.filasPorPaleta} filas`
}

export function formatoNumero(n: number): string {
  return n.toLocaleString('es-PE')
}
