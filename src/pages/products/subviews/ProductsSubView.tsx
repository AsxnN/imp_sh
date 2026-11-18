import { useMemo, useState, type ChangeEvent, type FormEvent } from 'react'
import { logCatalogChange } from '../../../lib/audit'
import { EmpaqueJerarquia } from '../components/EmpaqueJerarquia'
import {
  MODO_INFO,
  TIPOS_EMPAQUE,
  calcularPaleta,
  capitalizar,
  describirEmpaque,
  etiquetaModo,
  formatoNumero,
  leerRegla,
  nombreEmpaque,
  normalizarModo
} from '../empaque'
import { productoRepository } from '../repositories/ProductRepository'
import { getEstrategiaManejo } from '../strategies/RegistroEstrategias'
import {
  getProductRule,
  getProductSerialProfile,
  type Category,
  type PackingFormData,
  type Product,
  type Rule,
  type SerializedFormData
} from '../types'

type Props = {
  products: Product[]
  categories: Category[]
  loading: boolean
  onRefresh: () => void
  onError: (msg: string | null) => void
  onViewDetail: (prod: Product) => void
  onDeleteProduct?: (prod: Product) => void
}

export function ProductsSubView({
  products,
  categories,
  loading,
  onRefresh,
  onError,
  onViewDetail,
  onDeleteProduct
}: Props) {
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Product | null>(null)
  const [saving, setSaving] = useState(false)

  // 1. Campos Generales del Producto
  const [sku, setSku] = useState('')
  const [nombre, setNombre] = useState('')
  const [idCategoria, setIdCategoria] = useState('')
  const [unidadMedida, setUnidadMedida] = useState('UNIDAD')
  const [pesoUnitario, setPesoUnitario] = useState('')
  const [costoUnitario, setCostoUnitario] = useState('')
  const [clasificacionAbc, setClasificacionAbc] = useState('B')
  const [activo, setActivo] = useState(true)

  // 2. Modo de manejo detectado según categoría seleccionada
  const selectedCategory = useMemo(() => {
    return categories.find((c) => String(c.id_categoria) === idCategoria) || null
  }, [categories, idCategoria])

  const currentModo = normalizarModo(selectedCategory?.modo_manejo)
  const isSerializado = currentModo === 'SERIALIZADO'
  const usaPaleta = currentModo === 'PALETIZADO'

  // Categorías seleccionables: solo activas (más la actual si se está editando)
  const selectableCategories = useMemo(
    () => categories.filter((c) => c.activo !== false || String(c.id_categoria) === idCategoria),
    [categories, idCategoria]
  )

  // 3. Campos de empaque: PALETIZADO y POR CAJA
  // (en BD: cajas_por_camada = empaques por fila, numero_camadas = filas por paleta)
  const [tipoEmpaque, setTipoEmpaque] = useState('CAJA')
  const [unidadesPorCaja, setUnidadesPorCaja] = useState('1')
  const [cajasPorCamada, setCajasPorCamada] = useState('1')
  const [numeroCamadas, setNumeroCamadas] = useState('1')
  const [largoCm, setLargoCm] = useState('')
  const [anchoCm, setAnchoCm] = useState('')
  const [altoCm, setAltoCm] = useState('')
  const [pesoCajaKg, setPesoCajaKg] = useState('')
  const [notasArmado, setNotasArmado] = useState('')
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [currentImagePath, setCurrentImagePath] = useState<string | null>(null)

  // 4. Campos específicos: MODO SERIALIZADO
  const [serialPesoKg, setSerialPesoKg] = useState('')
  const [serialLargoCm, setSerialLargoCm] = useState('')
  const [serialAnchoCm, setSerialAnchoCm] = useState('')
  const [serialAltoCm, setSerialAltoCm] = useState('')
  const [serialRequiereIzaje, setSerialRequiereIzaje] = useState(false)
  const [serialUbicacion, setSerialUbicacion] = useState<'CAMPO' | 'RACK' | 'AMBAS'>('AMBAS')
  const [serialNotas, setSerialNotas] = useState('')

  // Filtros de tabla
  const [filterCategory, setFilterCategory] = useState('')
  const [search, setSearch] = useState('')

  const empaqueSingular = nombreEmpaque(tipoEmpaque, 1)
  const empaquePlural = nombreEmpaque(tipoEmpaque, 2)

  // Cálculos en tiempo real del empaque
  const metrics = useMemo(() => {
    const calc = calcularPaleta(unidadesPorCaja, cajasPorCamada, numeroCamadas)
    const l = Number(largoCm) || 0
    const w = Number(anchoCm) || 0
    const h = Number(altoCm) || 0
    const pEmpaque = Number(pesoCajaKg) || 0

    const volCajaM3 = l > 0 && w > 0 && h > 0 ? (l * w * h) / 1000000 : null
    const volPaletaM3 = volCajaM3 ? volCajaM3 * calc.empaquesPorPaleta : null

    // Estimaciones con tarima estándar: +15 cm de alto y +25 kg de peso
    const altoSugeridoCm = h > 0 ? h * calc.filasPorPaleta + 15 : null
    const pesoSugeridoKg = pEmpaque > 0 ? pEmpaque * calc.empaquesPorPaleta + 25 : null

    return { ...calc, volCajaM3, volPaletaM3, altoSugeridoCm, pesoSugeridoKg }
  }, [cajasPorCamada, numeroCamadas, unidadesPorCaja, largoCm, anchoCm, altoCm, pesoCajaKg])

  // Volumen calculado para serializado
  const serialVolumenM3 = useMemo(() => {
    const l = Number(serialLargoCm) || 0
    const w = Number(serialAnchoCm) || 0
    const h = Number(serialAltoCm) || 0
    return l > 0 && w > 0 && h > 0 ? (l * w * h) / 1000000 : null
  }, [serialLargoCm, serialAnchoCm, serialAltoCm])

  const filtered = useMemo(() => {
    return products.filter((p) => {
      const matchCat = filterCategory === '' || String(p.id_categoria) === filterCategory
      const q = search.trim().toLowerCase()
      const matchQ =
        q === '' ||
        p.sku.toLowerCase().includes(q) ||
        (p.nombre ?? p.descripcion).toLowerCase().includes(q)
      return matchCat && matchQ
    })
  }, [products, filterCategory, search])

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files && event.target.files[0]) {
      setImageFile(event.target.files[0])
    } else {
      setImageFile(null)
    }
  }

  function resetForm() {
    setEditing(null)
    setSku('')
    setNombre('')
    setIdCategoria('')
    setUnidadMedida('UNIDAD')
    setPesoUnitario('')
    setCostoUnitario('')
    setClasificacionAbc('B')
    setActivo(true)

    // Reset empaque
    setTipoEmpaque('CAJA')
    setUnidadesPorCaja('1')
    setCajasPorCamada('1')
    setNumeroCamadas('1')
    setLargoCm('')
    setAnchoCm('')
    setAltoCm('')
    setPesoCajaKg('')
    setNotasArmado('')
    setImageFile(null)
    setCurrentImagePath(null)

    // Reset Serializado
    setSerialPesoKg('')
    setSerialLargoCm('')
    setSerialAnchoCm('')
    setSerialAltoCm('')
    setSerialRequiereIzaje(false)
    setSerialUbicacion('AMBAS')
    setSerialNotas('')

    setShowForm(false)
  }

  function calcularSiguienteSkuLocal(): string {
    let maxNum = -1
    const regex = /^SKU-(\d+)$/i

    for (const p of products) {
      if (!p.sku) continue
      const match = p.sku.trim().match(regex)
      if (match) {
        const num = parseInt(match[1], 10)
        if (!isNaN(num) && num > maxNum) {
          maxNum = num
        }
      }
    }

    const nextNum = maxNum >= 0 ? maxNum + 1 : 0
    return `SKU-${String(nextNum).padStart(5, '0')}`
  }

  async function startCreate() {
    resetForm()
    // 1. Asignar de inmediato el correlativo SKU-00000 local
    const localNextSku = calcularSiguienteSkuLocal()
    setSku(localNextSku)
    setShowForm(true)

    // 2. Validar con base de datos por si hubo creaciones concurrentes
    try {
      const dbNextSku = await productoRepository.obtenerSiguienteSku()
      if (dbNextSku) {
        setSku(dbNextSku)
      }
    } catch {
      // Mantiene el calculado localmente
    }
  }

  function startEdit(p: Product) {
    setEditing(p)
    setSku(p.sku)
    setNombre(p.nombre ?? p.descripcion)
    setIdCategoria(p.id_categoria ? String(p.id_categoria) : '')
    setUnidadMedida(p.unidad_medida ?? 'UNIDAD')
    setPesoUnitario(p.peso_unitario_kg ? String(p.peso_unitario_kg) : '')
    setCostoUnitario(p.costo_unitario ? String(p.costo_unitario) : '')
    setClasificacionAbc(p.clasificacion_abc ?? 'B')
    setActivo(p.activo !== false)

    // Cargar perfil según corresponda
    const rule: Rule | null = getProductRule(p)
    if (rule) {
      setTipoEmpaque(rule.tipo_empaque || 'CAJA')
      setUnidadesPorCaja(String(rule.unidades_por_caja ?? 1))
      setCajasPorCamada(String(rule.cajas_por_camada ?? rule.cajas_por_camita ?? 1))
      setNumeroCamadas(String(rule.numero_camadas ?? rule.camitas_por_paleta ?? 1))
      setLargoCm(rule.largo_caja_cm ? String(rule.largo_caja_cm) : '')
      setAnchoCm(rule.ancho_caja_cm ? String(rule.ancho_caja_cm) : '')
      setAltoCm(rule.alto_caja_cm ? String(rule.alto_caja_cm) : '')
      setPesoCajaKg(rule.peso_caja_kg ? String(rule.peso_caja_kg) : '')
      setNotasArmado(rule.notas_armado ?? '')
      setCurrentImagePath(rule.imagen_armado_path ?? null)
    } else {
      setTipoEmpaque('CAJA')
      setUnidadesPorCaja('1')
      setCajasPorCamada('1')
      setNumeroCamadas('1')
      setLargoCm('')
      setAnchoCm('')
      setAltoCm('')
      setPesoCajaKg('')
      setNotasArmado('')
      setCurrentImagePath(null)
    }

    const serialProfile = getProductSerialProfile(p)
    if (serialProfile) {
      setSerialPesoKg(serialProfile.peso_unitario_kg ? String(serialProfile.peso_unitario_kg) : '')
      setSerialLargoCm(serialProfile.largo_cm ? String(serialProfile.largo_cm) : '')
      setSerialAnchoCm(serialProfile.ancho_cm ? String(serialProfile.ancho_cm) : '')
      setSerialAltoCm(serialProfile.alto_cm ? String(serialProfile.alto_cm) : '')
      setSerialRequiereIzaje(serialProfile.requiere_equipo_izaje ?? false)
      setSerialUbicacion(serialProfile.ubicacion_permitida || 'AMBAS')
      setSerialNotas(serialProfile.notas ?? '')
    } else {
      setSerialPesoKg(p.peso_unitario_kg ? String(p.peso_unitario_kg) : '')
      setSerialLargoCm('')
      setSerialAnchoCm('')
      setSerialAltoCm('')
      setSerialRequiereIzaje(false)
      setSerialUbicacion('AMBAS')
      setSerialNotas('')
    }

    setImageFile(null)
    setShowForm(true)
    window.scrollTo({ top: 100, behavior: 'smooth' })
  }

  async function handleSave(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const skuClean = sku.trim()
    const nombreClean = nombre.trim()

    if (!skuClean || !nombreClean) {
      onError('El SKU y el nombre del producto son obligatorios.')
      return
    }
    if (!idCategoria) {
      onError('Selecciona una categoría: define cómo se maneja el producto (paletizado, por caja o serializado).')
      return
    }

    setSaving(true)
    onError(null)

    try {
      // 1. Guardar o actualizar registro base en producto
      const productPayload: Partial<Product> = {
        sku: skuClean,
        nombre: nombreClean,
        descripcion: nombreClean,
        id_categoria: idCategoria ? Number(idCategoria) : null,
        unidad_medida: unidadMedida.trim() || 'UNIDAD',
        peso_unitario_kg: isSerializado
          ? (serialPesoKg ? Number(serialPesoKg) : null)
          : (pesoUnitario ? Number(pesoUnitario) : null),
        costo_unitario: costoUnitario ? Number(costoUnitario) : null,
        clasificacion_abc: clasificacionAbc || null,
        activo
      }

      if (editing?.id_producto) {
        productPayload.id_producto = editing.id_producto
      }

      const savedProduct = await productoRepository.guardar(productPayload)
      const targetId = savedProduct.id_producto

      // 2. Persistir perfil específico a través de la Estrategia correspondiente
      const strategy = getEstrategiaManejo(currentModo)

      if (isSerializado) {
        const serialData: SerializedFormData = {
          peso_unitario_kg: serialPesoKg,
          largo_cm: serialLargoCm,
          ancho_cm: serialAnchoCm,
          alto_cm: serialAltoCm,
          requiere_equipo_izaje: serialRequiereIzaje,
          ubicacion_permitida: serialUbicacion,
          atributos: {},
          notas: serialNotas
        }
        await strategy.guardarPerfil(targetId, serialData)
      } else {
        const packingData: PackingFormData = {
          tipo_empaque: tipoEmpaque,
          unidades_por_caja: unidadesPorCaja,
          cajas_por_camada: cajasPorCamada,
          numero_camadas: numeroCamadas,
          permite_puchos: usaPaleta,
          notas_armado: notasArmado,
          largo_caja_cm: largoCm,
          ancho_caja_cm: anchoCm,
          alto_caja_cm: altoCm,
          peso_caja_kg: pesoCajaKg
        }
        await strategy.guardarPerfil(targetId, packingData, imageFile)
      }

      await logCatalogChange({
        tabla: 'producto',
        operacion: editing ? 'UPDATE' : 'INSERT',
        id_registro: Number(targetId),
        datos_nuevos: { producto: productPayload, modo: currentModo }
      })

      resetForm()
      onRefresh()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error inesperado al guardar el producto.'
      onError(msg)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="panel master-section">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
        <div>
          <h3 style={{ margin: 0 }}>Productos y empaque</h3>
          <p className="muted" style={{ margin: '4px 0 0', fontSize: '0.85rem' }}>
            La categoría define cómo se maneja cada producto: paletizado, por caja o serializado.
          </p>
        </div>
        {!showForm && (
          <button className="button" style={{ margin: 0 }} type="button" onClick={startCreate}>
            + Registrar producto
          </button>
        )}
      </div>

      {/* Formulario Unificado Dinámico */}
      {showForm && (
        <div style={{ marginTop: '20px', padding: '24px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '6px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h4 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--color-text-primary)' }}>
              {editing ? `Editar producto: ${editing.sku}` : 'Registrar nuevo producto'}
            </h4>
            {selectedCategory && (
              <span className="modo-pill" title={MODO_INFO[currentModo].resumen}>
                Modo: {MODO_INFO[currentModo].label}
              </span>
            )}
          </div>

          <form className="product-form" onSubmit={handleSave}>
            {/* Bloque 1: Datos Comunes */}
            <fieldset>
              <legend>1. Datos generales del producto</legend>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
                <label>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>SKU (obligatorio y correlativo)</span>
                    {!editing && (
                      <button
                        type="button"
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: 'var(--color-brand)',
                          fontSize: '0.75rem',
                          cursor: 'pointer',
                          padding: 0,
                          textDecoration: 'underline'
                        }}
                        onClick={async () => {
                          const local = calcularSiguienteSkuLocal()
                          setSku(local)
                          try {
                            const remote = await productoRepository.obtenerSiguienteSku()
                            if (remote) setSku(remote)
                          } catch {
                            // Mantiene local
                          }
                        }}
                      >
                        ⚡ Siguiente SKU
                      </button>
                    )}
                  </div>
                  <input
                    value={sku}
                    onChange={(e) => setSku(e.target.value.toUpperCase())}
                    placeholder="Ej. SKU-00000"
                    required
                  />
                  <span style={{ fontSize: '0.72rem', color: 'var(--color-text-secondary)', display: 'block', marginTop: '2px' }}>
                    Formato: SKU-00000 en adelante
                  </span>
                </label>

                <label>
                  Nombre / Descripción (obligatorio)
                  <input
                    value={nombre}
                    onChange={(e) => setNombre(e.target.value)}
                    placeholder="Ej. Generador Diésel 5.5 kVA"
                    required
                  />
                </label>

                <label>
                  Categoría (define el modo de manejo)
                  <select value={idCategoria} onChange={(e) => setIdCategoria(e.target.value)} required>
                    <option value="">Selecciona una categoría</option>
                    {selectableCategories.map((c) => (
                      <option key={c.id_categoria} value={String(c.id_categoria)}>
                        {c.nombre} — {etiquetaModo(c.modo_manejo)}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  Unidad de medida
                  <select value={unidadMedida} onChange={(e) => setUnidadMedida(e.target.value)}>
                    <option value="UNIDAD">UNIDAD</option>
                    <option value="PIEZA">PIEZA</option>
                    <option value="EQUIPO">EQUIPO</option>
                    <option value="CAJA">CAJA</option>
                    <option value="ROLLO">ROLLO</option>
                    <option value="SET">SET</option>
                    <option value="METRO">METRO</option>
                  </select>
                </label>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px', marginTop: '12px' }}>
                {!isSerializado && (
                  <label>
                    Peso unitario suelto (kg)
                    <input
                      type="number"
                      step="0.001"
                      min="0"
                      value={pesoUnitario}
                      onChange={(e) => setPesoUnitario(e.target.value)}
                      placeholder="0.250"
                    />
                  </label>
                )}

                <label>
                  Costo unitario ($)
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={costoUnitario}
                    onChange={(e) => setCostoUnitario(e.target.value)}
                    placeholder="120.00"
                  />
                </label>

                <label>
                  Clasificación ABC
                  <select value={clasificacionAbc} onChange={(e) => setClasificacionAbc(e.target.value)}>
                    <option value="A">Clase A (Alta rotación/valor 80%)</option>
                    <option value="B">Clase B (Rotación media 15%)</option>
                    <option value="C">Clase C (Baja rotación 5%)</option>
                  </select>
                </label>

                <label className="check" style={{ marginTop: '26px' }}>
                  <input
                    type="checkbox"
                    checked={activo}
                    onChange={(e) => setActivo(e.target.checked)}
                  />
                  Producto activo en el catálogo
                </label>
              </div>
            </fieldset>

            {/* Bloque 2 Dinámico: Paletizado vs Serializado */}
            {isSerializado ? (
              <fieldset style={{ marginTop: '16px' }}>
                <legend>2. Ficha técnica del equipo (serializado)</legend>
                <p className="muted" style={{ margin: '0 0 12px', fontSize: '0.85rem' }}>
                  Cada unidad se identifica por su número de serie de fábrica. No lleva tag RFID, empaque, paletas ni puchos.
                </p>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px' }}>
                  <label>
                    Peso del equipo (kg)
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      value={serialPesoKg}
                      onChange={(e) => setSerialPesoKg(e.target.value)}
                      placeholder="Ej. 185.5"
                    />
                  </label>

                  <label>
                    Largo (cm)
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      value={serialLargoCm}
                      onChange={(e) => setSerialLargoCm(e.target.value)}
                      placeholder="90.0"
                    />
                  </label>

                  <label>
                    Ancho (cm)
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      value={serialAnchoCm}
                      onChange={(e) => setSerialAnchoCm(e.target.value)}
                      placeholder="60.0"
                    />
                  </label>

                  <label>
                    Alto (cm)
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      value={serialAltoCm}
                      onChange={(e) => setSerialAltoCm(e.target.value)}
                      placeholder="75.0"
                    />
                  </label>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px', marginTop: '12px' }}>
                  <label>
                    Ubicación permitida en almacén
                    <select
                      value={serialUbicacion}
                      onChange={(e) => setSerialUbicacion(e.target.value as 'CAMPO' | 'RACK' | 'AMBAS')}
                    >
                      <option value="AMBAS">Ambas (Campo libre o rack reforzado)</option>
                      <option value="CAMPO">Solo Campo / Piso libre (Sobredimensionado)</option>
                      <option value="RACK">Solo Estantería Rack (Dimensiones estándar)</option>
                    </select>
                  </label>

                  <label className="check" style={{ marginTop: '26px' }}>
                    <input
                      type="checkbox"
                      checked={serialRequiereIzaje}
                      onChange={(e) => setSerialRequiereIzaje(e.target.checked)}
                    />
                    Requiere equipo de izaje mecánico (grúa / montacargas pesado)
                  </label>
                </div>

                {serialVolumenM3 && (
                  <div className="metrics" style={{ marginTop: '12px' }}>
                    <span>Volumen unitario: {serialVolumenM3.toFixed(3)} m³</span>
                    <span>Dimensiones: {serialLargoCm} × {serialAnchoCm} × {serialAltoCm} cm</span>
                    {serialPesoKg && <strong>Peso: {serialPesoKg} kg</strong>}
                  </div>
                )}

                <label style={{ display: 'grid', gap: '6px', margin: '12px 0 0', fontWeight: 600, fontSize: '0.85rem' }}>
                  Notas técnicas y de mantenimiento
                  <input
                    value={serialNotas}
                    onChange={(e) => setSerialNotas(e.target.value)}
                    placeholder="Ej. Requiere chequeo de aceite hidráulico antes de despacho."
                  />
                </label>
              </fieldset>
            ) : (
              <fieldset style={{ marginTop: '16px' }}>
                <legend>{usaPaleta ? '2. Empaque y paletizado' : '2. Empaque (por caja, sin paletizar)'}</legend>
                <p className="muted" style={{ margin: '0 0 12px', fontSize: '0.85rem' }}>
                  {usaPaleta
                    ? `Las paletas completas siempre van cerradas. Solo el pucho puede tener 1 ${empaqueSingular} abierto.`
                    : `Se controla por empaques cerrados y 1 empaque abierto como máximo. No lleva paletas ni tag RFID.`}
                </p>

                <div className="number-grid">
                  <label>
                    Tipo de empaque
                    <select value={tipoEmpaque} onChange={(e) => setTipoEmpaque(e.target.value)}>
                      {TIPOS_EMPAQUE.map((t) => (
                        <option key={t.value} value={t.value}>
                          {capitalizar(t.singular)}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    Unidades por {empaqueSingular}
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={unidadesPorCaja}
                      onChange={(e) => setUnidadesPorCaja(e.target.value)}
                      required
                    />
                  </label>

                  {usaPaleta && (
                    <>
                      <label>
                        {capitalizar(empaquePlural)} por fila
                        <input
                          type="number"
                          min="1"
                          step="1"
                          value={cajasPorCamada}
                          onChange={(e) => setCajasPorCamada(e.target.value)}
                          required
                        />
                      </label>

                      <label>
                        Filas por paleta
                        <input
                          type="number"
                          min="1"
                          step="1"
                          value={numeroCamadas}
                          onChange={(e) => setNumeroCamadas(e.target.value)}
                          required
                        />
                      </label>
                    </>
                  )}
                </div>

                <EmpaqueJerarquia
                  tipoEmpaque={tipoEmpaque}
                  unidadesPorEmpaque={unidadesPorCaja}
                  empaquesPorFila={cajasPorCamada}
                  filasPorPaleta={numeroCamadas}
                  usaPaleta={usaPaleta}
                />

                <p style={{ margin: '14px 0 6px', fontWeight: 600, fontSize: '0.86rem', color: 'var(--color-text-primary)' }}>
                  Medidas y peso de {usaPaleta ? `cada ${empaqueSingular}` : 'cada caja'} (opcional)
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '10px' }}>
                  <label>
                    Largo (cm)
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      value={largoCm}
                      onChange={(e) => setLargoCm(e.target.value)}
                      placeholder="40.0"
                    />
                  </label>
                  <label>
                    Ancho (cm)
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      value={anchoCm}
                      onChange={(e) => setAnchoCm(e.target.value)}
                      placeholder="30.0"
                    />
                  </label>
                  <label>
                    Alto (cm)
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      value={altoCm}
                      onChange={(e) => setAltoCm(e.target.value)}
                      placeholder="25.0"
                    />
                  </label>
                  <label>
                    Peso (kg)
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={pesoCajaKg}
                      onChange={(e) => setPesoCajaKg(e.target.value)}
                      placeholder="12.5"
                    />
                  </label>
                </div>

                {usaPaleta && (
                  <>
                    <div className="detail-stats-grid" style={{ marginTop: '12px' }}>
                      <div className="stat-box">
                        <span>Alto estimado de la paleta</span>
                        <strong>{metrics.altoSugeridoCm ? `${metrics.altoSugeridoCm.toFixed(1)} cm` : '—'}</strong>
                        <span>{altoCm || 0} cm × {metrics.filasPorPaleta} filas + 15 cm de tarima</span>
                      </div>
                      <div className="stat-box">
                        <span>Peso estimado de la paleta</span>
                        <strong>{metrics.pesoSugeridoKg ? `${metrics.pesoSugeridoKg.toFixed(1)} kg` : '—'}</strong>
                        <span>{pesoCajaKg || 0} kg × {metrics.empaquesPorPaleta} {empaquePlural} + 25 kg de tarima</span>
                      </div>
                      <div className="stat-box">
                        <span>Volumen de la paleta</span>
                        <strong>{metrics.volPaletaM3 ? `${metrics.volPaletaM3.toFixed(3)} m³` : '—'}</strong>
                        <span>{metrics.volCajaM3 ? `${metrics.volCajaM3.toFixed(4)} m³ por ${empaqueSingular}` : 'Ingresa las medidas'}</span>
                      </div>
                    </div>

                    <label style={{ display: 'grid', gap: '6px', margin: '12px 0 0', fontWeight: 600, fontSize: '0.85rem' }}>
                      Notas del patrón de armado (opcional)
                      <input
                        value={notasArmado}
                        onChange={(e) => setNotasArmado(e.target.value)}
                        placeholder="Ej. Traba 3x2, orientar etiquetas hacia el exterior"
                      />
                    </label>

                    <label style={{ display: 'grid', gap: '6px', margin: '12px 0 0', fontWeight: 600, fontSize: '0.85rem' }}>
                      Diagrama del armado (PNG, JPG o WebP)
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/svg+xml"
                        onChange={handleFileChange}
                      />
                      {imageFile ? (
                        <span style={{ fontSize: '0.8rem', color: 'var(--color-success)' }}>
                          Archivo nuevo: {imageFile.name}
                        </span>
                      ) : currentImagePath ? (
                        <span style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)' }}>
                          Diagrama guardado: {currentImagePath}
                        </span>
                      ) : null}
                    </label>
                  </>
                )}
              </fieldset>
            )}

            <div style={{ display: 'flex', gap: '10px', marginTop: '18px' }}>
              <button className="button" style={{ margin: 0 }} disabled={saving}>
                {saving ? 'Guardando…' : editing ? 'Guardar cambios' : 'Guardar producto'}
              </button>
              <button className="button secondary" type="button" style={{ margin: 0 }} onClick={resetForm}>
                Cancelar
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Controles de Búsqueda y Filtros de la Tabla */}
      <div className="table-controls" style={{ marginTop: '20px' }}>
        <div className="filter-group">
          <label htmlFor="p-cat">Filtrar por categoría:</label>
          <select id="p-cat" value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}>
            <option value="">Todas las categorías ({products.length})</option>
            {categories
              .filter((c) => c.activo !== false || products.some((p) => String(p.id_categoria) === String(c.id_categoria)))
              .map((c) => (
                <option key={c.id_categoria} value={String(c.id_categoria)}>
                  {c.nombre}
                </option>
              ))}
          </select>
        </div>

        <div className="search-group">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por SKU o nombre de producto…"
          />
          {(filterCategory !== '' || search !== '') && (
            <button
              className="button secondary"
              style={{ padding: '6px 12px', fontSize: '0.8rem', margin: 0 }}
              type="button"
              onClick={() => {
                setFilterCategory('')
                setSearch('')
              }}
            >
              Restablecer
            </button>
          )}
        </div>
      </div>

      {/* Tabla Unificada Adaptativa según Modo de Manejo */}
      {loading ? (
        <p className="muted">Cargando productos y especificaciones…</p>
      ) : filtered.length === 0 ? (
        <p className="empty-state">No se encontraron productos registrados.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>SKU</th>
                <th>Nombre</th>
                <th>Categoría y modo</th>
                <th>Unidad y costo</th>
                <th>ABC</th>
                <th>Empaque</th>
                <th>Medidas y volumen</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const modoProd = normalizarModo(p.categoria?.modo_manejo)
                const esSerial = modoProd === 'SERIALIZADO'
                const esPaletizado = modoProd === 'PALETIZADO'
                const rule = getProductRule(p)
                const serialProfile = getProductSerialProfile(p)
                const r = leerRegla(rule)
                const nCamadas = r.filasPorPaleta

                return (
                  <tr key={p.id_producto}>
                    <td><span className="sku-badge">{p.sku}</span></td>
                    <td><strong>{p.nombre ?? p.descripcion}</strong></td>
                    <td>
                      <div><span className="category-pill">{p.categoria?.nombre ?? 'Sin categoría'}</span></div>
                      <span className="modo-pill" style={{ marginTop: '4px' }}>{etiquetaModo(modoProd)}</span>
                    </td>
                    <td>
                      <div>{p.unidad_medida ?? 'UNIDAD'}</div>
                      <span style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)' }}>
                        {p.costo_unitario ? `$${Number(p.costo_unitario).toFixed(2)}` : '—'}
                      </span>
                    </td>
                    <td>
                      <span style={{
                        fontWeight: 700,
                        color: p.clasificacion_abc === 'A' ? 'var(--color-success)' : p.clasificacion_abc === 'B' ? 'var(--color-warning)' : 'var(--color-text-secondary)'
                      }}>
                        {p.clasificacion_abc ?? 'B'}
                      </span>
                    </td>
                    <td>
                      {esSerial ? (
                        <div>
                          <span style={{ fontWeight: 600 }}>Por número de serie</span>
                          {serialProfile?.requiere_equipo_izaje && (
                            <span className="category-pill" style={{ marginLeft: '6px' }}>
                              Requiere izaje
                            </span>
                          )}
                          <div style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)' }}>
                            Ubicación: {serialProfile?.ubicacion_permitida || 'AMBAS'}
                          </div>
                        </div>
                      ) : rule ? (
                        <div>
                          <span>{describirEmpaque(rule, modoProd)}</span>
                          {esPaletizado && (
                            <div style={{ fontSize: '0.8rem', color: 'var(--color-brand)', fontWeight: 600 }}>
                              1 paleta = {formatoNumero(r.empaquesPorPaleta)} {nombreEmpaque(r.tipoEmpaque)} · {formatoNumero(r.unidadesPorPaleta)} u
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="muted" style={{ fontSize: '0.8rem' }}>Sin empaque asignado</span>
                      )}
                    </td>
                    <td>
                      {esSerial ? (
                        <div style={{ fontSize: '0.82rem' }}>
                          {serialProfile?.largo_cm && serialProfile?.ancho_cm && serialProfile?.alto_cm ? (
                            <div>{serialProfile.largo_cm}×{serialProfile.ancho_cm}×{serialProfile.alto_cm} cm</div>
                          ) : '—'}
                          {serialProfile?.peso_unitario_kg ? (
                            <div style={{ color: 'var(--color-brand)', fontWeight: 600 }}>
                              Peso: {serialProfile.peso_unitario_kg} kg
                            </div>
                          ) : null}
                        </div>
                      ) : !esPaletizado ? (
                        rule?.largo_caja_cm && rule?.ancho_caja_cm && rule?.alto_caja_cm ? (
                          <div style={{ fontSize: '0.82rem' }}>
                            Caja: {rule.largo_caja_cm}×{rule.ancho_caja_cm}×{rule.alto_caja_cm} cm
                          </div>
                        ) : '—'
                      ) : rule?.volumen_total_m3 || (rule?.alto_caja_cm && nCamadas) ? (
                        <div style={{ fontSize: '0.82rem' }}>
                          {rule.alto_caja_cm && nCamadas ? <div>Alto: {(rule.alto_caja_cm * nCamadas + 15).toFixed(0)} cm</div> : null}
                          {rule.volumen_total_m3 ? <div style={{ color: 'var(--color-brand)', fontWeight: 600 }}>Vol: {Number(rule.volumen_total_m3).toFixed(3)} m³</div> : null}
                        </div>
                      ) : '—'}
                    </td>
                    <td>
                      <span className={p.activo !== false ? 'category-pill' : 'category-pill muted'}>
                        {p.activo !== false ? 'Activo' : 'Inactivo'}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button className="btn-detail" type="button" onClick={() => startEdit(p)}>
                          Editar
                        </button>
                        <button className="btn-detail" type="button" onClick={() => onViewDetail(p)}>
                          Ver ficha
                        </button>
                        {onDeleteProduct && (
                          <button
                            className="btn-detail"
                            type="button"
                            style={{
                              color: 'var(--color-danger)',
                              borderColor: 'rgba(179, 64, 42, 0.3)'
                            }}
                            onClick={() => onDeleteProduct(p)}
                            title={`Eliminar producto ${p.sku}`}
                          >
                            Eliminar
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
    </section>
  )
}
