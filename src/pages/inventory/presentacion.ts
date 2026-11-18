import type { PalletRecord } from '../../types/locations'
import { concordar, formatoNumero, nombreEmpaque, normalizarModo, type ModoActivo } from '../products/empaque'
import type { InventoryItem, ProductOption } from './types'

/**
 * "Presentación" del stock de un producto en una sede, según su modo de manejo:
 *  - Paletizado: paletas completas + pucho (empaques cerrados + 1 abierto)
 *  - Por caja:   cajas cerradas + 1 caja abierta
 *  - Serializado: equipos
 */
export type Presentacion = {
  modo: ModoActivo
  principal: string
  detalle: string | null
  paletasCompletas: number
  puchos: number
  pallets: PalletRecord[]
  /** Unidades según las paletas físicas (solo paletizado) */
  unidadesEnPaletas: number
}

export function calcularPresentacion(
  item: InventoryItem,
  producto: ProductOption | undefined,
  palletsProducto: PalletRecord[],
  equipos: number
): Presentacion {
  const modo = normalizarModo(producto?.modo_manejo ?? item.producto?.categoria?.modo_manejo)
  const tipo = producto?.tipo_empaque || 'CAJA'
  const completas = palletsProducto.filter((p) => p.tipo_paleta === 'COMPLETO')
  const puchos = palletsProducto.filter((p) => p.tipo_paleta === 'PUCHO')
  const unidadesEnPaletas = palletsProducto.reduce((acc, p) => acc + (Number(p.cantidad_actual) || 0), 0)

  const base = {
    modo,
    paletasCompletas: completas.length,
    puchos: puchos.length,
    pallets: palletsProducto,
    unidadesEnPaletas
  }

  if (modo === 'SERIALIZADO') {
    return { ...base, principal: `${formatoNumero(equipos)} ${equipos === 1 ? 'equipo' : 'equipos'}`, detalle: 'Por número de serie' }
  }

  if (modo === 'PICKING_CAJA') {
    const cerradas = Number(item.cajas_cerradas) || 0
    const abierta = Number(item.unidades_caja_abierta) || 0
    return {
      ...base,
      principal: `${formatoNumero(cerradas)} ${nombreEmpaque(tipo, cerradas)} ${concordar(tipo, cerradas, 'cerrad')}`,
      detalle:
        abierta > 0
          ? `+ 1 ${nombreEmpaque(tipo, 1)} ${concordar(tipo, 1, 'abiert')} con ${formatoNumero(abierta)} u`
          : `Sin ${nombreEmpaque(tipo, 1)} ${concordar(tipo, 1, 'abiert')}`
    }
  }

  // PALETIZADO
  const partes: string[] = [`${formatoNumero(completas.length)} ${completas.length === 1 ? 'paleta' : 'paletas'}`]
  let detalle: string | null = null
  if (puchos.length > 0) {
    const pucho = puchos[0]
    const cerrados = Number(pucho.cantidad_paquetes) || 0
    const sueltas = Number(pucho.unidades_sueltas) || 0
    partes.push('pucho')
    detalle = `Pucho: ${formatoNumero(cerrados)} ${nombreEmpaque(tipo, cerrados)}${
      sueltas > 0 ? ` + 1 ${concordar(tipo, 1, 'abiert')} con ${formatoNumero(sueltas)} u` : ''
    }`
    if (puchos.length > 1) {
      detalle += ` · ${puchos.length} puchos: deben unificarse`
    }
  }
  return { ...base, principal: partes.join(' + '), detalle }
}
