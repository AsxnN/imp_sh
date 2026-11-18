import { Fragment, useMemo, useState } from 'react'
import type { PalletRecord } from '../../../types/locations'
import { MODO_INFO, formatoNumero, nombreEmpaque } from '../../products/empaque'
import type { UnidadSerializada } from '../../products/types'
import { calcularPresentacion } from '../presentacion'
import type { InventoryItem, ProductOption } from '../types'

type Props = {
  warehouseName?: string
  inventory: InventoryItem[]
  allProducts: ProductOption[]
  activePallets: PalletRecord[]
  serialUnitsMap: Map<number, UnidadSerializada[]>
  loadingStock: boolean
  showZeroStock: boolean
  onToggleShowZeroStock: (show: boolean) => void
  /** Abre el ingreso de stock con el producto preseleccionado */
  onIngresar: (productId: number) => void
  /** Conteo físico absoluto (solo modo Por caja) */
  onAjustarConteo: (productId: number) => void
  onInspectSerial: (product: ProductOption, units: UnidadSerializada[]) => void
}

const SEMAFORO: Record<string, { label: string; color: string; bg: string; border: string }> = {
  VERDE: { label: 'Óptimo', color: 'var(--color-success)', bg: 'var(--color-status-green-bg)', border: 'var(--color-status-green-border)' },
  AMARILLO: { label: 'Stock bajo', color: 'var(--color-warning)', bg: 'var(--color-status-yellow-bg)', border: 'var(--color-status-yellow-border)' },
  ROJO: { label: 'Crítico', color: 'var(--color-danger)', bg: 'var(--color-status-red-bg)', border: 'var(--color-status-red-border)' }
}

