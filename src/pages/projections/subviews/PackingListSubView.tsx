import { useEffect, useMemo, useState } from 'react'
import type {
  OrderPackingPlan,
  PackingMode,
  PalletTagItem,
  ProductPackingSummary,
  PuchoConsolidationItem
} from '../../../services/packingListService'
import { packingListService } from '../../../services/packingListService'
import { PalletStickerModal, type PalletStickerData } from '../../../components/PalletStickerModal'

interface PackingListSubViewProps {
  plan: OrderPackingPlan
  onBack: () => void
  onOpenReceptions?: () => void
}

type Pestana = 'productos' | 'codigos' | 'contingencia'
type FiltroTipo = 'TODOS' | 'COMPLETO' | 'PUCHO'

const MODO_LABEL: Record<PackingMode, string> = {
  PALETIZADO: 'Paletizado',
  PICKING_CAJA: 'Por caja',
  SERIALIZADO: 'Serializado'
}

const CONTENEDOR_LABEL: Record<string, string> = {
  '40FT': '40 pies',
  '20FT': '20 pies',
  LCL: 'Carga consolidada'
}

const EMPAQUE_PLURAL: Record<string, [string, string]> = {
  CAJA: ['caja', 'cajas'],
  PAQUETE: ['paquete', 'paquetes'],
  BOLSA: ['bolsa', 'bolsas'],
  ROLLO: ['rollo', 'rollos'],
  FARDO: ['fardo', 'fardos']
}

const fmt = (n: number) => n.toLocaleString('es-PE')
const modoDe = (p: ProductPackingSummary): PackingMode => p.modo ?? 'PALETIZADO'
const empaque = (p: ProductPackingSummary, n: number) => {
  const [s, pl] = EMPAQUE_PLURAL[(p.tipo_empaque || 'CAJA').toUpperCase()] ?? EMPAQUE_PLURAL.CAJA
  return n === 1 ? s : pl
}

/** Agrupa códigos consecutivos: IMP00001, IMP00002, IMP00003 → "IMP00001 – IMP00003" */
function rangosDeCodigos(tags: string[]): string[] {
  const out: string[] = []
  let ini = 0
  const num = (t: string) => Number(t.replace(/\D/g, ''))
  const pre = (t: string) => t.replace(/\d+$/, '')
  for (let i = 1; i <= tags.length; i++) {
    const corte =
      i === tags.length || pre(tags[i]) !== pre(tags[i - 1]) || num(tags[i]) !== num(tags[i - 1]) + 1
    if (corte) {
      out.push(i - 1 === ini ? tags[ini] : `${tags[ini]} – ${tags[i - 1]}`)
      ini = i
    }
  }
  return out
}

function desglose(p: ProductPackingSummary): string {
  const modo = modoDe(p)
  if (modo === 'SERIALIZADO') return `${fmt(p.cantidad_pedida)} ${p.cantidad_pedida === 1 ? 'equipo' : 'equipos'} con número de serie`
  if (p.sin_regla) return 'Falta la regla de empaque'
  if (modo === 'PICKING_CAJA') {
    const completas = p.unidades_pucho > 0 ? p.cajas_totales - 1 : p.cajas_totales
    return p.unidades_pucho > 0
      ? `${fmt(completas)} ${empaque(p, completas)} cerradas + 1 con ${fmt(p.unidades_pucho)} u`
      : `${fmt(p.cajas_totales)} ${empaque(p, p.cajas_totales)} cerradas`
  }
  const partes: string[] = []
  if (p.paletas_completas > 0) partes.push(`${p.paletas_completas} ${p.paletas_completas === 1 ? 'paleta completa' : 'paletas completas'}`)
  if (p.cajas_pucho > 0) partes.push(`pucho de ${p.cajas_pucho} ${empaque(p, p.cajas_pucho)}`)
  return partes.join(' + ') || '—'
}

