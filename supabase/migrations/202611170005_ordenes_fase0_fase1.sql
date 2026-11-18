-- ==============================================================================
-- Migración: Órdenes de importación — fases 0 y 1 (MOD-06)
-- Fecha: 2026-11-17
--   1. Estado FALTA_APROBACION en orden_estado (el frontend ya lo usa; antes se
--      degradaba a BORRADOR y se guardaba solo en el navegador).
--   2. Plantillas de proyección base (parámetros y fórmulas, sin ítems: los
--      consumos se cargan desde el Excel de salidas en la fase 2).
-- ==============================================================================

alter type public.orden_estado add value if not exists 'FALTA_APROBACION' before 'TRANSITO';

insert into public.plantilla_proyeccion (
  codigo, nombre, descripcion, lead_time_meses, seguridad_pct, factor_compra, dias_por_mes,
  formula_stock_min, formula_seguridad, formula_stock_min_f, formula_compra,
  formula_meses_duracion, formula_stock_redondeado,
  columnas_meses, mes_inicio_promedio, mes_fin_promedio, ignorar_meses_cero, activo
) values
  ('IMP_STO', 'Importaciones y Store',
   'Suministros de embalaje y paquetería para agencias',
   3, 0.20, 2, 30,
   'PROM_MEN * lead_time_meses', 'stock_min * seguridad_pct', 'stock_min + seguridad', 'stock_redondeado * factor_compra',
   '(stock_real * lead_time_meses) / stock_redondeado', 'CEIL(STOCK_MIN_F / 1000) * 1000',
   array[]::text[], null, null, true, true),
  ('CONST', 'Construcción y mantenimiento',
   'Insumos de infraestructura, iluminación, seguridad y cerámicos',
   2, 0.10, 2, 30,
   'PROM_MEN * lead_time_meses', 'stock_min * seguridad_pct', 'stock_min + seguridad', 'stock_redondeado * factor_compra',
   '(stock_real * lead_time_meses) / stock_redondeado', 'CEIL(STOCK_MIN_F / 100) * 100',
   array[]::text[], null, null, true, true)
on conflict (codigo) do nothing;
