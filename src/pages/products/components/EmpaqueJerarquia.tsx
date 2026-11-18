import { calcularPaleta, formatoNumero, nombreEmpaque } from '../empaque'

type Props = {
  tipoEmpaque: string
  unidadesPorEmpaque: unknown
  /** Solo modo paletizado */
  empaquesPorFila?: unknown
  /** Solo modo paletizado */
  filasPorPaleta?: unknown
  usaPaleta: boolean
}

/**
 * Muestra la jerarquía de empaque del producto:
 *   Paletizado: unidades -> empaque -> fila -> paleta (con totales)
 *   Por caja:   unidades -> caja
 */
export function EmpaqueJerarquia({ tipoEmpaque, unidadesPorEmpaque, empaquesPorFila, filasPorPaleta, usaPaleta }: Props) {
  const calc = calcularPaleta(unidadesPorEmpaque, usaPaleta ? empaquesPorFila : 1, usaPaleta ? filasPorPaleta : 1)
  const singular = nombreEmpaque(tipoEmpaque, 1)
  const plural = nombreEmpaque(tipoEmpaque, 2)

  return (
    <div className="empaque-jerarquia" aria-label="Jerarquía de empaque">
      <div className="empaque-nivel">
        <span className="empaque-nivel-valor">{formatoNumero(calc.unidadesPorEmpaque)}</span>
        <span className="empaque-nivel-label">unidades</span>
      </div>
      <span className="empaque-flecha" aria-hidden="true">→</span>
      <div className="empaque-nivel">
        <span className="empaque-nivel-valor">1</span>
        <span className="empaque-nivel-label">{singular}</span>
      </div>

      {usaPaleta && (
        <>
          <span className="empaque-flecha" aria-hidden="true">→</span>
          <div className="empaque-nivel">
            <span className="empaque-nivel-valor">{formatoNumero(calc.empaquesPorFila)}</span>
            <span className="empaque-nivel-label">{plural} = 1 fila</span>
          </div>
          <span className="empaque-flecha" aria-hidden="true">→</span>
          <div className="empaque-nivel">
            <span className="empaque-nivel-valor">{formatoNumero(calc.filasPorPaleta)}</span>
            <span className="empaque-nivel-label">filas = 1 paleta</span>
          </div>
          <div className="empaque-total">
            <span>1 paleta</span>
            <strong>
              {formatoNumero(calc.empaquesPorPaleta)} {plural} · {formatoNumero(calc.unidadesPorPaleta)} unidades
            </strong>
          </div>
        </>
      )}

      {!usaPaleta && (
        <div className="empaque-total">
          <span>Contenido de cada {singular}</span>
          <strong>{formatoNumero(calc.unidadesPorEmpaque)} unidades · stock en empaques cerrados + máx. 1 abierto</strong>
        </div>
      )}
    </div>
  )
}
