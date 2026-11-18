import { useEffect, useMemo, useState } from 'react'

/** Códigos de mes usados en toda la proyección (mismos que genera la carga de Excel). */
export const MESES: { codigo: string; nombre: string }[] = [
  { codigo: 'ENE', nombre: 'Enero' },
  { codigo: 'FEB', nombre: 'Febrero' },
  { codigo: 'MAR', nombre: 'Marzo' },
  { codigo: 'ABR', nombre: 'Abril' },
  { codigo: 'MAY', nombre: 'Mayo' },
  { codigo: 'JUN', nombre: 'Junio' },
  { codigo: 'JUL', nombre: 'Julio' },
  { codigo: 'AGO', nombre: 'Agosto' },
  { codigo: 'SET', nombre: 'Setiembre' },
  { codigo: 'OCT', nombre: 'Octubre' },
  { codigo: 'NOV', nombre: 'Noviembre' },
  { codigo: 'DIC', nombre: 'Diciembre' }
]

const indice = (codigo: string) => {
  const c = codigo === 'SEP' ? 'SET' : codigo
  return MESES.findIndex((m) => m.codigo === c)
}

/**
 * Ordena los meses de forma cronológica continuando desde el primer mes ya existente
 * (ej. SET, OCT, NOV, DIC, ENE, FEB…), igual que un reporte de salidas de 12 meses.
 */
export function ordenarMeses(meses: string[], inicio?: string): string[] {
  const base = inicio ? indice(inicio) : -1
  const desde = base >= 0 ? base : new Date().getMonth()
  return [...new Set(meses)].sort((a, b) => ((indice(a) - desde + 12) % 12) - ((indice(b) - desde + 12) % 12))
}

interface AddMonthModalProps {
  isOpen: boolean
  onClose: () => void
  /** Meses que ya tiene la proyección de esta orden */
  existingMonths: string[]
  isAdding: boolean
  onAdd: (months: string[]) => Promise<void> | void
}

export function AddMonthModal({ isOpen, onClose, existingMonths, isAdding, onAdd }: AddMonthModalProps) {
  const [seleccion, setSeleccion] = useState<string[]>([])

  useEffect(() => {
    if (isOpen) setSeleccion([])
  }, [isOpen])

  const existentes = useMemo(() => new Set(existingMonths.map((m) => (m === 'SEP' ? 'SET' : m))), [existingMonths])

  // Primer mes de referencia para el orden cronológico
  const referencia = existingMonths[0]

  // Atajo: los N meses anteriores al mes actual (los últimos cerrados)
  const ultimosMeses = (n: number) => {
    const actual = new Date().getMonth()
    return Array.from({ length: n }, (_, i) => MESES[(actual - n + i + 12) % 12].codigo)
  }

  // Siguiente mes después del último existente
  const siguiente = useMemo(() => {
    if (existingMonths.length === 0) return null
    const ultimo = existingMonths[existingMonths.length - 1]
    const idx = indice(ultimo)
    if (idx < 0) return null
    const cod = MESES[(idx + 1) % 12].codigo
    return existentes.has(cod) ? null : cod
  }, [existingMonths, existentes])

  const toggle = (codigo: string) => {
    if (existentes.has(codigo)) return
    setSeleccion((prev) => (prev.includes(codigo) ? prev.filter((m) => m !== codigo) : [...prev, codigo]))
  }

  const aplicarAtajo = (codigos: string[]) => setSeleccion(codigos.filter((c) => !existentes.has(c)))

  const resultado = ordenarMeses([...existingMonths, ...seleccion], referencia ?? ordenarMeses(seleccion)[0])

  if (!isOpen) return null

  return (
    <div className="modal-overlay" onClick={() => !isAdding && onClose()}>
      <div
        className="modal-window"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-month-title"
        style={{ maxWidth: '560px' }}
      >
        <div className="modal-header">
          <div>
            <h3 id="add-month-title">Agregar meses de consumo</h3>
            <p className="muted" style={{ margin: '4px 0 0', fontSize: '14px' }}>
              Elige uno o varios meses. Se agregan como columnas en orden cronológico.
            </p>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} disabled={isAdding} aria-label="Cerrar">
            ✕
          </button>
        </div>

        <div className="product-form">
          {/* Atajos */}
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' }}>
            {siguiente && (
              <button type="button" className="btn-detail" onClick={() => aplicarAtajo([siguiente])}>
                Siguiente mes ({siguiente})
              </button>
            )}
            <button type="button" className="btn-detail" onClick={() => aplicarAtajo(ultimosMeses(3))}>
              Últimos 3 meses
            </button>
            <button type="button" className="btn-detail" onClick={() => aplicarAtajo(ultimosMeses(6))}>
              Últimos 6 meses
            </button>
            <button type="button" className="btn-detail" onClick={() => aplicarAtajo(ultimosMeses(12))}>
              Últimos 12 meses
            </button>
            {seleccion.length > 0 && (
              <button type="button" className="btn-detail" onClick={() => setSeleccion([])}>
                Limpiar
              </button>
            )}
          </div>

          {/* Calendario de 12 meses */}
          <div className="month-grid" role="group" aria-label="Meses">
            {MESES.map((m) => {
              const yaEsta = existentes.has(m.codigo)
              const marcado = seleccion.includes(m.codigo)
              return (
                <button
                  key={m.codigo}
                  type="button"
                  className={`month-cell ${marcado ? 'selected' : ''}`}
                  onClick={() => toggle(m.codigo)}
                  disabled={yaEsta}
                  aria-pressed={marcado}
                  title={yaEsta ? `${m.nombre} ya está en la tabla` : `Agregar ${m.nombre}`}
                >
                  <span className="month-cell-code">{m.codigo}</span>
                  <span className="month-cell-name">{yaEsta ? 'Ya agregado' : m.nombre}</span>
                </button>
              )
            })}
          </div>

          {/* Vista previa */}
          <div className="empaque-jerarquia" style={{ marginTop: '14px' }}>
            <div className="empaque-total">
              <span>Columnas de la tabla{seleccion.length > 0 ? ` (+${seleccion.length})` : ''}</span>
              <strong>{resultado.length > 0 ? resultado.join(' · ') : 'Aún no hay meses'}</strong>
            </div>
          </div>
          <p className="field-help">
            Cada mes nuevo empieza en 0 para todos los productos; luego escribe los consumos o cárgalos desde el Excel de salidas.
          </p>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '16px' }}>
            <button type="button" className="btn-secondary" onClick={onClose} disabled={isAdding}>
              Cancelar
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={isAdding || seleccion.length === 0}
              onClick={() => void onAdd(seleccion)}
            >
              {isAdding
                ? 'Agregando…'
                : seleccion.length === 0
                  ? 'Elige al menos un mes'
                  : `Agregar ${seleccion.length} ${seleccion.length === 1 ? 'mes' : 'meses'}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
