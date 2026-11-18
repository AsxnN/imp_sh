import { useMemo, useState } from 'react'
import type { ProjectionOrder, ProjectionOrderStatus, ProjectionTemplate } from '../../../types/projections'

interface OrdersListSubViewProps {
  orders: ProjectionOrder[]
  templates: ProjectionTemplate[]
  onSelectOrder: (order: ProjectionOrder) => void
  onCreateOrderClick: () => void
  onDeleteOrder: (id_orden: number) => Promise<void>
  onOpenReceptions?: () => void
  onOpenPackingPlan?: (order: ProjectionOrder) => void
  onBack: () => void
  loading: boolean
}

/** Estados del ciclo de la orden y el siguiente paso de cada uno. */
const ESTADOS: Record<ProjectionOrderStatus, { label: string; siguiente: string; color: string; bg: string; border: string }> = {
  BORRADOR: {
    label: 'Borrador',
    siguiente: 'Completar la proyección',
    color: 'var(--color-text-secondary)',
    bg: 'var(--color-canvas)',
    border: 'var(--color-border)'
  },
  FALTA_APROBACION: {
    label: 'Falta aprobación',
    siguiente: 'Aprobar cantidades',
    color: 'var(--color-warning)',
    bg: 'var(--color-status-yellow-bg)',
    border: 'var(--color-status-yellow-border)'
  },
  TRANSITO: {
    label: 'En tránsito',
    siguiente: 'Recibir en Operaciones',
    color: 'var(--color-brand)',
    bg: 'var(--color-brand-soft)',
    border: 'var(--color-border)'
  },
  RECIBIDA: {
    label: 'Recibida',
    siguiente: 'Cerrada',
    color: 'var(--color-success)',
    bg: 'var(--color-status-green-bg)',
    border: 'var(--color-status-green-border)'
  }
}

const CONTENEDOR_LABEL: Record<string, string> = { '40FT': '40 pies', '20FT': '20 pies', LCL: 'Consolidado (LCL)' }

