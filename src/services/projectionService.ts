import * as XLSX from 'xlsx'
import { supabase } from '../lib/supabase'
import type {
  CalculableColumnKey,
  CalculatedProjectionRow,
  CustomProjectionColumn,
  ExcelImportResult,
  ProjectionItem,
  ProjectionOrder,
  ProjectionOrderStatus,
  ProjectionTemplate,
  TemplateParamsForm
} from '../types/projections'

export const LOCAL_STORAGE_ORDERS_KEY = 'shalom_projection_orders_v1'
export const SNAPSHOT_STORAGE_PREFIX = 'shalom_order_snap_'

// Ítems predeterminados de Importaciones / Store (referencia catálogo)
export const DEFAULT_IMP_STO_ITEMS: ProjectionItem[] = [
  {
    id_item: 1,
    id_plantilla: 1,
    id_producto: null,
    nombre_producto: 'BOLSA SEG. GRANDE',
    datos_meses: { SEP: -22400, OCT: -2200, NOV: -18400, DIC: -14800, ENE: -16200, FEB: -15000, MAR: -89600, ABR: -22000, MAY: -12500, JUN: -2500, JUL: -16000 },
    promedio_manual: 15000,
    stock_manual: 48500,
    stock_redondeado_manual: 60000,
    orden_fila: 1,
    activo: true
  },
  {
    id_item: 2,
    id_plantilla: 1,
    id_producto: null,
    nombre_producto: 'BOLSA SEG. MEDIANA',
    datos_meses: { SEP: 0, OCT: 0, NOV: -3800, DIC: -16200, ENE: -7400, FEB: -300, MAR: -10000, ABR: 0, MAY: 0, JUN: 0, JUL: 0 },
    promedio_manual: 5000,
    stock_manual: 193000,
    stock_redondeado_manual: 40000,
    orden_fila: 2,
    activo: true
  },
  {
    id_item: 3,
    id_plantilla: 1,
    id_producto: null,
    nombre_producto: 'BOLSA SEG. PEQUEÑO',
    datos_meses: { SEP: -11000, OCT: -14800, NOV: -11100, DIC: -13600, ENE: -10200, FEB: -10200, MAR: -6800, ABR: 0, MAY: 0, JUN: 0, JUL: 0 },
    promedio_manual: 10000,
    stock_manual: 141500,
    stock_redondeado_manual: 40000,
    orden_fila: 3,
    activo: true
  },
  {
    id_item: 4,
    id_plantilla: 1,
    id_producto: null,
    nombre_producto: 'BURBUPACK- 50 CM',
    datos_meses: { SEP: -2106, OCT: -2610, NOV: -2800, DIC: -2401, ENE: -2300, FEB: -2000, MAR: -2220, ABR: -3600, MAY: -2400, JUN: -3500, JUL: -2400 },
    promedio_manual: 3000,
    stock_manual: 30000,
    stock_redondeado_manual: 15000,
    orden_fila: 4,
    activo: true
  },
  {
    id_item: 5,
    id_plantilla: 1,
    id_producto: null,
    nombre_producto: 'CINTAS-EMBALAJE 2 X 100 YDS',
    datos_meses: { SEP: -864, OCT: -1152, NOV: -1800, DIC: -1008, ENE: -936, FEB: -792, MAR: -1080, ABR: -2592, MAY: -4824, JUN: -2448, JUL: -1080 },
    promedio_manual: 1200,
    stock_manual: 2584,
    stock_redondeado_manual: 4000,
    orden_fila: 5,
    activo: true
  },
  {
    id_item: 6,
    id_plantilla: 1,
    id_producto: null,
    nombre_producto: 'CINTAS-EMBALAJE 2 X 50 YDS',
    datos_meses: { SEP: 0, OCT: 0, NOV: 0, DIC: 0, ENE: 0, FEB: 0, MAR: -8220, ABR: 0, MAY: 0, JUN: 0, JUL: 0 },
    promedio_manual: 12000,
    stock_manual: 80000,
    stock_redondeado_manual: 40000,
    orden_fila: 6,
    activo: true
  },
  {
    id_item: 7,
    id_plantilla: 1,
    id_producto: null,
    nombre_producto: 'CONTOMETRO',
    datos_meses: { SEP: -14505, OCT: -17100, NOV: -19200, DIC: -26850, ENE: -21300, FEB: -17400, MAR: -21750, ABR: -25200, MAY: -600, JUN: -23850, JUL: -36000 },
    promedio_manual: 22000,
    stock_manual: 98000,
    stock_redondeado_manual: 90000,
    orden_fila: 7,
    activo: true
  },
  {
    id_item: 8,
    id_plantilla: 1,
    id_producto: null,
    nombre_producto: 'PAQUETE S',
    datos_meses: { SEP: -9784, OCT: -10375, NOV: -11304, DIC: -10925, ENE: -13971, FEB: -14482, MAR: -14860, ABR: -17880, MAY: -15400, JUN: -16000, JUL: -14800 },
    promedio_manual: 15000,
    stock_manual: 101820,
    stock_redondeado_manual: 60000,
    orden_fila: 8,
    activo: true
  },
  {
    id_item: 9,
    id_plantilla: 1,
    id_producto: null,
    nombre_producto: 'PAQUETE XS',
    datos_meses: { SEP: -15083, OCT: -16523, NOV: -9625, DIC: -23439, ENE: -22876, FEB: -17770, MAR: -26200, ABR: -18920, MAY: 0, JUN: -19800, JUL: -12800 },
    promedio_manual: 15000,
    stock_manual: 229000,
    stock_redondeado_manual: 60000,
    orden_fila: 9,
    activo: true
  },
  {
    id_item: 10,
    id_plantilla: 1,
    id_producto: null,
    nombre_producto: 'PAQUETE XXS',
    datos_meses: { SEP: -44666, OCT: -30050, NOV: -58957, DIC: -45007, ENE: -44646, FEB: -45442, MAR: -40000, ABR: -14800, MAY: -39860, JUN: -26800, JUL: -45000 },
    promedio_manual: 35000,
    stock_manual: 151067,
    stock_redondeado_manual: 130000,
    orden_fila: 10,
    activo: true
  },
  {
    id_item: 11,
    id_plantilla: 1,
    id_producto: null,
    nombre_producto: 'PRECINTO-PQT 100 UND-20 CM',
    datos_meses: { SEP: 0, OCT: 0, NOV: 0, DIC: 0, ENE: 0, FEB: 0, MAR: 0, ABR: -1800, MAY: 0, JUN: 0, JUL: -500 },
    promedio_manual: 450,
    stock_manual: 500000,
    stock_redondeado_manual: 250000,
    orden_fila: 11,
    activo: true
  },
  {
    id_item: 12,
    id_plantilla: 1,
    id_producto: null,
    nombre_producto: 'PRECINTO-PQT 100 UND-30 CM',
    datos_meses: { SEP: 0, OCT: 0, NOV: 0, DIC: 0, ENE: 0, FEB: 0, MAR: 0, ABR: 0, MAY: 0, JUN: -800, JUL: -1800 },
    promedio_manual: 1300,
    stock_manual: 3800,
    stock_redondeado_manual: 5000,
    orden_fila: 12,
    activo: true
  },
  {
    id_item: 13,
    id_plantilla: 1,
    id_producto: null,
    nombre_producto: 'ROLLO QR DIRECTO',
    datos_meses: { SEP: -3460, OCT: 0, NOV: 0, DIC: 0, ENE: -3456, FEB: -3456, MAR: -3456, ABR: -1728, MAY: -3456, JUN: -3456, JUL: -3456 },
    promedio_manual: 18000,
    stock_manual: 13632,
    stock_redondeado_manual: 65000,
    orden_fila: 13,
    activo: true
  },
  {
    id_item: 14,
    id_plantilla: 1,
    id_producto: null,
    nombre_producto: 'SACO DE LONA',
    datos_meses: { SEP: 0, OCT: 0, NOV: 0, DIC: 0, ENE: -660, FEB: -1700, MAR: -1130, ABR: -235, MAY: -60, JUN: 0, JUL: 0 },
    promedio_manual: 143,
    stock_manual: 6000,
    stock_redondeado_manual: 5000,
    orden_fila: 14,
    activo: true
  },
  {
    id_item: 15,
    id_plantilla: 1,
    id_producto: null,
    nombre_producto: 'SOBRE DE BURBUJA GRANDE 260x320+45mm',
    datos_meses: { SEP: -12000, OCT: -15000, NOV: -16000, DIC: -18000, ENE: -14000, FEB: -15000, MAR: -16000, ABR: -17000, MAY: -14000, JUN: -15000, JUL: -16000 },
    promedio_manual: 15000,
    stock_manual: 77000,
    stock_redondeado_manual: 40000,
    orden_fila: 15,
    activo: true
  },
  {
    id_item: 16,
    id_plantilla: 1,
    id_producto: null,
    nombre_producto: 'SOBRE DE BURBUJA MEDIANO 220x250+45mm',
    datos_meses: { SEP: -14000, OCT: -16000, NOV: -15000, DIC: -19000, ENE: -15000, FEB: -14000, MAR: -15000, ABR: -16000, MAY: -13000, JUN: -14000, JUL: -15000 },
    promedio_manual: 15000,
    stock_manual: 48400,
    stock_redondeado_manual: 40000,
    orden_fila: 16,
    activo: true
  },
  {
    id_item: 17,
    id_plantilla: 1,
    id_producto: null,
    nombre_producto: 'SOBRE DE BURBUJA PEQUEÑO 130x180+45mm',
    datos_meses: { SEP: -4000, OCT: -5000, NOV: -6000, DIC: -5500, ENE: -4800, FEB: -5200, MAR: -5000, ABR: -5500, MAY: -4600, JUN: -5000, JUL: -5400 },
    promedio_manual: 5000,
    stock_manual: 68800,
    stock_redondeado_manual: 40000,
    orden_fila: 17,
    activo: true
  },
  {
    id_item: 18,
    id_plantilla: 1,
    id_producto: null,
    nombre_producto: 'SOBRE DE CARTON VERTICAL 250x345+50MM',
    datos_meses: { SEP: -10000, OCT: -12000, NOV: -13000, DIC: -15000, ENE: -11000, FEB: -12000, MAR: -13000, ABR: -14000, MAY: -11000, JUN: -12000, JUL: -13000 },
    promedio_manual: 12000,
    stock_manual: 62300,
    stock_redondeado_manual: 40000,
    orden_fila: 18,
    activo: true
  },
  {
    id_item: 19,
    id_plantilla: 1,
    id_producto: null,
    nombre_producto: 'STRECH FILM - 15',
    datos_meses: { SEP: -1800, OCT: -2000, NOV: -2200, DIC: -2500, ENE: -1900, FEB: -2100, MAR: -2000, ABR: -2300, MAY: -1800, JUN: -2000, JUL: -2200 },
    promedio_manual: 2000,
    stock_manual: 54400,
    stock_redondeado_manual: 10000,
    orden_fila: 19,
    activo: true
  },
  {
    id_item: 20,
    id_plantilla: 1,
    id_producto: null,
    nombre_producto: 'STRECH FILM- 15/2Kg (EMBALAJE)',
    datos_meses: { SEP: -800, OCT: -900, NOV: -1000, DIC: -1200, ENE: -850, FEB: -950, MAR: -900, ABR: -1100, MAY: -800, JUN: -900, JUL: -950 },
    promedio_manual: 900,
    stock_manual: 13036,
    stock_redondeado_manual: 5000,
    orden_fila: 20,
    activo: true
  }
]

