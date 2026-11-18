import * as XLSX from 'xlsx'
import { supabase } from '../lib/supabase'

/** Modo de manejo del producto (lo define su categoría). */
export type PackingMode = 'PALETIZADO' | 'PICKING_CAJA' | 'SERIALIZADO'

export interface PalletTagItem {
  bulto_numero: number
  uid_tag: string
  id_producto?: number
  sku: string
  nombre: string
  tipo: 'COMPLETO' | 'PUCHO' | 'RESERVA_EXCEDENTE'
  cajas: number
  unidades: number
  notas?: string
  liberado?: boolean
}

export interface ProductPackingSummary {
  id_producto: number
  sku: string
  nombre: string
  /** Planes antiguos no lo tienen: se asume PALETIZADO */
  modo?: PackingMode
  /** CAJA, PAQUETE, BOLSA, ROLLO o FARDO */
  tipo_empaque?: string
  /** true si el producto paletizado no tiene regla de empaque registrada */
  sin_regla?: boolean
  cantidad_pedida: number
  unidades_por_caja: number
  cajas_por_paleta: number
  unidades_por_paleta: number
  cajas_totales: number
  paletas_completas: number
  cajas_pucho: number
  unidades_pucho: number
  total_bultos: number
  peso_estimado_kg?: number | null
  volumen_estimado_m3?: number | null
  paletas: PalletTagItem[]
}

export interface OrderPackingPlan {
  numero_orden: string
  contenedor: string
  proveedor: string
  fecha_emision: string
  prefijo_almacen: string
  total_unidades: number
  total_cajas: number
  total_paletas_completas: number
  total_puchos: number
  total_bultos_previstos: number
  /** Unidades serializadas (maquinaria) */
  total_series?: number
  /** Cajas de productos que se reciben por caja, sin paleta */
  total_cajas_sueltas?: number
  peso_total_kg?: number | null
  volumen_total_m3?: number | null
  generado_en?: string
  productos: ProductPackingSummary[]
  etiquetas_bultos: PalletTagItem[]
  etiquetas_reserva: PalletTagItem[]
}

export interface PuchoConsolidationItem {
  id_producto: number
  sku: string
  nombre: string
  cajas_existentes: number
  tag_existente: string
  ubicacion_existente: string
  cajas_nuevas: number
  tag_nuevo: string
  cajas_por_paleta: number
  total_cajas: number
  tipo_caso: 'CASO_1_PUCHO' | 'CASO_2_COMPLETO' | 'CASO_3_COMPLETO_MAS_PUCHO'
  titulo_caso: string
  instruccion: string
  badge_texto: string
  badge_color: string
}

interface ProductRule {
  id_producto: number
  sku: string
  nombre: string
  modo: PackingMode
  tipo_empaque: string
  unidades_por_caja: number | null
  cajas_por_paleta: number | null
  peso_unitario_kg: number | null
  volumen_caja_m3: number | null
}

const CONTINGENCIA = 5

function normalizarModo(m?: string | null): PackingMode {
  const v = (m || '').toUpperCase()
  return v === 'PICKING_CAJA' || v === 'SERIALIZADO' ? v : 'PALETIZADO'
}

function numeroDeTag(uid: string, prefix: string): number | null {
  if (!uid || !uid.toUpperCase().startsWith(prefix)) return null
  const numStr = uid.slice(prefix.length).replace(/\D/g, '')
  return numStr ? parseInt(numStr, 10) : null
}

function tagsDelPlan(plan: any): PalletTagItem[] {
  if (!plan) return []
  return [
    ...(Array.isArray(plan.etiquetas_bultos) ? plan.etiquetas_bultos : []),
    ...(Array.isArray(plan.etiquetas_reserva) ? plan.etiquetas_reserva : [])
  ]
}

/**
 * @deprecated Las reservas viven en Supabase (orden_importacion.snapshot_proyeccion.packing_plan).
 * Se conserva la firma síncrona para locationService; ya no lee el navegador y devuelve vacío.
 * Usa `packingListService.getReservedTagNumbers` (asíncrono) para consultar las reservas reales.
 */
export function getReservedTagsFromAllOrders(_cleanPrefix: string, _excludeOrderNumber?: string): Set<number> {
  return new Set<number>()
}