export function PackingListSubView({ plan, onBack, onOpenReceptions }: PackingListSubViewProps) {
  const [pestana, setPestana] = useState<Pestana>('productos')
  const [busqueda, setBusqueda] = useState('')
  const [filtroTipo, setFiltroTipo] = useState<FiltroTipo>('TODOS')
  const [copiado, setCopiado] = useState<string | null>(null)
  const [sticker, setSticker] = useState<PalletStickerData | null>(null)
  const [consolidaciones, setConsolidaciones] = useState<PuchoConsolidationItem[]>([])

  useEffect(() => {
    let vivo = true
    packingListService
      .detectWarehousePuchosForPlan(plan.productos, plan.prefijo_almacen)
      .then((r) => vivo && setConsolidaciones(r))
      .catch(() => vivo && setConsolidaciones([]))
    return () => {
      vivo = false
    }
  }, [plan])

  const consolidacionPorProducto = useMemo(
    () => new Map(consolidaciones.map((c) => [c.id_producto, c])),
    [consolidaciones]
  )

  const sinRegla = useMemo(() => plan.productos.filter((p) => p.sin_regla), [plan])
  const totalSeries = plan.total_series ?? plan.productos.filter((p) => modoDe(p) === 'SERIALIZADO').reduce((a, p) => a + p.cantidad_pedida, 0)
  const totalCajasSueltas =
    plan.total_cajas_sueltas ?? plan.productos.filter((p) => modoDe(p) === 'PICKING_CAJA').reduce((a, p) => a + p.cajas_totales, 0)
  const totalCodigos = plan.etiquetas_bultos.length + plan.etiquetas_reserva.length

  const codigosFiltrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    return plan.etiquetas_bultos.filter((t) => {
      const okTipo = filtroTipo === 'TODOS' || t.tipo === filtroTipo
      const okTexto = !q || t.uid_tag.toLowerCase().includes(q) || t.nombre.toLowerCase().includes(q) || t.sku.toLowerCase().includes(q)
      return okTipo && okTexto
    })
  }, [plan, busqueda, filtroTipo])

  const copiar = (texto: string, clave: string) => {
    void navigator.clipboard.writeText(texto)
    setCopiado(clave)
    window.setTimeout(() => setCopiado(null), 2000)
  }

  const abrirSticker = (t: PalletTagItem) => {
    setSticker({
      almacenNombre: `Almacén ${plan.prefijo_almacen}`,
      empresa: 'SHALOM',
      tagRfid: t.uid_tag,
      ordenNumero: plan.numero_orden,
      sku: t.sku,
      productoNombre: t.nombre,
      cajas: t.cajas,
      unidades: t.unidades,
      cajasPorCamada: null,
      camadas: null,
      pesoTotalKg: null,
      pareto: 'CLASE B',
      fecha: plan.fecha_emision
    })
  }

  const contenedor = CONTENEDOR_LABEL[plan.contenedor] ?? plan.contenedor
  const atenciones = sinRegla.length + consolidaciones.length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Encabezado */}
      <header className="page-heading" style={{ flexWrap: 'wrap' }}>
        <div>
          <button type="button" className="link-back no-print" onClick={onBack} style={{ padding: 0, marginBottom: '8px' }}>
            ← Volver a la orden
          </button>
          <p className="eyebrow">Orden {plan.numero_orden} · Fase 4 de 8</p>
          <h1 style={{ margin: '0 0 6px', fontSize: '30px', fontFamily: 'var(--font-display)', fontWeight: 600, color: 'var(--color-brand-deep-text)' }}>
            Packing list
          </h1>
          <p className="muted" style={{ margin: 0 }}>
            {plan.proveedor} · {contenedor} · emitida el {plan.fecha_emision} · llega al almacén <strong>{plan.prefijo_almacen}</strong>
          </p>
        </div>

        <div className="no-print" style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
          {onOpenReceptions && (
            <button type="button" className="button secondary" onClick={onOpenReceptions}>
              Ir a recepciones
            </button>
          )}
          <button type="button" className="button secondary" onClick={() => window.print()}>
            Imprimir
          </button>
          <button type="button" className="button primary" onClick={() => packingListService.exportPackingListToExcel(plan)}>
            Descargar Excel
          </button>
        </div>
      </header>

      {/* Indicadores */}
      <section className="indicator-strip" aria-label="Resumen del embarque">
        <div className="indicator-card">
          <span className="indicator-label">Unidades</span>
          <span className="indicator-value">{fmt(plan.total_unidades)}</span>
          <span className="indicator-context">
            {plan.productos.length} {plan.productos.length === 1 ? 'producto' : 'productos'}
            {plan.peso_total_kg ? ` · ${fmt(Math.round(plan.peso_total_kg))} kg aprox.` : ''}
          </span>
        </div>
        <div className="indicator-card">
          <span className="indicator-label">Paletas a recibir</span>
          <span className="indicator-value">{fmt(plan.total_bultos_previstos)}</span>
          <span className="indicator-context">
            {plan.total_paletas_completas} completas · {plan.total_puchos} {plan.total_puchos === 1 ? 'pucho' : 'puchos'}
          </span>
        </div>
        <div className="indicator-card">
          <span className="indicator-label">Cajas sin paletizar</span>
          <span className="indicator-value">{fmt(totalCajasSueltas)}</span>
          <span className="indicator-context">Productos que se controlan por caja</span>
        </div>
        <div className="indicator-card">
          <span className="indicator-label">Equipos con serie</span>
          <span className="indicator-value">{fmt(totalSeries)}</span>
          <span className="indicator-context">Se registra la serie al recibir</span>
        </div>
        <div className="indicator-card">
          <span className="indicator-label">Códigos reservados</span>
          <span className="indicator-value">{fmt(totalCodigos)}</span>
          <span className="indicator-context">
            {plan.etiquetas_bultos.length} de paleta + {plan.etiquetas_reserva.length} de contingencia
          </span>
        </div>
      </section>

      {/* Atención requerida */}
      {atenciones > 0 && (
        <section className="attention-panel" aria-label="Atención requerida">
          <div className="attention-panel-header">
            <h2 style={{ margin: 0, fontSize: '20px', fontFamily: 'var(--font-display)', fontWeight: 600 }}>Atención requerida</h2>
            <span className="muted">{atenciones} {atenciones === 1 ? 'punto' : 'puntos'}</span>
          </div>
          <div className="attention-list">
            {sinRegla.map((p) => (
              <div key={`regla-${p.id_producto}-${p.nombre}`} className="attention-item" style={{ borderLeft: '3px solid var(--color-danger)' }}>
                <div className="attention-item-content">
                  <span className="attention-item-module">Falta regla de empaque</span>
                  <span className="attention-item-desc">
                    <strong>{p.nombre}</strong> no tiene {modoDe(p) === 'PICKING_CAJA' ? 'unidades por caja' : 'unidades por empaque ni empaques por paleta'}.
                    No se le asignaron códigos de paleta. Complétala en Maestros y empaque.
                  </span>
                </div>
              </div>
            ))}
            {consolidaciones.map((c) => (
              <div key={`pucho-${c.id_producto}`} className="attention-item" style={{ borderLeft: '3px solid var(--color-warning)' }}>
                <div className="attention-item-content">
                  <span className="attention-item-module">
                    Unir pucho · {c.titulo_caso} ({c.badge_texto})
                  </span>
                  <span className="attention-item-desc">
                    <strong>{c.nombre}</strong>: ya hay un pucho de {c.cajas_existentes} cajas en {c.ubicacion_existente} ({c.tag_existente}). {c.instruccion}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Pestañas */}
      <nav className="module-tabs no-print" aria-label="Secciones del packing list">
        <button type="button" className={pestana === 'productos' ? 'active' : ''} onClick={() => setPestana('productos')}>
          Por producto ({plan.productos.length})
        </button>
        <button type="button" className={pestana === 'codigos' ? 'active' : ''} onClick={() => setPestana('codigos')}>
          Códigos de paleta ({plan.etiquetas_bultos.length})
        </button>
        <button type="button" className={pestana === 'contingencia' ? 'active' : ''} onClick={() => setPestana('contingencia')}>
          Contingencia ({plan.etiquetas_reserva.length})
        </button>
      </nav>

      {/* Por producto */}
      {pestana === 'productos' && (
        <section className="panel" aria-label="Desglose por producto">
          <div style={{ marginBottom: '14px' }}>
            <h2 style={{ margin: 0, fontSize: '20px', fontFamily: 'var(--font-display)', fontWeight: 600 }}>Cómo llega cada producto</h2>
            <p className="muted" style={{ margin: '4px 0 0' }}>
              Calculado con la regla de empaque del catálogo. Solo las paletas llevan tag RFID; lo que va por caja se cuenta y la maquinaria se identifica por su serie.
            </p>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Modo</th>
                  <th className="num-col">Unidades</th>
                  <th>Empaque</th>
                  <th>Llega como</th>
                  <th className="num-col">Paletas</th>
                  <th>Códigos de paleta</th>
                </tr>
              </thead>
              <tbody>
                {plan.productos.map((p, i) => {
                  const modo = modoDe(p)
                  const codigos = p.paletas.map((t) => t.uid_tag)
                  const consol = consolidacionPorProducto.get(p.id_producto)
                  return (
                    <tr key={`${p.id_producto}-${i}`}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{p.nombre}</div>
                        <div className="muted" style={{ fontSize: '13px' }}>SKU {p.sku}</div>
                      </td>
                      <td>
                        <span className="modo-pill">{MODO_LABEL[modo]}</span>
                      </td>
                      <td className="num-col" style={{ fontWeight: 600 }}>{fmt(p.cantidad_pedida)}</td>
                      <td className="muted" style={{ fontSize: '14px' }}>
                        {modo === 'SERIALIZADO'
                          ? '1 unidad = 1 serie'
                          : p.sin_regla && !p.unidades_por_caja
                          ? 'Sin regla'
                          : modo === 'PICKING_CAJA'
                          ? `${fmt(p.unidades_por_caja)} u por ${empaque(p, 1)}`
                          : p.sin_regla
                          ? `${fmt(p.unidades_por_caja)} u por ${empaque(p, 1)} · sin paleta definida`
                          : `${fmt(p.unidades_por_caja)} u por ${empaque(p, 1)} · ${p.cajas_por_paleta} ${empaque(p, p.cajas_por_paleta)} por paleta`}
                      </td>
                      <td style={{ color: p.sin_regla ? 'var(--color-danger)' : undefined }}>
                        {desglose(p)}
                        {consol && (
                          <div style={{ fontSize: '13px', color: 'var(--color-warning)', fontWeight: 600 }}>Unir con pucho {consol.tag_existente}</div>
                        )}
                      </td>
                      <td className="num-col" style={{ fontWeight: 600 }}>{modo === 'PALETIZADO' ? p.total_bultos : '—'}</td>
                      <td style={{ fontSize: '14px' }}>
                        {codigos.length > 0 ? (
                          <span title={codigos.join(', ')}>{rangosDeCodigos(codigos).join(', ')}</span>
                        ) : (
                          <span className="muted">{modo === 'PALETIZADO' ? '—' : 'No lleva'}</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr style={{ fontWeight: 700 }}>
                  <td colSpan={2}>Total</td>
                  <td className="num-col">{fmt(plan.total_unidades)}</td>
                  <td />
                  <td className="muted" style={{ fontWeight: 500 }}>
                    {plan.total_paletas_completas} completas · {plan.total_puchos} puchos · {fmt(totalCajasSueltas)} cajas · {fmt(totalSeries)} series
                  </td>
                  <td className="num-col">{plan.total_bultos_previstos}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
      )}

      {/* Códigos de paleta */}
      {pestana === 'codigos' && (
        <section className="panel" aria-label="Códigos de paleta">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: '12px', flexWrap: 'wrap', marginBottom: '14px' }}>
            <div>
              <h2 style={{ margin: 0, fontSize: '20px', fontFamily: 'var(--font-display)', fontWeight: 600 }}>Códigos de paleta</h2>
              <p className="muted" style={{ margin: '4px 0 0' }}>
                Reservados para esta orden. En Operaciones cada paleta recibe su tag RFID con este código.
              </p>
            </div>
            <div className="no-print" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <input
                type="search"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Buscar código o producto"
                aria-label="Buscar código o producto"
                style={{ minWidth: '220px' }}
              />
              <select value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value as FiltroTipo)} aria-label="Tipo de paleta">
                <option value="TODOS">Todas las paletas</option>
                <option value="COMPLETO">Solo completas</option>
                <option value="PUCHO">Solo puchos</option>
              </select>
              <button
                type="button"
                className="button secondary"
                disabled={plan.etiquetas_bultos.length === 0}
                onClick={() => copiar(plan.etiquetas_bultos.map((t) => t.uid_tag).join('\n'), '__todos')}
              >
                {copiado === '__todos' ? 'Copiados' : 'Copiar todos'}
              </button>
            </div>
          </div>

          {plan.etiquetas_bultos.length === 0 ? (
            <p className="muted" style={{ padding: '20px', textAlign: 'center' }}>
              Esta orden no tiene productos paletizados, así que no lleva códigos de paleta.
            </p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th className="num-col">N°</th>
                    <th>Código</th>
                    <th>Tipo</th>
                    <th>Producto</th>
                    <th className="num-col">Empaques</th>
                    <th className="num-col">Unidades</th>
                    <th className="no-print">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {codigosFiltrados.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="muted" style={{ textAlign: 'center', padding: '24px' }}>
                        No hay códigos que coincidan con la búsqueda.
                      </td>
                    </tr>
                  ) : (
                    codigosFiltrados.map((t) => (
                      <tr key={t.uid_tag}>
                        <td className="num-col muted">{t.bulto_numero}</td>
                        <td style={{ fontWeight: 700, color: 'var(--color-brand)' }}>{t.uid_tag}</td>
                        <td>
                          {t.tipo === 'PUCHO' ? (
                            <span style={{ color: 'var(--color-warning)', fontWeight: 600 }}>Pucho</span>
                          ) : (
                            'Completa'
                          )}
                        </td>
                        <td>
                          {t.nombre}
                          <div className="muted" style={{ fontSize: '13px' }}>SKU {t.sku}</div>
                        </td>
                        <td className="num-col">{fmt(t.cajas)}</td>
                        <td className="num-col">{fmt(t.unidades)}</td>
                        <td className="no-print">
                          <div style={{ display: 'flex', gap: '6px' }}>
                            <button type="button" className="button secondary button-sm" onClick={() => copiar(t.uid_tag, t.uid_tag)}>
                              {copiado === t.uid_tag ? 'Copiado' : 'Copiar'}
                            </button>
                            <button type="button" className="button secondary button-sm" onClick={() => abrirSticker(t)}>
                              Etiqueta
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* Contingencia */}
      {pestana === 'contingencia' && (
        <section className="panel" aria-label="Códigos de contingencia">
          <h2 style={{ margin: 0, fontSize: '20px', fontFamily: 'var(--font-display)', fontWeight: 600 }}>Códigos de contingencia</h2>
          <p className="muted" style={{ margin: '4px 0 14px', maxWidth: '760px' }}>
            Si en Operaciones aparece una paleta que no estaba prevista, se rotula con uno de estos códigos para no detener la descarga.
            Solo se pueden usar cuando el producto ya agotó su lote de códigos separados. Los que no se usen se liberan al liquidar la recepción.
          </p>
          {plan.etiquetas_reserva.length === 0 ? (
            <p className="muted">Esta orden no reservó códigos de contingencia porque no tiene productos paletizados.</p>
          ) : (
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {plan.etiquetas_reserva.map((r) => (
                <button
                  key={r.uid_tag}
                  type="button"
                  className="button secondary"
                  onClick={() => copiar(r.uid_tag, r.uid_tag)}
                  title="Copiar código"
                  style={{ fontWeight: 700, borderStyle: 'dashed', opacity: r.liberado ? 0.5 : 1 }}
                >
                  {r.uid_tag}
                  {copiado === r.uid_tag ? ' · copiado' : r.liberado ? ' · liberado' : ''}
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      <PalletStickerModal isOpen={!!sticker} onClose={() => setSticker(null)} data={sticker} />
    </div>
  )
}