// Ítems predeterminados de Construcción (referencia catálogo)
export const DEFAULT_CONST_ITEMS: ProjectionItem[] = [
  { id_item: 101, id_plantilla: 2, id_producto: null, nombre_producto: 'CERAMICO GRIS 60X60 SRK66013', datos_meses: {}, promedio_manual: null, stock_manual: 1329, stock_redondeado_manual: 500, orden_fila: 1, activo: true },
  { id_item: 102, id_plantilla: 2, id_producto: null, nombre_producto: 'PORCELANATO GRIS CHISPEADO 60X60 SRK 76121 A1', datos_meses: {}, promedio_manual: null, stock_manual: 471, stock_redondeado_manual: 600, orden_fila: 2, activo: true },
  { id_item: 103, id_plantilla: 2, id_producto: null, nombre_producto: 'CERAMICO BLANCO 30X60 LLG36001', datos_meses: {}, promedio_manual: null, stock_manual: 720, stock_redondeado_manual: 400, orden_fila: 3, activo: true },
  { id_item: 104, id_plantilla: 2, id_producto: null, nombre_producto: 'LUMINARIA HIGH BAY LED 6500K LEDVANCE 150W', datos_meses: {}, promedio_manual: null, stock_manual: 193, stock_redondeado_manual: 70, orden_fila: 4, activo: true },
  { id_item: 105, id_plantilla: 2, id_producto: null, nombre_producto: 'LUMINARIA TIPO PANEL LED 22W 2000LM', datos_meses: {}, promedio_manual: null, stock_manual: 90, stock_redondeado_manual: 70, orden_fila: 5, activo: true },
  { id_item: 106, id_plantilla: 2, id_producto: null, nombre_producto: 'LUMINARIA TIPO PANEL LED 40W 4000LM', datos_meses: {}, promedio_manual: null, stock_manual: 300, stock_redondeado_manual: 80, orden_fila: 6, activo: true },
  { id_item: 107, id_plantilla: 2, id_producto: null, nombre_producto: 'DETECTOR DE HUMO HAGROY', datos_meses: {}, promedio_manual: null, stock_manual: 63, stock_redondeado_manual: 30, orden_fila: 7, activo: true },
  { id_item: 108, id_plantilla: 2, id_producto: null, nombre_producto: 'REFLECTOR LED 200W 6500K PHILIPS', datos_meses: {}, promedio_manual: null, stock_manual: 75, stock_redondeado_manual: 30, orden_fila: 8, activo: true },
  { id_item: 109, id_plantilla: 2, id_producto: null, nombre_producto: 'ESTACION MANUAL DOBLE ACCION HAGROY', datos_meses: {}, promedio_manual: null, stock_manual: 46, stock_redondeado_manual: 30, orden_fila: 9, activo: true },
  { id_item: 110, id_plantilla: 2, id_producto: null, nombre_producto: 'SIRENA ESTROBOSCOPICA HAGROY', datos_meses: {}, promedio_manual: null, stock_manual: 46, stock_redondeado_manual: 30, orden_fila: 10, activo: true }
]