export function StockPalletsSubView({
  warehouseName,
  inventory,
  allProducts,
  activePallets,
  serialUnitsMap,
  loadingStock,
  showZeroStock,
  onToggleShowZeroStock,
  onIngresar,
  onAjustarConteo,
  onInspectSerial
}: Props) {
  const [search, setSearch] = useState('')
  const [modoFilter, setModoFilter] = useState<'ALL' | 'PALETIZADO' | 'PICKING_CAJA' | 'SERIALIZADO'>('ALL')
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'VERDE' | 'AMARILLO' | 'ROJO'>('ALL')
  const [expanded, setExpanded] = useState<number | null>(null)

  const productById = useMemo(() => new Map(allProducts.map((p) => [p.id_producto, p])), [allProducts])

  const filas = useMemo(
    () =>
      inventory.map((item) => {
        const producto = productById.get(item.id_producto)
        const pallets = activePallets.filter((p) => p.id_producto === item.id_producto)
        const equipos = (serialUnitsMap.get(item.id_producto) || []).filter((u) => u.estado !== 'DESPACHADA' && u.estado !== 'BAJA')
        const pres = calcularPresentacion(item, producto, pallets, equipos.length)
        const stock = Number(item.stock_real) || 0
        return { item, producto, pres, stock, equipos }
      }),
    [inventory, productById, activePallets, serialUnitsMap]
  )

  const conStock = filas.filter((f) => f.stock > 0 || f.pres.pallets.length > 0 || f.equipos.length > 0)
  const sinStock = filas.length - conStock.length
  const visibles = showZeroStock ? filas : conStock

  const filtradas = visibles.filter(({ item, pres }) => {
    if (modoFilter !== 'ALL' && pres.modo !== modoFilter) return false
    if (statusFilter !== 'ALL' && item.estado_semaforo !== statusFilter) return false
    const q = search.trim().toLowerCase()
    if (q && !item.producto?.sku?.toLowerCase().includes(q) && !item.producto?.nombre?.toLowerCase().includes(q)) return false
    return true
  })

  return (
    <div className="panel" style={{ padding: '20px' }}>
      <div className="table-controls">
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', flex: 1 }}>
          <div className="search-group" style={{ flex: '1 1 240px', maxWidth: '360px' }}>
            <input
              type="search"
              placeholder="Buscar por SKU o nombre…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: '100%' }}
              aria-label="Buscar producto"
            />
          </div>
          <div className="filter-group">
            <label htmlFor="modo-filter">Modo:</label>
            <select id="modo-filter" value={modoFilter} onChange={(e) => setModoFilter(e.target.value as typeof modoFilter)}>
              <option value="ALL">Todos</option>
              <option value="PALETIZADO">Paletizado</option>
              <option value="PICKING_CAJA">Por caja</option>
              <option value="SERIALIZADO">Serializado</option>
            </select>
          </div>
          <div className="filter-group">
            <label htmlFor="status-filter">Estado:</label>
            <select id="status-filter" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}>
              <option value="ALL">Todos</option>
              <option value="VERDE">Óptimo</option>
              <option value="AMARILLO">Stock bajo</option>
              <option value="ROJO">Crítico</option>
            </select>
          </div>
        </div>
        {sinStock > 0 && (
          <label className="check" style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>
            <input type="checkbox" checked={showZeroStock} onChange={(e) => onToggleShowZeroStock(e.target.checked)} />
            Mostrar productos sin existencias ({sinStock})
          </label>
        )}
      </div>

      <p className="muted" style={{ margin: '0 0 10px', fontSize: '13px' }}>
        Mostrando <strong>{filtradas.length}</strong> de {visibles.length} productos en {warehouseName || 'la sede'}.
      </p>

      {loadingStock ? (
        <p className="muted" style={{ padding: '24px 0', textAlign: 'center' }}>Cargando existencias…</p>
      ) : filtradas.length === 0 ? (
        <p className="empty-state">
          {visibles.length === 0
            ? `${warehouseName || 'Esta sede'} aún no tiene existencias. Usa “Ingresar stock” para registrar la primera.`
            : 'Ningún producto coincide con los filtros.'}
        </p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Producto</th>
                <th>Categoría y modo</th>
                <th>Presentación</th>
                <th className="num-col">Stock total</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtradas.map(({ item, producto, pres, stock, equipos }) => {
                const sem = SEMAFORO[item.estado_semaforo] ?? SEMAFORO.ROJO
                const descuadre = pres.modo === 'PALETIZADO' && pres.pallets.length > 0 && Math.abs(pres.unidadesEnPaletas - stock) > 0.001
                const abierto = expanded === item.id_producto
                return (
                  <Fragment key={item.id_producto}>
                    <tr>
                      <td>
                        <span className="sku-badge">{item.producto?.sku}</span>
                        <div style={{ fontWeight: 600, marginTop: '4px' }}>{item.producto?.nombre}</div>
                      </td>
                      <td>
                        <div><span className="category-pill">{producto?.categoria_nombre ?? item.producto?.categoria?.nombre ?? 'Sin categoría'}</span></div>
                        <span className="modo-pill" style={{ marginTop: '4px' }}>{MODO_INFO[pres.modo].label}</span>
                      </td>
                      <td>
                        <strong>{pres.principal}</strong>
                        {pres.detalle && <div className="muted" style={{ fontSize: '13px' }}>{pres.detalle}</div>}
                        {producto && !producto.tiene_regla && pres.modo !== 'SERIALIZADO' && (
                          <div style={{ fontSize: '13px', color: 'var(--color-warning)' }}>Falta regla de empaque</div>
                        )}
                      </td>
                      <td className="num-col">
                        <strong>{formatoNumero(stock)}</strong> <span className="muted" style={{ fontSize: '13px' }}>u</span>
                        {item.sin_registro && (
                          <div style={{ fontSize: '12px', color: 'var(--color-warning)' }}>Sin registro de inventario</div>
                        )}
                        {descuadre && !item.sin_registro && (
                          <div style={{ fontSize: '12px', color: 'var(--color-warning)' }} title="El stock registrado no coincide con la suma de las paletas activas">
                            Paletas suman {formatoNumero(pres.unidadesEnPaletas)} u
                          </div>
                        )}
                      </td>
                      <td>
                        <span className="category-pill" style={{ background: sem.bg, color: sem.color, borderColor: sem.border }}>
                          {sem.label}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                          <button className="btn-detail" type="button" onClick={() => onIngresar(item.id_producto)}>
                            Ingresar
                          </button>
                          {pres.modo === 'PALETIZADO' && (
                            <button
                              className="btn-detail"
                              type="button"
                              aria-expanded={abierto}
                              onClick={() => setExpanded(abierto ? null : item.id_producto)}
                              disabled={pres.pallets.length === 0}
                            >
                              {abierto ? 'Ocultar paletas' : `Paletas (${pres.pallets.length})`}
                            </button>
                          )}
                          {pres.modo === 'PICKING_CAJA' && (
                            <button className="btn-detail" type="button" onClick={() => onAjustarConteo(item.id_producto)}>
                              Ajustar conteo
                            </button>
                          )}
                          {pres.modo === 'SERIALIZADO' && producto && (
                            <button className="btn-detail" type="button" onClick={() => onInspectSerial(producto, equipos)}>
                              Equipos ({equipos.length})
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {abierto && (
                      <tr>
                        <td colSpan={6} style={{ background: 'var(--color-canvas)' }}>
                          <table style={{ margin: 0 }}>
                            <thead>
                              <tr>
                                <th>Tag RFID</th>
                                <th>Tipo</th>
                                <th>Contenido</th>
                                <th className="num-col">Unidades</th>
                                <th>Ubicación</th>
                              </tr>
                            </thead>
                            <tbody>
                              {pres.pallets.map((p) => {
                                const sueltas = Number(p.unidades_sueltas) || 0
                                return (
                                  <tr key={p.id_etiqueta}>
                                    <td><span className="sku-badge">{p.uid_tag}</span></td>
                                    <td>{p.tipo_paleta === 'COMPLETO' ? 'Paleta completa' : 'Pucho'}</td>
                                    <td>
                                      {formatoNumero(Number(p.cantidad_paquetes) || 0)} {nombreEmpaque(producto?.tipo_empaque, Number(p.cantidad_paquetes))}
                                      {sueltas > 0 && ` + ${formatoNumero(sueltas)} u sueltas`}
                                    </td>
                                    <td className="num-col">{formatoNumero(Number(p.cantidad_actual) || 0)}</td>
                                    <td>{p.codigo_ubicacion ?? 'Sin ubicación'}</td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
