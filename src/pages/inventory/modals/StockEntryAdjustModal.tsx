import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from '../../../lib/supabase'
import { locationService } from '../../../services/locationService'
import { MODO_INFO, capitalizar, concordar, formatoNumero, nombreEmpaque, normalizarModo } from '../../products/empaque'
import type { InventoryItem, ProductOption } from '../types'

export type StockModalMode = 'ingreso' | 'conteo'

type Props = {
  isOpen: boolean
  mode: StockModalMode
  onClose: () => void
  warehouseId: number | null
  warehouseName?: string
  warehousePrefix?: string
  allProducts: ProductOption[]
  inventory: InventoryItem[]
  initialProductId?: string
  onSaved: (msg: string) => void
}

/**
 * Ingreso de stock según el modo de manejo del producto (todo vía RPC atómica):
 *  - Paletizado:  paleta completa o pucho (empaques cerrados + 1 abierto) con tag RFID
 *  - Por caja:    cajas cerradas + unidades sueltas (sin tag)
 *  - Serializado: equipo por número de serie (sin tag)
 * Modo "conteo": conteo físico absoluto de un producto Por caja.
 */
export function StockEntryAdjustModal({
  isOpen,
  mode,
  onClose,
  warehouseId,
  warehouseName,
  warehousePrefix,
  allProducts,
  inventory,
  initialProductId,
  onSaved
}: Props) {
  const [productId, setProductId] = useState('')
  const [tipoPaleta, setTipoPaleta] = useState<'COMPLETO' | 'PUCHO'>('COMPLETO')
  const [uidTag, setUidTag] = useState('')
  const [empaques, setEmpaques] = useState('0')
  const [sueltas, setSueltas] = useState('0')
  const [numeroSerie, setNumeroSerie] = useState('')
  const [estadoSerie, setEstadoSerie] = useState<'DISPONIBLE' | 'EN_MANTENIMIENTO'>('DISPONIBLE')
  const [motivo, setMotivo] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const productosElegibles = useMemo(
    () =>
      mode === 'conteo'
        ? allProducts.filter((p) => normalizarModo(p.modo_manejo) === 'PICKING_CAJA')
        : allProducts,
    [allProducts, mode]
  )

  useEffect(() => {
    if (!isOpen) return
    const inicial = initialProductId || (productosElegibles[0] ? String(productosElegibles[0].id_producto) : '')
    setProductId(inicial)
    setTipoPaleta('COMPLETO')
    setUidTag('')
    setNumeroSerie('')
    setEstadoSerie('DISPONIBLE')
    setMotivo(mode === 'conteo' ? 'Conteo físico' : 'Ingreso de stock')
    setError(null)
    if (mode === 'conteo') {
      const inv = inventory.find((i) => String(i.id_producto) === inicial)
      setEmpaques(String(inv?.cajas_cerradas ?? 0))
      setSueltas(String(inv?.unidades_caja_abierta ?? 0))
    } else {
      setEmpaques('0')
      setSueltas('0')
    }
  }, [isOpen, initialProductId, mode, productosElegibles, inventory])

  const producto = productosElegibles.find((p) => String(p.id_producto) === productId) ?? null
  const modo = normalizarModo(producto?.modo_manejo)
  const tipo = producto?.tipo_empaque || 'CAJA'
  const upc = Math.max(1, producto?.unidades_por_caja || 1)
  const porPaleta = Math.max(1, producto?.cajas_por_paleta || 1)
  const actual = inventory.find((i) => String(i.id_producto) === productId)

  const nEmpaques = Math.max(0, Math.floor(Number(empaques) || 0))
  const nSueltas = Math.max(0, Math.floor(Number(sueltas) || 0))

  const unidades =
    modo === 'SERIALIZADO'
      ? 1
      : modo === 'PALETIZADO' && tipoPaleta === 'COMPLETO'
        ? porPaleta * upc
        : nEmpaques * upc + nSueltas

  function validar(): string | null {
    if (!warehouseId) return 'Selecciona un almacén.'
    if (!producto) return 'Selecciona un producto.'
    if (modo !== 'SERIALIZADO' && !producto.tiene_regla) return 'El producto no tiene regla de empaque. Complétala en Maestros y empaque.'
    if (modo === 'SERIALIZADO') return numeroSerie.trim() ? null : 'El número de serie es obligatorio.'
    if (modo === 'PALETIZADO' && !uidTag.trim()) return 'El código del tag RFID es obligatorio.'
    const necesitaCantidad = mode === 'ingreso' && !(modo === 'PALETIZADO' && tipoPaleta === 'COMPLETO')
    if (necesitaCantidad && nEmpaques === 0 && nSueltas === 0) return 'Indica al menos un empaque cerrado o unidades sueltas.'
    if (nSueltas >= upc && !(modo === 'PALETIZADO' && tipoPaleta === 'COMPLETO')) {
      return `Las unidades sueltas deben ser menos de ${upc}: con ${upc} se completa un ${nombreEmpaque(tipo, 1)}.`
    }
    if (modo === 'PALETIZADO' && tipoPaleta === 'PUCHO' && nEmpaques >= porPaleta) {
      return `Un pucho tiene menos de ${porPaleta} ${nombreEmpaque(tipo)}; con esa cantidad es una paleta completa.`
    }
    return null
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const msg = validar()
    if (msg) {
      setError(msg)
      return
    }
    setSaving(true)
    setError(null)
    try {
      if (mode === 'conteo') {
        const { data, error: rpcErr } = await supabase.rpc('ajustar_conteo_cajas', {
          p_id_producto: producto!.id_producto,
          p_id_almacen: warehouseId,
          p_cajas_cerradas: nEmpaques,
          p_unidades_caja_abierta: nSueltas,
          p_motivo: motivo
        })
        if (rpcErr) throw rpcErr
        onSaved(`Conteo de ${producto!.sku} guardado: ${formatoNumero(Number(data?.stock_nuevo) || 0)} unidades.`)
      } else {
        const datos =
          modo === 'SERIALIZADO'
            ? { numero_serie: numeroSerie.trim(), estado: estadoSerie }
            : modo === 'PICKING_CAJA'
              ? { cajas: nEmpaques, unidades_sueltas: nSueltas }
              : { uid_tag: uidTag.trim().toUpperCase(), tipo_paleta: tipoPaleta, empaques: nEmpaques, unidades_sueltas: nSueltas }
        const { data, error: rpcErr } = await supabase.rpc('registrar_ingreso_inventario', {
          p_id_producto: producto!.id_producto,
          p_id_almacen: warehouseId,
          p_datos: datos,
          p_motivo: motivo
        })
        if (rpcErr) throw rpcErr
        onSaved(`Ingreso registrado en ${warehouseName ?? 'la sede'}: ${data?.detalle ?? ''} (+${formatoNumero(Number(data?.unidades) || 0)} u).`)
      }
      onClose()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : (err as { message?: string })?.message ?? 'No se pudo guardar.')
    } finally {
      setSaving(false)
    }
  }

  if (!isOpen) return null

  const singular = nombreEmpaque(tipo, 1)
  const plural = nombreEmpaque(tipo, 2)

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-window" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="stock-modal-title">
        <div className="modal-header">
          <div>
            <h3 id="stock-modal-title">{mode === 'conteo' ? 'Ajustar conteo por caja' : 'Ingresar stock'}</h3>
            <p className="muted" style={{ margin: '4px 0 0', fontSize: '14px' }}>
              Almacén: <strong>{warehouseName ?? '—'}</strong>
            </p>
          </div>
          <button className="modal-close-btn" type="button" onClick={onClose} aria-label="Cerrar">
            ✕
          </button>
        </div>

        <form className="product-form" onSubmit={handleSubmit}>
          <label>
            Producto
            <select value={productId} onChange={(e) => {
              setProductId(e.target.value)
              setError(null)
              if (mode === 'conteo') {
                const inv = inventory.find((i) => String(i.id_producto) === e.target.value)
                setEmpaques(String(inv?.cajas_cerradas ?? 0))
                setSueltas(String(inv?.unidades_caja_abierta ?? 0))
              }
            }} required>
              {productosElegibles.map((p) => (
                <option key={p.id_producto} value={String(p.id_producto)}>
                  {p.sku} — {p.nombre} ({MODO_INFO[normalizarModo(p.modo_manejo)].label})
                </option>
              ))}
            </select>
          </label>

          {producto && (
            <p className="muted" style={{ margin: '8px 0 0', fontSize: '13px' }}>
              <span className="modo-pill">{MODO_INFO[modo].label}</span>{' '}
              {modo === 'SERIALIZADO'
                ? 'Se registra 1 equipo por número de serie, sin tag RFID.'
                : modo === 'PICKING_CAJA'
                  ? `1 ${singular} = ${upc} u. Sin paletas ni tag RFID.`
                  : `1 ${singular} = ${upc} u · 1 paleta = ${porPaleta} ${plural} = ${formatoNumero(porPaleta * upc)} u.`}
            </p>
          )}

          {/* ---------------- Paletizado ---------------- */}
          {mode === 'ingreso' && modo === 'PALETIZADO' && (
            <fieldset style={{ marginTop: '14px' }}>
              <legend>Paleta con tag RFID</legend>
              <div className="number-grid">
                <label>
                  Tipo
                  <select value={tipoPaleta} onChange={(e) => setTipoPaleta(e.target.value as 'COMPLETO' | 'PUCHO')}>
                    <option value="COMPLETO">Paleta completa (cerrada)</option>
                    <option value="PUCHO">Pucho (paleta incompleta)</option>
                  </select>
                </label>
                <label>
                  Código del tag RFID
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <input value={uidTag} onChange={(e) => setUidTag(e.target.value.toUpperCase())} placeholder={`${warehousePrefix ?? 'TAG'}00001`} required />
                    <button
                      type="button"
                      className="btn-detail"
                      onClick={async () => {
                        if (warehouseId) setUidTag(await locationService.suggestNextRfidTag(warehouseId, warehousePrefix))
                      }}
                    >
                      Sugerir
                    </button>
                  </div>
                </label>
                {tipoPaleta === 'PUCHO' && (
                  <>
                    <label>
                      {capitalizar(plural)} {concordar(tipo, 2, 'cerrad')}
                      <input type="number" min="0" step="1" value={empaques} onChange={(e) => setEmpaques(e.target.value)} />
                    </label>
                    <label>
                      Unidades sueltas (1 {singular} {concordar(tipo, 1, 'abiert')})
                      <input type="number" min="0" max={upc - 1} step="1" value={sueltas} onChange={(e) => setSueltas(e.target.value)} />
                    </label>
                  </>
                )}
              </div>
              {tipoPaleta === 'PUCHO' && (
                <p className="muted" style={{ margin: '8px 0 0', fontSize: '13px' }}>
                  Solo puede haber 1 pucho por producto en el almacén, con como máximo 1 {singular} {concordar(tipo, 1, 'abiert')}.
                </p>
              )}
            </fieldset>
          )}

          {/* ---------------- Por caja (ingreso o conteo) ---------------- */}
          {modo === 'PICKING_CAJA' && (
            <fieldset style={{ marginTop: '14px' }}>
              <legend>{mode === 'conteo' ? 'Conteo físico actual' : 'Cajas a ingresar'}</legend>
              {mode === 'conteo' && actual && (
                <p className="muted" style={{ margin: '0 0 10px', fontSize: '13px' }}>
                  Registrado hoy: {actual.cajas_cerradas ?? 0} {plural} {concordar(tipo, 2, 'cerrad')} + {actual.unidades_caja_abierta ?? 0} u en 1 {singular} {concordar(tipo, 1, 'abiert')} ({formatoNumero(Number(actual.stock_real) || 0)} u).
                </p>
              )}
              <div className="number-grid">
                <label>
                  {capitalizar(plural)} {concordar(tipo, 2, 'cerrad')}
                  <input type="number" min="0" step="1" value={empaques} onChange={(e) => setEmpaques(e.target.value)} />
                </label>
                <label>
                  Unidades en {singular} {concordar(tipo, 1, 'abiert')}
                  <input type="number" min="0" max={upc - 1} step="1" value={sueltas} onChange={(e) => setSueltas(e.target.value)} />
                </label>
              </div>
              {mode === 'ingreso' && (
                <p className="muted" style={{ margin: '8px 0 0', fontSize: '13px' }}>
                  Si las unidades sueltas completan {concordar(tipo, 1, 'l').replace(/^lo$/, 'el')} {singular} {concordar(tipo, 1, 'abiert')} que ya existe, se cuenta como {singular} {concordar(tipo, 1, 'cerrad')}.
                </p>
              )}
            </fieldset>
          )}

          {/* ---------------- Serializado ---------------- */}
          {mode === 'ingreso' && modo === 'SERIALIZADO' && (
            <fieldset style={{ marginTop: '14px' }}>
              <legend>Equipo</legend>
              <div className="number-grid">
                <label>
                  Número de serie de fábrica
                  <input value={numeroSerie} onChange={(e) => setNumeroSerie(e.target.value)} placeholder="Ej. SN-GEN-2026-0042" required />
                </label>
                <label>
                  Estado inicial
                  <select value={estadoSerie} onChange={(e) => setEstadoSerie(e.target.value as 'DISPONIBLE' | 'EN_MANTENIMIENTO')}>
                    <option value="DISPONIBLE">Disponible</option>
                    <option value="EN_MANTENIMIENTO">En mantenimiento</option>
                  </select>
                </label>
              </div>
            </fieldset>
          )}

          <label style={{ marginTop: '14px' }}>
            Motivo
            <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej. Ingreso por importación IMP-2026-004" />
          </label>

          {producto && (
            <div className="empaque-jerarquia" style={{ marginTop: '14px' }}>
              <div className="empaque-total">
                <span>{mode === 'conteo' ? 'Stock resultante' : 'Unidades a ingresar'}</span>
                <strong>{formatoNumero(unidades)} u</strong>
              </div>
            </div>
          )}

          {error && (
            <p className="error notice" role="alert" style={{ marginTop: '14px' }}>
              {error}
            </p>
          )}

          <div style={{ display: 'flex', gap: '10px', marginTop: '18px' }}>
            <button className="button" style={{ margin: 0 }} disabled={saving || !producto}>
              {saving ? 'Guardando…' : mode === 'conteo' ? 'Guardar conteo' : 'Registrar ingreso'}
            </button>
            <button className="button secondary" type="button" style={{ margin: 0 }} onClick={onClose}>
              Cancelar
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
