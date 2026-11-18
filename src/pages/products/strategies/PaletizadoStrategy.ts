import { supabase } from '../../../lib/supabase'
import { nombreEmpaque } from '../empaque'
import { getProductRule, type PackingFormData, type Product } from '../types'
import type { EstrategiaManejo } from './EstrategiaManejo'

/**
 * Estrategia de regla de empaque compartida por los modos con empaque:
 *  - PALETIZADO   (usaPaleta = true):  unidad -> empaque -> fila -> paleta, con pucho.
 *  - PICKING_CAJA (usaPaleta = false): unidad -> caja, sin paletas ni puchos.
 *
 * En la BD: cajas_por_camada = "empaques por fila", numero_camadas = "filas por paleta".
 * Para "Por caja" ambos se guardan en 1 (no se usan).
 */
export class ReglaEmpaqueStrategy implements EstrategiaManejo<PackingFormData> {
  readonly requiereReglaEmpaque = true
  readonly requiereSerie = false
  readonly codigoModo: string
  readonly nombre: string
  readonly descripcion: string
  readonly permitePuchos: boolean
  readonly usaPaleta: boolean

  constructor(config: { codigoModo: string; nombre: string; descripcion: string; usaPaleta: boolean }) {
    this.codigoModo = config.codigoModo
    this.nombre = config.nombre
    this.descripcion = config.descripcion
    this.usaPaleta = config.usaPaleta
    this.permitePuchos = config.usaPaleta
  }

  obtenerValoresPorDefecto(): PackingFormData {
    return {
      tipo_empaque: 'CAJA',
      unidades_por_caja: '1',
      cajas_por_camada: '1',
      numero_camadas: '1',
      permite_puchos: this.usaPaleta,
      notas_armado: '',
      largo_caja_cm: '',
      ancho_caja_cm: '',
      alto_caja_cm: '',
      peso_caja_kg: ''
    }
  }

  mapearDesdeProducto(producto: Product): PackingFormData {
    const rule = getProductRule(producto)
    if (!rule) {
      return this.obtenerValoresPorDefecto()
    }

    return {
      tipo_empaque: rule.tipo_empaque || 'CAJA',
      unidades_por_caja: String(rule.unidades_por_caja ?? 1),
      cajas_por_camada: String(rule.cajas_por_camada ?? rule.cajas_por_camita ?? 1),
      numero_camadas: String(rule.numero_camadas ?? rule.camitas_por_paleta ?? 1),
      permite_puchos: this.usaPaleta,
      notas_armado: rule.notas_armado ?? '',
      largo_caja_cm: rule.largo_caja_cm ? String(rule.largo_caja_cm) : '',
      ancho_caja_cm: rule.ancho_caja_cm ? String(rule.ancho_caja_cm) : '',
      alto_caja_cm: rule.alto_caja_cm ? String(rule.alto_caja_cm) : '',
      peso_caja_kg: rule.peso_caja_kg ? String(rule.peso_caja_kg) : ''
    }
  }

  validar(datos: PackingFormData): { valido: boolean; errores: string[] } {
    const errores: string[] = []
    const singular = nombreEmpaque(datos.tipo_empaque, 1)
    const plural = nombreEmpaque(datos.tipo_empaque, 2)
    const esEntero = (v: string) => Number.isInteger(Number(v)) && Number(v) > 0

    if (!esEntero(datos.unidades_por_caja)) {
      errores.push(`Las unidades por ${singular} deben ser un número entero mayor a 0.`)
    }
    if (this.usaPaleta) {
      if (!esEntero(datos.cajas_por_camada)) {
        errores.push(`Los ${plural} por fila deben ser un número entero mayor a 0.`)
      }
      if (!esEntero(datos.numero_camadas)) {
        errores.push('Las filas por paleta deben ser un número entero mayor a 0.')
      }
    }

    return { valido: errores.length === 0, errores }
  }

  async guardarPerfil(idProducto: number | string, datos: PackingFormData, imagenFile?: File | null): Promise<void> {
    const validacion = this.validar(datos)
    if (!validacion.valido) {
      throw new Error(validacion.errores.join(' '))
    }

    const uEmpaque = Number(datos.unidades_por_caja)
    const porFila = this.usaPaleta ? Number(datos.cajas_por_camada) : 1
    const filas = this.usaPaleta ? Number(datos.numero_camadas) : 1
    const l = Number(datos.largo_caja_cm) || null
    const w = Number(datos.ancho_caja_cm) || null
    const h = Number(datos.alto_caja_cm) || null
    const pEmpaque = Number(datos.peso_caja_kg) || null

    const volEmpaqueM3 = l && w && h ? (l * w * h) / 1000000 : null
    const volPaletaM3 = this.usaPaleta && volEmpaqueM3 ? volEmpaqueM3 * porFila * filas : null

    let imagePath: string | null = null
    if (imagenFile && this.usaPaleta) {
      const ext = imagenFile.name.split('.').pop() || 'png'
      const fileName = `patrones/${idProducto}_${Date.now()}.${ext}`
      const { error: uploadErr } = await supabase.storage
        .from('esquemas-empaque')
        .upload(fileName, imagenFile, { upsert: true })

      if (uploadErr) {
        throw new Error(`Error al subir la imagen de armado: ${uploadErr.message}`)
      }
      imagePath = fileName
    }

    const payload: Record<string, unknown> = {
      id_producto: Number(idProducto),
      tipo_empaque: datos.tipo_empaque || 'CAJA',
      unidades_por_caja: uEmpaque,
      cajas_por_camada: porFila,
      numero_camadas: filas,
      permite_puchos: this.usaPaleta,
      largo_caja_cm: l,
      ancho_caja_cm: w,
      alto_caja_cm: h,
      peso_caja_kg: pEmpaque,
      volumen_caja_m3: volEmpaqueM3,
      volumen_total_m3: volPaletaM3,
      notas_armado: this.usaPaleta ? datos.notas_armado.trim() || null : null
    }

    if (imagePath) {
      payload.imagen_armado_path = imagePath
    }

    const { error } = await supabase.from('regla_empaque').upsert(payload, { onConflict: 'id_producto' })

    if (error) {
      throw new Error(`Error al guardar la regla de empaque: ${error.message}`)
    }
  }

  async eliminarPerfil(idProducto: number | string): Promise<void> {
    const { error } = await supabase.from('regla_empaque').delete().eq('id_producto', idProducto)

    if (error) {
      throw new Error(`Error al eliminar la regla de empaque: ${error.message}`)
    }
  }
}

export const paletizadoStrategy = new ReglaEmpaqueStrategy({
  codigoModo: 'PALETIZADO',
  nombre: 'Paletizado',
  descripcion: 'Unidad, empaque, fila y paleta, con pucho y un empaque abierto como máximo',
  usaPaleta: true
})

export const porCajaStrategy = new ReglaEmpaqueStrategy({
  codigoModo: 'PICKING_CAJA',
  nombre: 'Por caja',
  descripcion: 'Unidad y caja sin paletizar, con una caja abierta como máximo',
  usaPaleta: false
})
