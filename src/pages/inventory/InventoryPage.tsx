import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../auth/AuthProvider'
import { logCatalogChange } from '../../lib/audit'
import { supabase } from '../../lib/supabase'
import { locationService } from '../../services/locationService'
import type { PalletRecord } from '../../types/locations'
import { normalizarModo } from '../products/empaque'
import { productoRepository } from '../products/repositories/ProductRepository'
import { unidadSerializadaRepository } from '../products/repositories/SerialUnitRepository'
import type { EstadoUnidadSerial, UnidadSerializada } from '../products/types'
import { InventoryKpiStrip, type InventorySummary } from './InventoryKpiStrip'
import { OperationalAlertsBanner } from './OperationalAlertsBanner'
import { RackLocationsSubView } from './RackLocationsSubView'
import { WarehouseSelectorBar } from './WarehouseSelectorBar'
import { SerialInspectionModal } from './modals/SerialInspectionModal'
import { StockEntryAdjustModal, type StockModalMode } from './modals/StockEntryAdjustModal'
import { WarehouseCrudModal } from './modals/WarehouseCrudModal'
import { StockPalletsSubView } from './subviews/StockPalletsSubView'
import { WarehouseAdminSubView } from './subviews/WarehouseAdminSubView'
import { mapProductToOption, type InventoryItem, type ProductOption, type SystemAlert, type Warehouse } from './types'

type Tab = 'stock' | 'ubicaciones' | 'config'

type Props = {
  onBack: () => void
  /** Historial (Kardex) y salidas viven en el módulo 03 */
  onGoToMovements?: () => void
}