export const packingListService = {
  // 1. Reglas de empaque y modo de cada producto (vista v_producto_detalle)
  async getProductRules(): Promise<{ byId: Map<number, ProductRule>; byName: Map<string, ProductRule> }> {
    const byId = new Map<number, ProductRule>()
    const byName = new Map<string, ProductRule>()
    const { data, error } = await supabase
      .from('v_producto_detalle')
      .select(
        'id_producto, sku, nombre, modo_manejo, tipo_empaque, unidades_por_caja, cajas_por_paleta, peso_unitario_kg, volumen_caja_m3'
      )
    if (error) throw new Error(`No se pudieron leer las reglas de empaque: ${error.message}`)
    for (const p of (data || []) as any[]) {
      const rule: ProductRule = {
        id_producto: p.id_producto,
        sku: p.sku || `SKU-${p.id_producto}`,
        nombre: p.nombre || 'Producto sin nombre',
        modo: normalizarModo(p.modo_manejo),
        tipo_empaque: p.tipo_empaque || 'CAJA',
        unidades_por_caja: Number(p.unidades_por_caja) > 0 ? Number(p.unidades_por_caja) : null,
        cajas_por_paleta: Number(p.cajas_por_paleta) > 0 ? Number(p.cajas_por_paleta) : null,
        peso_unitario_kg: Number(p.peso_unitario_kg) > 0 ? Number(p.peso_unitario_kg) : null,
        volumen_caja_m3: Number(p.volumen_caja_m3) > 0 ? Number(p.volumen_caja_m3) : null
      }
      byId.set(rule.id_producto, rule)
      byName.set(rule.nombre.trim().toUpperCase(), rule)
    }
    return { byId, byName }
  },

  /** Compatibilidad (resumen de aprobación): unidades por caja y cajas por paleta por id de producto. */
  async getProductsPackingRules(): Promise<Map<number, { unidades_por_caja: number; cajas_por_paleta: number }>> {
    const map = new Map<number, { unidades_por_caja: number; cajas_por_paleta: number }>()
    try {
      const { byId } = await this.getProductRules()
      for (const r of byId.values()) {
        map.set(r.id_producto, {
          unidades_por_caja: r.unidades_por_caja || 1,
          cajas_por_paleta: r.modo === 'PALETIZADO' ? r.cajas_por_paleta || 1 : 1
        })
      }
    } catch (err) {
      console.warn('No se pudieron cargar las reglas de empaque:', err)
    }
    return map
  },

  // 2. Números de tag ya reservados por otras órdenes activas (Supabase)
  async getReservedTagNumbers(prefix: string, excludeOrderNumber?: string): Promise<Set<number>> {
    const reserved = new Set<number>()
    const { data, error } = await supabase
      .from('orden_importacion')
      .select('numero_orden, estado, snapshot_proyeccion')
      .in('estado', ['BORRADOR', 'FALTA_APROBACION', 'TRANSITO'])
    if (error) throw new Error(`No se pudieron consultar los códigos reservados: ${error.message}`)
    for (const ord of (data || []) as any[]) {
      if (excludeOrderNumber && ord.numero_orden === excludeOrderNumber) continue
      for (const t of tagsDelPlan(ord.snapshot_proyeccion?.packing_plan)) {
        if (t?.liberado) continue
        const n = numeroDeTag(t.uid_tag, prefix)
        if (n !== null) reserved.add(n)
      }
    }
    return reserved
  },

  // 3. Lote de códigos libres: excluye tags físicos activos y reservas de otras órdenes
  async getAvailableTagBatch(prefix: string, countNeeded: number, currentOrderNumber?: string): Promise<string[]> {
    const cleanPrefix = (prefix || 'IMP').trim().toUpperCase()
    const occupied = await this.getReservedTagNumbers(cleanPrefix, currentOrderNumber)

    const { data: tags, error } = await supabase
      .from('etiqueta_rfid')
      .select('uid_tag, estado')
      .ilike('uid_tag', `${cleanPrefix}%`)
    if (error) throw new Error(`No se pudieron consultar los tags existentes: ${error.message}`)
    for (const t of tags || []) {
      if (t.estado === 'ACTIVA') {
        const n = numeroDeTag(t.uid_tag, cleanPrefix)
        if (n !== null) occupied.add(n)
      }
    }

    const result: string[] = []
    let currentNum = 1
    while (result.length < countNeeded) {
      if (!occupied.has(currentNum)) result.push(`${cleanPrefix}${currentNum.toString().padStart(5, '0')}`)
      currentNum++
    }
    return result
  },

  // 4. Leer el plan guardado de una orden (Supabase es la única fuente)
  async getSavedPlan(numeroOrden: string): Promise<OrderPackingPlan | null> {
    const { data, error } = await supabase
      .from('orden_importacion')
      .select('snapshot_proyeccion')
      .eq('numero_orden', numeroOrden)
      .maybeSingle()
    if (error) throw new Error(`No se pudo leer la orden ${numeroOrden}: ${error.message}`)
    const plan = (data as any)?.snapshot_proyeccion?.packing_plan
    return plan && Array.isArray(plan.productos) ? (plan as OrderPackingPlan) : null
  },

  // 5. Guardar el plan dentro del snapshot SIN borrar la proyección (fusiona)
  async savePackingPlanToOrder(numeroOrden: string, plan: OrderPackingPlan | null): Promise<void> {
    const { data: ord, error } = await supabase
      .from('orden_importacion')
      .select('id_orden, snapshot_proyeccion')
      .eq('numero_orden', numeroOrden)
      .maybeSingle()
    if (error) throw new Error(`No se pudo leer la orden ${numeroOrden}: ${error.message}`)
    if (!ord) throw new Error(`La orden ${numeroOrden} no existe.`)

    const snapshot = { ...((ord as any).snapshot_proyeccion || {}) }
    if (plan) snapshot.packing_plan = plan
    else delete snapshot.packing_plan

    const { error: upErr } = await (supabase.from('orden_importacion') as any)
      .update({ snapshot_proyeccion: snapshot })
      .eq('id_orden', (ord as any).id_orden)
    if (upErr) throw new Error(`No se pudo guardar el packing list: ${upErr.message}`)
  },

  /**
   * 6. Generar (o reutilizar) el packing list de una orden.
   * - Si la orden ya tiene un plan guardado en Supabase, se devuelve tal cual (los códigos no cambian).
   * - Las cantidades salen de `detalles` o, si no hay, de las cantidades aprobadas (`approval_summary`).
   * - Solo los productos PALETIZADOS reciben códigos de paleta (tag RFID).
   *   POR CAJA se cuenta en cajas y SERIALIZADO en unidades con número de serie.
   * - `persist: false` calcula una vista previa sin reservar códigos.
   */
  async generateOrderPackingPlan(
    order: {
      numero_orden: string
      tipo_contenedor?: string | null
      proveedor?: { razon_social?: string; nombre?: string } | null
      fecha_emision?: string
      snapshot_proyeccion?: any
      detalles?: Array<{
        id_producto: number
        cantidad_pedida: number
        producto?: { sku: string; nombre: string } | null
      }>
    },
    warehousePrefix: string = 'IMP',
    options: { persist?: boolean; regenerate?: boolean } = {}
  ): Promise<OrderPackingPlan> {
    const persist = options.persist !== false
    const prefix = (warehousePrefix || 'IMP').trim().toUpperCase()

    if (!options.regenerate) {
      const saved = await this.getSavedPlan(order.numero_orden).catch(() => null)
      const existing = saved || order.snapshot_proyeccion?.packing_plan
      if (existing && Array.isArray(existing.productos) && existing.productos.length > 0) {
        return existing as OrderPackingPlan
      }
    }

    const rules = await this.getProductRules()

    // Líneas de la orden: detalles reales o cantidades aprobadas del snapshot
    type Linea = { id_producto: number | null; nombre: string; sku?: string; cantidad: number }
    let lineas: Linea[] = (order.detalles || []).map((d) => ({
      id_producto: d.id_producto || null,
      nombre: d.producto?.nombre || '',
      sku: d.producto?.sku,
      cantidad: Number(d.cantidad_pedida) || 0
    }))
    if (lineas.length === 0 && Array.isArray(order.snapshot_proyeccion?.approval_summary)) {
      lineas = order.snapshot_proyeccion.approval_summary.map((r: any) => ({
        id_producto: r.id_producto ?? null,
        nombre: r.nombre_producto || '',
        sku: r.sku,
        cantidad: Number(r.cantidad_aprobada) || 0
      }))
    }

    const summaries: ProductPackingSummary[] = []
    for (const l of lineas) {
      if (l.cantidad <= 0) continue
      const rule =
        (l.id_producto ? rules.byId.get(l.id_producto) : undefined) ||
        rules.byName.get(l.nombre.trim().toUpperCase())
      const modo: PackingMode = rule?.modo || 'PALETIZADO'
      const unidCaja = rule?.unidades_por_caja ?? null
      const cajasPal = rule?.cajas_por_paleta ?? null
      const cantidad = l.cantidad

      const base = {
        id_producto: rule?.id_producto ?? l.id_producto ?? 0,
        sku: rule?.sku || (l.sku && !l.sku.startsWith('PROD-') ? l.sku : '') || '—',
        nombre: rule?.nombre || l.nombre || 'Producto sin nombre',
        modo,
        tipo_empaque: rule?.tipo_empaque || 'CAJA',
        cantidad_pedida: cantidad,
        peso_estimado_kg: rule?.peso_unitario_kg ? Number((rule.peso_unitario_kg * cantidad).toFixed(2)) : null,
        paletas: [] as PalletTagItem[]
      }

      if (modo === 'SERIALIZADO') {
        summaries.push({
          ...base,
          unidades_por_caja: 1,
          cajas_por_paleta: 0,
          unidades_por_paleta: 0,
          cajas_totales: 0,
          paletas_completas: 0,
          cajas_pucho: 0,
          unidades_pucho: 0,
          total_bultos: 0,
          volumen_estimado_m3: null
        })
        continue
      }

      const uc = unidCaja || 1
      const cajasTotales = Math.ceil(cantidad / uc)
      const volumen = rule?.volumen_caja_m3 ? Number((rule.volumen_caja_m3 * cajasTotales).toFixed(3)) : null

      if (modo === 'PICKING_CAJA') {
        summaries.push({
          ...base,
          sin_regla: !unidCaja,
          unidades_por_caja: uc,
          cajas_por_paleta: 0,
          unidades_por_paleta: 0,
          cajas_totales: cajasTotales,
          paletas_completas: 0,
          cajas_pucho: 0,
          // unidades de la última caja incompleta (caja abierta)
          unidades_pucho: cantidad % uc,
          total_bultos: 0,
          volumen_estimado_m3: volumen
        })
        continue
      }

      // PALETIZADO: requiere regla completa; sin ella no se inventan paletas
      if (!unidCaja || !cajasPal) {
        summaries.push({
          ...base,
          sin_regla: true,
          unidades_por_caja: unidCaja || 0,
          cajas_por_paleta: cajasPal || 0,
          unidades_por_paleta: 0,
          cajas_totales: unidCaja ? cajasTotales : 0,
          paletas_completas: 0,
          cajas_pucho: 0,
          unidades_pucho: 0,
          total_bultos: 0,
          volumen_estimado_m3: volumen
        })
        continue
      }

      const unidPal = unidCaja * cajasPal
      const paletasCompletas = Math.floor(cantidad / unidPal)
      const restantes = cantidad % unidPal
      const cajasPucho = restantes > 0 ? Math.ceil(restantes / unidCaja) : 0
      summaries.push({
        ...base,
        unidades_por_caja: unidCaja,
        cajas_por_paleta: cajasPal,
        unidades_por_paleta: unidPal,
        cajas_totales: cajasTotales,
        paletas_completas: paletasCompletas,
        cajas_pucho: cajasPucho,
        unidades_pucho: restantes,
        total_bultos: paletasCompletas + (cajasPucho > 0 ? 1 : 0),
        volumen_estimado_m3: volumen
      })
    }

    if (summaries.length === 0) {
      throw new Error('La orden no tiene productos con cantidad aprobada para armar el packing list.')
    }

    const totalBultos = summaries.reduce((a, s) => a + s.total_bultos, 0)
    const tagsNecesarios = totalBultos > 0 ? totalBultos + CONTINGENCIA : 0
    const tags =
      tagsNecesarios > 0
        ? persist
          ? await this.getAvailableTagBatch(prefix, tagsNecesarios, order.numero_orden)
          : Array.from({ length: tagsNecesarios }, (_, i) => `${prefix}-PREV${String(i + 1).padStart(3, '0')}`)
        : []

    let tagIndex = 0
    let bultoSeq = 1
    const allPalletTags: PalletTagItem[] = []
    for (const s of summaries) {
      if (s.modo !== 'PALETIZADO' || s.sin_regla) continue
      for (let i = 0; i < s.paletas_completas; i++) {
        const item: PalletTagItem = {
          bulto_numero: bultoSeq++,
          uid_tag: tags[tagIndex++],
          id_producto: s.id_producto,
          sku: s.sku,
          nombre: s.nombre,
          tipo: 'COMPLETO',
          cajas: s.cajas_por_paleta,
          unidades: s.unidades_por_paleta,
          notas: `Paleta completa ${i + 1} de ${s.paletas_completas}`
        }
        s.paletas.push(item)
        allPalletTags.push(item)
      }
      if (s.cajas_pucho > 0) {
        const item: PalletTagItem = {
          bulto_numero: bultoSeq++,
          uid_tag: tags[tagIndex++],
          id_producto: s.id_producto,
          sku: s.sku,
          nombre: s.nombre,
          tipo: 'PUCHO',
          cajas: s.cajas_pucho,
          unidades: s.unidades_pucho,
          notas: `Pucho de ${s.cajas_pucho} caja(s)`
        }
        s.paletas.push(item)
        allPalletTags.push(item)
      }
    }

    const contingencyTags: PalletTagItem[] = []
    if (totalBultos > 0) {
      for (let c = 0; c < CONTINGENCIA; c++) {
        contingencyTags.push({
          bulto_numero: bultoSeq + c,
          uid_tag: tags[tagIndex++],
          sku: 'EXCEDENTE',
          nombre: 'Reserva para paletas no previstas',
          tipo: 'RESERVA_EXCEDENTE',
          cajas: 0,
          unidades: 0,
          notas: `Código de contingencia ${c + 1} de ${CONTINGENCIA}`
        })
      }
    }

    const sumNullable = (vals: Array<number | null | undefined>) => {
      const nums = vals.filter((v): v is number => typeof v === 'number')
      return nums.length ? Number(nums.reduce((a, b) => a + b, 0).toFixed(3)) : null
    }

    const finalPlan: OrderPackingPlan = {
      numero_orden: order.numero_orden,
      contenedor: order.tipo_contenedor || '40FT',
      proveedor: order.proveedor?.razon_social || order.proveedor?.nombre || 'Proveedor por definir',
      fecha_emision: order.fecha_emision || new Date().toISOString().split('T')[0],
      prefijo_almacen: prefix,
      total_unidades: summaries.reduce((a, s) => a + s.cantidad_pedida, 0),
      total_cajas: summaries.reduce((a, s) => a + s.cajas_totales, 0),
      total_paletas_completas: summaries.reduce((a, s) => a + s.paletas_completas, 0),
      total_puchos: summaries.reduce((a, s) => a + (s.cajas_pucho > 0 ? 1 : 0), 0),
      total_bultos_previstos: totalBultos,
      total_series: summaries.filter((s) => s.modo === 'SERIALIZADO').reduce((a, s) => a + s.cantidad_pedida, 0),
      total_cajas_sueltas: summaries.filter((s) => s.modo === 'PICKING_CAJA').reduce((a, s) => a + s.cajas_totales, 0),
      peso_total_kg: sumNullable(summaries.map((s) => s.peso_estimado_kg)),
      volumen_total_m3: sumNullable(summaries.map((s) => s.volumen_estimado_m3)),
      generado_en: new Date().toISOString(),
      productos: summaries,
      etiquetas_bultos: allPalletTags,
      etiquetas_reserva: contingencyTags
    }

    // Congelar el plan y sus códigos en Supabase (sin tocar la proyección)
    if (persist) await this.savePackingPlanToOrder(order.numero_orden, finalPlan)
    return finalPlan
  },

  // 6.1. Liberar formalmente códigos no utilizados en el plan
  liberateCodesInPlan(plan: OrderPackingPlan, codigosALiberar: string[]): OrderPackingPlan {
    const toFreeSet = new Set(codigosALiberar.map((c) => c.trim().toUpperCase()))
    const liberar = (item: PalletTagItem) =>
      toFreeSet.has(item.uid_tag.trim().toUpperCase()) ? { ...item, liberado: true, notas: 'LIBERADO_EN_LIQUIDACION' } : item

    return {
      ...plan,
      etiquetas_bultos: (plan.etiquetas_bultos || []).map(liberar),
      etiquetas_reserva: (plan.etiquetas_reserva || []).map(liberar),
      productos: (plan.productos || []).map((prod) => ({ ...prod, paletas: prod.paletas.map(liberar) }))
    }
  },

  // 7. Exportar a Excel (.xlsx)
  exportPackingListToExcel(plan: OrderPackingPlan): void {
    const wb = XLSX.utils.book_new()
    const modoLabel = (m?: PackingMode) => (m === 'PICKING_CAJA' ? 'Por caja' : m === 'SERIALIZADO' ? 'Serializado' : 'Paletizado')

    const resumenData: any[][] = [
      ['Importaciones Shalom · Packing list'],
      [''],
      ['Orden:', plan.numero_orden, '', 'Fecha de emisión:', plan.fecha_emision],
      ['Proveedor:', plan.proveedor, '', 'Contenedor:', plan.contenedor],
      ['Almacén destino:', plan.prefijo_almacen, '', 'Paletas esperadas:', plan.total_bultos_previstos],
      [''],
      [
        'N°',
        'SKU',
        'Producto',
        'Modo',
        'Unidades',
        'Unid. por empaque',
        'Empaques por paleta',
        'Empaques totales',
        'Paletas completas',
        'Empaques en pucho',
        'Total paletas',
        'Códigos'
      ]
    ]
    plan.productos.forEach((p, idx) => {
      resumenData.push([
        idx + 1,
        p.sku,
        p.nombre,
        modoLabel(p.modo),
        p.cantidad_pedida,
        p.modo === 'SERIALIZADO' ? '—' : p.unidades_por_caja || '—',
        p.modo === 'PALETIZADO' || !p.modo ? p.cajas_por_paleta || '—' : '—',
        p.modo === 'SERIALIZADO' ? '—' : p.cajas_totales,
        p.paletas_completas,
        p.cajas_pucho,
        p.total_bultos,
        p.modo === 'SERIALIZADO'
          ? `${p.cantidad_pedida} número(s) de serie`
          : p.paletas.map((t) => t.uid_tag).join(', ') || (p.sin_regla ? 'Sin regla de empaque' : '—')
      ])
    })
    resumenData.push([
      'Totales',
      '',
      `${plan.productos.length} productos`,
      '',
      plan.total_unidades,
      '',
      '',
      plan.total_cajas,
      plan.total_paletas_completas,
      plan.total_puchos,
      plan.total_bultos_previstos,
      ''
    ])
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(resumenData), 'Resumen')

    const etiquetasData: any[][] = [
      [`Códigos de paleta · Orden ${plan.numero_orden} · ${plan.contenedor}`],
      [''],
      ['Paleta N°', 'Código / tag RFID', 'Tipo', 'SKU', 'Producto', 'Empaques', 'Unidades', 'Verificado en Operaciones', 'Notas']
    ]
    plan.etiquetas_bultos.forEach((tag) => {
      etiquetasData.push([
        tag.bulto_numero,
        tag.uid_tag,
        tag.tipo === 'COMPLETO' ? 'Paleta completa' : 'Pucho',
        tag.sku,
        tag.nombre,
        tag.cajas,
        tag.unidades,
        '[  ]',
        tag.notas || ''
      ])
    })
    if (plan.etiquetas_reserva.length > 0) {
      etiquetasData.push([''])
      etiquetasData.push(['', 'Códigos de contingencia (paletas no previstas)'])
      plan.etiquetas_reserva.forEach((tag) => {
        etiquetasData.push([tag.bulto_numero, tag.uid_tag, 'Contingencia', '', tag.nombre, '—', '—', '[  ] Usado', tag.notas || ''])
      })
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(etiquetasData), 'Codigos_paleta')

    const safeNum = plan.numero_orden.replace(/[^A-Za-z0-9_-]/g, '_')
    XLSX.writeFile(wb, `Packing_list_${safeNum}.xlsx`)
  },

  // 8. Detectar puchos activos en almacén para los productos paletizados del plan
  async detectWarehousePuchosForPlan(
    productos: ProductPackingSummary[],
    _prefijoAlmacen?: string
  ): Promise<PuchoConsolidationItem[]> {
    const puchoProds = productos.filter((p) => p.cajas_pucho > 0 && (p.modo ?? 'PALETIZADO') === 'PALETIZADO')
    if (puchoProds.length === 0) return []

    const puchoProdIds = puchoProds.map((p) => p.id_producto)
    const consolidations: PuchoConsolidationItem[] = []

    const { data: dbPuchos, error } = await supabase
      .from('etiqueta_rfid')
      .select(`
        id_etiqueta,
        uid_tag,
        id_producto,
        cantidad_paquetes,
        tipo_paleta,
        estado,
        id_celda,
        celda:id_celda ( codigo_ubicacion )
      `)
      .in('id_producto', puchoProdIds)
      .eq('tipo_paleta', 'PUCHO')
      .eq('estado', 'ACTIVA')
    if (error) {
      console.warn('No se pudieron consultar los puchos en almacén:', error.message)
      return []
    }

    const foundMap = new Map<number, any>()
    for (const item of dbPuchos || []) {
      if (!foundMap.has(item.id_producto)) foundMap.set(item.id_producto, item)
    }

    for (const prod of puchoProds) {
      const existing = foundMap.get(prod.id_producto)
      if (!existing) continue

      const cajasExistentes = Number(existing.cantidad_paquetes) || 1
      const tagExistente = existing.uid_tag || 'Sin tag'
      const celdaRaw = Array.isArray(existing.celda) ? existing.celda[0] : existing.celda
      const ubicacionExistente = celdaRaw?.codigo_ubicacion
        ? celdaRaw.codigo_ubicacion
        : existing.id_celda
        ? `Celda ${existing.id_celda}`
        : 'Zona de piso'
      const cajasNuevas = prod.cajas_pucho
      const tagNuevo = prod.paletas.find((p) => p.tipo === 'PUCHO')?.uid_tag || 'Por asignar'
      const cajasPorPaleta = Math.max(1, prod.cajas_por_paleta)
      const totalCajas = cajasExistentes + cajasNuevas
      const comun = {
        id_producto: prod.id_producto,
        sku: prod.sku,
        nombre: prod.nombre,
        cajas_existentes: cajasExistentes,
        tag_existente: tagExistente,
        ubicacion_existente: ubicacionExistente,
        cajas_nuevas: cajasNuevas,
        tag_nuevo: tagNuevo,
        cajas_por_paleta: cajasPorPaleta,
        total_cajas: totalCajas
      }

      if (totalCajas < cajasPorPaleta) {
        consolidations.push({
          ...comun,
          tipo_caso: 'CASO_1_PUCHO',
          titulo_caso: 'Se une en un solo pucho',
          instruccion: `Pasar las ${cajasNuevas} cajas que llegan a la paleta ${tagExistente}. Queda 1 pucho de ${totalCajas} de ${cajasPorPaleta} cajas y el código ${tagNuevo} se libera.`,
          badge_texto: `1 pucho (${totalCajas}/${cajasPorPaleta})`,
          badge_color: 'var(--color-warning)'
        })
      } else if (totalCajas === cajasPorPaleta) {
        consolidations.push({
          ...comun,
          tipo_caso: 'CASO_2_COMPLETO',
          titulo_caso: 'Se completa una paleta',
          instruccion: `Unir las ${cajasNuevas} cajas nuevas con las ${cajasExistentes} de ${tagExistente}. La paleta queda completa con ${cajasPorPaleta} cajas y no queda pucho.`,
          badge_texto: 'Paleta completa, sin pucho',
          badge_color: 'var(--color-success)'
        })
      } else {
        const remanente = totalCajas - cajasPorPaleta
        consolidations.push({
          ...comun,
          tipo_caso: 'CASO_3_COMPLETO_MAS_PUCHO',
          titulo_caso: '1 paleta completa y 1 pucho',
          instruccion: `Completar ${tagExistente} hasta ${cajasPorPaleta} cajas. Las ${remanente} cajas restantes quedan en ${tagNuevo} como único pucho.`,
          badge_texto: `1 completa + pucho de ${remanente}`,
          badge_color: 'var(--color-brand)'
        })
      }
    }

    return consolidations
  }
}