export const projectionService = {
  // Almacenamiento seguro e inmutable de snapshots de órdenes
  getSnapshotFromStorage(id_orden?: number | null, numero_orden?: string | null): any {
    try {
      if (id_orden) {
        const raw = localStorage.getItem(`${SNAPSHOT_STORAGE_PREFIX}${id_orden}`)
        if (raw) return JSON.parse(raw)
      }
      if (numero_orden) {
        const raw = localStorage.getItem(`${SNAPSHOT_STORAGE_PREFIX}${numero_orden}`)
        if (raw) return JSON.parse(raw)
      }
    } catch (e) {
      console.warn('Error reading snapshot from storage:', e)
    }
    return null
  },

  saveSnapshotToStorage(id_orden?: number | null, numero_orden?: string | null, snapshot?: any): void {
    if (!snapshot) return
    try {
      const serialized = JSON.stringify(snapshot)
      if (id_orden) {
        localStorage.setItem(`${SNAPSHOT_STORAGE_PREFIX}${id_orden}`, serialized)
      }
      if (numero_orden) {
        localStorage.setItem(`${SNAPSHOT_STORAGE_PREFIX}${numero_orden}`, serialized)
      }
    } catch (e) {
      console.warn('Error saving snapshot to storage:', e)
    }
  },

  // 1. Obtener plantillas
  /** Plantillas: Supabase es la única fuente (sin plantillas de respaldo ni datos del navegador). */
  async getTemplates(): Promise<ProjectionTemplate[]> {
    const { data, error } = await supabase
      .from('plantilla_proyeccion')
      .select('*')
      .eq('activo', true)
      .order('id_plantilla', { ascending: true })

    if (error) {
      console.warn('[proyecciones] Error cargando plantillas:', error.message)
      return []
    }

    return ((data as ProjectionTemplate[]) ?? []).map((tpl) => ({
      ...tpl,
      columnas_meses: tpl.columnas_meses || [],
      columnas_personalizadas: Array.isArray(tpl.columnas_personalizadas)
        ? (tpl.columnas_personalizadas as CustomProjectionColumn[])
        : []
    }))
  },

  // 2. Obtener ítems de una plantilla
  async getItems(id_plantilla: number, _templateCodigo?: string): Promise<ProjectionItem[]> {
    try {
      const { data, error } = await supabase
        .from('item_proyeccion')
        .select('*')
        .eq('id_plantilla', id_plantilla)
        .eq('activo', true)
        .order('orden_fila', { ascending: true })

      if (error || !data || data.length === 0) {
        // Al ingresar por primera vez para hacer la proyección, debe iniciar vacía (sin productos pre-cargados)
        return []
      }

      return data.map((item: any) => ({
        id_item: item.id_item,
        id_plantilla: item.id_plantilla,
        id_producto: item.id_producto,
        nombre_producto: item.nombre_producto,
        datos_meses: item.datos_meses || {},
        promedio_manual: item.promedio_manual,
        stock_manual: item.stock_manual,
        stock_redondeado_manual: item.stock_redondeado_manual,
        orden_fila: item.orden_fila,
        activo: item.activo
      }))
    } catch {
      // Inicia vacía por defecto
      return []
    }
  },

  // 3. Obtener mapa de stock real en vivo desde almacén
  async getLiveStockMap(): Promise<Map<string, number>> {
    const stockMap = new Map<string, number>()
    try {
      const { data, error } = await supabase
        .from('inventario')
        .select(`
          stock_real,
          producto (
            nombre,
            sku
          )
        `)

      if (!error && data) {
        for (const row of data as any[]) {
          if (row.producto?.nombre) {
            const current = stockMap.get(row.producto.nombre) || 0
            stockMap.set(row.producto.nombre, current + Number(row.stock_real || 0))
          }
        }
      }
    } catch (err) {
      console.warn('Advertencia al consultar stock real en vivo:', err)
    }
    return stockMap
  },

  // 4. Actualizar parámetros o fórmulas de una plantilla
  async updateTemplateParams(
    id_plantilla: number,
    form: TemplateParamsForm
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const payload: Record<string, any> = {
        lead_time_meses: form.lead_time_meses,
        seguridad_pct: form.seguridad_pct,
        factor_compra: form.factor_compra,
        dias_por_mes: form.dias_por_mes,
        updated_at: new Date().toISOString()
      }

      if (form.formula_stock_min !== undefined) payload.formula_stock_min = form.formula_stock_min
      if (form.formula_seguridad !== undefined) payload.formula_seguridad = form.formula_seguridad
      if (form.formula_stock_min_f !== undefined) payload.formula_stock_min_f = form.formula_stock_min_f
      if (form.formula_compra !== undefined) payload.formula_compra = form.formula_compra
      if (form.formula_meses_duracion !== undefined) payload.formula_meses_duracion = form.formula_meses_duracion
      if (form.formula_stock_redondeado !== undefined) payload.formula_stock_redondeado = form.formula_stock_redondeado
      if (form.mes_inicio_promedio !== undefined) payload.mes_inicio_promedio = form.mes_inicio_promedio
      if (form.mes_fin_promedio !== undefined) payload.mes_fin_promedio = form.mes_fin_promedio
      if (form.ignorar_meses_cero !== undefined) payload.ignorar_meses_cero = form.ignorar_meses_cero

      const { error } = await supabase
        .from('plantilla_proyeccion')
        .update(payload)
        .eq('id_plantilla', id_plantilla)

      if (error) {
        // Si falló por columnas adicionales no migradas aún, reintentar con las columnas base
        const fallbackPayload = {
          lead_time_meses: form.lead_time_meses,
          seguridad_pct: form.seguridad_pct,
          factor_compra: form.factor_compra,
          dias_por_mes: form.dias_por_mes,
          updated_at: new Date().toISOString()
        }
        const { error: fallbackErr } = await supabase
          .from('plantilla_proyeccion')
          .update(fallbackPayload)
          .eq('id_plantilla', id_plantilla)

        if (fallbackErr) {
          return { success: false, error: fallbackErr.message }
        }
      }
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message || 'Error al actualizar parámetros.' }
    }
  },

  // 4b. Guardar y persistir columnas personalizadas de la plantilla
  async saveCustomColumns(
    id_plantilla: number,
    columns: CustomProjectionColumn[]
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const { error } = await supabase
        .from('plantilla_proyeccion')
        .update({
          columnas_personalizadas: columns,
          updated_at: new Date().toISOString()
        })
        .eq('id_plantilla', id_plantilla)

      if (error) {
        return { success: false, error: `No se pudieron guardar las columnas: ${error.message}` }
      }
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  },

  // 4c. Actualizar la ecuación de una columna específica (estándar o personalizada)
  async updateColumnFormula(
    id_plantilla: number,
    columnKey: CalculableColumnKey,
    newFormula: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const columnFieldMap: Record<string, string> = {
        stock_min: 'formula_stock_min',
        seguridad: 'formula_seguridad',
        stock_min_f: 'formula_stock_min_f',
        stock_min_redondeado: 'formula_stock_redondeado',
        compra_sugerida: 'formula_compra',
        meses_duracion: 'formula_meses_duracion'
      }

      const dbField = columnFieldMap[columnKey]
      if (!dbField) {
        // Columna personalizada
        try {
          const stored = localStorage.getItem(`shalom_custom_columns_${id_plantilla}`)
          let customCols: CustomProjectionColumn[] = stored ? JSON.parse(stored) : []
          const found = customCols.find((c) => c.id === columnKey)
          if (found) {
            customCols = customCols.map((c) =>
              c.id === columnKey ? { ...c, formula: newFormula } : c
            )
            return this.saveCustomColumns(id_plantilla, customCols)
          }
        } catch {}
        return { success: false, error: `Columna no configurable: ${columnKey}` }
      }

      const { error } = await supabase
        .from('plantilla_proyeccion')
        .update({
          [dbField]: newFormula,
          updated_at: new Date().toISOString()
        })
        .eq('id_plantilla', id_plantilla)

      if (error) {
        console.warn(`Aviso de persistencia en Supabase para ${dbField}:`, error.message)
      }
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  },

  // 4c. Actualizar rango de meses para cálculo de promedio
  async updateMonthRange(
    id_plantilla: number,
    startMonth: string | null,
    endMonth: string | null,
    ignoreZero: boolean
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const { error } = await supabase
        .from('plantilla_proyeccion')
        .update({
          mes_inicio_promedio: startMonth,
          mes_fin_promedio: endMonth,
          ignorar_meses_cero: ignoreZero,
          updated_at: new Date().toISOString()
        })
        .eq('id_plantilla', id_plantilla)

      if (error) {
        console.warn('Aviso de persistencia en Supabase para rango de meses:', error.message)
      }
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  },

  // 5. Guardar edición de una celda individual
  async updateItemCell(
    id_item: number,
    updates: Partial<ProjectionItem>
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const payload: any = { updated_at: new Date().toISOString() }

      if (updates.datos_meses !== undefined) payload.datos_meses = updates.datos_meses
      if (updates.promedio_manual !== undefined) payload.promedio_manual = updates.promedio_manual
      if (updates.stock_manual !== undefined) payload.stock_manual = updates.stock_manual
      if (updates.stock_redondeado_manual !== undefined) payload.stock_redondeado_manual = updates.stock_redondeado_manual
      if (updates.nombre_producto !== undefined) payload.nombre_producto = updates.nombre_producto

      const { error } = await supabase
        .from('item_proyeccion')
        .update(payload)
        .eq('id_item', id_item)

      if (error) {
        console.warn('Error al guardar celda en base de datos:', error)
      }
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  },

  // 6. Agregar nueva columna de mes
  async addMonthColumn(
    id_plantilla: number,
    currentMonths: string[] = [],
    newMonth: string
  ): Promise<{ success: boolean; error?: string }> {
    const cleanMonth = newMonth.trim().toUpperCase()
    const safeMonths = Array.isArray(currentMonths) ? currentMonths : []
    if (!cleanMonth || safeMonths.includes(cleanMonth)) {
      return { success: false, error: 'El nombre de mes no es válido o ya existe.' }
    }

    const updatedMonths = [...safeMonths, cleanMonth]
    const { error } = await supabase
      .from('plantilla_proyeccion')
      .update({
        columnas_meses: updatedMonths,
        updated_at: new Date().toISOString()
      })
      .eq('id_plantilla', id_plantilla)

    if (error) {
      return { success: false, error: `No se pudo agregar el mes: ${error.message}` }
    }
    return { success: true }
  },

  // 7. Agregar nuevo producto a la matriz
  async addItem(
    id_plantilla: number,
    nombreProducto: string,
    initialStock: number = 0
  ): Promise<{ success: boolean; newItem?: ProjectionItem; error?: string }> {
    const cleanName = nombreProducto.trim().toUpperCase()
    if (!cleanName) {
      return { success: false, error: 'El nombre del producto es obligatorio.' }
    }

    try {
      const { data, error } = await supabase
        .from('item_proyeccion')
        .insert({
          id_plantilla,
          nombre_producto: cleanName,
          datos_meses: {},
          stock_manual: initialStock,
          orden_fila: 999
        })
        .select('*')
        .single()

      if (error || !data) {
        // Fallback local
        const localItem: ProjectionItem = {
          id_item: Date.now(),
          id_plantilla,
          id_producto: null,
          nombre_producto: cleanName,
          datos_meses: {},
          promedio_manual: null,
          stock_manual: initialStock,
          stock_redondeado_manual: null,
          orden_fila: 999,
          activo: true
        }
        return { success: true, newItem: localItem }
      }

      return {
        success: true,
        newItem: {
          id_item: data.id_item,
          id_plantilla: data.id_plantilla,
          id_producto: data.id_producto,
          nombre_producto: data.nombre_producto,
          datos_meses: data.datos_meses || {},
          promedio_manual: data.promedio_manual,
          stock_manual: data.stock_manual,
          stock_redondeado_manual: data.stock_redondeado_manual,
          orden_fila: data.orden_fila,
          activo: data.activo
        }
      }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  },

  // 8. Eliminar producto de la matriz
  async deleteItem(id_item: number): Promise<{ success: boolean; error?: string }> {
    try {
      const { error } = await supabase
        .from('item_proyeccion')
        .delete()
        .eq('id_item', id_item)

      if (error) {
        console.warn('Advertencia DB al eliminar item de proyección (continuando en local):', error.message)
      }
      return { success: true }
    } catch (err: any) {
      console.warn('Excepción al eliminar item DB (continuando en local):', err?.message)
      return { success: true }
    }
  },

  // 9. Generar Orden de Importación consolidada desde la selección grupal
  async createImportOrderFromProjection(
    numeroOrden: string,
    tipoContenedor: '40FT' | '20FT' | 'LCL',
    selectedRows: CalculatedProjectionRow[]
  ): Promise<{ success: boolean; id_orden?: number; error?: string }> {
    if (!numeroOrden.trim()) {
      return { success: false, error: 'El número de orden es obligatorio.' }
    }

    if (selectedRows.length === 0) {
      return { success: false, error: 'Debe seleccionar al menos un producto con cantidad de compra sugerida.' }
    }

    try {
      // 1. Verificar si la orden ya existe en public.orden_importacion
      let targetIdOrden: number | null = null

      const { data: existingOrd } = await supabase
        .from('orden_importacion')
        .select('id_orden')
        .eq('numero_orden', numeroOrden.trim().toUpperCase())
        .maybeSingle()

      if (existingOrd?.id_orden) {
        targetIdOrden = existingOrd.id_orden
        await supabase
          .from('orden_importacion')
          .update({
            estado: 'TRANSITO',
            tipo_contenedor: tipoContenedor,
            fecha_emision: new Date().toISOString().split('T')[0]
          })
          .eq('id_orden', targetIdOrden)

        // Limpiar detalles previos si los hubiera para insertar el nuevo cálculo
        await supabase
          .from('detalle_orden')
          .delete()
          .eq('id_orden', targetIdOrden)
      } else {
        const { data: orden, error: ordenError } = await supabase
          .from('orden_importacion')
          .insert({
            numero_orden: numeroOrden.trim().toUpperCase(),
            estado: 'TRANSITO',
            tipo_contenedor: tipoContenedor,
            fecha_emision: new Date().toISOString().split('T')[0]
          })
          .select('id_orden')
          .single()

        if (ordenError || !orden) {
          return { success: false, error: ordenError?.message || 'Error al crear la orden de importación.' }
        }
        targetIdOrden = orden.id_orden
      }

      // 2. Asociar ítems en detalle_orden (buscar o crear producto si es necesario)
      const { data: productosExistentes } = await supabase
        .from('producto')
        .select('id_producto, nombre, sku')

      const prodMapByName = new Map<string, number>()
      for (const p of productosExistentes || []) {
        prodMapByName.set(p.nombre.toUpperCase(), p.id_producto)
        prodMapByName.set(p.sku.toUpperCase(), p.id_producto)
      }

      const detalles = []
      for (const row of selectedRows) {
        let idProd = row.id_producto || prodMapByName.get(row.nombre_producto.toUpperCase())

        // Si el producto no existe en el catálogo maestro, se crea automáticamente para permitir la trazabilidad
        if (!idProd) {
          const autoSku = 'SKU-' + row.nombre_producto.slice(0, 8).replace(/[^A-Z0-9]/g, '') + '-' + Math.floor(Math.random() * 1000)
          const { data: newProd } = await supabase
            .from('producto')
            .insert({
              sku: autoSku,
              nombre: row.nombre_producto
            })
            .select('id_producto')
            .single()

          if (newProd && typeof newProd.id_producto === 'number') {
            idProd = newProd.id_producto
            prodMapByName.set(row.nombre_producto.toUpperCase(), newProd.id_producto)
          }
        }

        if (idProd && row.compra_sugerida > 0) {
          detalles.push({
            id_orden: targetIdOrden,
            id_producto: idProd,
            cantidad_pedida: row.compra_sugerida
          })
        }
      }

      if (detalles.length > 0) {
        const { error: detalleError } = await supabase
          .from('detalle_orden')
          .insert(detalles)

        if (detalleError) {
          console.error('Error insertando detalle de orden:', detalleError)
        }
      }

      return { success: true, id_orden: targetIdOrden ?? undefined }
    } catch (err: any) {
      return { success: false, error: err.message || 'Error inesperado al generar la orden.' }
    }
  },

  // 10. GESTIÓN INTEGRAL DE ÓRDENES Y PROYECCIONES PERIÓDICAS
  /**
   * Órdenes: Supabase es la única fuente de verdad.
   * (Antes se mezclaban órdenes guardadas en el navegador y órdenes de ejemplo fijas.)
   * El snapshot de proyección se lee de la BD; la copia local solo se usa si la BD aún no tiene uno.
   */
  async getOrders(): Promise<ProjectionOrder[]> {
    const { data, error } = await supabase
      .from('orden_importacion')
      .select(`
        id_orden,
        numero_orden,
        id_proveedor,
        id_plantilla,
        estado,
        fecha_emision,
        tipo_contenedor,
        volumen_ocupado_m3,
        descripcion,
        total_items,
        total_unidades,
        snapshot_proyeccion,
        proveedor ( id_proveedor, razon_social ),
        detalle_orden (
          id_detalle,
          id_orden,
          id_producto,
          cantidad_pedida,
          subtotal_peso_kg,
          subtotal_volumen_m3,
          producto (
            id_producto,
            sku,
            nombre,
            regla_empaque ( unidades_por_caja, cajas_por_camada, numero_camadas, tipo_empaque )
          )
        )
      `)
      .order('fecha_emision', { ascending: false })
      .order('id_orden', { ascending: false })

    if (error) {
      throw new Error(`No se pudieron cargar las órdenes: ${error.message}`)
    }

    return ((data as any[]) ?? []).map((ord) => {
      const rawDetalles = ord.detalle_orden || []
      let sumPaletasCompletas = 0
      let sumPuchos = 0
      let sumBultos = 0

      const detalles = rawDetalles.map((d: any) => {
        const r = Array.isArray(d.producto?.regla_empaque) ? d.producto.regla_empaque[0] : d.producto?.regla_empaque
        const unidCaja = Math.max(1, Number(r?.unidades_por_caja) || 1)
        const cajasPal = Math.max(1, (Number(r?.cajas_por_camada) || 1) * (Number(r?.numero_camadas) || 1))
        const unidPal = unidCaja * cajasPal
        const cant = Number(d.cantidad_pedida) || 0
        const palCompletas = Math.floor(cant / unidPal)
        const unidRest = cant % unidPal
        const cajPucho = unidRest > 0 ? Math.ceil(unidRest / unidCaja) : 0
        const totBultos = palCompletas + (cajPucho > 0 ? 1 : 0)
        sumPaletasCompletas += palCompletas
        sumPuchos += cajPucho > 0 ? 1 : 0
        sumBultos += totBultos

        return {
          id_detalle: d.id_detalle,
          id_orden: d.id_orden,
          id_producto: d.id_producto,
          cantidad_pedida: d.cantidad_pedida,
          subtotal_peso_kg: d.subtotal_peso_kg,
          subtotal_volumen_m3: d.subtotal_volumen_m3,
          desglose_empaque: {
            unidades_por_caja: unidCaja,
            cajas_por_paleta: cajasPal,
            unidades_por_paleta: unidPal,
            cajas_totales: Math.ceil(cant / unidCaja),
            paletas_completas: palCompletas,
            cajas_pucho: cajPucho,
            unidades_pucho: unidRest,
            total_paletas_bultos: totBultos
          },
          producto: d.producto
            ? { id_producto: d.producto.id_producto, sku: d.producto.sku, nombre: d.producto.nombre, regla_empaque: r }
            : undefined
        }
      })

      const snapshot =
        ord.snapshot_proyeccion && Object.keys(ord.snapshot_proyeccion).length > 0 ? ord.snapshot_proyeccion : null

      return {
        id_orden: ord.id_orden,
        numero_orden: ord.numero_orden,
        descripcion: ord.descripcion || `Orden ${ord.numero_orden}`,
        id_plantilla: ord.id_plantilla ?? null,
        id_proveedor: ord.id_proveedor,
        estado: (ord.estado as ProjectionOrderStatus) || 'BORRADOR',
        fecha_emision: ord.fecha_emision,
        tipo_contenedor: ord.tipo_contenedor || null,
        volumen_ocupado_m3: ord.volumen_ocupado_m3 ?? null,
        total_items: snapshot?.items?.length || ord.total_items || rawDetalles.length,
        total_unidades:
          Number(ord.total_unidades) ||
          rawDetalles.reduce((acc: number, d: any) => acc + (Number(d.cantidad_pedida) || 0), 0),
        total_paletas_completas: sumPaletasCompletas,
        total_puchos: sumPuchos,
        total_bultos: sumBultos,
        proveedor: ord.proveedor
          ? { id_proveedor: ord.proveedor.id_proveedor, razon_social: ord.proveedor.razon_social, nombre: ord.proveedor.razon_social }
          : null,
        detalles,
        snapshot_proyeccion: snapshot || null
      } as ProjectionOrder
    })
  },

  /** Siguiente número correlativo del año: IMP-2026-001, IMP-2026-002… (según la BD). */
  async getNextOrderNumber(): Promise<string> {
    const year = new Date().getFullYear()
    const prefix = `IMP-${year}-`
    const { data } = await supabase.from('orden_importacion').select('numero_orden').ilike('numero_orden', `${prefix}%`)
    const max = ((data as { numero_orden: string }[]) ?? []).reduce((acc, o) => {
      const n = parseInt(o.numero_orden.slice(prefix.length), 10)
      return Number.isFinite(n) && n > acc ? n : acc
    }, 0)
    return `${prefix}${String(max + 1).padStart(3, '0')}`
  },

  async createOrder(payload: {
    numero_orden: string
    descripcion?: string
    id_plantilla?: number
    id_proveedor?: number | null
    tipo_contenedor?: '20FT' | '40FT' | 'LCL'
    estado?: ProjectionOrderStatus
    fecha_emision?: string
    snapshot_proyeccion?: any
    items?: Array<{ id_producto?: number; nombre_producto: string; cantidad_pedida: number }>
  }): Promise<{ success: boolean; id_orden?: number; order?: ProjectionOrder; error?: string }> {
    const cleanNum = payload.numero_orden.trim().toUpperCase()
    if (!cleanNum) {
      return { success: false, error: 'El número de orden es obligatorio.' }
    }

    const insertPayload = {
      numero_orden: cleanNum,
      descripcion: payload.descripcion?.trim() || `Orden ${cleanNum}`,
      id_plantilla: payload.id_plantilla ?? null,
      id_proveedor: payload.id_proveedor ?? null,
      tipo_contenedor: payload.tipo_contenedor || '40FT',
      estado: payload.estado || 'BORRADOR',
      fecha_emision: payload.fecha_emision || new Date().toISOString().split('T')[0],
      snapshot_proyeccion: payload.snapshot_proyeccion || {},
      total_items: payload.items?.length || 0,
      total_unidades: payload.items?.reduce((s, i) => s + (Number(i.cantidad_pedida) || 0), 0) || 0
    }

    const { data, error } = await supabase.from('orden_importacion').insert(insertPayload).select('id_orden').single()
    if (error || !data) {
      const msg = error?.code === '23505' ? `La orden ${cleanNum} ya existe.` : error?.message || 'Error desconocido'
      return { success: false, error: `No se pudo crear la orden: ${msg}` }
    }

    const order: ProjectionOrder = {
      id_orden: data.id_orden,
      numero_orden: cleanNum,
      descripcion: insertPayload.descripcion,
      id_plantilla: insertPayload.id_plantilla ?? undefined,
      id_proveedor: insertPayload.id_proveedor,
      estado: insertPayload.estado,
      fecha_emision: insertPayload.fecha_emision,
      tipo_contenedor: insertPayload.tipo_contenedor,
      total_items: insertPayload.total_items,
      total_unidades: insertPayload.total_unidades,
      snapshot_proyeccion: payload.snapshot_proyeccion || null,
      detalles: []
    } as ProjectionOrder

    return { success: true, id_orden: data.id_orden, order }
  },

  async updateOrder(
    id_orden: number,
    updates: Partial<ProjectionOrder>
  ): Promise<{ success: boolean; error?: string }> {
    const dbPayload: Record<string, unknown> = {}
    if (updates.estado) dbPayload.estado = updates.estado
    if (updates.tipo_contenedor) dbPayload.tipo_contenedor = updates.tipo_contenedor
    if (updates.volumen_ocupado_m3 !== undefined) dbPayload.volumen_ocupado_m3 = updates.volumen_ocupado_m3
    if (updates.fecha_emision) dbPayload.fecha_emision = updates.fecha_emision
    if (updates.total_items !== undefined) dbPayload.total_items = updates.total_items
    if (updates.total_unidades !== undefined) dbPayload.total_unidades = updates.total_unidades
    if (updates.descripcion !== undefined) dbPayload.descripcion = updates.descripcion
    if (updates.id_plantilla !== undefined) dbPayload.id_plantilla = updates.id_plantilla
    if (updates.id_proveedor !== undefined) dbPayload.id_proveedor = updates.id_proveedor

    if (updates.snapshot_proyeccion !== undefined) {
      // Fusión superficial con el snapshot guardado (mismo comportamiento que antes, ahora en la BD)
      const { data: current } = await supabase
        .from('orden_importacion')
        .select('snapshot_proyeccion')
        .eq('id_orden', id_orden)
        .maybeSingle()
      dbPayload.snapshot_proyeccion = updates.snapshot_proyeccion
        ? { ...((current?.snapshot_proyeccion as object) || {}), ...updates.snapshot_proyeccion }
        : updates.snapshot_proyeccion
    }

    if (Object.keys(dbPayload).length === 0) return { success: true }

    const { error } = await supabase.from('orden_importacion').update(dbPayload).eq('id_orden', id_orden)
    if (error) {
      return { success: false, error: `No se pudo actualizar la orden: ${error.message}` }
    }
    return { success: true }
  },

  async deleteOrder(id_orden: number): Promise<{ success: boolean; error?: string }> {
    const { error: detErr } = await supabase.from('detalle_orden').delete().eq('id_orden', id_orden)
    if (detErr) return { success: false, error: `No se pudo eliminar el detalle: ${detErr.message}` }
    const { error } = await supabase.from('orden_importacion').delete().eq('id_orden', id_orden)
    if (error) return { success: false, error: `No se pudo eliminar la orden: ${error.message}` }
    try {
      localStorage.removeItem(`${SNAPSHOT_STORAGE_PREFIX}${id_orden}`)
    } catch {
      // sin efecto si el navegador bloquea el almacenamiento
    }
    return { success: true }
  },

  // 11. IMPORTADOR ASISTIDO DE SALIDAS MENSUALES A AGENCIAS DESDE EXCEL
  async parseMonthlyOutputsExcel(
    file: File,
    template: ProjectionTemplate,
    existingItems: ProjectionItem[],
    masterCatalog?: Array<{ id_producto?: number | null; sku?: string; nombre: string }>
  ): Promise<{
    success: boolean
    error?: string
    result?: ExcelImportResult
    updatedItems?: ProjectionItem[]
  }> {
    try {
      const buffer = await file.arrayBuffer()
      const wb = XLSX.read(buffer, { type: 'array' })
      if (!wb.SheetNames || wb.SheetNames.length === 0) {
        return { success: false, error: 'El archivo Excel no contiene hojas de cálculo legibles.' }
      }

      // Buscar hoja coincidente con el código de la plantilla o tomar la primera
      let targetSheetName = wb.SheetNames[0]
      const tplCodeClean = (template.codigo || '').replace(/[^A-Z0-9]/gi, '').toUpperCase()
      for (const name of wb.SheetNames) {
        const cleanName = name.replace(/[^A-Z0-9]/gi, '').toUpperCase()
        if (cleanName.includes(tplCodeClean) || tplCodeClean.includes(cleanName)) {
          targetSheetName = name
          break
        }
      }

      const sheet = wb.Sheets[targetSheetName]
      const rawRows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1 })
      if (!rawRows || rawRows.length < 2) {
        return {
          success: false,
          error: `La hoja "${targetSheetName}" no contiene suficientes filas de datos.`
        }
      }

      const normalizeKey = (str: string) =>
        str
          .trim()
          .toUpperCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/[^A-Z0-9]/g, '')

      const MONTH_NAMES = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SET', 'OCT', 'NOV', 'DIC']

      // Cargar catálogo maestro de productos de Maestros y Empaque (public.producto)
      let catalog: Array<{ id_producto: number; sku: string; nombre: string }> = []
      if (masterCatalog && masterCatalog.length > 0) {
        catalog = masterCatalog
          .filter((p) => p.id_producto && p.nombre)
          .map((p) => ({
            id_producto: Number(p.id_producto),
            sku: p.sku || '',
            nombre: p.nombre
          }))
      }

      try {
        const { data: dbProds, error: dbErr } = await supabase
          .from('producto')
          .select('id_producto, sku, nombre')
          .or('activo.is.null,activo.eq.true')
        if (!dbErr && dbProds && Array.isArray(dbProds) && dbProds.length > 0) {
          const existingIds = new Set(catalog.map((c) => c.id_producto))
          for (const p of dbProds) {
            if (!existingIds.has(Number(p.id_producto))) {
              catalog.push({
                id_producto: Number(p.id_producto),
                sku: p.sku || '',
                nombre: p.nombre
              })
            }
          }
        }
      } catch (e) {
        console.warn('Error al consultar catálogo maestro en parseMonthlyOutputsExcel:', e)
      }

      // Función de parseo de fechas robusta (Excel serial, dd/mm/yyyy, yyyy-mm-dd)
      const parseExcelDate = (val: any): Date | null => {
        if (typeof val === 'number') {
          const dc = (XLSX.SSF as any).parse_date_code(val)
          if (dc) return new Date(dc.y, dc.m - 1, dc.d)
        }
        if (typeof val === 'string') {
          const parts = val.trim().split(/[\/\-\.]/)
          if (parts.length === 3) {
            if (parts[0].length === 4) {
              return new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]))
            } else {
              return new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]))
            }
          }
          const d = new Date(val)
          if (!isNaN(d.getTime())) return d
        }
        if (val instanceof Date) return val
        return null
      }

      // 1. Analizar encabezados para detectar si es formato Transaccional (con Fecha) o Matricial (con meses directos)
      let headerRowIndex = 0
      let dateColIdx = -1
      let productColIdx = -1
      let articleNameColIdx = -1
      let qtyColIdx = -1
      let detectedDirectMonths: Array<{ key: string; colIdx: number }> = []

      for (let r = 0; r < Math.min(10, rawRows.length); r++) {
        const row = rawRows[r]
        if (!row || !Array.isArray(row)) continue

        row.forEach((cell, idx) => {
          if (cell === null || cell === undefined) return
          const str = String(cell).trim().toUpperCase()

          if (str.includes('FECHA') || str === 'DATE' || str.includes('F.DESPACHO') || str.includes('F.SALIDA')) {
            dateColIdx = idx
          } else if (str.includes('NOMBRE') && (str.includes('ARTICULO') || str.includes('ÁRTICULO') || str.includes('PRODUCTO'))) {
            articleNameColIdx = idx
          } else if (str === 'PRODUCTO' || str === 'ITEM' || str.includes('SKU') || str.includes('CODIGO') || str.includes('COD_PROD')) {
            if (productColIdx < 0) productColIdx = idx
          } else if (
            str.includes('PROD') ||
            str.includes('DESCRIP') ||
            str.includes('MATERIAL') ||
            str.includes('SUMINISTRO')
          ) {
            if (productColIdx < 0) productColIdx = idx
          }

          // Detección de columna de cantidad (priorizar salidas efectivas y descartar unidades de medida)
          if (
            str.includes('CANT. ENVIADA') ||
            str.includes('CANT ENVIADA') ||
            str.includes('CANT. SALIDA') ||
            str.includes('CANTIDAD SALIDA') ||
            str.includes('SALIDA') ||
            str.includes('ENTREGA')
          ) {
            qtyColIdx = idx
          } else if (
            qtyColIdx < 0 &&
            (str.includes('CANT') || (str.includes('UNID') && !str.includes('MEDIDA') && !str.includes('MEDIA') && !str.includes('ALMACEN')))
          ) {
            qtyColIdx = idx
          }

          // Detección de meses directos en columnas (modo matricial alternativo)
          const prefix3 = str.slice(0, 3)
          if (MONTH_NAMES.includes(str) || MONTH_NAMES.includes(prefix3)) {
            let stdKey = prefix3
            if (stdKey === 'SEP') stdKey = 'SET'
            detectedDirectMonths.push({ key: stdKey, colIdx: idx })
          }
        })

        // Si encontramos Fecha + Producto + Cantidad, es formato transaccional por fecha
        if (dateColIdx >= 0 && (productColIdx >= 0 || articleNameColIdx >= 0)) {
          headerRowIndex = r
          break
        }

        // Si encontramos Producto + al menos 2 meses directos, es formato matricial
        if ((productColIdx >= 0 || articleNameColIdx >= 0) && detectedDirectMonths.length >= 2) {
          headerRowIndex = r
          break
        }
      }

      if (productColIdx < 0 && articleNameColIdx >= 0) {
        productColIdx = articleNameColIdx
      }

      const productMonthTotals: Record<string, Record<string, number>> = {}
      const rawProductDisplayNames: Record<string, string> = {}
      const rawProductArticleNames: Record<string, string> = {}
      let chronologicalMonths: string[] = []

      // =========================================================================
      // COINCIDENCIA ESTRICTA CONTRA CATÁLOGO MAESTRO (Maestros y Empaque)
      // =========================================================================
      const findInMasterCatalog = (prodStr: any, articleStr?: any) => {
        const s1 = typeof prodStr === 'string' ? prodStr.trim() : ''
        const s2 = typeof articleStr === 'string' ? articleStr.trim() : ''
        const n1 = normalizeKey(s1)
        const n2 = normalizeKey(s2)

        // 1. Coincidencia exacta por SKU
        if (n1) {
          const bySku1 = catalog.find((p) => p.sku && normalizeKey(p.sku) === n1)
          if (bySku1) return bySku1
        }
        if (n2) {
          const bySku2 = catalog.find((p) => p.sku && normalizeKey(p.sku) === n2)
          if (bySku2) return bySku2
        }

        // 2. Coincidencia exacta por Nombre de Producto en Catálogo
        if (n2) {
          const byName2 = catalog.find((p) => normalizeKey(p.nombre) === n2)
          if (byName2) return byName2
        }
        if (n1) {
          const byName1 = catalog.find((p) => normalizeKey(p.nombre) === n1)
          if (byName1) return byName1
        }

        return null
      }

      // =========================================================================
      // CASO A: FORMATO TRANSACCIONAL DE SALIDAS (Columna Fecha + Producto + Cantidad)
      // =========================================================================
      if (dateColIdx >= 0 && productColIdx >= 0) {
        if (qtyColIdx < 0) {
          qtyColIdx = Math.max(productColIdx, articleNameColIdx) + 1
        }

        const detectedMonthsSet = new Set<string>()
        const monthSortOrder: Record<string, number> = {}

        for (let r = headerRowIndex + 1; r < rawRows.length; r++) {
          const row = rawRows[r]
          if (!row || !Array.isArray(row)) continue

          const rawDate = row[dateColIdx]
          const parsedDate = parseExcelDate(rawDate)
          if (!parsedDate) continue

          const mIdx = parsedDate.getMonth()
          const mKey = MONTH_NAMES[mIdx]
          const sortVal = parsedDate.getFullYear() * 100 + mIdx
          monthSortOrder[mKey] = sortVal
          detectedMonthsSet.add(mKey)

          const rawProd = row[productColIdx]
          const rawArtic = articleNameColIdx >= 0 ? row[articleNameColIdx] : ''
          const prodText = typeof rawProd === 'string' ? rawProd.trim() : (rawProd ? String(rawProd).trim() : '')
          const articText = typeof rawArtic === 'string' ? rawArtic.trim() : (rawArtic ? String(rawArtic).trim() : '')
          if (!prodText && !articText) continue

          // Clave única compuesta para acumulación
          const itemKey = normalizeKey(articText || prodText)
          if (!itemKey) continue

          rawProductDisplayNames[itemKey] = articText || prodText
          rawProductArticleNames[itemKey] = prodText

          const rawQty = row[qtyColIdx]
          let numQty = 0
          if (typeof rawQty === 'number' && !isNaN(rawQty)) {
            numQty = Math.abs(rawQty)
          } else if (rawQty) {
            const parsed = parseFloat(String(rawQty).replace(/,/g, ''))
            if (!isNaN(parsed)) numQty = Math.abs(parsed)
          }

          if (!productMonthTotals[itemKey]) {
            productMonthTotals[itemKey] = {}
          }
          productMonthTotals[itemKey][mKey] = (productMonthTotals[itemKey][mKey] || 0) + numQty
        }

        chronologicalMonths = Array.from(detectedMonthsSet).sort(
          (a, b) => (monthSortOrder[a] || 0) - (monthSortOrder[b] || 0)
        )

        if (chronologicalMonths.length === 0) {
          return {
            success: false,
            error:
              'Se detectó la columna Fecha pero no se pudieron interpretar las fechas del archivo. Usa formato dd/mm/aaaa o aaaa-mm-dd.'
          }
        }
      }
      // =========================================================================
      // CASO B: FORMATO MATRICIAL DE SALIDAS (Columnas directas de meses JUN, JUL, etc.)
      // =========================================================================
      else if (detectedDirectMonths.length >= 2 && productColIdx >= 0) {
        chronologicalMonths = Array.from(new Set(detectedDirectMonths.map((m) => m.key)))

        for (let r = headerRowIndex + 1; r < rawRows.length; r++) {
          const row = rawRows[r]
          if (!row || !Array.isArray(row)) continue

          const rawProdName = row[productColIdx]
          const rawArticName = articleNameColIdx >= 0 ? row[articleNameColIdx] : ''
          const prodText = typeof rawProdName === 'string' ? rawProdName.trim() : (rawProdName ? String(rawProdName).trim() : '')
          const articText = typeof rawArticName === 'string' ? rawArticName.trim() : (rawArticName ? String(rawArticName).trim() : '')
          if (!prodText && !articText) continue

          const itemKey = normalizeKey(articText || prodText)
          if (!itemKey) continue

          rawProductDisplayNames[itemKey] = articText || prodText
          rawProductArticleNames[itemKey] = prodText

          if (!productMonthTotals[itemKey]) {
            productMonthTotals[itemKey] = {}
          }

          detectedDirectMonths.forEach((m) => {
            const rawVal = row[m.colIdx]
            let numQty = 0
            if (typeof rawVal === 'number' && !isNaN(rawVal)) {
              numQty = Math.abs(rawVal)
            } else if (rawVal !== undefined && rawVal !== null && String(rawVal).trim() !== '') {
              const parsed = parseFloat(String(rawVal).replace(/,/g, ''))
              if (!isNaN(parsed)) numQty = Math.abs(parsed)
            }
            productMonthTotals[itemKey][m.key] = (productMonthTotals[itemKey][m.key] || 0) + numQty
          })
        }
      } else {
        return {
          success: false,
          error:
            'No se encontraron los encabezados esperados en el Excel. Debe incluir [Fecha, Producto, Cantidad] o columnas directas de meses [JUN, JUL, AGO, etc.].'
        }
      }

      // Agrupación por Productos que Poseo (en catálogo) vs Productos No Registrados
      const productosPoseoMap: Record<
        number,
        {
          id_producto: number
          sku: string
          nombre_producto: string
          nombresEnExcel: Set<string>
          valoresMeses: Record<string, number>
          totalSalidas: number
        }
      > = {}

      const productosNoPoseoMap: Record<
        string,
        {
          nombre_en_excel: string
          valoresMeses: Record<string, number>
          totalSalidas: number
        }
      > = {}

      Object.keys(productMonthTotals).forEach((k) => {
        const rawName = rawProductDisplayNames[k] || k
        const articleText = rawProductArticleNames[k] || ''
        const monthMap = productMonthTotals[k]
        let itemTotal = 0
        const filledMonths: Record<string, number> = {}

        chronologicalMonths.forEach((m) => {
          const val = monthMap[m] || 0
          filledMonths[m] = -Math.abs(Math.round(val))
          itemTotal += Math.abs(Math.round(val))
        })

        // Cruce estricto y único contra Maestros y Empaque
        const matchedMaster = findInMasterCatalog(rawName, articleText)

        if (matchedMaster) {
          // PRODUCTO QUE POSEO (Registrado en Maestros y Empaque)
          if (!productosPoseoMap[matchedMaster.id_producto]) {
            productosPoseoMap[matchedMaster.id_producto] = {
              id_producto: matchedMaster.id_producto,
              sku: matchedMaster.sku || '',
              nombre_producto: matchedMaster.nombre,
              nombresEnExcel: new Set([rawName]),
              valoresMeses: { ...filledMonths },
              totalSalidas: itemTotal
            }
          } else {
            // Acumular salidas de múltiples líneas del Excel mapeadas al mismo producto del maestro
            const entry = productosPoseoMap[matchedMaster.id_producto]
            entry.nombresEnExcel.add(rawName)
            entry.totalSalidas += itemTotal
            chronologicalMonths.forEach((m) => {
              entry.valoresMeses[m] = (entry.valoresMeses[m] || 0) + (filledMonths[m] || 0)
            })
          }
        } else {
          // PRODUCTO QUE NO POSEO (No registrado en Maestros y Empaque: ¡OMITIDO DE LA TABLA!)
          if (!productosNoPoseoMap[k]) {
            productosNoPoseoMap[k] = {
              nombre_en_excel: rawName,
              valoresMeses: { ...filledMonths },
              totalSalidas: itemTotal
            }
          } else {
            const entry = productosNoPoseoMap[k]
            entry.totalSalidas += itemTotal
            chronologicalMonths.forEach((m) => {
              entry.valoresMeses[m] = (entry.valoresMeses[m] || 0) + (filledMonths[m] || 0)
            })
          }
        }
      })

      // Convertir a listas ordenadas
      const productosPoseoList = Object.values(productosPoseoMap)
        .map((p) => ({
          id_producto: p.id_producto,
          sku: p.sku,
          nombre_producto: p.nombre_producto,
          nombre_en_excel: Array.from(p.nombresEnExcel).join(' / '),
          valoresMeses: p.valoresMeses,
          totalSalidas: p.totalSalidas
        }))
        .sort((a, b) => a.nombre_producto.localeCompare(b.nombre_producto))

      const productosNoPoseoList = Object.values(productosNoPoseoMap)
        .map((p) => ({
          nombre_en_excel: p.nombre_en_excel,
          valoresMeses: p.valoresMeses,
          totalSalidas: p.totalSalidas
        }))
        .sort((a, b) => a.nombre_en_excel.localeCompare(b.nombre_en_excel))

      // =========================================================================
      // CONSTRUCCIÓN ESTRICTA DE updatedItems
      // REGLA CRÍTICA: SOLO SE CARGAN A LA TABLA LOS PRODUCTOS QUE POSEO (EN CATÁLOGO MAESTRO).
      // LOS PRODUCTOS NO REGISTRADOS Y CUALQUIER ÍTEM HUÉRFANO PREVIO SE EXCLUYEN TOTALMENTE.
      // =========================================================================
      const updatedItems: ProjectionItem[] = []
      const processedMasterIds = new Set<number>()

      // 1. Si un producto ya estaba en la matriz de la orden Y existe válidamente en el catálogo maestro
      for (const targetItem of existingItems) {
        // Verificar existencia en catálogo maestro
        const inCatalog = targetItem.id_producto
          ? catalog.find((c) => c.id_producto === targetItem.id_producto)
          : catalog.find((c) => normalizeKey(c.nombre) === normalizeKey(targetItem.nombre_producto))

        if (!inCatalog) {
          // Si el ítem previo en la tabla NO pertenece al catálogo maestro, SE PURGA Y SE ELIMINA DE LA TABLA
          continue
        }

        const masterId = inCatalog.id_producto
        processedMasterIds.add(masterId)

        const matchedPoseo = productosPoseoMap[masterId]
        if (matchedPoseo) {
          updatedItems.push({
            ...targetItem,
            id_producto: masterId,
            sku: inCatalog.sku || targetItem.sku || matchedPoseo.sku,
            nombre_producto: inCatalog.nombre,
            datos_meses: { ...matchedPoseo.valoresMeses }
          })
        } else {
          // Producto registrado en Maestros y Empaque pero que no tuvo salidas en este Excel
          const zeroMonths: Record<string, number> = {}
          chronologicalMonths.forEach((m) => {
            zeroMonths[m] = 0
          })
          updatedItems.push({
            ...targetItem,
            id_producto: masterId,
            sku: inCatalog.sku || targetItem.sku,
            nombre_producto: inCatalog.nombre,
            datos_meses: zeroMonths
          })
        }
      }

      // 2. Incorporar a la matriz los productos que poseo que aún no estaban en la matriz
      for (const poseo of productosPoseoList) {
        if (!processedMasterIds.has(poseo.id_producto)) {
          processedMasterIds.add(poseo.id_producto)
          const newItem: ProjectionItem = {
            id_item: Date.now() + Math.floor(Math.random() * 100000) + updatedItems.length,
            id_plantilla: template.id_plantilla,
            id_producto: poseo.id_producto,
            sku: poseo.sku,
            nombre_producto: poseo.nombre_producto,
            datos_meses: { ...poseo.valoresMeses },
            promedio_manual: null,
            stock_manual: 0,
            stock_redondeado_manual: null,
            orden_fila: updatedItems.length + 1,
            activo: true
          }
          updatedItems.push(newItem)
        }
      }

      // Preview de filas combinadas
      const previewRows: Array<{
        producto: string
        valoresMeses: Record<string, number>
        coincide: boolean
      }> = []

      productosPoseoList.slice(0, 15).forEach((p) => {
        previewRows.push({
          producto: p.nombre_producto,
          valoresMeses: p.valoresMeses,
          coincide: true
        })
      })

      productosNoPoseoList.slice(0, 10).forEach((p) => {
        previewRows.push({
          producto: p.nombre_en_excel,
          valoresMeses: p.valoresMeses,
          coincide: false
        })
      })

      return {
        success: true,
        result: {
          fileName: file.name,
          detectedMonths: chronologicalMonths,
          matchedCount: productosPoseoList.length,
          unmatchedCount: productosNoPoseoList.length,
          totalExcelProducts: productosPoseoList.length + productosNoPoseoList.length,
          totalExcelRows: rawRows.length - (headerRowIndex + 1),
          unmatchedProducts: productosNoPoseoList.map((p) => p.nombre_en_excel),
          productosPoseo: productosPoseoList,
          productosNoPoseo: productosNoPoseoList,
          previewRows
        },
        updatedItems
      }
    } catch (err: any) {
      return {
        success: false,
        error: err.message || 'Error al procesar el archivo Excel.'
      }
    }
  }
}
