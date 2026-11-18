import { useState, type ChangeEvent } from 'react'
import { logCatalogChange } from '../../../lib/audit'
import { supabase } from '../../../lib/supabase'

type ImportTarget = 'categoria' | 'producto' | 'proveedor' | 'regla_empaque'

type Props = {
  onRefreshAll: () => void
  onError: (msg: string | null) => void
}

// Modos válidos en el CSV de categorías (ver empaque.ts)
const MODOS_CSV: Record<string, string> = {
  PALETIZADO: 'PALETIZADO',
  POR_CAJA: 'PICKING_CAJA',
  PICKING_CAJA: 'PICKING_CAJA',
  SERIALIZADO: 'SERIALIZADO'
}
const TIPOS_EMPAQUE_CSV = ['CAJA', 'PAQUETE', 'BOLSA', 'ROLLO', 'FARDO']

const templates: Record<ImportTarget, { headers: string; example: string; ayuda: string }> = {
  categoria: {
    headers: 'nombre,descripcion,modo_manejo',
    example: 'Iluminación,Luminarias y reflectores,POR_CAJA\nEmbalaje y paquetería,Paquetes y bolsas,PALETIZADO',
    ayuda: 'modo_manejo: PALETIZADO, POR_CAJA o SERIALIZADO (si se omite, PALETIZADO).'
  },
  producto: {
    headers: 'sku,nombre,categoria,unidad_medida,peso_unitario_kg,costo_unitario,clasificacion_abc',
    example: 'SKU-00030,Cinta de embalaje 2x100m,"Cintas, film y precintos",ROLLO,0.25,2.50,A\nSKU-00031,Luminaria panel LED 40W,Iluminación,UNIDAD,1.10,18.00,B',
    ayuda: 'categoria: nombre exacto de una categoría existente; define el modo de manejo del producto.'
  },
  proveedor: {
    headers: 'razon_social,calificacion_otif,tiempo_lead_time_dias',
    example: 'Proveedor Internacional Asia S.A.,96.5,35\nDistribuidora Nacional Shalom SAC,88.0,15',
    ayuda: 'calificacion_otif en % (0 a 100); tiempo_lead_time_dias en días.'
  },
  regla_empaque: {
    headers: 'sku,tipo_empaque,unidades_por_empaque,empaques_por_fila,filas_por_paleta,largo_cm,ancho_cm,alto_cm,peso_kg',
    example: 'SKU-0010,PAQUETE,20,11,9,40,30,25,4.5\nSKU-00022,CAJA,10,,,35,25,20,3.2',
    ayuda: 'tipo_empaque: CAJA, PAQUETE, BOLSA, ROLLO o FARDO. Para productos por caja deja vacíos empaques_por_fila y filas_por_paleta.'
  }
}

/** Separa una línea CSV respetando comillas ("a, b",c). */
function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (const ch of line) {
    if (ch === '"') {
      quoted = !quoted
    } else if (ch === ',' && !quoted) {
      out.push(cur.trim())
      cur = ''
    } else {
      cur += ch
    }
  }
  out.push(cur.trim())
  return out
}

