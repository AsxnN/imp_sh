import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { EmpaqueJerarquia } from './components/EmpaqueJerarquia'
import { MODO_INFO, TIPOS_EMPAQUE, capitalizar, formatoNumero, leerRegla, nombreEmpaque, normalizarModo } from './empaque'
import { unidadSerializadaRepository } from './repositories/SerialUnitRepository'
import { getEstrategiaManejo } from './strategies/RegistroEstrategias'
import {
  getProductRule,
  getProductSerialProfile,
  type PerfilSerializado,
  type Product,
  type Rule,
  type UnidadSerializada
} from './types'

type ProductDetailModalProps = {
  product: Product | null
  onClose: () => void
  onPackagingUpdated?: () => void
  onDeleteProduct?: (prod: Product) => void
}

export function ProductDetailModal({
  product,
  onClose,
  onPackagingUpdated,
  onDeleteProduct
}: ProductDetailModalProps) {
  const [signedImageUrl, setSignedImageUrl] = useState<string | null>(null)
  const [loadingImage, setLoadingImage] = useState(false)

  // Estado para asignar o editar empaque (solo modo paletizado)
  const [editingPacking, setEditingPacking] = useState(false)
  const [savingPacking, setSavingPacking] = useState(false)
  const [packingError, setPackingError] = useState<string | null>(null)

  // Extraer perfiles
  const rule: Rule | null = useMemo(() => getProductRule(product), [product])
  const serialProfile: PerfilSerializado | null = useMemo(
    () => getProductSerialProfile(product),
    [product]
  )

  const modoManejo = normalizarModo(product?.categoria?.modo_manejo)
  const isSerializado = modoManejo === 'SERIALIZADO'
  const usaPaleta = modoManejo === 'PALETIZADO'

  // Unidades serializadas físicas (identificadas solo por número de serie)
  const [unidadesSeriales, setUnidadesSeriales] = useState<UnidadSerializada[]>([])
  const [loadingUnidades, setLoadingUnidades] = useState(false)
  const [showAddUnidad, setShowAddUnidad] = useState(false)
  const [nuevaSerie, setNuevaSerie] = useState('')
  const [guardandoUnidad, setGuardandoUnidad] = useState(false)
  const [errorUnidad, setErrorUnidad] = useState<string | null>(null)

  // Formulario de empaque (paletizado o por caja)
  const [formTipo, setFormTipo] = useState('CAJA')
  const [formUnits, setFormUnits] = useState('1')
  const [formBoxesLayer, setFormBoxesLayer] = useState('1')
  const [formLayers, setFormLayers] = useState('1')
  const [formNotes, setFormNotes] = useState('')
  const [formLargo, setFormLargo] = useState('')
  const [formAncho, setFormAncho] = useState('')
  const [formAlto, setFormAlto] = useState('')
  const [formPeso, setFormPeso] = useState('')

  // Sincronizar formulario con los datos existentes al abrir
  useEffect(() => {
    if (rule) {
      setFormTipo(rule.tipo_empaque || 'CAJA')
      setFormUnits(String(rule.unidades_por_caja ?? 1))
      setFormBoxesLayer(String(rule.cajas_por_camada ?? 1))
      setFormLayers(String(rule.numero_camadas ?? 1))
      setFormNotes(rule.notas_armado ?? '')
      setFormLargo(rule.largo_caja_cm ? String(rule.largo_caja_cm) : '')
      setFormAncho(rule.ancho_caja_cm ? String(rule.ancho_caja_cm) : '')
      setFormAlto(rule.alto_caja_cm ? String(rule.alto_caja_cm) : '')
      setFormPeso(rule.peso_caja_kg ? String(rule.peso_caja_kg) : '')
    } else {
      setFormTipo('CAJA')
      setFormUnits('1')
      setFormBoxesLayer('1')
      setFormLayers('1')
      setFormNotes('')
      setFormLargo('')
      setFormAncho('')
      setFormAlto('')
      setFormPeso('')
    }
    setEditingPacking(false)
    setPackingError(null)
  }, [rule, product])

  // Cargar unidades serializadas si es modo serializado
  useEffect(() => {
    if (isSerializado && product?.id_producto) {
      setLoadingUnidades(true)
      unidadSerializadaRepository
        .obtenerPorProducto(product.id_producto)
        .then((units) => setUnidadesSeriales(units))
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : 'Error al cargar unidades'
          setErrorUnidad(msg)
        })
        .finally(() => setLoadingUnidades(false))
    }
  }, [isSerializado, product?.id_producto])

  // Obtener URL firmada si hay imagen de armado
  useEffect(() => {
    let active = true
    const imagePath = rule?.imagen_armado_path

    if (!imagePath) {
      setSignedImageUrl(null)
      return
    }

    async function fetchImageUrl(filePath: string) {
      setLoadingImage(true)
      try {
        const { data, error } = await supabase.storage
          .from('esquemas-empaque')
          .createSignedUrl(filePath, 3600)

        if (active) {
          if (!error && data?.signedUrl) {
            setSignedImageUrl(data.signedUrl)
          } else {
            setSignedImageUrl(null)
          }
        }
      } catch {
        if (active) setSignedImageUrl(null)
      } finally {
        if (active) setLoadingImage(false)
      }
    }

    void fetchImageUrl(imagePath)
    return () => {
      active = false
    }
  }, [rule?.imagen_armado_path])

  if (!product) return null

  const regla = leerRegla(rule)
  const cajasPaleta = regla.empaquesPorPaleta
  const empSingular = nombreEmpaque(regla.tipoEmpaque, 1)
  const empPlural = nombreEmpaque(regla.tipoEmpaque, 2)
  const formSingular = nombreEmpaque(formTipo, 1)
  const formPlural = nombreEmpaque(formTipo, 2)
  const volumenCajaM3 =
    rule?.largo_caja_cm && rule?.ancho_caja_cm && rule?.alto_caja_cm
      ? (rule.largo_caja_cm * rule.ancho_caja_cm * rule.alto_caja_cm) / 1000000
      : null
  const volumenPaletaM3 = volumenCajaM3 ? volumenCajaM3 * cajasPaleta : null
  const pesoPaletaKg = rule?.peso_caja_kg ? rule.peso_caja_kg * cajasPaleta + 25 : null
  const altoPaletaCm =
    rule?.alto_caja_cm && (rule?.numero_camadas ?? rule?.camitas_por_paleta)
      ? rule.alto_caja_cm * (rule.numero_camadas ?? rule.camitas_por_paleta ?? 0) + 15
      : null

  const serialVolumenM3 =
    serialProfile?.largo_cm && serialProfile?.ancho_cm && serialProfile?.alto_cm
      ? (serialProfile.largo_cm * serialProfile.ancho_cm * serialProfile.alto_cm) / 1000000
      : null

  async function handleSavePackaging(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!product) return

    setSavingPacking(true)
    setPackingError(null)

    try {
      // Misma lógica de guardado que el formulario de productos (estrategia del modo)
      await getEstrategiaManejo(modoManejo).guardarPerfil(product.id_producto, {
        tipo_empaque: formTipo,
        unidades_por_caja: formUnits,
        cajas_por_camada: formBoxesLayer,
        numero_camadas: formLayers,
        permite_puchos: usaPaleta,
        notas_armado: formNotes,
        largo_caja_cm: formLargo,
        ancho_caja_cm: formAncho,
        alto_caja_cm: formAlto,
        peso_caja_kg: formPeso
      })
      setEditingPacking(false)
      onPackagingUpdated?.()
    } catch (err: unknown) {
      setPackingError(err instanceof Error ? err.message : 'Error al guardar el empaque.')
    } finally {
      setSavingPacking(false)
    }
  }

  async function handleAddSerialUnit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!product || !nuevaSerie.trim()) return

    setGuardandoUnidad(true)
    setErrorUnidad(null)

    try {
      // La maquinaria se identifica solo por número de serie (sin tag RFID)
      await unidadSerializadaRepository.guardar({
        id_producto: product.id_producto,
        numero_serie: nuevaSerie.trim(),
        id_etiqueta: null,
        estado: 'DISPONIBLE'
      })

      setNuevaSerie('')
      setShowAddUnidad(false)

      const updatedList = await unidadSerializadaRepository.obtenerPorProducto(product.id_producto)
      setUnidadesSeriales(updatedList)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al registrar unidad serializada.'
      setErrorUnidad(msg)
    } finally {
      setGuardandoUnidad(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-window" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <span className="sku-badge" style={{ fontSize: '0.95rem' }}>
              {product.sku}
            </span>
            <h3>{product.nombre ?? product.descripcion}</h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
              <span className="muted" style={{ fontSize: '0.85rem' }}>
                Categoría: <strong>{product.categoria?.nombre ?? 'Sin categoría'}</strong>
              </span>
              <span className="modo-pill" title={MODO_INFO[modoManejo].resumen}>
                {MODO_INFO[modoManejo].label}
              </span>
            </div>
          </div>
          <button
            className="modal-close-btn"
            type="button"
            title="Cerrar ficha"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        {packingError && (
          <p className="error notice" role="alert" style={{ marginBottom: '16px' }}>
            {packingError}
          </p>
        )}

        {/* =================================================================== */}
        {/* VISTA MODO SERIALIZADO */}
        {/* =================================================================== */}
        {isSerializado ? (
          <div>
            {/* Especificaciones Técnicas del Equipo */}
            <div className="detail-section">
              <h4>Ficha técnica de maquinaria y equipo</h4>
              <div className="detail-stats-grid">
                <div className="stat-box highlight">
                  <span>Modo de manejo</span>
                  <strong>Serializado (por número de serie)</strong>
                </div>
                <div className="stat-box">
                  <span>Peso unitario</span>
                  <strong>{serialProfile?.peso_unitario_kg ? `${serialProfile.peso_unitario_kg} kg` : product.peso_unitario_kg ? `${product.peso_unitario_kg} kg` : '—'}</strong>
                </div>
                <div className="stat-box">
                  <span>Dimensiones (L × An × Al)</span>
                  <strong>
                    {serialProfile?.largo_cm && serialProfile?.ancho_cm && serialProfile?.alto_cm
                      ? `${serialProfile.largo_cm} × ${serialProfile.ancho_cm} × ${serialProfile.alto_cm} cm`
                      : '—'}
                  </strong>
                </div>
                {serialVolumenM3 !== null && (
                  <div className="stat-box highlight">
                    <span>Volumen unitario</span>
                    <strong>{serialVolumenM3.toFixed(3)} m³</strong>
                  </div>
                )}
                <div className="stat-box">
                  <span>Ubicación permitida</span>
                  <strong>{serialProfile?.ubicacion_permitida || 'AMBAS'}</strong>
                </div>
                <div className="stat-box">
                  <span>Equipo de izaje</span>
                  <strong style={{ color: serialProfile?.requiere_equipo_izaje ? 'var(--color-danger)' : 'var(--color-success)' }}>
                    {serialProfile?.requiere_equipo_izaje ? 'Requiere grúa/clark' : 'No requiere'}
                  </strong>
                </div>
              </div>

              {serialProfile?.notas && (
                <div style={{ marginTop: '14px', padding: '10px 14px', background: 'var(--color-canvas)', borderRadius: '6px', border: '1px solid var(--color-border)' }}>
                  <span style={{ fontSize: '0.78rem', color: 'var(--color-text-secondary)', display: 'block' }}>Notas técnicas / mantenimiento:</span>
                  <p style={{ margin: '4px 0 0', fontSize: '0.9rem', color: 'var(--color-text-primary)' }}>
                    {serialProfile.notas}
                  </p>
                </div>
              )}
            </div>

            {/* Unidades Serializadas Físicas Registradas */}
            <div className="detail-section" style={{ marginTop: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <h4 style={{ margin: 0 }}>Unidades serializadas registradas ({unidadesSeriales.length})</h4>
                <button
                  className="button"
                  style={{ padding: '6px 12px', fontSize: '0.8rem', margin: 0 }}
                  type="button"
                  onClick={() => setShowAddUnidad(!showAddUnidad)}
                >
                  {showAddUnidad ? 'Cancelar' : '+ Registrar unidad'}
                </button>
              </div>

              {errorUnidad && (
                <p className="error notice" role="alert" style={{ margin: '8px 0' }}>
                  {errorUnidad}
                </p>
              )}

              {/* Formulario para enrolar nueva unidad física */}
              {showAddUnidad && (
                <form
                  onSubmit={handleAddSerialUnit}
                  style={{
                    background: 'var(--color-canvas)',
                    padding: '16px',
                    borderRadius: '6px',
                    border: '1px solid var(--color-border)',
                    marginBottom: '16px'
                  }}
                >
                  <h5 style={{ margin: '0 0 10px', fontSize: '0.9rem' }}>Registrar nueva unidad</h5>
                  <label style={{ maxWidth: '360px' }}>
                    Número de serie de fábrica (único)
                    <input
                      value={nuevaSerie}
                      onChange={(e) => setNuevaSerie(e.target.value)}
                      placeholder="Ej. SN-GEN-2026-0042"
                      required
                    />
                  </label>
                  <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                    <button className="button" style={{ margin: 0 }} disabled={guardandoUnidad}>
                      {guardandoUnidad ? 'Guardando…' : 'Guardar unidad'}
                    </button>
                    <button
                      className="button secondary"
                      type="button"
                      style={{ margin: 0 }}
                      onClick={() => setShowAddUnidad(false)}
                    >
                      Cancelar
                    </button>
                  </div>
                </form>
              )}

              {loadingUnidades ? (
                <p className="muted">Cargando unidades serializadas…</p>
              ) : unidadesSeriales.length === 0 ? (
                <p className="empty-state">No hay unidades registradas para este equipo.</p>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Número de serie</th>
                        <th>Almacén actual</th>
                        <th>Estado</th>
                        <th>Fecha de ingreso</th>
                      </tr>
                    </thead>
                    <tbody>
                      {unidadesSeriales.map((u) => (
                        <tr key={u.id_unidad}>
                          <td><strong>{u.numero_serie}</strong></td>
                          <td>{u.almacen?.nombre ?? '—'}</td>
                          <td>
                            <span
                              className="category-pill"
                              style={{
                                background: u.estado === 'DISPONIBLE' ? 'var(--color-status-green-bg)' : 'var(--color-status-yellow-bg)',
                                color: u.estado === 'DISPONIBLE' ? 'var(--color-success)' : 'var(--color-warning)'
                              }}
                            >
                              {capitalizar(u.estado.toLowerCase().replace(/_/g, ' '))}
                            </span>
                          </td>
                          <td style={{ fontSize: '0.82rem' }}>
                            {new Date(u.fecha_ingreso).toLocaleDateString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* =================================================================== */
          /* VISTA MODO PALETIZADO */
          /* =================================================================== */
          <>
            {!rule && !editingPacking ? (
              <div style={{ textAlign: 'center', padding: '24px 0' }}>
                <p className="empty-state" style={{ margin: '0 0 18px' }}>
                  Este producto aún no tiene regla de empaque.
                </p>
                <button
                  className="button"
                  type="button"
                  style={{ margin: 0 }}
                  onClick={() => setEditingPacking(true)}
                >
                  + Asignar regla de empaque
                </button>
              </div>
            ) : editingPacking ? (
              <form className="product-form" onSubmit={handleSavePackaging}>
                <h4>{rule ? 'Editar regla de empaque' : 'Asignar regla de empaque'}</h4>
                <fieldset>
                  <legend>{usaPaleta ? 'Empaque y paletizado' : 'Empaque (por caja)'}</legend>
                  <div className="number-grid">
                    <label>
                      Tipo de empaque
                      <select value={formTipo} onChange={(e) => setFormTipo(e.target.value)}>
                        {TIPOS_EMPAQUE.map((t) => (
                          <option key={t.value} value={t.value}>
                            {capitalizar(t.singular)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Unidades por {formSingular}
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={formUnits}
                        onChange={(e) => setFormUnits(e.target.value)}
                        required
                      />
                    </label>
                    {usaPaleta && (
                      <>
                        <label>
                          {capitalizar(formPlural)} por fila
                          <input
                            type="number"
                            min="1"
                            step="1"
                            value={formBoxesLayer}
                            onChange={(e) => setFormBoxesLayer(e.target.value)}
                            required
                          />
                        </label>
                        <label>
                          Filas por paleta
                          <input
                            type="number"
                            min="1"
                            step="1"
                            value={formLayers}
                            onChange={(e) => setFormLayers(e.target.value)}
                            required
                          />
                        </label>
                      </>
                    )}
                  </div>

                  <EmpaqueJerarquia
                    tipoEmpaque={formTipo}
                    unidadesPorEmpaque={formUnits}
                    empaquesPorFila={formBoxesLayer}
                    filasPorPaleta={formLayers}
                    usaPaleta={usaPaleta}
                  />

                  {usaPaleta && (
                    <label style={{ display: 'grid', gap: '6px', margin: '12px 0 0', fontWeight: 600, fontSize: '0.85rem' }}>
                      Notas del patrón de armado (opcional)
                      <input
                        value={formNotes}
                        onChange={(e) => setFormNotes(e.target.value)}
                        placeholder="Ej. 6 cajas horizontales + 2 verticales"
                      />
                    </label>
                  )}

                  <div className="number-grid" style={{ marginTop: '12px' }}>
                    <label>
                      Largo (cm)
                      <input
                        type="number"
                        min="0"
                        step="0.1"
                        value={formLargo}
                        onChange={(e) => setFormLargo(e.target.value)}
                      />
                    </label>
                    <label>
                      Ancho (cm)
                      <input
                        type="number"
                        min="0"
                        step="0.1"
                        value={formAncho}
                        onChange={(e) => setFormAncho(e.target.value)}
                      />
                    </label>
                    <label>
                      Alto (cm)
                      <input
                        type="number"
                        min="0"
                        step="0.1"
                        value={formAlto}
                        onChange={(e) => setFormAlto(e.target.value)}
                      />
                    </label>
                    <label>
                      Peso (kg)
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={formPeso}
                        onChange={(e) => setFormPeso(e.target.value)}
                      />
                    </label>
                  </div>
                </fieldset>

                <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
                  <button className="button" style={{ margin: 0 }} disabled={savingPacking}>
                    {savingPacking ? 'Guardando…' : 'Guardar empaque'}
                  </button>
                  {rule && (
                    <button
                      className="button secondary"
                      type="button"
                      style={{ margin: 0 }}
                      onClick={() => setEditingPacking(false)}
                    >
                      Cancelar
                    </button>
                  )}
                </div>
              </form>
            ) : rule ? (
              <>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '10px' }}>
                  <button
                    className="btn-detail"
                    type="button"
                    onClick={() => setEditingPacking(true)}
                  >
                    ✎ Modificar empaque
                  </button>
                </div>

                <div className="detail-section">
                  <h4>{usaPaleta ? 'Empaque y paletizado' : 'Empaque por caja'}</h4>
                  <EmpaqueJerarquia
                    tipoEmpaque={regla.tipoEmpaque}
                    unidadesPorEmpaque={regla.unidadesPorEmpaque}
                    empaquesPorFila={regla.empaquesPorFila}
                    filasPorPaleta={regla.filasPorPaleta}
                    usaPaleta={usaPaleta}
                  />
                  <div className="detail-stats-grid" style={{ marginTop: '12px' }}>
                    <div className="stat-box">
                      <span>Unidades por {empSingular}</span>
                      <strong>{formatoNumero(regla.unidadesPorEmpaque)}</strong>
                    </div>
                    {usaPaleta ? (
                      <>
                        <div className="stat-box">
                          <span>{capitalizar(empPlural)} por fila</span>
                          <strong>{formatoNumero(regla.empaquesPorFila)}</strong>
                        </div>
                        <div className="stat-box">
                          <span>Filas por paleta</span>
                          <strong>{formatoNumero(regla.filasPorPaleta)}</strong>
                        </div>
                        <div className="stat-box highlight">
                          <span>{capitalizar(empPlural)} por paleta</span>
                          <strong>{formatoNumero(regla.empaquesPorPaleta)}</strong>
                        </div>
                        <div className="stat-box highlight">
                          <span>Unidades por paleta</span>
                          <strong>{formatoNumero(regla.unidadesPorPaleta)}</strong>
                        </div>
                        <div className="stat-box">
                          <span>Regla de orden</span>
                          <strong>Máx. 1 pucho con 1 {empSingular} abierto</strong>
                        </div>
                      </>
                    ) : (
                      <div className="stat-box">
                        <span>Regla de orden</span>
                        <strong>Cajas cerradas + máx. 1 caja abierta</strong>
                      </div>
                    )}
                  </div>
                </div>

                {(rule.largo_caja_cm || rule.ancho_caja_cm || rule.alto_caja_cm || rule.peso_caja_kg) && (
                  <div className="detail-section">
                    <h4>Medidas y volumen</h4>
                    <div className="detail-stats-grid">
                      <div className="stat-box">
                        <span>Medidas de cada {empSingular} (cm)</span>
                        <strong>
                          {rule.largo_caja_cm ?? '—'} × {rule.ancho_caja_cm ?? '—'} × {rule.alto_caja_cm ?? '—'}
                        </strong>
                      </div>
                      <div className="stat-box">
                        <span>Peso de cada {empSingular}</span>
                        <strong>{rule.peso_caja_kg ? `${rule.peso_caja_kg} kg` : '—'}</strong>
                      </div>
                      {usaPaleta && altoPaletaCm !== null && (
                        <div className="stat-box highlight">
                          <span>Alto estimado paleta</span>
                          <strong>{altoPaletaCm.toFixed(1)} cm</strong>
                        </div>
                      )}
                      {volumenCajaM3 !== null && (
                        <div className="stat-box">
                          <span>Volumen de cada {empSingular}</span>
                          <strong>{volumenCajaM3.toFixed(4)} m³</strong>
                        </div>
                      )}
                      {usaPaleta && volumenPaletaM3 !== null && (
                        <div className="stat-box highlight">
                          <span>Volumen de la paleta</span>
                          <strong>{volumenPaletaM3.toFixed(3)} m³</strong>
                        </div>
                      )}
                      {usaPaleta && pesoPaletaKg !== null && (
                        <div className="stat-box highlight">
                          <span>Peso estimado de la paleta</span>
                          <strong>{pesoPaletaKg.toFixed(1)} kg</strong>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {usaPaleta && (
                <div className="detail-section">
                  <h4>Patrón de armado</h4>
                  {rule.notas_armado ? (
                    <p style={{ margin: '0 0 10px', fontSize: '0.92rem', color: 'var(--color-text-primary)' }}>
                      <strong>Instrucciones:</strong> {rule.notas_armado}
                    </p>
                  ) : (
                    <p className="muted" style={{ margin: '0 0 10px', fontSize: '0.85rem' }}>
                      Sin notas específicas de armado registradas.
                    </p>
                  )}

                  {rule.imagen_armado_path ? (
                    <div className="diagram-box">
                      <p style={{ margin: '0 0 10px', fontSize: '0.82rem', color: 'var(--color-text-secondary)' }}>
                        Diagrama almacenado en: <code>{rule.imagen_armado_path}</code>
                      </p>
                      {loadingImage ? (
                        <p className="muted">Cargando esquema desde Supabase Storage…</p>
                      ) : signedImageUrl ? (
                        <div>
                          <img src={signedImageUrl} alt={`Esquema de ${product.sku}`} />
                          <div style={{ marginTop: '10px' }}>
                            <a
                              href={signedImageUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="link-button"
                              style={{ fontSize: '0.82rem' }}
                            >
                              Ver imagen completa en nueva pestaña ↗
                            </a>
                          </div>
                        </div>
                      ) : (
                        <p className="notice" style={{ margin: '10px 0 0' }}>
                          No se pudo generar la URL de lectura de la imagen o no cuentas con los permisos requeridos.
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="muted" style={{ fontSize: '0.85rem' }}>
                      No se ha adjuntado un diagrama de armado para este producto.
                    </p>
                  )}
                </div>
                )}
              </>
            ) : null}
          </>
        )}

        <div style={{ display: 'flex', justifyContent: onDeleteProduct && product ? 'space-between' : 'flex-end', alignItems: 'center', marginTop: '22px', borderTop: '1px solid var(--color-border)', paddingTop: '16px' }}>
          {onDeleteProduct && product && (
            <button
              className="button secondary"
              type="button"
              style={{ color: 'var(--color-danger)', borderColor: 'rgba(179, 64, 42, 0.4)' }}
              onClick={() => {
                const target = product
                onClose()
                onDeleteProduct(target)
              }}
            >
              Eliminar producto
            </button>
          )}
          <button className="button secondary" type="button" onClick={onClose}>
            Cerrar ficha
          </button>
        </div>
      </div>
    </div>
  )
}
