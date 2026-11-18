import { useEffect, useState, type FormEvent } from 'react'
import { projectionService } from '../../../services/projectionService'
import type { ProjectionTemplate } from '../../../types/projections'

interface SupplierOption {
  id_proveedor: number
  razon_social: string
}

type Contenedor = '20FT' | '40FT' | 'LCL'

const CONTENEDORES: { value: Contenedor; label: string; descripcion: string }[] = [
  { value: '40FT', label: '40 pies', descripcion: 'Contenedor completo estándar (~67 m³).' },
  { value: '20FT', label: '20 pies', descripcion: 'Contenedor completo pequeño (~33 m³).' },
  { value: 'LCL', label: 'Carga consolidada', descripcion: 'LCL: se comparte el contenedor con otros importadores.' }
]

interface NewOrderModalProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (data: {
    numero_orden: string
    descripcion: string
    id_plantilla: number
    id_proveedor: number | null
    tipo_contenedor: Contenedor
  }) => Promise<void>
  templates: ProjectionTemplate[]
  existingOrderNumbers: string[]
  suppliers: SupplierOption[]
}

/** Fase 1: crear la orden en Borrador. La proyección y la aprobación vienen después. */
export function NewOrderModal({ isOpen, onClose, onSubmit, templates, existingOrderNumbers, suppliers }: NewOrderModalProps) {
  const [numeroOrden, setNumeroOrden] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [idProveedor, setIdProveedor] = useState('')
  const [tipoContenedor, setTipoContenedor] = useState<Contenedor>('40FT')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen) return
    setErrorMsg(null)
    setDescripcion('')
    setTipoContenedor('40FT')
    setIdProveedor(suppliers.length === 1 ? String(suppliers[0].id_proveedor) : '')
    setNumeroOrden('')
    void projectionService.getNextOrderNumber().then(setNumeroOrden).catch(() => setNumeroOrden(''))
  }, [isOpen, templates, suppliers])

  if (!isOpen) return null

  const cleanNum = numeroOrden.trim().toUpperCase()
  const duplicada = existingOrderNumbers.some((n) => n.toUpperCase() === cleanNum)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setErrorMsg(null)
    if (!cleanNum) return setErrorMsg('El número de orden es obligatorio.')
    if (duplicada) return setErrorMsg(`La orden ${cleanNum} ya existe. Usa otro número.`)
    // La plantilla (fórmulas de cálculo) se asigna automáticamente: la primera activa
    const idPlantilla = templates[0]?.id_plantilla
    if (!idPlantilla) return setErrorMsg('No hay plantillas de cálculo activas.')

    setIsSubmitting(true)
    try {
      await onSubmit({
        numero_orden: cleanNum,
        descripcion: descripcion.trim() || `Orden ${cleanNum}`,
        id_plantilla: idPlantilla,
        id_proveedor: idProveedor ? Number(idProveedor) : null,
        tipo_contenedor: tipoContenedor
      })
      onClose()
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'No se pudo crear la orden.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={() => !isSubmitting && onClose()}>
      <div
        className="modal-window"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-order-title"
        style={{ maxWidth: '640px' }}
      >
        <div className="modal-header">
          <div>
            <h3 id="new-order-title">Nueva orden de importación</h3>
            <p className="muted" style={{ margin: '4px 0 0', fontSize: '14px' }}>
              Se crea en <strong>Borrador</strong>. Después calcularás la compra en la matriz de proyección.
            </p>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} disabled={isSubmitting} aria-label="Cerrar">
            ✕
          </button>
        </div>

        {templates.length === 0 ? (
          <p className="error notice" role="alert">
            No hay plantillas de proyección activas. Se necesita al menos una para crear órdenes.
          </p>
        ) : (
          <form className="product-form" onSubmit={handleSubmit} noValidate>
            <fieldset>
              <legend>1. Identificación</legend>
              <div className="number-grid">
                <label>
                  Número de orden
                  <input
                    value={numeroOrden}
                    onChange={(e) => setNumeroOrden(e.target.value.toUpperCase())}
                    placeholder="IMP-2026-001"
                    aria-invalid={duplicada}
                    style={{ fontWeight: 600, letterSpacing: '0.5px' }}
                  />
                  {duplicada ? (
                    <span className="field-error">Ya existe una orden con ese número.</span>
                  ) : (
                    <span className="field-help">Correlativo sugerido del año. Puedes cambiarlo.</span>
                  )}
                </label>
                <label>
                  Proveedor
                  <select value={idProveedor} onChange={(e) => setIdProveedor(e.target.value)}>
                    <option value="">Por definir</option>
                    {suppliers.map((s) => (
                      <option key={s.id_proveedor} value={s.id_proveedor}>
                        {s.razon_social}
                      </option>
                    ))}
                  </select>
                  {suppliers.length === 0 && (
                    <span className="field-help">No hay proveedores. Regístralos en Maestros y empaque → Proveedores.</span>
                  )}
                </label>
              </div>
              <label style={{ marginTop: '12px' }}>
                Descripción o campaña (opcional)
                <input
                  value={descripcion}
                  onChange={(e) => setDescripcion(e.target.value)}
                  placeholder="Ej. Reposición agencias diciembre 2026"
                />
              </label>
            </fieldset>

            <fieldset style={{ marginTop: '16px' }}>
              <legend>2. Tipo de contenedor</legend>
              <div className="choice-cards" role="radiogroup" aria-label="Tipo de contenedor">
                {CONTENEDORES.map((c) => (
                  <label key={c.value} className={`choice-card ${tipoContenedor === c.value ? 'selected' : ''}`}>
                    <input type="radio" name="contenedor" checked={tipoContenedor === c.value} onChange={() => setTipoContenedor(c.value)} />
                    <span className="choice-card-title">{c.label}</span>
                    <span className="choice-card-text">{c.descripcion}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="empaque-jerarquia" style={{ marginTop: '16px' }}>
              <div className="empaque-total">
                <span>Resumen</span>
                <strong>
                  {cleanNum || 'Sin número'} · {CONTENEDORES.find((c) => c.value === tipoContenedor)?.label} ·{' '}
                  {suppliers.find((s) => String(s.id_proveedor) === idProveedor)?.razon_social ?? 'Proveedor por definir'}
                </strong>
              </div>
            </div>

            {errorMsg && (
              <p className="error notice" role="alert" style={{ marginTop: '14px' }}>
                {errorMsg}
              </p>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '18px' }}>
              <button type="button" className="btn-secondary" onClick={onClose} disabled={isSubmitting}>
                Cancelar
              </button>
              <button type="submit" className="btn-primary" disabled={isSubmitting || duplicada || !cleanNum}>
                {isSubmitting ? 'Creando…' : 'Crear orden y abrir proyección'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