export function DataImportSubView({ onRefreshAll, onError }: Props) {
  const [target, setTarget] = useState<ImportTarget>('producto')
  const [rawText, setRawText] = useState('')
  const [parsedRows, setParsedRows] = useState<Record<string, string>[]>([])
  const [importing, setImporting] = useState(false)
  const [resultMessage, setResultMessage] = useState<string | null>(null)

  function parseCSV(text: string) {
    const lines = text
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
    if (lines.length < 2) {
      setParsedRows([])
      return
    }

    const headers = splitCsvLine(lines[0])
    const rows = lines.slice(1).map((line) => {
      const values = splitCsvLine(line)
      const obj: Record<string, string> = {}
      headers.forEach((h, i) => {
        obj[h] = values[i] ?? ''
      })
      return obj
    })

    setParsedRows(rows)
  }

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event) => {
      const content = event.target?.result as string
      setRawText(content)
      parseCSV(content)
    }
    reader.readAsText(file)
  }

  function handleTextChange(text: string) {
    setRawText(text)
    parseCSV(text)
  }

  function loadExample() {
    const tmpl = templates[target]
    const fullText = `${tmpl.headers}\n${tmpl.example}`
    setRawText(fullText)
    parseCSV(fullText)
    setResultMessage(null)
  }

  async function handleImport() {
    if (parsedRows.length === 0) {
      onError('No hay filas válidas para importar.')
      return
    }

    setImporting(true)
    onError(null)
    setResultMessage(null)

    let successCount = 0
    let errorCount = 0
    const errors: string[] = []

    try {
      if (target === 'categoria') {
        for (const row of parsedRows) {
          if (!row.nombre) continue
          const modoCsv = (row.modo_manejo || 'PALETIZADO').trim().toUpperCase().replace(/\s+/g, '_')
          const modo = MODOS_CSV[modoCsv]
          if (!modo) {
            errorCount++
            errors.push(`${row.nombre}: modo "${row.modo_manejo}" no válido (usa PALETIZADO, POR_CAJA o SERIALIZADO).`)
            continue
          }
          const { error } = await supabase.from('categoria').insert({
            nombre: row.nombre.trim(),
            descripcion: row.descripcion?.trim() || row.nombre.trim(),
            modo_manejo: modo,
            activo: true
          })
          if (error) {
            errorCount++
            errors.push(`${row.nombre}: ${error.message}`)
          } else {
            successCount++
          }
        }
      } else if (target === 'producto') {
        for (const row of parsedRows) {
          if (!row.sku || !row.nombre) continue
          let idCategoria: number | null = null
          if (row.categoria?.trim()) {
            const { data: cat } = await supabase
              .from('categoria')
              .select('id_categoria')
              .eq('nombre', row.categoria.trim())
              .maybeSingle()
            if (!cat) {
              errorCount++
              errors.push(`${row.sku}: la categoría "${row.categoria}" no existe.`)
              continue
            }
            idCategoria = cat.id_categoria
          }
          const { error } = await supabase.from('producto').insert({
            sku: row.sku.trim(),
            id_categoria: idCategoria,
            nombre: row.nombre.trim(),
            descripcion: row.nombre.trim(),
            unidad_medida: row.unidad_medida?.trim() || 'UNIDAD',
            peso_unitario_kg: row.peso_unitario_kg ? Number(row.peso_unitario_kg) : null,
            costo_unitario: row.costo_unitario ? Number(row.costo_unitario) : null,
            clasificacion_abc: row.clasificacion_abc?.trim() || 'B',
            activo: true
          })
          if (error) {
            errorCount++
            errors.push(`${row.sku}: ${error.message}`)
          } else {
            successCount++
          }
        }
      } else if (target === 'proveedor') {
        for (const row of parsedRows) {
          if (!row.razon_social) continue
          const { error } = await supabase.from('proveedor').insert({
            razon_social: row.razon_social.trim(),
            calificacion_otif: row.calificacion_otif ? Number(row.calificacion_otif) : null,
            tiempo_lead_time_dias: row.tiempo_lead_time_dias ? Number(row.tiempo_lead_time_dias) : 30,
            activo: true
          })
          if (error) {
            errorCount++
            errors.push(`${row.razon_social}: ${error.message}`)
          } else {
            successCount++
          }
        }
      } else if (target === 'regla_empaque') {
        for (const row of parsedRows) {
          if (!row.sku) continue
          // Buscar el producto y el modo de su categoría
          const { data: prod } = await supabase
            .from('producto')
            .select('id_producto, categoria:categoria(modo_manejo)')
            .eq('sku', row.sku.trim())
            .maybeSingle()

          if (!prod) {
            errorCount++
            errors.push(`SKU ${row.sku} no existe en el catálogo de productos.`)
            continue
          }

          const cat = prod.categoria as unknown as { modo_manejo?: string } | null
          const modo = cat?.modo_manejo || 'PALETIZADO'
          if (modo === 'SERIALIZADO') {
            errorCount++
            errors.push(`${row.sku}: es serializado (maquinaria) y no lleva regla de empaque.`)
            continue
          }
          const usaPaleta = modo === 'PALETIZADO'

          const tipo = (row.tipo_empaque || 'CAJA').trim().toUpperCase()
          if (!TIPOS_EMPAQUE_CSV.includes(tipo)) {
            errorCount++
            errors.push(`${row.sku}: tipo de empaque "${row.tipo_empaque}" no válido.`)
            continue
          }

          const esEntero = (v: string | undefined) => Number.isInteger(Number(v)) && Number(v) > 0
          if (!esEntero(row.unidades_por_empaque) || (usaPaleta && (!esEntero(row.empaques_por_fila) || !esEntero(row.filas_por_paleta)))) {
            errorCount++
            errors.push(
              `${row.sku}: ${usaPaleta ? 'unidades_por_empaque, empaques_por_fila y filas_por_paleta deben ser' : 'unidades_por_empaque debe ser'} un entero mayor a 0.`
            )
            continue
          }

          const uEmpaque = Number(row.unidades_por_empaque)
          const porFila = usaPaleta ? Number(row.empaques_por_fila) : 1
          const filas = usaPaleta ? Number(row.filas_por_paleta) : 1
          const l = Number(row.largo_cm) || null
          const w = Number(row.ancho_cm) || null
          const h = Number(row.alto_cm) || null
          const vEmpaque = l && w && h ? (l * w * h) / 1000000 : null

          const { error } = await supabase.from('regla_empaque').upsert(
            {
              id_producto: prod.id_producto,
              tipo_empaque: tipo,
              unidades_por_caja: uEmpaque,
              cajas_por_camada: porFila,
              numero_camadas: filas,
              largo_caja_cm: l,
              ancho_caja_cm: w,
              alto_caja_cm: h,
              peso_caja_kg: Number(row.peso_kg) || null,
              volumen_caja_m3: vEmpaque,
              volumen_total_m3: usaPaleta && vEmpaque ? vEmpaque * porFila * filas : null,
              permite_puchos: usaPaleta
            },
            { onConflict: 'id_producto' }
          )

          if (error) {
            errorCount++
            errors.push(`${row.sku}: ${error.message}`)
          } else {
            successCount++
          }
        }
      }

      await logCatalogChange({
        tabla: target,
        operacion: 'INSERT',
        id_registro: `IMPORT_${Date.now()}`,
        datos_nuevos: { exitosos: successCount, errores: errorCount }
      })

      setResultMessage(
        `Importación finalizada: ${successCount} registros importados exitosamente.${
          errorCount > 0 ? ` (${errorCount} con error)` : ''
        }`
      )
      if (errors.length > 0) {
        onError(errors.slice(0, 3).join(' | '))
      }

      onRefreshAll()
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Error inesperado durante la importación.')
    } finally {
      setImporting(false)
    }
  }

  return (
    <section className="panel master-section">
      <h3>Importación CSV</h3>
      <p className="muted">
        Carga masiva de categorías, productos, proveedores y reglas de empaque desde un archivo CSV separado por comas.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px', marginTop: '16px' }}>
        <label>
          <strong>Catálogo de destino:</strong>
          <select
            value={target}
            onChange={(e) => {
              setTarget(e.target.value as ImportTarget)
              setParsedRows([])
              setRawText('')
              setResultMessage(null)
            }}
          >
            <option value="categoria">Categorías</option>
            <option value="producto">Productos</option>
            <option value="proveedor">Proveedores</option>
            <option value="regla_empaque">Reglas de empaque</option>
          </select>
        </label>

        <label>
          <strong>Subir archivo (.csv):</strong>
          <input type="file" accept=".csv,text/csv" onChange={handleFileChange} />
        </label>

        <div style={{ display: 'flex', alignItems: 'flex-end' }}>
          <button className="button secondary" type="button" onClick={loadExample}>
            Cargar plantilla de ejemplo
          </button>
        </div>
      </div>

      <p className="muted" style={{ margin: '12px 0 0', fontSize: '0.85rem' }}>
        <strong>Columnas:</strong> <code>{templates[target].headers}</code>
        <br />
        {templates[target].ayuda}
      </p>

      <label style={{ display: 'grid', gap: '6px', marginTop: '16px', fontWeight: 700, fontSize: '0.85rem' }}>
        Datos en texto plano CSV (puedes pegar datos directamente aquí):
        <textarea
          rows={6}
          value={rawText}
          onChange={(e) => handleTextChange(e.target.value)}
          placeholder={`Encabezados requeridos: ${templates[target].headers}\nEjemplo:\n${templates[target].example}`}
          style={{ fontFamily: 'monospace', fontSize: '0.83rem', border: '1px solid #b9c9bc', borderRadius: '8px', padding: '10px' }}
        />
      </label>

      {resultMessage && (
        <div className="notice" style={{ marginTop: '14px', background: '#edf7ef', borderColor: '#badfc4', color: '#17653f' }}>
          ✓ {resultMessage}
        </div>
      )}

      {parsedRows.length > 0 && (
        <div style={{ marginTop: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <h4>Vista previa de filas a importar ({parsedRows.length} registros detectados)</h4>
            <button className="button" disabled={importing} onClick={() => void handleImport()}>
              {importing ? 'Importando en base de datos…' : `Validar e Importar (${parsedRows.length} filas)`}
            </button>
          </div>

          <div className="table-wrap" style={{ maxHeight: '250px', overflowY: 'auto' }}>
            <table>
              <thead>
                <tr>
                  {Object.keys(parsedRows[0] || {}).map((header) => (
                    <th key={header}>{header}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {parsedRows.slice(0, 10).map((row, idx) => (
                  <tr key={idx}>
                    {Object.values(row).map((val, colIdx) => (
                      <td key={colIdx}>{val || '—'}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {parsedRows.length > 10 && (
            <p className="muted" style={{ fontSize: '0.8rem', marginTop: '6px' }}>
              Mostrando las primeras 10 filas de {parsedRows.length} detectadas.
            </p>
          )}
        </div>
      )}
    </section>
  )
}
