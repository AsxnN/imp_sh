import { useEffect, useMemo, useState, type FormEvent } from 'react'
import type { Warehouse } from '../types'

type TipoAlmacen = 'PRINCIPAL' | 'TIENDA' | 'MERMA'

const TIPOS: { value: TipoAlmacen; label: string; descripcion: string }[] = [
  { value: 'PRINCIPAL', label: 'Principal', descripcion: 'Centro de distribución: recibe importaciones y guarda paletas en racks.' },
  { value: 'TIENDA', label: 'Tienda', descripcion: 'Punto de venta o despacho a agencias; maneja menos volumen.' },
  { value: 'MERMA', label: 'Merma', descripcion: 'Zona de productos dañados, devueltos o por dar de baja.' }
]

// Palabras que no aportan al prefijo ("Almacén Importaciones" -> IMP, "Tienda Breña" -> BRE)
const PALABRAS_GENERICAS = new Set(['almacen', 'tienda', 'sede', 'deposito', 'centro', 'de', 'del', 'la', 'el', 'los', 'las', 'y'])

function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 ]/g, ' ').trim()
}

/**
 * Sugiere un prefijo que no esté en uso: prueba la 1.ª palabra significativa,
 * luego la 2.ª, luego combinaciones (IMP -> CAL -> IMPC -> IMPO…).
 */
export function sugerirPrefijoLibre(name: string, usados: string[]): string {
  const ocupados = new Set(usados.map((u) => u.toUpperCase()))
  const palabras = normalizar(name)
    .replace(/[0-9]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p.toUpperCase())
  const signif = palabras.filter((p) => !PALABRAS_GENERICAS.has(p.toLowerCase()))
  const base = signif.length > 0 ? signif : palabras
  if (base.length === 0) return ''
  const [w1, w2 = ''] = base
  const candidatos = [
    w1.slice(0, 3),
    w2.slice(0, 3),
    w1.slice(0, 3) + w2.slice(0, 1),
    w1.slice(0, 4),
    w1.slice(0, 2) + w2.slice(0, 1),
    w1.slice(0, 5)
  ].filter((c) => /^[A-Z]{2,5}$/.test(c))
  return candidatos.find((c) => !ocupados.has(c)) ?? candidatos[0] ?? ''
}

type Payload = {
  nombre: string
  tipo: TipoAlmacen
  capacidad_m3: number | null
  activo: boolean
  prefijo_rfid: string
}

type Props = {
  isOpen: boolean
  onClose: () => void
  editingWh: Warehouse | null
  /** Para validar que el nombre y el prefijo no se repitan */
  warehouses: Warehouse[]
  onSaveWarehouse: (payload: Payload) => Promise<void> | void
  saving: boolean
}

