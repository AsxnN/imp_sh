import { formatoNumero } from '../products/empaque'

export type InventorySummary = {
  totalUnidades: number
  productosConStock: number
  paletasCompletas: number
  puchos: number
  cajasCerradas: number
  cajasAbiertas: number
  productosPorCaja: number
  equipos: number
  volumenM3: number | null
  capacidadM3: number | null
  productosSinMedidas: number
}

type Props = {
  summary: InventorySummary
}

/** 4 indicadores calculados de la misma fuente que la tabla de existencias (skill_design.md §3.4). */
export function InventoryKpiStrip({ summary: s }: Props) {
  const pct = s.volumenM3 !== null && s.capacidadM3 ? Math.min(100, (s.volumenM3 / s.capacidadM3) * 100) : null

  return (
    <section
      className="indicator-strip"
      style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px', marginBottom: '20px' }}
      aria-label="Indicadores de la sede"
    >
      <div className="indicator-card">
        <span className="indicator-label">Unidades en stock</span>
        <div className="indicator-value">{formatoNumero(s.totalUnidades)}</div>
        <span className="indicator-context">
          {s.productosConStock} {s.productosConStock === 1 ? 'producto' : 'productos'} con existencias
        </span>
      </div>

      <div className="indicator-card">
        <span className="indicator-label">Paletas con tag RFID</span>
        <div className="indicator-value">{formatoNumero(s.paletasCompletas + s.puchos)}</div>
        <span className="indicator-context">
          {s.paletasCompletas} completas · {s.puchos} {s.puchos === 1 ? 'pucho' : 'puchos'}
        </span>
      </div>

      <div className="indicator-card">
        <span className="indicator-label">Cajas sin paletizar</span>
        <div className="indicator-value">{formatoNumero(s.cajasCerradas)}</div>
        <span className="indicator-context">
          cerradas · {s.cajasAbiertas} {s.cajasAbiertas === 1 ? 'abierta' : 'abiertas'} · {s.equipos}{' '}
          {s.equipos === 1 ? 'equipo' : 'equipos'} por serie
        </span>
      </div>

      <div className="indicator-card">
        <span className="indicator-label">Ocupación</span>
        <div className="indicator-value">{pct !== null ? `${pct.toFixed(1)} %` : '—'}</div>
        <span className="indicator-context">
          {s.volumenM3 !== null
            ? `${s.volumenM3.toFixed(2)} de ${s.capacidadM3 ? formatoNumero(s.capacidadM3) : '—'} m³`
            : 'Sin medidas de empaque para calcular'}
          {s.productosSinMedidas > 0 && s.volumenM3 !== null && ` · ${s.productosSinMedidas} sin medidas`}
        </span>
      </div>
    </section>
  )
}
