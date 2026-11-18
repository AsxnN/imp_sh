import { useState, type FormEvent } from 'react'
import { logCatalogChange } from '../../../lib/audit'
import { MODOS_ACTIVOS, MODO_INFO } from '../empaque'
import { categoriaRepository } from '../repositories/CategoryRepository'
import type { Category, ModoManejoCodigo } from '../types'

type Props = {
  categories: Category[]
  loading: boolean
  onRefresh: () => void
  onError: (msg: string | null) => void
}

// Solo 3 modos activos (ver empaque.ts). Los demás modos existen en la BD pero están desactivados.
const MODOS_METADATA: Record<string, { label: string; bg: string; color: string; border: string }> = Object.fromEntries(
  MODOS_ACTIVOS.map((m) => [
    m,
    { label: MODO_INFO[m].label, bg: 'var(--color-brand-soft)', color: 'var(--color-brand)', border: 'var(--color-border)' }
  ])
)

export function CategoriesSubView({ categories, loading, onRefresh, onError }: Props) {
  const [nombre, setNombre] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [modoManejo, setModoManejo] = useState<ModoManejoCodigo>('PALETIZADO')
  const [activo, setActivo] = useState(true)
  const [editing, setEditing] = useState<Category | null>(null)
  const [saving, setSaving] = useState(false)

  async function handleSave(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const nameVal = nombre.trim()
    const descVal = descripcion.trim()
    if (!nameVal || !descVal) return

    setSaving(true)
    onError(null)

    const payload: Partial<Category> = {
      nombre: nameVal,
      descripcion: descVal,
      modo_manejo: modoManejo,
      activo
    }

    try {
      if (editing) {
        payload.id_categoria = editing.id_categoria
        const updated = await categoriaRepository.guardar(payload)

        await logCatalogChange({
          tabla: 'categoria',
          operacion: 'UPDATE',
          id_registro: Number(editing.id_categoria),
          datos_anteriores: editing,
          datos_nuevos: updated
        })
      } else {
        const created = await categoriaRepository.guardar(payload)

        await logCatalogChange({
          tabla: 'categoria',
          operacion: 'INSERT',
          id_registro: Number(created.id_categoria),
          datos_nuevos: created
        })
      }

      resetForm()
      onRefresh()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error inesperado al guardar categoría.'
      onError(msg)
    } finally {
      setSaving(false)
    }
  }

  function startEdit(cat: Category) {
    setEditing(cat)
    setNombre(cat.nombre)
    setDescripcion(cat.descripcion ?? '')
    setModoManejo(cat.modo_manejo || 'PALETIZADO')
    setActivo(cat.activo !== false)
  }

  function resetForm() {
    setEditing(null)
    setNombre('')
    setDescripcion('')
    setModoManejo('PALETIZADO')
    setActivo(true)
  }

  async function toggleActivo(cat: Category) {
    const nuevoEstado = !(cat.activo !== false)
    try {
      await categoriaRepository.cambiarEstado(cat.id_categoria, nuevoEstado)
      await logCatalogChange({
        tabla: 'categoria',
        operacion: 'UPDATE',
        id_registro: Number(cat.id_categoria),
        datos_anteriores: { activo: cat.activo },
        datos_nuevos: { activo: nuevoEstado }
      })
      onRefresh()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al cambiar estado de la categoría.'
      onError(msg)
    }
  }

  return (
    <section className="panel master-section">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h3>Categorías</h3>
          <p className="muted">Cada categoría define el modo de manejo de sus productos: paletizado, por caja o serializado.</p>
        </div>
      </div>

      <form className="category-form" onSubmit={handleSave} style={{ marginTop: '16px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '14px' }}>
          <label>
            Nombre (obligatorio y único)
            <input
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Ej. MAQUINARIA PESADA"
              required
            />
          </label>

          <label>
            Descripción (obligatoria)
            <input
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              placeholder="Generadores, compresores y equipos industriales"
              required
            />
          </label>

          <label>
            Modo de manejo
            <select
              value={modoManejo}
              onChange={(e) => setModoManejo(e.target.value as ModoManejoCodigo)}
            >
              {MODOS_ACTIVOS.map((m) => (
                <option key={m} value={m}>
                  {MODO_INFO[m].label}
                </option>
              ))}
            </select>
            <span style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', fontWeight: 400 }}>
              {MODO_INFO[modoManejo as keyof typeof MODO_INFO]?.resumen ?? 'Modo desactivado: elige uno de los 3 modos vigentes.'}
            </span>
          </label>
        </div>

        <label className="check" style={{ marginTop: '10px' }}>
          <input
            type="checkbox"
            checked={activo}
            onChange={(e) => setActivo(e.target.checked)}
          />
          Categoría activa en el sistema
        </label>

        <div className="form-actions" style={{ marginTop: '14px' }}>
          <button className="button" disabled={saving}>
            {saving ? 'Guardando…' : editing ? 'Guardar cambios' : 'Crear categoría'}
          </button>
          {editing && (
            <button className="button secondary" type="button" onClick={resetForm}>
              Cancelar edición
            </button>
          )}
        </div>
      </form>

      <div style={{ marginTop: '28px' }}>
        <h4>Categorías registradas ({categories.length})</h4>
        {loading ? (
          <p className="muted">Cargando categorías…</p>
        ) : categories.length === 0 ? (
          <p className="empty-state">No hay categorías registradas.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Descripción</th>
                  <th>Modo de manejo</th>
                  <th>Estado</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {categories.map((c) => {
                  const modo = c.modo_manejo || 'PALETIZADO'
                  return (
                    <tr key={c.id_categoria}>
                      <td><strong>{c.nombre}</strong></td>
                      <td>{c.descripcion || '—'}</td>
                      <td>
                        {(() => {
                          const meta = MODOS_METADATA[modo] || {
                            label: modo,
                            bg: 'var(--color-brand-soft)',
                            color: 'var(--color-brand)',
                            border: 'var(--color-border)'
                          }
                          return (
                            <span
                              className="category-pill"
                              style={{
                                background: meta.bg,
                                color: meta.color,
                                borderColor: meta.border
                              }}
                            >
                              {meta.label}
                            </span>
                          )
                        })()}
                      </td>
                      <td>
                        <span className={c.activo !== false ? 'category-pill' : 'category-pill muted'}>
                          {c.activo !== false ? 'Activo' : 'Inactivo'}
                        </span>
                      </td>
                      <td>
                        <button className="btn-detail" type="button" onClick={() => startEdit(c)}>
                          Editar
                        </button>
                        <button
                          className="btn-detail"
                          style={{ marginLeft: '6px' }}
                          type="button"
                          onClick={() => void toggleActivo(c)}
                        >
                          {c.activo !== false ? 'Desactivar' : 'Activar'}
                        </button>
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