export function WarehouseCrudModal({ isOpen, onClose, editingWh, warehouses, onSaveWarehouse, saving }: Props) {
  const [nombre, setNombre] = useState('')
  const [prefijo, setPrefijo] = useState('')
  const [prefijoManual, setPrefijoManual] = useState(false)
  const [tipo, setTipo] = useState<TipoAlmacen>('PRINCIPAL')
  const [capacidad, setCapacidad] = useState('')
  const [usarMedidas, setUsarMedidas] = useState(false)
  const [largo, setLargo] = useState('')
  const [ancho, setAncho] = useState('')
  const [alto, setAlto] = useState('')
  const [activo, setActivo] = useState(true)
  const [intentoGuardar, setIntentoGuardar] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    setNombre(editingWh?.nombre ?? '')
    setPrefijo(editingWh?.prefijo_rfid ?? '')
    setPrefijoManual(Boolean(editingWh?.prefijo_rfid))
    setTipo(editingWh?.tipo ?? 'PRINCIPAL')
    setCapacidad(editingWh?.capacidad_m3 ? String(Number(editingWh.capacidad_m3)) : '')
    setUsarMedidas(false)
    setLargo('')
    setAncho('')
    setAlto('')
    setActivo(editingWh?.activo ?? true)
    setIntentoGuardar(false)
  }, [isOpen, editingWh])

  const otros = useMemo(
    () => warehouses.filter((w) => w.id_almacen !== editingWh?.id_almacen),
    [warehouses, editingWh]
  )

  const prefijosUsados = useMemo(() => otros.map((w) => w.prefijo_rfid ?? '').filter(Boolean), [otros])

  const capacidadCalculada = useMemo(() => {
    const l = Number(largo) || 0
    const a = Number(ancho) || 0
    const h = Number(alto) || 0
    return l > 0 && a > 0 && h > 0 ? Math.round(l * a * h * 10) / 10 : null
  }, [largo, ancho, alto])

  const capacidadFinal = usarMedidas ? capacidadCalculada : capacidad ? Number(capacidad) : null

  const errores = useMemo(() => {
    const e: Partial<Record<'nombre' | 'prefijo' | 'capacidad', string>> = {}
    const n = nombre.trim()
    if (!n) e.nombre = 'Escribe el nombre del almacén.'
    else if (otros.some((w) => w.nombre.trim().toLowerCase() === n.toLowerCase())) e.nombre = 'Ya existe un almacén con ese nombre.'

    if (!/^[A-Z]{2,5}$/.test(prefijo)) e.prefijo = 'Usa de 2 a 5 letras (A-Z), sin números ni espacios.'
    else if (otros.some((w) => (w.prefijo_rfid ?? '').toUpperCase() === prefijo)) e.prefijo = `El prefijo ${prefijo} ya lo usa otro almacén.`

    if (capacidadFinal !== null && (Number.isNaN(capacidadFinal) || capacidadFinal <= 0)) e.capacidad = 'La capacidad debe ser mayor a 0.'
    return e
  }, [nombre, prefijo, capacidadFinal, otros])

  const cambiaPrefijo = Boolean(editingWh?.prefijo_rfid) && editingWh?.prefijo_rfid !== prefijo

  if (!isOpen) return null

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setIntentoGuardar(true)
    if (Object.keys(errores).length > 0) return
    void onSaveWarehouse({
      nombre: nombre.trim(),
      tipo,
      capacidad_m3: capacidadFinal,
      activo,
      prefijo_rfid: prefijo
    })
  }

  const mostrar = (campo: keyof typeof errores) => (intentoGuardar || campo === 'prefijo' ? errores[campo] : undefined)

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-window" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="wh-modal-title" style={{ maxWidth: '640px' }}>
        <div className="modal-header">
          <div>
            <h3 id="wh-modal-title">{editingWh ? `Editar almacén` : 'Nuevo almacén'}</h3>
            <p className="muted" style={{ margin: '4px 0 0', fontSize: '14px' }}>
              {editingWh ? editingWh.nombre : 'Registra una sede donde se guardará mercadería.'}
            </p>
          </div>
          <button className="modal-close-btn" type="button" onClick={onClose} aria-label="Cerrar">
            ✕
          </button>
        </div>

        <form className="product-form" onSubmit={handleSubmit} noValidate>
          {/* 1. Identificación */}
          <fieldset>
            <legend>1. Identificación</legend>
            <label>
              Nombre
              <input
                value={nombre}
                onChange={(e) => {
                  setNombre(e.target.value)
                  if (!prefijoManual) setPrefijo(sugerirPrefijoLibre(e.target.value, prefijosUsados))
                }}
                placeholder="Ej. Importaciones, Tienda Breña, Construcción"
                aria-invalid={Boolean(mostrar('nombre'))}
                autoFocus
              />
              {mostrar('nombre') && <span className="field-error">{mostrar('nombre')}</span>}
            </label>

            <label style={{ marginTop: '12px' }}>
              Prefijo RFID
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <input
                  value={prefijo}
                  maxLength={5}
                  onChange={(e) => {
                    setPrefijoManual(true)
                    setPrefijo(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))
                  }}
                  placeholder="IMP"
                  style={{ maxWidth: '120px', letterSpacing: '1px', fontWeight: 600 }}
                  aria-invalid={Boolean(nombre && errores.prefijo)}
                />
                {prefijoManual && nombre && (
                  <button
                    type="button"
                    className="btn-detail"
                    onClick={() => {
                      setPrefijo(sugerirPrefijoLibre(nombre, prefijosUsados))
                      setPrefijoManual(false)
                    }}
                  >
                    Sugerir desde el nombre
                  </button>
                )}
              </div>
              {nombre && errores.prefijo ? (
                <span className="field-error">{errores.prefijo}</span>
              ) : (
                <span className="field-help">
                  Las paletas de esta sede se etiquetarán <strong>{prefijo || 'IMP'}00001</strong>, <strong>{prefijo || 'IMP'}00002</strong>… El prefijo no se puede cambiar
                  una vez emitidas etiquetas.
                </span>
              )}
              {cambiaPrefijo && (
                <span className="field-error">
                  Estás cambiando el prefijo {editingWh?.prefijo_rfid} → {prefijo}. Si la sede ya tiene etiquetas emitidas, el sistema lo rechazará.
                </span>
              )}
            </label>
          </fieldset>

          {/* 2. Tipo */}
          <fieldset style={{ marginTop: '16px' }}>
            <legend>2. Tipo de almacén</legend>
            <div className="choice-cards" role="radiogroup" aria-label="Tipo de almacén">
              {TIPOS.map((t) => (
                <label key={t.value} className={`choice-card ${tipo === t.value ? 'selected' : ''}`}>
                  <input type="radio" name="tipo-almacen" value={t.value} checked={tipo === t.value} onChange={() => setTipo(t.value)} />
                  <span className="choice-card-title">{t.label}</span>
                  <span className="choice-card-text">{t.descripcion}</span>
                </label>
              ))}
            </div>
          </fieldset>

          {/* 3. Capacidad */}
          <fieldset style={{ marginTop: '16px' }}>
            <legend>3. Capacidad (opcional)</legend>
            <p className="field-help" style={{ margin: '0 0 10px' }}>
              Se usa para el indicador de ocupación del inventario. Puedes dejarla en blanco y completarla después.
            </p>
            <div className="choice-toggle" role="radiogroup" aria-label="Forma de indicar la capacidad">
              <button type="button" className={!usarMedidas ? 'active' : ''} onClick={() => setUsarMedidas(false)}>
                Ingresar m³
              </button>
              <button type="button" className={usarMedidas ? 'active' : ''} onClick={() => setUsarMedidas(true)}>
                Calcular con medidas
              </button>
            </div>

            {!usarMedidas ? (
              <label style={{ marginTop: '10px', maxWidth: '220px' }}>
                Capacidad útil (m³)
                <input type="number" min="0" step="0.5" value={capacidad} onChange={(e) => setCapacidad(e.target.value)} placeholder="Ej. 1200" />
              </label>
            ) : (
              <div className="number-grid" style={{ marginTop: '10px' }}>
                <label>
                  Largo útil (m)
                  <input type="number" min="0" step="0.1" value={largo} onChange={(e) => setLargo(e.target.value)} />
                </label>
                <label>
                  Ancho útil (m)
                  <input type="number" min="0" step="0.1" value={ancho} onChange={(e) => setAncho(e.target.value)} />
                </label>
                <label>
                  Alto de estiba (m)
                  <input type="number" min="0" step="0.1" value={alto} onChange={(e) => setAlto(e.target.value)} />
                </label>
              </div>
            )}
            {usarMedidas && (
              <p className="field-help" style={{ margin: '8px 0 0' }}>
                Capacidad calculada: <strong>{capacidadCalculada !== null ? `${capacidadCalculada.toLocaleString('es-PE')} m³` : '—'}</strong>
              </p>
            )}
            {mostrar('capacidad') && <span className="field-error">{mostrar('capacidad')}</span>}
          </fieldset>

          {editingWh && (
            <label className="check" style={{ marginTop: '14px' }}>
              <input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} />
              Almacén activo (los inactivos no aparecen para ingresar stock)
            </label>
          )}

          {/* Resumen */}
          <div className="empaque-jerarquia" style={{ marginTop: '16px' }}>
            <div className="empaque-total">
              <span>Resumen</span>
              <strong>
                {nombre.trim() || 'Sin nombre'} · {TIPOS.find((t) => t.value === tipo)?.label} · Prefijo {prefijo || '—'} ·{' '}
                {capacidadFinal ? `${capacidadFinal.toLocaleString('es-PE')} m³` : 'capacidad sin definir'}
              </strong>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '18px' }}>
            <button className="btn-secondary" type="button" onClick={onClose}>
              Cancelar
            </button>
            <button className="btn-primary" type="submit" disabled={saving}>
              {saving ? 'Guardando…' : editingWh ? 'Guardar cambios' : 'Crear almacén'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