export function InventoryPage({ onBack, onGoToMovements }: Props) {
  const { profile } = useAuth()
  const isAdmin = Boolean(profile?.roles.includes('ADMINISTRADOR'))
  const canOperate = Boolean(profile?.roles.some((r) => r === 'ADMINISTRADOR' || r === 'OPERARIO'))

  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<number | null>(null)
  const [inventory, setInventory] = useState<InventoryItem[]>([])
  const [showZeroStock, setShowZeroStock] = useState(false)
  const [allProducts, setAllProducts] = useState<ProductOption[]>([])
  const [activePallets, setActivePallets] = useState<PalletRecord[]>([])
  const [systemAlerts, setSystemAlerts] = useState<SystemAlert[]>([])
  const [serialUnitsMap, setSerialUnitsMap] = useState<Map<number, UnidadSerializada[]>>(new Map())

  const [loading, setLoading] = useState(true)
  const [loadingStock, setLoadingStock] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const [currentTab, setCurrentTab] = useState<Tab>('stock')

  const [stockModal, setStockModal] = useState<{ open: boolean; mode: StockModalMode; productId?: string }>({
    open: false,
    mode: 'ingreso'
  })
  const [inspectSerialProd, setInspectSerialProd] = useState<{ product: ProductOption; units: UnidadSerializada[] } | null>(null)
  const [updatingUnitState, setUpdatingUnitState] = useState(false)

  const [showWhModal, setShowWhModal] = useState(false)
  const [editingWh, setEditingWh] = useState<Warehouse | null>(null)
  const [savingWh, setSavingWh] = useState(false)

  async function loadInitialData(selectWhId?: number) {
    setLoading(true)
    setError(null)

    const { data: whData, error: whErr } = await supabase
      .from('almacen')
      .select('id_almacen, nombre, tipo, capacidad_m3, activo, prefijo_rfid')
      .order('id_almacen')

    if (whErr) {
      setError(`Error cargando almacenes: ${whErr.message}`)
      setLoading(false)
      return
    }

    const whList = (whData as Warehouse[]) || []
    setWarehouses(whList)
    if (selectWhId) {
      setSelectedWarehouseId(selectWhId)
    } else if (whList.length > 0 && !selectedWarehouseId) {
      setSelectedWarehouseId((whList.find((w) => w.activo) ?? whList[0]).id_almacen)
    }

    try {
      const prodList = await productoRepository.obtenerTodos()
      setAllProducts(prodList.map(mapProductToOption))
    } catch (prodErr) {
      console.warn('[inventario] Error cargando catálogo:', prodErr)
    }
    setLoading(false)
  }

  /** Solo LEE datos: no escribe en la base al abrir la vista. */
  async function loadWarehouseInventory(whId: number) {
    setLoadingStock(true)
    setError(null)

    let products = allProducts
    if (products.length === 0) {
      try {
        products = (await productoRepository.obtenerTodos()).map(mapProductToOption)
        setAllProducts(products)
      } catch {
        // la tabla mostrará lo que exista en inventario
      }
    }

    const [serialRes, invRes, palletsRes, alertsRes] = await Promise.allSettled([
      supabase
        .from('unidad_serializada')
        .select('id_unidad, id_producto, numero_serie, id_etiqueta, id_almacen, estado, fecha_ingreso')
        .eq('id_almacen', whId)
        .order('fecha_ingreso', { ascending: false }),
      supabase
        .from('inventario')
        .select(`
          id_inventario, id_producto, id_almacen, stock_real, stock_minimo, estado_semaforo,
          cajas_cerradas, unidades_caja_abierta,
          producto ( sku, nombre, clasificacion_abc, unidad_medida, categoria ( nombre, modo_manejo ) )
        `)
        .eq('id_almacen', whId),
      locationService.getWarehousePallets(whId),
      locationService.getSystemAlerts(whId)
    ])

    const sMap = new Map<number, UnidadSerializada[]>()
    if (serialRes.status === 'fulfilled' && serialRes.value.data) {
      for (const s of serialRes.value.data) {
        const list = sMap.get(Number(s.id_producto)) || []
        list.push(s as unknown as UnidadSerializada)
        sMap.set(Number(s.id_producto), list)
      }
    }
    setSerialUnitsMap(sMap)

    if (invRes.status === 'fulfilled' && invRes.value.error) {
      setError(`Error consultando inventario: ${invRes.value.error.message}`)
    }
    const invItems: InventoryItem[] =
      invRes.status === 'fulfilled' ? ((invRes.value.data as unknown as InventoryItem[]) ?? []) : []

    const pallets = palletsRes.status === 'fulfilled' ? palletsRes.value : []
    setActivePallets(pallets)
    setSystemAlerts(alertsRes.status === 'fulfilled' ? alertsRes.value : [])

    // Productos con paletas activas pero sin fila en `inventario`: se muestran (sin escribir en la BD)
    const conFila = new Set(invItems.map((i) => i.id_producto))
    const huerfanos = new Map<number, PalletRecord[]>()
    for (const p of pallets) {
      if (p.id_producto && !conFila.has(p.id_producto)) {
        huerfanos.set(p.id_producto, [...(huerfanos.get(p.id_producto) || []), p])
      }
    }
    for (const [prodId, list] of huerfanos) {
      const prod = products.find((ap) => ap.id_producto === prodId)
      const unidades = list.reduce((acc, p) => acc + (Number(p.cantidad_actual) || 0), 0)
      invItems.push({
        id_inventario: -prodId,
        id_producto: prodId,
        id_almacen: whId,
        stock_real: unidades,
        stock_minimo: 0,
        estado_semaforo: unidades > 0 ? 'VERDE' : 'ROJO',
        sin_registro: true,
        producto: {
          sku: prod?.sku || list[0].producto?.sku || `#${prodId}`,
          nombre: prod?.nombre || list[0].producto?.nombre || 'Producto',
          clasificacion_abc: null,
          unidad_medida: null,
          categoria: prod ? { nombre: prod.categoria_nombre ?? 'Sin categoría', modo_manejo: prod.modo_manejo } : null
        }
      })
    }

    setInventory(invItems)
    setLoadingStock(false)
  }

  useEffect(() => {
    void loadInitialData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (selectedWarehouseId !== null) {
      setShowZeroStock(false)
      void loadWarehouseInventory(selectedWarehouseId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedWarehouseId])

  const selectedWarehouse = warehouses.find((w) => w.id_almacen === selectedWarehouseId)

  // Indicadores: misma fuente que la tabla (inventario + paletas activas + equipos)
  const summary = useMemo<InventorySummary>(() => {
    const productById = new Map(allProducts.map((p) => [p.id_producto, p]))
    let totalUnidades = 0
    let productosConStock = 0
    let cajasCerradas = 0
    let cajasAbiertas = 0
    let productosPorCaja = 0
    let volumen = 0
    let conVolumen = 0
    let sinMedidas = 0

    for (const item of inventory) {
      const stock = Number(item.stock_real) || 0
      if (stock <= 0) continue
      totalUnidades += stock
      productosConStock += 1
      const prod = productById.get(item.id_producto)
      const modo = normalizarModo(prod?.modo_manejo ?? item.producto?.categoria?.modo_manejo)
      if (modo === 'PICKING_CAJA') {
        productosPorCaja += 1
        cajasCerradas += Number(item.cajas_cerradas) || 0
        if ((Number(item.unidades_caja_abierta) || 0) > 0) cajasAbiertas += 1
      }
      // Volumen ocupado: empaques equivalentes × volumen del empaque (o volumen unitario del equipo)
      let volUnidad: number | null = null
      if (modo === 'SERIALIZADO' && prod?.largo_cm && prod?.ancho_cm && prod?.alto_cm) {
        volUnidad = (prod.largo_cm * prod.ancho_cm * prod.alto_cm) / 1000000
      } else if (prod?.volumen_caja_m3) {
        volUnidad = prod.volumen_caja_m3 / Math.max(1, prod.unidades_por_caja)
      }
      if (volUnidad) {
        volumen += stock * volUnidad
        conVolumen += 1
      } else {
        sinMedidas += 1
      }
    }

    const equipos = Array.from(serialUnitsMap.values()).reduce(
      (acc, list) => acc + list.filter((u) => u.estado !== 'DESPACHADA' && u.estado !== 'BAJA').length,
      0
    )

    return {
      totalUnidades,
      productosConStock,
      paletasCompletas: activePallets.filter((p) => p.tipo_paleta === 'COMPLETO').length,
      puchos: activePallets.filter((p) => p.tipo_paleta === 'PUCHO').length,
      cajasCerradas,
      cajasAbiertas,
      productosPorCaja,
      equipos,
      volumenM3: conVolumen > 0 ? volumen : null,
      capacidadM3: selectedWarehouse?.capacidad_m3 ?? null,
      productosSinMedidas: sinMedidas
    }
  }, [inventory, allProducts, activePallets, serialUnitsMap, selectedWarehouse])

  async function handleSaveWarehouse(payload: {
    nombre: string
    tipo: 'PRINCIPAL' | 'TIENDA' | 'MERMA'
    capacidad_m3: number | null
    activo: boolean
    prefijo_rfid: string
  }) {
    setSavingWh(true)
    setError(null)
    setSuccessMsg(null)
    try {
      if (editingWh) {
        const { error: updErr } = await supabase.from('almacen').update(payload).eq('id_almacen', editingWh.id_almacen)
        if (updErr) throw updErr
        await logCatalogChange({
          tabla: 'almacen',
          operacion: 'UPDATE',
          id_registro: editingWh.id_almacen,
          datos_anteriores: editingWh,
          datos_nuevos: payload
        })
        setSuccessMsg(`Almacén "${payload.nombre}" actualizado (prefijo ${payload.prefijo_rfid}).`)
        await loadInitialData(editingWh.id_almacen)
      } else {
        const { data: newWh, error: insErr } = await supabase.from('almacen').insert(payload).select('id_almacen').single()
        if (insErr) throw insErr
        if (newWh?.id_almacen) {
          await supabase.from('secuencia_rfid').upsert({ id_almacen: newWh.id_almacen, ultimo_numero: 0 }, { onConflict: 'id_almacen' })
        }
        await logCatalogChange({ tabla: 'almacen', operacion: 'INSERT', id_registro: newWh?.id_almacen ?? 0, datos_nuevos: payload })
        setSuccessMsg(`Almacén "${payload.nombre}" registrado (prefijo ${payload.prefijo_rfid}).`)
        await loadInitialData(newWh?.id_almacen)
      }
      setShowWhModal(false)
    } catch (err: unknown) {
      setError(`Error guardando almacén: ${err instanceof Error ? err.message : (err as { message?: string })?.message}`)
    } finally {
      setSavingWh(false)
    }
  }

  async function handleToggleWarehouseActive(wh: Warehouse) {
    setError(null)
    const updatedStatus = !wh.activo
    const { error: updErr } = await supabase.from('almacen').update({ activo: updatedStatus }).eq('id_almacen', wh.id_almacen)
    if (updErr) {
      setError(`Error cambiando estado: ${updErr.message}`)
      return
    }
    await logCatalogChange({
      tabla: 'almacen',
      operacion: 'UPDATE',
      id_registro: wh.id_almacen,
      datos_anteriores: { activo: wh.activo },
      datos_nuevos: { activo: updatedStatus }
    })
    setSuccessMsg(`Almacén "${wh.nombre}" ${updatedStatus ? 'activado' : 'desactivado'}.`)
    await loadInitialData(wh.id_almacen)
  }

  async function handleDeleteWarehouse(wh: Warehouse) {
    if (!window.confirm(`¿Eliminar el almacén "${wh.nombre}"? Si tiene existencias o movimientos no se podrá eliminar; en ese caso desactívalo.`)) {
      return
    }
    setError(null)
    const { error: delErr } = await supabase.from('almacen').delete().eq('id_almacen', wh.id_almacen)
    if (delErr) {
      setError(`No se puede eliminar porque tiene registros asociados (inventario o movimientos). Desactívalo en su lugar. Detalle: ${delErr.message}`)
      return
    }
    await logCatalogChange({ tabla: 'almacen', operacion: 'DELETE', id_registro: wh.id_almacen, datos_anteriores: wh })
    setSuccessMsg(`Almacén "${wh.nombre}" eliminado.`)
    await loadInitialData()
  }

  async function handleToggleUnitState(unit: UnidadSerializada) {
    setUpdatingUnitState(true)
    setError(null)
    try {
      const nuevoEstado: EstadoUnidadSerial = unit.estado === 'DISPONIBLE' ? 'EN_MANTENIMIENTO' : 'DISPONIBLE'
      await unidadSerializadaRepository.cambiarEstado(unit.id_unidad, nuevoEstado)
      if (inspectSerialProd) {
        setInspectSerialProd({
          ...inspectSerialProd,
          units: inspectSerialProd.units.map((u) => (u.id_unidad === unit.id_unidad ? { ...u, estado: nuevoEstado } : u))
        })
      }
      if (selectedWarehouseId) await loadWarehouseInventory(selectedWarehouseId)
    } catch (err: unknown) {
      setError(`Error actualizando el equipo: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setUpdatingUnitState(false)
    }
  }

  function openStockModal(mode: StockModalMode, productId?: number) {
    setStockModal({ open: true, mode, productId: productId ? String(productId) : undefined })
  }

  if (loading) {
    return <main className="screen-message">Cargando almacenes y existencias…</main>
  }

  return (
    <section className="products-page">
      <div className="page-heading">
        <div>
          <button className="link-back" type="button" onClick={onBack}>
            <span aria-hidden="true">‹</span> Volver al panel principal
          </button>
          <div className="view-title-row">
            <h2>Inventario y almacenes</h2>
            <span className="module-code-badge">MOD-02</span>
          </div>
          <p className="page-lead">Existencias por almacén según su presentación: paletas, cajas o equipos, y dónde están ubicadas.</p>
        </div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            className="btn-secondary"
            type="button"
            onClick={() => selectedWarehouseId && void loadWarehouseInventory(selectedWarehouseId)}
          >
            Actualizar
          </button>
          {canOperate && warehouses.length > 0 && (
            <button className="btn-primary" type="button" onClick={() => openStockModal('ingreso')} style={{ margin: 0 }}>
              + Ingresar stock
            </button>
          )}
        </div>
      </div>

      {error && (
        <p className="error notice" role="alert" style={{ margin: '14px 0' }}>
          {error}
        </p>
      )}
      {successMsg && (
        <div className="notice" role="status" style={{ margin: '14px 0', display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
          <span>{successMsg}</span>
          <button type="button" className="btn-detail" onClick={() => setSuccessMsg(null)} aria-label="Cerrar mensaje">
            ✕
          </button>
        </div>
      )}

      {warehouses.length === 0 && (
        <div className="panel" style={{ padding: '24px' }}>
          <h3 style={{ marginTop: 0 }}>Aún no hay almacenes</h3>
          <p className="muted" style={{ margin: '0 0 14px' }}>
            Crea al menos un almacén (por ejemplo Importaciones, Store o Construcción) con su prefijo RFID para empezar a ingresar stock.
          </p>
          {isAdmin ? (
            <button
              className="btn-primary"
              type="button"
              onClick={() => {
                setEditingWh(null)
                setShowWhModal(true)
              }}
            >
              + Crear almacén
            </button>
          ) : (
            <p className="muted" style={{ margin: 0 }}>Pide a un administrador que registre los almacenes.</p>
          )}
        </div>
      )}

      {warehouses.length > 0 && (
        <WarehouseSelectorBar
          warehouses={warehouses}
          selectedWarehouseId={selectedWarehouseId}
          onSelectWarehouse={(id) => setSelectedWarehouseId(id)}
        />
      )}

      {warehouses.length > 0 && <InventoryKpiStrip summary={summary} />}

      <OperationalAlertsBanner
        alerts={systemAlerts}
        onResolveAlert={async (idAlerta) => {
          await locationService.resolveAlert(idAlerta)
          setSystemAlerts((prev) => prev.filter((a) => a.id_alerta !== idAlerta))
          setSuccessMsg('Alerta marcada como verificada.')
        }}
      />

      {warehouses.length > 0 && (
      <nav className="module-tabs" aria-label="Secciones de inventario">
        <button className={currentTab === 'stock' ? 'active' : ''} type="button" onClick={() => setCurrentTab('stock')}>
          Existencias
        </button>
        <button className={currentTab === 'ubicaciones' ? 'active' : ''} type="button" onClick={() => setCurrentTab('ubicaciones')}>
          Ubicaciones ({activePallets.length} {activePallets.length === 1 ? 'paleta' : 'paletas'})
        </button>
        {isAdmin && (
          <button className={currentTab === 'config' ? 'active' : ''} type="button" onClick={() => setCurrentTab('config')}>
            Configuración
          </button>
        )}
      </nav>
      )}

      {onGoToMovements && warehouses.length > 0 && currentTab !== 'config' && (
        <p className="muted" style={{ margin: '0 0 12px', fontSize: '13px' }}>
          El historial (Kardex), las transferencias y las salidas se gestionan en{' '}
          <button type="button" className="link-back" style={{ padding: 0 }} onClick={onGoToMovements}>
            Movimientos
          </button>
          .
        </p>
      )}

      {currentTab === 'stock' && warehouses.length > 0 && (
        <StockPalletsSubView
          warehouseName={selectedWarehouse?.nombre}
          inventory={inventory}
          allProducts={allProducts}
          activePallets={activePallets}
          serialUnitsMap={serialUnitsMap}
          loadingStock={loadingStock}
          showZeroStock={showZeroStock}
          onToggleShowZeroStock={setShowZeroStock}
          onIngresar={(id) => (canOperate ? openStockModal('ingreso', id) : setError('Tu rol no permite ingresar stock.'))}
          onAjustarConteo={(id) => (canOperate ? openStockModal('conteo', id) : setError('Tu rol no permite ajustar conteos.'))}
          onInspectSerial={(product, units) => setInspectSerialProd({ product, units })}
        />
      )}

      {currentTab === 'ubicaciones' && selectedWarehouse && (
        <RackLocationsSubView
          warehouseId={selectedWarehouse.id_almacen}
          warehouseName={selectedWarehouse.nombre}
          products={allProducts}
        />
      )}

      {currentTab === 'config' && isAdmin && (
        <WarehouseAdminSubView
          warehouses={warehouses}
          onNewWarehouse={() => {
            setEditingWh(null)
            setShowWhModal(true)
          }}
          onEditWarehouse={(wh) => {
            setEditingWh(wh)
            setShowWhModal(true)
          }}
          onToggleWarehouseActive={(wh) => void handleToggleWarehouseActive(wh)}
          onDeleteWarehouse={(wh) => void handleDeleteWarehouse(wh)}
        />
      )}

      <StockEntryAdjustModal
        isOpen={stockModal.open}
        mode={stockModal.mode}
        onClose={() => setStockModal((s) => ({ ...s, open: false }))}
        warehouseId={selectedWarehouseId}
        warehouseName={selectedWarehouse?.nombre}
        warehousePrefix={selectedWarehouse?.prefijo_rfid || undefined}
        allProducts={allProducts}
        inventory={inventory}
        initialProductId={stockModal.productId}
        onSaved={(msg) => {
          setSuccessMsg(msg)
          if (selectedWarehouseId) void loadWarehouseInventory(selectedWarehouseId)
        }}
      />

      <SerialInspectionModal
        isOpen={Boolean(inspectSerialProd)}
        onClose={() => setInspectSerialProd(null)}
        inspectProd={inspectSerialProd}
        warehouseName={selectedWarehouse?.nombre}
        onToggleUnitState={(unit) => void handleToggleUnitState(unit)}
        updatingUnitState={updatingUnitState}
        onOpenEnrollModal={(prodId) => openStockModal('ingreso', prodId)}
      />

      <WarehouseCrudModal
        warehouses={warehouses}
        isOpen={showWhModal}
        onClose={() => setShowWhModal(false)}
        editingWh={editingWh}
        onSaveWarehouse={handleSaveWarehouse}
        saving={savingWh}
      />
    </section>
  )
}
