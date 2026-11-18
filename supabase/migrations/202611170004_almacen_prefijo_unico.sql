-- ==============================================================================
-- Migración: prefijo RFID único por almacén (MOD-02)
-- Fecha: 2026-11-17
-- La documentación declaraba prefijo_rfid UNIQUE pero la BD no lo garantizaba.
-- Dos almacenes con el mismo prefijo generarían tags RFID duplicados (IMP00001).
-- ==============================================================================

create unique index if not exists almacen_prefijo_rfid_uq
  on public.almacen (upper(prefijo_rfid))
  where prefijo_rfid is not null;
