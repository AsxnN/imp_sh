import { useEffect, useState, useMemo } from 'react'
import {
  receptionService,
  type WarehouseOption
} from '../services/receptionService'
import { containerService } from '../services/containerService'
import { packingListService, type OrderPackingPlan } from '../services/packingListService'
import { orderReceptionService } from '../services/orderReceptionService'
import type { ContainerRecord } from '../types/containers'
import type { ImportOrder, OrderReceptionState } from '../types/receptions'

// Subcomponentes del nuevo flujo modular
import { WarehouseSearchSelector } from './receptions/WarehouseSearchSelector'
import { OrderReceptionView } from './receptions/OrderReceptionView'
import { ProductReceptionView } from './receptions/ProductReceptionView'
import { ReceptionLiquidationView } from './receptions/ReceptionLiquidationView'

interface Props {
  onBack?: () => void
  onNavigateToInventory?: () => void
  initialContainerId?: number | null
  /** Las órdenes se crean solo en MOD-06 (Órdenes y proyecciones) */
  onGoToOrders?: () => void
}

export function ReceptionsPage({
  onBack: _onBack,
  onNavigateToInventory: _onNavigateToInventory,
  initialContainerId,
  onGoToOrders
}: Props) {
  // 1. Almacenes y estado global
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([])
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<number | null>(null)

  // 2. Modo de Navegación del Módulo
  // 'orders_list': Lista principal de órdenes
  // 'order_reception': Vista de la orden seleccionada con compuerta de contenedor
  // 'product_reception': Vista de recepción individual de un producto
  // 'liquidation': Vista de liquidación y liberación de códigos
  const [viewMode, setViewMode] = useState<'orders_list' | 'order_reception' | 'product_reception' | 'liquidation'>('orders_list')

  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  // 3. Datos maestros
  const [orders, setOrders] = useState<ImportOrder[]>([])
  const [activeContainers, setActiveContainers] = useState<ContainerRecord[]>([])

  // 4. Selección activa
  const [selectedOrderId, setSelectedOrderId] = useState<string>('')
  const [selectedProductId, setSelectedProductId] = useState<number | null>(null)
  const [activePackingPlan, setActivePackingPlan] = useState<OrderPackingPlan | null>(null)
  const [receptionState, setReceptionState] = useState<OrderReceptionState>({
    contenedor_confirmado: false,
    paletas_recibidas: [],
    codigos_liberados: [],
    estado_recepcion: 'PENDIENTE'
  })

  // 5. Filtro y búsqueda en lista de órdenes
  const [orderFilter, setOrderFilter] = useState<'ALL' | 'PENDING' | 'RECEIVED'>('ALL')
  const [searchOrderTerm, setSearchOrderTerm] = useState('')


  // 7. Modal y visualizador de Packing List
  const [orderPackingModal, setOrderPackingModal] = useState<OrderPackingPlan | null>(null)
  const [loadingPackingModal, setLoadingPackingModal] = useState(false)

  // Almacén activo
  const selectedWarehouse = useMemo(() => {
    return warehouses.find((w) => w.id_almacen === selectedWarehouseId) || warehouses[0] || null
  }, [warehouses, selectedWarehouseId])

  // Orden activa
  const selectedOrder = useMemo(() => {
    if (!selectedOrderId) return null
    return orders.find((o) => String(o.id_orden) === selectedOrderId) || null
  }, [orders, selectedOrderId])

  // Detalle de producto activo en la orden
  const selectedOrderDetail = useMemo(() => {
    if (!selectedOrder || !selectedProductId) return null
    return selectedOrder.detalles?.find((d) => d.id_producto === selectedProductId) || null
  }, [selectedOrder, selectedProductId])

  // Carga inicial
  const loadInitialData = async () => {
    setLoading(true)
    setErrorMsg(null)
    try {
      const [whList, ordList, contList] = await Promise.all([
        receptionService.getWarehouses(),
        receptionService.getImportOrders('ALL'),
        containerService.getActiveContainersInYard()
      ])

      setWarehouses(whList)
      setOrders(ordList)
      setActiveContainers(contList)

      if (whList.length > 0 && selectedWarehouseId === null) {
        setSelectedWarehouseId(whList[0].id_almacen)
      }
    } catch (err: any) {
      setErrorMsg(`Error cargando datos de recepción: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadInitialData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Refrescar contenedores al cambiar de vista
  useEffect(() => {
    void containerService.getActiveContainersInYard().then(setActiveContainers)
  }, [viewMode])

  // Órdenes filtradas para la lista principal
  const filteredOrders = useMemo(() => {
    let list = orders
    if (orderFilter === 'PENDING') {
      list = list.filter((o) => o.estado === 'TRANSITO' || o.estado === 'BORRADOR')
    } else if (orderFilter === 'RECEIVED') {
      list = list.filter((o) => o.estado === 'RECIBIDA')
    }

    if (searchOrderTerm.trim()) {
      const q = searchOrderTerm.toLowerCase().trim()
      list = list.filter(
        (o) =>
          o.numero_orden.toLowerCase().includes(q) ||
          (o.proveedor?.razon_social && o.proveedor.razon_social.toLowerCase().includes(q)) ||
          (o.proveedor?.nombre && o.proveedor.nombre.toLowerCase().includes(q)) ||
          (o.detalles && o.detalles.some((d) => d.producto?.sku.toLowerCase().includes(q) || d.producto?.nombre.toLowerCase().includes(q)))
      )
    }
    return list
  }, [orders, orderFilter, searchOrderTerm])

  // Abrir recepción de una orden (Paso al Nivel 2)
  const handleOpenOrderReception = async (ord: ImportOrder) => {
    setErrorMsg(null)
    setSelectedOrderId(String(ord.id_orden))
    setSelectedProductId(null)

    // Cargar o inicializar estado de recepción
    const state = orderReceptionService.getOrderReceptionState(ord.id_orden, ord.snapshot_proyeccion)

    // Si viene un initialContainerId desde MOD-07 y la orden no tenía contenedor confirmado, auto-asociarlo
    if (initialContainerId && !state.contenedor_confirmado) {
      const matched = activeContainers.find((c) => c.id_contenedor === initialContainerId)
      if (matched) {
        state.id_contenedor_seleccionado = matched.id_contenedor
        state.numero_contenedor_seleccionado = matched.numero_contenedor
        state.placa_camion_seleccionado = matched.placa_camion
      }
    }

    setReceptionState(state)

    // Cargar plan de paletizado de la orden (códigos separados)
    try {
      const plan = await packingListService.generateOrderPackingPlan(
        ord,
        selectedWarehouse?.prefijo_rfid || 'IMP'
      )
      setActivePackingPlan(plan)
    } catch (e: any) {
      console.warn('Error loading packing plan:', e)
    }

    setViewMode('order_reception')
  }

  // Guardar contenedor seleccionado para la orden
  const handleSaveContainer = (containerId: number, containerNumber: string, truckPlate: string) => {
    if (!selectedOrder) return
    const updated: OrderReceptionState = {
      ...receptionState,
      id_contenedor_seleccionado: containerId,
      numero_contenedor_seleccionado: containerNumber,
      placa_camion_seleccionado: truckPlate,
      contenedor_confirmado: true
    }
    setReceptionState(updated)
    orderReceptionService.saveOrderReceptionState(selectedOrder.id_orden, updated, selectedOrder.numero_orden)
    setSuccessMsg(`Contenedor [${containerNumber}] vinculado y fijado para la orden ${selectedOrder.numero_orden}.`)
  }

  // Seleccionar un producto para recepcionar (Paso al Nivel 3)
  const handleSelectProduct = (productId: number) => {
    setSelectedProductId(productId)
    setViewMode('product_reception')
  }

  // Confirmar y registrar físicamente una paleta
  const handleConfirmPallet = async (payload: {
    uid_tag: string
    tipo: 'COMPLETO' | 'PUCHO'
    cajas: number
    unidades: number
    codigo_barras?: string
  }) => {
    if (!selectedOrder || !selectedWarehouse || !selectedOrderDetail || !selectedOrderDetail.producto) {
      throw new Error('Faltan datos de la orden o producto para registrar la paleta.')
    }

    const updatedState = await orderReceptionService.recordPalletReception({
      id_orden: selectedOrder.id_orden,
      numero_orden: selectedOrder.numero_orden,
      id_almacen: selectedWarehouse.id_almacen,
      id_producto: selectedOrderDetail.id_producto,
      sku: selectedOrderDetail.producto.sku,
      nombre: selectedOrderDetail.producto.nombre,
      uid_tag: payload.uid_tag,
      tipo: payload.tipo,
      cajas: payload.cajas,
      unidades: payload.unidades,
      id_contenedor: receptionState.id_contenedor_seleccionado,
      numero_contenedor: receptionState.numero_contenedor_seleccionado,
      currentState: receptionState
    })

    setReceptionState(updatedState)
  }

  // Liquidación final de la orden
  const handleConfirmLiquidation = async (
    dictamen: 'COMPLETA' | 'FALTANTES' | 'SOBRANTES',
    observaciones: string,
    codigosALiberar: string[]
  ) => {
    if (!selectedOrder) return

    await orderReceptionService.liquidateOrderReception({
      id_orden: selectedOrder.id_orden,
      numero_orden: selectedOrder.numero_orden,
      dictamen,
      observaciones,
      codigosALiberar,
      id_contenedor: receptionState.id_contenedor_seleccionado,
      packingPlan: activePackingPlan,
      currentState: receptionState
    })

    setSuccessMsg(
      `Recepción de la orden ${selectedOrder.numero_orden} liquidada con éxito (Dictamen: ${dictamen}). Se liberaron ${codigosALiberar.length} códigos correlativos para futuras órdenes.`
    )

    // Recargar órdenes
    await loadInitialData()
    setViewMode('orders_list')
    setSelectedOrderId('')
    setSelectedProductId(null)
  }

  // Modal de Packing List
  const handleOpenOrderPacking = async (ord: ImportOrder) => {
    setLoadingPackingModal(true)
    try {
      const plan = await packingListService.generateOrderPackingPlan(
        ord,
        selectedWarehouse?.prefijo_rfid || 'IMP'
      )
      setOrderPackingModal(plan)
    } catch (err: any) {
      setErrorMsg(`Error al generar el plan de paletizado: ${err.message}`)
    } finally {
      setLoadingPackingModal(false)
    }
  }

  return (
    <div className="workspace" style={{ padding: '24px 32px' }}>
      {/* Mensajes de Alerta y Éxito */}
      {errorMsg && (
        <div
          style={{
            padding: '12px 16px',
            borderRadius: '6px',
            background: '#FDF2F0',
            border: '1px solid var(--color-danger)',
            color: 'var(--color-danger)',
            fontSize: '13px',
            marginBottom: '16px'
          }}
        >
          {errorMsg}
        </div>
      )}

      {successMsg && (
        <div
          style={{
            padding: '12px 16px',
            borderRadius: '6px',
            background: '#EAF5ED',
            border: '1px solid var(--color-success)',
            color: 'var(--color-success)',
            fontSize: '13px',
            marginBottom: '16px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}
        >
          <span>✓ {successMsg}</span>
          <button
            type="button"
            onClick={() => setSuccessMsg(null)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-success)', fontWeight: 700 }}
          >
            ✕
          </button>
        </div>
      )}

      {/* VISTA 1: Lista Principal de Órdenes de Importación */}
      {viewMode === 'orders_list' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Cabecera Principal con Selector de Almacén Buscable */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '16px',
              paddingBottom: '16px',
              borderBottom: '1px solid var(--color-border)'
            }}
          >
            <div>
              <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-brand)' }}>
                Módulo 04 · Recepciones tácticas en Operaciones
              </span>
              <h1 className="page-title" style={{ margin: '2px 0 0 0', fontSize: '24px', color: 'var(--color-brand-deep-text)' }}>
                Órdenes de importación y embarques
              </h1>
              <p className="muted" style={{ margin: '2px 0 0 0', fontSize: '13px' }}>
                Recepción de contenedores llegados al patio, conciliación física y asignación de códigos RFID.
              </p>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
              {/* Selector Inteligente de Almacén (Sin scroll horizontal) */}
              <WarehouseSearchSelector
                warehouses={warehouses}
                selectedWarehouseId={selectedWarehouseId}
                onSelectWarehouse={(id) => setSelectedWarehouseId(id)}
              />

              {onGoToOrders && (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={onGoToOrders}
                  title="Las órdenes se crean y aprueban en Órdenes y proyecciones"
                >
                  Ver órdenes y proyecciones
                </button>
              )}
            </div>
          </div>

          {/* Barra de Filtros y Búsqueda */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '12px'
            }}
          >
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <button
                type="button"
                className={`button ${orderFilter === 'ALL' ? 'primary' : 'secondary'} button-sm`}
                onClick={() => setOrderFilter('ALL')}
                style={{ fontSize: '13px' }}
              >
                Todas las órdenes ({orders.length})
              </button>
              <button
                type="button"
                className={`button ${orderFilter === 'PENDING' ? 'primary' : 'secondary'} button-sm`}
                onClick={() => setOrderFilter('PENDING')}
                style={{ fontSize: '13px' }}
              >
                En tránsito / Operaciones ({orders.filter((o) => o.estado === 'TRANSITO' || o.estado === 'BORRADOR').length})
              </button>
              <button
                type="button"
                className={`button ${orderFilter === 'RECEIVED' ? 'primary' : 'secondary'} button-sm`}
                onClick={() => setOrderFilter('RECEIVED')}
                style={{ fontSize: '13px' }}
              >
                Recibidas ({orders.filter((o) => o.estado === 'RECIBIDA').length})
              </button>
            </div>

            <div style={{ width: '320px', maxWidth: '100%' }}>
              <input
                type="text"
                placeholder="Buscar orden por N°, proveedor o SKU..."
                value={searchOrderTerm}
                onChange={(e) => setSearchOrderTerm(e.target.value)}
                style={{
                  width: '100%',
                  padding: '7px 12px',
                  fontSize: '13px',
                  borderRadius: '6px',
                  border: '1px solid var(--color-border)',
                  background: 'var(--color-surface)',
                  boxSizing: 'border-box'
                }}
              />
            </div>
          </div>

          {/* Tabla de Órdenes */}
          <div className="table-wrap" style={{ margin: 0 }}>
            {loading ? (
              <div style={{ padding: '36px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
                Cargando órdenes de importación y embarques...
              </div>
            ) : filteredOrders.length === 0 ? (
              <div style={{ padding: '36px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
                No se encontraron órdenes registradas para el filtro seleccionado.
              </div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>N° Orden</th>
                    <th>Fecha de emisión</th>
                    <th>Proveedor</th>
                    <th>Contenedor</th>
                    <th>Líneas de producto</th>
                    <th>Estado</th>
                    <th style={{ textAlign: 'center' }}>Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOrders.map((ord) => (
                    <tr key={ord.id_orden}>
                      <td>
                        <strong style={{ color: 'var(--color-brand-deep-text)', fontSize: '14px' }}>
                          {ord.numero_orden}
                        </strong>
                      </td>
                      <td>{ord.fecha_emision}</td>
                      <td>{ord.proveedor?.nombre || ord.proveedor?.razon_social || 'Proveedor genérico'}</td>
                      <td>
                        <span
                          style={{
                            background: 'var(--color-canvas)',
                            border: '1px solid var(--color-border)',
                            padding: '2px 8px',
                            borderRadius: '4px',
                            fontSize: '12px',
                            fontWeight: 600,
                            color: 'var(--color-text-secondary)'
                          }}
                        >
                          {ord.tipo_contenedor || '40FT'}
                        </span>
                      </td>
                      <td>
                        {ord.detalles && ord.detalles.length > 0 ? (
                          <div style={{ fontSize: '13px' }}>
                            {ord.detalles.length} producto(s) · {ord.detalles.reduce((acc, d) => acc + (Number(d.cantidad_pedida) || 0), 0).toLocaleString('es-PE')} unid
                          </div>
                        ) : (
                          <span className="muted">Sin detalles</span>
                        )}
                      </td>
                      <td>
                        <span
                          style={{
                            background:
                              ord.estado === 'RECIBIDA'
                                ? '#EAF5ED'
                                : ord.estado === 'TRANSITO'
                                ? '#FDF6EC'
                                : 'var(--color-canvas)',
                            color:
                              ord.estado === 'RECIBIDA'
                                ? 'var(--color-success)'
                                : ord.estado === 'TRANSITO'
                                ? 'var(--color-warning)'
                                : 'var(--color-text-secondary)',
                            padding: '3px 8px',
                            borderRadius: '4px',
                            fontSize: '12px',
                            fontWeight: 600,
                            border: '1px solid var(--color-border)'
                          }}
                        >
                          {ord.estado === 'RECIBIDA'
                            ? 'Recibida en Operaciones'
                            : ord.estado === 'TRANSITO'
                            ? 'En tránsito'
                            : 'Borrador'}
                        </span>
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <div style={{ display: 'inline-flex', gap: '8px', alignItems: 'center' }}>
                          <button
                            type="button"
                            className="button secondary button-sm"
                            onClick={() => handleOpenOrderPacking(ord)}
                            disabled={loadingPackingModal}
                            title="Ver desglose de paletas esperadas y descargar rótulos"
                          >
                            Packing / Rótulos
                          </button>
                          <button
                            type="button"
                            className="button primary button-sm"
                            onClick={() => handleOpenOrderReception(ord)}
                            style={{ fontWeight: 600, padding: '6px 14px' }}
                          >
                            {ord.estado === 'RECIBIDA' ? 'Ver recepción' : 'Recepcionar'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* VISTA 2: Vista de la Orden con Compuerta de Contenedor */}
      {viewMode === 'order_reception' && selectedOrder && (
        <OrderReceptionView
          order={selectedOrder}
          warehouse={selectedWarehouse}
          activeContainers={activeContainers}
          receptionState={receptionState}
          packingPlan={activePackingPlan}
          onSaveContainer={handleSaveContainer}
          onSelectProduct={handleSelectProduct}
          onGoToLiquidation={() => setViewMode('liquidation')}
          onBack={() => setViewMode('orders_list')}
        />
      )}

      {/* VISTA 3: Vista de Recepción Individual del Producto */}
      {viewMode === 'product_reception' && selectedOrder && selectedOrderDetail && (
        <ProductReceptionView
          order={selectedOrder}
          warehouse={selectedWarehouse}
          orderDetail={selectedOrderDetail}
          receptionState={receptionState}
          packingPlan={activePackingPlan}
          onConfirmPallet={handleConfirmPallet}
          onBack={() => setViewMode('order_reception')}
        />
      )}

      {/* VISTA 4: Liquidación y Liberación de Códigos */}
      {viewMode === 'liquidation' && selectedOrder && (
        <ReceptionLiquidationView
          order={selectedOrder}
          warehouse={selectedWarehouse}
          receptionState={receptionState}
          packingPlan={activePackingPlan}
          onConfirmLiquidation={handleConfirmLiquidation}
          onBack={() => setViewMode('order_reception')}
        />
      )}

      {/* MODAL 2: Visor de Packing List y Rótulos */}
      {orderPackingModal && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card" style={{ maxWidth: '820px', width: '92%', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
            <div className="modal-header">
              <div>
                <h2 className="modal-title" style={{ margin: 0, fontSize: '18px', color: 'var(--color-brand-deep-text)' }}>
                  Packing list oficial: {orderPackingModal.numero_orden}
                </h2>
                <span style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                  Proveedor: {orderPackingModal.proveedor} · Contenedor: {orderPackingModal.contenedor} · Total bultos: {orderPackingModal.total_bultos_previstos}
                </span>
              </div>
              <button type="button" className="modal-close-btn" onClick={() => setOrderPackingModal(null)}>
                ✕
              </button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '16px 0' }}>
              <div className="table-wrap" style={{ margin: 0 }}>
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>SKU</th>
                      <th>Descripción</th>
                      <th style={{ textAlign: 'right' }}>Unid. pedidas</th>
                      <th style={{ textAlign: 'right' }}>Cajas</th>
                      <th style={{ textAlign: 'right' }}>Paletas compl.</th>
                      <th style={{ textAlign: 'right' }}>Pucho</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orderPackingModal.productos.map((p, idx) => (
                      <tr key={idx}>
                        <td>{idx + 1}</td>
                        <td>
                          <strong>{p.sku}</strong>
                        </td>
                        <td>{p.nombre}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{p.cantidad_pedida.toLocaleString('es-PE')}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{p.cajas_totales}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{p.paletas_completas}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{p.cajas_pucho > 0 ? `${p.cajas_pucho} cajas` : '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '16px', borderTop: '1px solid var(--color-border)' }}>
              <button
                type="button"
                className="button secondary"
                onClick={() => packingListService.exportPackingListToExcel(orderPackingModal)}
              >
                Descargar Excel con rótulos (.xlsx)
              </button>
              <button type="button" className="button primary" onClick={() => setOrderPackingModal(null)}>
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