export function OrdersListSubView({
  orders,
  templates,
  onSelectOrder,
  onCreateOrderClick,
  onDeleteOrder,
  onOpenReceptions,
  onOpenPackingPlan,
  onBack,
  loading
}: OrdersListSubViewProps) {
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<'TODAS' | ProjectionOrderStatus>('TODAS')
  const [templateFilter, setTemplateFilter] = useState('TODAS')
  const [deletingId, setDeletingId] = useState<number | null>(null)

  const plantillaNombre = (id?: number | null) => templates.find((t) => t.id_plantilla === id)?.nombre ?? 'Sin plantilla'

  const conteo = useMemo(() => {
    const c: Record<ProjectionOrderStatus, number> = { BORRADOR: 0, FALTA_APROBACION: 0, TRANSITO: 0, RECIBIDA: 0 }
    for (const o of orders) c[o.estado] = (c[o.estado] ?? 0) + 1
    return c
  }, [orders])

  const filteredOrders = useMemo(() => {
    const term = searchTerm.trim().toLowerCase()
    return orders.filter((ord) => {
      if (term) {
        const texto = `${ord.numero_orden} ${ord.descripcion ?? ''} ${ord.proveedor?.razon_social ?? ''}`.toLowerCase()
        if (!texto.includes(term)) return false
      }
      if (statusFilter !== 'TODAS' && ord.estado !== statusFilter) return false
      if (templateFilter !== 'TODAS' && String(ord.id_plantilla) !== templateFilter) return false
      return true
    })
  }, [orders, searchTerm, statusFilter, templateFilter])

  const handleDelete = async (id_orden: number, num: string) => {
    if (!window.confirm(`¿Eliminar la orden ${num}? Se borrará con su proyección y no se puede deshacer.`)) return
    setDeletingId(id_orden)
    try {
      await onDeleteOrder(id_orden)
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <section className="products-page">
      <div className="page-heading">
        <div>
          <button className="link-back" type="button" onClick={onBack}>
            <span aria-hidden="true">‹</span> Volver al panel principal
          </button>
          <div className="view-title-row">
            <h2>Órdenes y proyecciones</h2>
            <span className="module-code-badge">MOD-06</span>
          </div>
          <p className="page-lead">
            Planifica la compra de cada importación: proyección → aprobación → packing list. Luego se recibe en Recepciones RFID.
          </p>
        </div>
        <button type="button" className="btn-primary" onClick={onCreateOrderClick} disabled={templates.length === 0}>
          + Nueva orden
        </button>
      </div>

      {templates.length === 0 && !loading && (
        <p className="error notice" role="alert">
          No hay plantillas de proyección activas: no se pueden crear órdenes hasta registrar una.
        </p>
      )}

      {/* Indicadores por estado (también funcionan como filtro) */}
      <section
        className="indicator-strip"
        style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '14px', marginBottom: '20px' }}
        aria-label="Órdenes por estado"
      >
        {(Object.keys(ESTADOS) as ProjectionOrderStatus[]).map((st) => (
          <button
            key={st}
            type="button"
            className={`indicator-card ${statusFilter === st ? 'attention' : ''}`}
            onClick={() => setStatusFilter(statusFilter === st ? 'TODAS' : st)}
            aria-pressed={statusFilter === st}
            style={{ textAlign: 'left', cursor: 'pointer' }}
          >
            <span className="indicator-label">{ESTADOS[st].label}</span>
            <div className="indicator-value">{conteo[st]}</div>
            <span className="indicator-context">Siguiente paso: {ESTADOS[st].siguiente.toLowerCase()}</span>
          </button>
        ))}
      </section>

      <div className="panel" style={{ padding: '20px' }}>
        <div className="table-controls">
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', flex: 1 }}>
            <div className="search-group" style={{ flex: '1 1 240px', maxWidth: '360px' }}>
              <input
                type="search"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Buscar por número, descripción o proveedor…"
                aria-label="Buscar orden"
                style={{ width: '100%' }}
              />
            </div>
            <div className="filter-group">
              <label htmlFor="tpl-filter">Plantilla:</label>
              <select id="tpl-filter" value={templateFilter} onChange={(e) => setTemplateFilter(e.target.value)}>
                <option value="TODAS">Todas</option>
                {templates.map((t) => (
                  <option key={t.id_plantilla} value={String(t.id_plantilla)}>
                    {t.nombre}
                  </option>
                ))}
              </select>
            </div>
            <div className="filter-group">
              <label htmlFor="st-filter">Estado:</label>
              <select id="st-filter" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}>
                <option value="TODAS">Todos</option>
                {(Object.keys(ESTADOS) as ProjectionOrderStatus[]).map((st) => (
                  <option key={st} value={st}>
                    {ESTADOS[st].label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {loading ? (
          <p className="muted" style={{ padding: '24px 0', textAlign: 'center' }}>Cargando órdenes…</p>
        ) : filteredOrders.length === 0 ? (
          <div className="empty-state" style={{ textAlign: 'center', padding: '32px' }}>
            <p style={{ margin: '0 0 6px', fontWeight: 600 }}>
              {orders.length === 0 ? 'Aún no hay órdenes de importación.' : 'Ninguna orden coincide con los filtros.'}
            </p>
            {orders.length === 0 && templates.length > 0 && (
              <>
                <p className="muted" style={{ margin: '0 0 14px' }}>Crea la primera para empezar a proyectar la compra.</p>
                <button type="button" className="btn-primary" onClick={onCreateOrderClick}>
                  + Nueva orden
                </button>
              </>
            )}
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Orden</th>
                  <th>Plantilla y proveedor</th>
                  <th>Contenedor</th>
                  <th>Contenido</th>
                  <th>Estado</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filteredOrders.map((ord) => {
                  const est = ESTADOS[ord.estado] ?? ESTADOS.BORRADOR
                  const editable = ord.estado === 'BORRADOR' || ord.estado === 'FALTA_APROBACION'
                  return (
                    <tr key={ord.id_orden}>
                      <td>
                        <span className="sku-badge">{ord.numero_orden}</span>
                        <div style={{ fontWeight: 600, marginTop: '4px' }}>{ord.descripcion || 'Sin descripción'}</div>
                        <div className="muted" style={{ fontSize: '13px' }}>Emitida {ord.fecha_emision}</div>
                      </td>
                      <td>
                        <div><span className="category-pill">{plantillaNombre(ord.id_plantilla)}</span></div>
                        <div className="muted" style={{ fontSize: '13px', marginTop: '4px' }}>
                          {ord.proveedor?.razon_social || 'Proveedor por definir'}
                        </div>
                      </td>
                      <td>{CONTENEDOR_LABEL[ord.tipo_contenedor ?? ''] ?? '—'}</td>
                      <td>
                        <strong>{ord.total_items || 0}</strong> {ord.total_items === 1 ? 'producto' : 'productos'}
                        {ord.total_unidades ? (
                          <div className="muted" style={{ fontSize: '13px' }}>{Number(ord.total_unidades).toLocaleString('es-PE')} u</div>
                        ) : null}
                      </td>
                      <td>
                        <span className="category-pill" style={{ background: est.bg, color: est.color, borderColor: est.border }}>
                          {est.label}
                        </span>
                        <div className="muted" style={{ fontSize: '12px', marginTop: '4px' }}>{est.siguiente}</div>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                          {ord.estado === 'TRANSITO' && onOpenPackingPlan ? (
                            <button type="button" className="btn-detail" onClick={() => onOpenPackingPlan(ord)}>
                              Packing list
                            </button>
                          ) : null}
                          {ord.estado === 'TRANSITO' && onOpenReceptions ? (
                            <button type="button" className="btn-detail" onClick={onOpenReceptions}>
                              Recibir
                            </button>
                          ) : null}
                          <button type="button" className="btn-detail" onClick={() => onSelectOrder(ord)}>
                            {ord.estado === 'BORRADOR' ? 'Proyectar' : ord.estado === 'FALTA_APROBACION' ? 'Revisar' : 'Ver proyección'}
                          </button>
                          {editable && (
                            <button
                              type="button"
                              className="btn-detail"
                              style={{ color: 'var(--color-danger)' }}
                              onClick={() => void handleDelete(ord.id_orden, ord.numero_orden)}
                              disabled={deletingId === ord.id_orden}
                            >
                              {deletingId === ord.id_orden ? 'Eliminando…' : 'Eliminar'}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  )
}
