-- ==============================================================================
-- Migración: Sincronización de la BD real con el código (Módulos 0-8)
-- Proyecto: Importaciones Shalom (pzsxzzfrwpamjkyyjodj)
-- Fecha: 2026-11-17
-- Motivo: la BD solo tenía 2 migraciones aplicadas; faltaban tablas, RPCs y
-- políticas RLS que el frontend ya usa. Script idempotente (se puede re-ejecutar).
-- NOTA: NO incluye el paso 7 de 202609020019 (asignaba ADMINISTRADOR a todos los
-- usuarios de auth.users) ni las semillas de permiso (ya existen 10 registros).
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- MÓDULO 0: función base es_administrador() (usada por 0019/0020)
-- ------------------------------------------------------------------------------
create or replace function public.es_administrador()
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.tiene_rol(array['ADMINISTRADOR']);
$$;

-- ------------------------------------------------------------------------------
-- MÓDULO 2: tipos de movimiento que el frontend ya inserta ('AJUSTE', 'SALIDA')
-- ------------------------------------------------------------------------------
alter type public.movimiento_tipo add value if not exists 'AJUSTE';
alter type public.movimiento_tipo add value if not exists 'SALIDA';

-- ------------------------------------------------------------------------------
-- MÓDULO 1: esquema_camita y auditoria_catalogo (de 202609020004)
-- ------------------------------------------------------------------------------
create table if not exists public.esquema_camita (
  id_esquema bigint generated always as identity primary key,
  id_producto bigint references public.producto(id_producto) on delete cascade,
  nombre varchar not null,
  cajas_por_fila integer not null check (cajas_por_fila > 0),
  filas_por_camada integer not null check (filas_por_camada > 0),
  cajas_por_camada integer generated always as (cajas_por_fila * filas_por_camada) stored,
  numero_camadas integer not null check (numero_camadas > 0),
  alto_paleta_armada_cm numeric check (alto_paleta_armada_cm > 0),
  activo boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.esquema_camita enable row level security;
drop policy if exists "esquema_camita_lectura" on public.esquema_camita;
create policy "esquema_camita_lectura" on public.esquema_camita
  for select to authenticated using (true);
drop policy if exists "esquema_camita_gestion" on public.esquema_camita;
create policy "esquema_camita_gestion" on public.esquema_camita
  for all to authenticated
  using (public.tiene_rol(array['ADMINISTRADOR', 'COMPRADOR']))
  with check (public.tiene_rol(array['ADMINISTRADOR', 'COMPRADOR']));

create table if not exists public.auditoria_catalogo (
  id_auditoria bigint generated always as identity primary key,
  tabla varchar not null,
  operacion varchar not null check (operacion in ('INSERT', 'UPDATE', 'DELETE')),
  id_registro varchar not null,
  auth_user_id uuid references auth.users(id),
  datos_anteriores jsonb,
  datos_nuevos jsonb,
  created_at timestamptz not null default now()
);
alter table public.auditoria_catalogo enable row level security;
drop policy if exists "auditoria_catalogo_lectura" on public.auditoria_catalogo;
create policy "auditoria_catalogo_lectura" on public.auditoria_catalogo
  for select to authenticated
  using (public.tiene_rol(array['ADMINISTRADOR', 'COMPRADOR', 'AUDITOR']));
drop policy if exists "auditoria_catalogo_insertar" on public.auditoria_catalogo;
create policy "auditoria_catalogo_insertar" on public.auditoria_catalogo
  for insert to authenticated
  with check (auth_user_id is null or auth_user_id = auth.uid());
grant select, insert on public.auditoria_catalogo to authenticated;
grant select, insert, update, delete on public.esquema_camita to authenticated;

-- ------------------------------------------------------------------------------
-- MÓDULO 2: RPC ajustar_inventario_paletas (adaptada al esquema real)
--   * Kardex registra el delta absoluto (CHECK cantidad_afectada > 0).
--   * Si no hay cambio de stock no se inserta movimiento.
-- ------------------------------------------------------------------------------
create or replace function public.ajustar_inventario_paletas(
  p_id_producto bigint,
  p_id_almacen bigint,
  p_paletas integer,
  p_puchos integer,
  p_motivo text default 'Ajuste manual de inventario'
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_unidades_por_caja integer;
  v_cajas_por_paleta integer;
  v_total_cajas integer;
  v_total_unidades numeric;
  v_id_usuario bigint;
  v_stock_anterior numeric := 0;
  v_delta numeric;
begin
  if not public.tiene_rol(array['ADMINISTRADOR', 'OPERARIO']) then
    raise exception 'Acceso denegado: rol no autorizado para ajustar inventario.';
  end if;

  select
    coalesce(r.unidades_por_caja, 1),
    coalesce(r.cajas_por_camada, r.cajas_por_camita, 1) * coalesce(r.numero_camadas, r.camitas_por_paleta, 1)
  into v_unidades_por_caja, v_cajas_por_paleta
  from public.producto p
  left join public.regla_empaque r on r.id_producto = p.id_producto
  where p.id_producto = p_id_producto;

  if not found then
    raise exception 'Producto con ID % no encontrado.', p_id_producto;
  end if;

  v_unidades_por_caja := coalesce(v_unidades_por_caja, 1);
  v_cajas_por_paleta := coalesce(v_cajas_por_paleta, 1);
  v_total_cajas := (greatest(0, p_paletas) * v_cajas_por_paleta) + greatest(0, p_puchos);
  v_total_unidades := v_total_cajas * v_unidades_por_caja;

  select id_usuario into v_id_usuario from public.usuario where auth_user_id = auth.uid();

  select stock_real into v_stock_anterior
  from public.inventario
  where id_producto = p_id_producto and id_almacen = p_id_almacen
  for update;
  v_stock_anterior := coalesce(v_stock_anterior, 0);
  v_delta := v_total_unidades - v_stock_anterior;

  insert into public.inventario (id_producto, id_almacen, stock_real, stock_minimo, estado_semaforo)
  values (
    p_id_producto, p_id_almacen, v_total_unidades,
    v_cajas_por_paleta * v_unidades_por_caja,
    case
      when v_total_unidades <= 0 then 'ROJO'
      when v_total_unidades <= v_cajas_por_paleta * v_unidades_por_caja then 'AMARILLO'
      else 'VERDE'
    end
  )
  on conflict (id_producto, id_almacen) do update set
    stock_real = excluded.stock_real,
    estado_semaforo = case
      when excluded.stock_real <= 0 then 'ROJO'
      when excluded.stock_real <= public.inventario.stock_minimo then 'AMARILLO'
      else 'VERDE'
    end;

  if v_delta <> 0 then
    insert into public.movimiento (id_usuario, id_producto, tipo, cantidad_afectada, destino_almacen, motivo)
    values (
      v_id_usuario, p_id_producto, 'AJUSTE', abs(v_delta), p_id_almacen,
      format('%s: %s paletas (%s cajas) + %s puchos = %s unidades (anterior: %s)',
        p_motivo, p_paletas, p_paletas * v_cajas_por_paleta, p_puchos, v_total_unidades, v_stock_anterior)
    );
  end if;

  return jsonb_build_object(
    'ok', true, 'id_producto', p_id_producto, 'id_almacen', p_id_almacen,
    'paletas', p_paletas, 'puchos', p_puchos, 'total_cajas', v_total_cajas,
    'total_unidades', v_total_unidades, 'stock_anterior', v_stock_anterior
  );
end;
$$;

-- ------------------------------------------------------------------------------
-- MÓDULO 2/3: políticas RLS faltantes (inventario, movimiento, secuencia_rfid)
-- ------------------------------------------------------------------------------
drop policy if exists "inventario_gestion" on public.inventario;
create policy "inventario_gestion" on public.inventario
  for all to authenticated
  using (public.tiene_rol(array['ADMINISTRADOR', 'OPERARIO']))
  with check (public.tiene_rol(array['ADMINISTRADOR', 'OPERARIO']));

-- Kardex inmutable: lectura, inserción y borrado solo admin (reset); sin UPDATE.
drop policy if exists "movimiento_lectura" on public.movimiento;
create policy "movimiento_lectura" on public.movimiento
  for select to authenticated
  using (public.tiene_rol(array['ADMINISTRADOR', 'OPERARIO', 'AUDITOR', 'COMPRADOR']));
drop policy if exists "movimiento_insertar" on public.movimiento;
create policy "movimiento_insertar" on public.movimiento
  for insert to authenticated
  with check (public.tiene_rol(array['ADMINISTRADOR', 'OPERARIO']));
drop policy if exists "movimiento_eliminar_admin" on public.movimiento;
create policy "movimiento_eliminar_admin" on public.movimiento
  for delete to authenticated
  using (public.tiene_rol(array['ADMINISTRADOR']));

drop policy if exists "secuencia_rfid_lectura" on public.secuencia_rfid;
create policy "secuencia_rfid_lectura" on public.secuencia_rfid
  for select to authenticated
  using (public.tiene_rol(array['ADMINISTRADOR', 'COMPRADOR', 'OPERARIO', 'AUDITOR']));
drop policy if exists "secuencia_rfid_gestion" on public.secuencia_rfid;
create policy "secuencia_rfid_gestion" on public.secuencia_rfid
  for all to authenticated
  using (public.tiene_rol(array['ADMINISTRADOR', 'OPERARIO']))
  with check (public.tiene_rol(array['ADMINISTRADOR', 'OPERARIO']));

-- Quitar políticas abiertas "ALL true" que anulaban el RBAC (ya existen las de rol)
drop policy if exists "carril_gestion_autenticado" on public.carril;
drop policy if exists "nivel_carril_gestion_autenticado" on public.nivel_carril;
drop policy if exists "celda_rack_gestion_autenticado" on public.celda_rack;
drop policy if exists "etiqueta_rfid_gestion_autenticado" on public.etiqueta_rfid;

-- ------------------------------------------------------------------------------
-- MÓDULO 4/5: auditoria_eri y dispositivo_iot sin políticas
-- ------------------------------------------------------------------------------
drop policy if exists "auditoria_eri_lectura" on public.auditoria_eri;
create policy "auditoria_eri_lectura" on public.auditoria_eri
  for select to authenticated
  using (public.tiene_rol(array['ADMINISTRADOR', 'AUDITOR', 'OPERARIO']));
drop policy if exists "auditoria_eri_gestion" on public.auditoria_eri;
create policy "auditoria_eri_gestion" on public.auditoria_eri
  for all to authenticated
  using (public.tiene_rol(array['ADMINISTRADOR', 'AUDITOR']))
  with check (public.tiene_rol(array['ADMINISTRADOR', 'AUDITOR']));

drop policy if exists "dispositivo_iot_lectura" on public.dispositivo_iot;
create policy "dispositivo_iot_lectura" on public.dispositivo_iot
  for select to authenticated
  using (public.tiene_rol(array['ADMINISTRADOR', 'OPERARIO']));
drop policy if exists "dispositivo_iot_gestion" on public.dispositivo_iot;
create policy "dispositivo_iot_gestion" on public.dispositivo_iot
  for all to authenticated
  using (public.tiene_rol(array['ADMINISTRADOR']))
  with check (public.tiene_rol(array['ADMINISTRADOR']));

-- ------------------------------------------------------------------------------
-- MÓDULO 6: proyecciones (contenido de 202609020021 + 0025 + 0026)
-- ------------------------------------------------------------------------------
-- >>> 202609020021_modulo6_configuracion_proyecciones.sql
-- ==============================================================================
-- Migración: Módulo 06 - Órdenes y Proyecciones Dinámicas de Importación
-- Proyecto: Importaciones Shalom
-- Fecha: 2026-10-20
-- ==============================================================================


CREATE TABLE IF NOT EXISTS public.plantilla_proyeccion (
  id_plantilla bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  codigo varchar NOT NULL UNIQUE,
  nombre varchar NOT NULL,
  descripcion text,
  lead_time_meses numeric NOT NULL DEFAULT 3,
  seguridad_pct numeric NOT NULL DEFAULT 0.20,
  factor_compra numeric NOT NULL DEFAULT 2,
  dias_por_mes integer NOT NULL DEFAULT 30,
  formula_stock_min varchar NOT NULL DEFAULT 'PROM_MEN * lead_time_meses',
  formula_seguridad varchar NOT NULL DEFAULT 'stock_min * seguridad_pct',
  formula_stock_min_f varchar NOT NULL DEFAULT 'stock_min + seguridad',
  formula_compra varchar NOT NULL DEFAULT 'stock_redondeado * factor_compra',
  formula_meses_duracion varchar NOT NULL DEFAULT 'stock_real / (PROM_MEN > 0 ? PROM_MEN : 1)',
  columnas_meses text[] NOT NULL DEFAULT ARRAY['SEP', 'OCT', 'NOV', 'DIC', 'ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL'],
  activo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.item_proyeccion (
  id_item bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id_plantilla bigint NOT NULL REFERENCES public.plantilla_proyeccion(id_plantilla) ON DELETE CASCADE,
  id_producto bigint REFERENCES public.producto(id_producto) ON DELETE SET NULL,
  nombre_producto varchar NOT NULL,
  datos_meses jsonb NOT NULL DEFAULT '{}'::jsonb,
  promedio_manual numeric,
  stock_manual numeric,
  stock_redondeado_manual numeric,
  orden_fila integer NOT NULL DEFAULT 0,
  activo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.plantilla_proyeccion ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.item_proyeccion ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "plantilla_proyeccion_lectura" ON public.plantilla_proyeccion;
CREATE POLICY "plantilla_proyeccion_lectura" ON public.plantilla_proyeccion
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "plantilla_proyeccion_gestion" ON public.plantilla_proyeccion;
CREATE POLICY "plantilla_proyeccion_gestion" ON public.plantilla_proyeccion
  FOR ALL TO authenticated
  USING (public.tiene_rol(ARRAY['ADMINISTRADOR', 'COMPRADOR']))
  WITH CHECK (public.tiene_rol(ARRAY['ADMINISTRADOR', 'COMPRADOR']));

DROP POLICY IF EXISTS "item_proyeccion_lectura" ON public.item_proyeccion;
CREATE POLICY "item_proyeccion_lectura" ON public.item_proyeccion
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "item_proyeccion_gestion" ON public.item_proyeccion;
CREATE POLICY "item_proyeccion_gestion" ON public.item_proyeccion
  FOR ALL TO authenticated
  USING (public.tiene_rol(ARRAY['ADMINISTRADOR', 'COMPRADOR']))
  WITH CHECK (public.tiene_rol(ARRAY['ADMINISTRADOR', 'COMPRADOR']));

-- 1. Plantilla IMP_STO
INSERT INTO public.plantilla_proyeccion (
  codigo, nombre, descripcion, lead_time_meses, seguridad_pct, factor_compra, columnas_meses, activo
) VALUES (
  'IMP_STO',
  'Importaciones y Store',
  'Modelo dinámico de proyección para suministros de embalaje y paquetería de agencias',
  3,
  0.20,
  2,
  ARRAY['SEP', 'OCT', 'NOV', 'DIC', 'ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL'],
  true
)
ON CONFLICT (codigo) DO UPDATE
SET lead_time_meses = EXCLUDED.lead_time_meses,
    seguridad_pct = EXCLUDED.seguridad_pct,
    factor_compra = EXCLUDED.factor_compra,
    columnas_meses = EXCLUDED.columnas_meses,
    activo = true;

-- 2. Plantilla CONST
INSERT INTO public.plantilla_proyeccion (
  codigo, nombre, descripcion, lead_time_meses, seguridad_pct, factor_compra, columnas_meses, activo
) VALUES (
  'CONST',
  'Construcción y Mantenimiento',
  'Modelo de reposición para insumos de infraestructura, luminarias y cerámicos',
  2,
  0.10,
  2,
  ARRAY[]::text[],
  true
)
ON CONFLICT (codigo) DO UPDATE
SET lead_time_meses = EXCLUDED.lead_time_meses,
    seguridad_pct = EXCLUDED.seguridad_pct,
    factor_compra = EXCLUDED.factor_compra,
    activo = true;


DELETE FROM public.item_proyeccion WHERE id_plantilla IN (
  SELECT id_plantilla FROM public.plantilla_proyeccion WHERE codigo IN ('IMP_STO', 'CONST')
);

INSERT INTO public.item_proyeccion (id_plantilla, nombre_producto, datos_meses, promedio_manual, stock_manual, stock_redondeado_manual, orden_fila)
SELECT id_plantilla, 'BOLSA SEG. GRANDE', '{"SEP": -22400.0, "OCT": -2200.0, "NOV": -18400.0, "DIC": -14800.0, "ENE": -16200.0, "FEB": -15000.0, "MAR": -89600.0, "ABR": -22000.0, "MAY": -12500.0, "JUN": -2500.0, "JUL": -16000.0}'::jsonb, 15000, 48500, 60000, 1
FROM public.plantilla_proyeccion WHERE codigo = 'IMP_STO';
INSERT INTO public.item_proyeccion (id_plantilla, nombre_producto, datos_meses, promedio_manual, stock_manual, stock_redondeado_manual, orden_fila)
SELECT id_plantilla, 'BOLSA SEG. MEDIANA', '{"SEP": 0.0, "OCT": 0.0, "NOV": -3800.0, "DIC": -16200.0, "ENE": -7400.0, "FEB": -300.0, "MAR": -10000.0, "ABR": 0.0, "MAY": 0.0, "JUN": -5000.0, "JUL": 0.0}'::jsonb, 5000, 193000, 40000, 2
FROM public.plantilla_proyeccion WHERE codigo = 'IMP_STO';
INSERT INTO public.item_proyeccion (id_plantilla, nombre_producto, datos_meses, promedio_manual, stock_manual, stock_redondeado_manual, orden_fila)
SELECT id_plantilla, 'BOLSA SEG. PEQUEÑO', '{"SEP": -11000.0, "OCT": -14800.0, "NOV": -11100.0, "DIC": -13600.0, "ENE": -10200.0, "FEB": -10200.0, "MAR": -6800.0, "ABR": 0.0, "MAY": 0.0, "JUN": -10000.0, "JUL": -8000.0}'::jsonb, 10000, 141500, 40000, 3
FROM public.plantilla_proyeccion WHERE codigo = 'IMP_STO';
INSERT INTO public.item_proyeccion (id_plantilla, nombre_producto, datos_meses, promedio_manual, stock_manual, stock_redondeado_manual, orden_fila)
SELECT id_plantilla, 'BURBUPACK- 50 CM', '{"SEP": -2106.0, "OCT": -2610.0, "NOV": -2800.0, "DIC": -2401.0, "ENE": -2300.0, "FEB": -2000.0, "MAR": -2220.0, "ABR": -3600.0, "MAY": -2400.0, "JUN": -300.0, "JUL": -350.0}'::jsonb, 3000, 30000, 15000, 4
FROM public.plantilla_proyeccion WHERE codigo = 'IMP_STO';
INSERT INTO public.item_proyeccion (id_plantilla, nombre_producto, datos_meses, promedio_manual, stock_manual, stock_redondeado_manual, orden_fila)
SELECT id_plantilla, 'CINTAS-EMBALAJE 2 X 100 YDS', '{"SEP": -864.0, "OCT": -1152.0, "NOV": -1800.0, "DIC": -1008.0, "ENE": -936.0, "FEB": -792.0, "MAR": -1080.0, "ABR": -2592.0, "MAY": -4824.0, "JUN": 0.0, "JUL": 0.0}'::jsonb, 1200, 2584, 4000, 5
FROM public.plantilla_proyeccion WHERE codigo = 'IMP_STO';
INSERT INTO public.item_proyeccion (id_plantilla, nombre_producto, datos_meses, promedio_manual, stock_manual, stock_redondeado_manual, orden_fila)
SELECT id_plantilla, 'CINTAS-EMBALAJE 2 X 50 YDS', '{"SEP": 0.0, "OCT": 0.0, "NOV": 0.0, "DIC": 0.0, "ENE": 0.0, "FEB": 0.0, "MAR": -8220.0, "ABR": 0.0, "MAY": 0.0, "JUN": 0.0, "JUL": 0.0}'::jsonb, 12000, 80000, 40000, 6
FROM public.plantilla_proyeccion WHERE codigo = 'IMP_STO';
INSERT INTO public.item_proyeccion (id_plantilla, nombre_producto, datos_meses, promedio_manual, stock_manual, stock_redondeado_manual, orden_fila)
SELECT id_plantilla, 'CONTOMETRO', '{"SEP": -14505.0, "OCT": -17100.0, "NOV": -19200.0, "DIC": -26850.0, "ENE": -21300.0, "FEB": -17400.0, "MAR": -21750.0, "ABR": -25200.0, "MAY": -600.0, "JUN": 0.0, "JUL": -22000.0}'::jsonb, 22000, 98000, 90000, 7
FROM public.plantilla_proyeccion WHERE codigo = 'IMP_STO';
INSERT INTO public.item_proyeccion (id_plantilla, nombre_producto, datos_meses, promedio_manual, stock_manual, stock_redondeado_manual, orden_fila)
SELECT id_plantilla, 'PAQUETE S', '{"SEP": -9784.0, "OCT": -10375.0, "NOV": -11304.0, "DIC": -10925.0, "ENE": -13971.0, "FEB": -14482.0, "MAR": -14860.0, "ABR": -17880.0, "MAY": -15400.0, "JUN": -2800.0, "JUL": -13180.0}'::jsonb, 15000, 101820, 60000, 8
FROM public.plantilla_proyeccion WHERE codigo = 'IMP_STO';
INSERT INTO public.item_proyeccion (id_plantilla, nombre_producto, datos_meses, promedio_manual, stock_manual, stock_redondeado_manual, orden_fila)
SELECT id_plantilla, 'PAQUETE XS', '{"SEP": -15083.0, "OCT": -16523.0, "NOV": -9625.0, "DIC": -23439.0, "ENE": -22876.0, "FEB": -17770.0, "MAR": -26200.0, "ABR": -18920.0, "MAY": 0.0, "JUN": -30.0, "JUL": 0.0}'::jsonb, 15000, 229000, 60000, 9
FROM public.plantilla_proyeccion WHERE codigo = 'IMP_STO';
INSERT INTO public.item_proyeccion (id_plantilla, nombre_producto, datos_meses, promedio_manual, stock_manual, stock_redondeado_manual, orden_fila)
SELECT id_plantilla, 'PAQUETE XXS', '{"SEP": -44666.0, "OCT": -30050.0, "NOV": -58957.0, "DIC": -45007.0, "ENE": -44646.0, "FEB": -45442.0, "MAR": -40000.0, "ABR": -14800.0, "MAY": -39860.0, "JUN": -24800.0, "JUL": -44900.0}'::jsonb, 35000, 151067, 130000, 10
FROM public.plantilla_proyeccion WHERE codigo = 'IMP_STO';
INSERT INTO public.item_proyeccion (id_plantilla, nombre_producto, datos_meses, promedio_manual, stock_manual, stock_redondeado_manual, orden_fila)
SELECT id_plantilla, 'PRECINTO-PQT 100 UND-20 CM', '{"SEP": 0, "OCT": 0, "NOV": 0, "DIC": 0, "ENE": 0, "FEB": 0, "MAR": 0, "ABR": -1800.0, "MAY": 0.0, "JUN": 0.0, "JUL": 0.0}'::jsonb, 450, 500000, 250000, 11
FROM public.plantilla_proyeccion WHERE codigo = 'IMP_STO';
INSERT INTO public.item_proyeccion (id_plantilla, nombre_producto, datos_meses, promedio_manual, stock_manual, stock_redondeado_manual, orden_fila)
SELECT id_plantilla, 'PRECINTO-PQT 100 UND-30 CM', '{"SEP": 0, "OCT": 0, "NOV": 0, "DIC": 0, "ENE": 0, "FEB": 0, "MAR": 0, "ABR": 0.0, "MAY": 0.0, "JUN": 0.0, "JUL": -1300.0}'::jsonb, 1300, 3800, 5000, 12
FROM public.plantilla_proyeccion WHERE codigo = 'IMP_STO';
INSERT INTO public.item_proyeccion (id_plantilla, nombre_producto, datos_meses, promedio_manual, stock_manual, stock_redondeado_manual, orden_fila)
SELECT id_plantilla, 'ROLLO QR DIRECTO', '{"SEP": -3460.0, "OCT": 0.0, "NOV": 0.0, "DIC": 0.0, "ENE": -3456.0, "FEB": -3456.0, "MAR": -3456.0, "ABR": -1728.0, "MAY": -3456.0, "JUN": -7296.0, "JUL": -15360.0}'::jsonb, 18000, 13632, 65000, 13
FROM public.plantilla_proyeccion WHERE codigo = 'IMP_STO';
INSERT INTO public.item_proyeccion (id_plantilla, nombre_producto, datos_meses, promedio_manual, stock_manual, stock_redondeado_manual, orden_fila)
SELECT id_plantilla, 'SACO DE LONA', '{"SEP": 0.0, "OCT": 0.0, "NOV": 0.0, "DIC": 0.0, "ENE": -660.0, "FEB": -1700.0, "MAR": -1130.0, "ABR": -235.0, "MAY": -60.0, "JUN": -220.0, "JUL": -55.0}'::jsonb, 143, 6000, 5000, 14
FROM public.plantilla_proyeccion WHERE codigo = 'IMP_STO';
INSERT INTO public.item_proyeccion (id_plantilla, nombre_producto, datos_meses, promedio_manual, stock_manual, stock_redondeado_manual, orden_fila)
SELECT id_plantilla, 'SOBRE DE BURBUJA GRANDE 260x320+45mm', '{"SEP": -5690.0, "OCT": -5627.0, "NOV": -5900.0, "DIC": 0.0, "ENE": 0.0, "FEB": 0.0, "MAR": -6100.0, "ABR": -19200.0, "MAY": -16400.0, "JUN": 0.0, "JUL": 0.0}'::jsonb, 15000, 77000, 40000, 15
FROM public.plantilla_proyeccion WHERE codigo = 'IMP_STO';
INSERT INTO public.item_proyeccion (id_plantilla, nombre_producto, datos_meses, promedio_manual, stock_manual, stock_redondeado_manual, orden_fila)
SELECT id_plantilla, 'SOBRE DE BURBUJA MEDIANO 220x250+45mm', '{"SEP": 0.0, "OCT": -7661.0, "NOV": -100.0, "DIC": -3200.0, "ENE": 0.0, "FEB": 0.0, "MAR": -1300.0, "ABR": 0.0, "MAY": -15600.0, "JUN": 0.0, "JUL": 0.0}'::jsonb, 15000, 48400, 40000, 16
FROM public.plantilla_proyeccion WHERE codigo = 'IMP_STO';
INSERT INTO public.item_proyeccion (id_plantilla, nombre_producto, datos_meses, promedio_manual, stock_manual, stock_redondeado_manual, orden_fila)
SELECT id_plantilla, 'SOBRE DE BURBUJA PEQUEÑO 130x180+45mm', '{"SEP": -5380.0, "OCT": -8820.0, "NOV": -6400.0, "DIC": 0.0, "ENE": 0.0, "FEB": 0.0, "MAR": -6400.0, "ABR": -6000.0, "MAY": -9000.0, "JUN": 0.0, "JUL": -1900.0}'::jsonb, 5000, 68800, 40000, 17
FROM public.plantilla_proyeccion WHERE codigo = 'IMP_STO';
INSERT INTO public.item_proyeccion (id_plantilla, nombre_producto, datos_meses, promedio_manual, stock_manual, stock_redondeado_manual, orden_fila)
SELECT id_plantilla, 'SOBRE DE CARTON VERTICAL 250x345+50MM', '{"SEP": -6200.0, "OCT": -6559.0, "NOV": 0.0, "DIC": -6000.0, "ENE": 0.0, "FEB": 0.0, "MAR": -6600.0, "ABR": -12000.0, "MAY": -12000.0, "JUN": 0.0, "JUL": -6000.0}'::jsonb, 12000, 62300, 40000, 18
FROM public.plantilla_proyeccion WHERE codigo = 'IMP_STO';
INSERT INTO public.item_proyeccion (id_plantilla, nombre_producto, datos_meses, promedio_manual, stock_manual, stock_redondeado_manual, orden_fila)
SELECT id_plantilla, 'STRECH FILM - 15', '{"SEP": -2933.0, "OCT": -2808.0, "NOV": -2968.0, "DIC": -3432.0, "ENE": -4000.0, "FEB": -3841.0, "MAR": -4584.0, "ABR": -1920.0, "MAY": -2400.0, "JUN": -3360.0, "JUL": -708.0}'::jsonb, 2000, 54400, 10000, 19
FROM public.plantilla_proyeccion WHERE codigo = 'IMP_STO';
INSERT INTO public.item_proyeccion (id_plantilla, nombre_producto, datos_meses, promedio_manual, stock_manual, stock_redondeado_manual, orden_fila)
SELECT id_plantilla, 'STRECH FILM- 15/2Kg (EMBALAJE)', '{"SEP": -1112.0, "OCT": -1264.0, "NOV": -1007.0, "DIC": -1244.0, "ENE": -980.0, "FEB": -768.0, "MAR": -1306.0, "ABR": -576.0, "MAY": -1584.0, "JUN": -576.0, "JUL": -788.0}'::jsonb, 900, 13036, 5000, 20
FROM public.plantilla_proyeccion WHERE codigo = 'IMP_STO';
INSERT INTO public.item_proyeccion (id_plantilla, nombre_producto, datos_meses, stock_manual, stock_redondeado_manual, orden_fila)
SELECT id_plantilla, 'CERAMICO GRIS 60X60 SRK66013', '{}'::jsonb, 1329, 500, 1
FROM public.plantilla_proyeccion WHERE codigo = 'CONST';
INSERT INTO public.item_proyeccion (id_plantilla, nombre_producto, datos_meses, stock_manual, stock_redondeado_manual, orden_fila)
SELECT id_plantilla, 'PORCELANATO GRIS CHISPEADO 60X60 SRK 76121 A1', '{}'::jsonb, 471, 600, 2
FROM public.plantilla_proyeccion WHERE codigo = 'CONST';
INSERT INTO public.item_proyeccion (id_plantilla, nombre_producto, datos_meses, stock_manual, stock_redondeado_manual, orden_fila)
SELECT id_plantilla, 'CERAMICO BLANCO 30X60 LLG36001', '{}'::jsonb, 720, 400, 3
FROM public.plantilla_proyeccion WHERE codigo = 'CONST';
INSERT INTO public.item_proyeccion (id_plantilla, nombre_producto, datos_meses, stock_manual, stock_redondeado_manual, orden_fila)
SELECT id_plantilla, 'LUMINARIA HIGH BAY LED 6500K LEDVANCE 150W', '{}'::jsonb, 193, 70, 4
FROM public.plantilla_proyeccion WHERE codigo = 'CONST';
INSERT INTO public.item_proyeccion (id_plantilla, nombre_producto, datos_meses, stock_manual, stock_redondeado_manual, orden_fila)
SELECT id_plantilla, 'LUMINARIA TIPO PANEL LED 22W 2000LM', '{}'::jsonb, 90, 70, 5
FROM public.plantilla_proyeccion WHERE codigo = 'CONST';
INSERT INTO public.item_proyeccion (id_plantilla, nombre_producto, datos_meses, stock_manual, stock_redondeado_manual, orden_fila)
SELECT id_plantilla, 'LUMINARIA TIPO PANEL LED 40W 4000LM', '{}'::jsonb, 300, 80, 6
FROM public.plantilla_proyeccion WHERE codigo = 'CONST';
INSERT INTO public.item_proyeccion (id_plantilla, nombre_producto, datos_meses, stock_manual, stock_redondeado_manual, orden_fila)
SELECT id_plantilla, 'DETECTOR DE HUMO HAGROY', '{}'::jsonb, 63, 30, 7
FROM public.plantilla_proyeccion WHERE codigo = 'CONST';
INSERT INTO public.item_proyeccion (id_plantilla, nombre_producto, datos_meses, stock_manual, stock_redondeado_manual, orden_fila)
SELECT id_plantilla, 'REFLECTOR LED 200W 6500K PHILIPS', '{}'::jsonb, 75, 30, 8
FROM public.plantilla_proyeccion WHERE codigo = 'CONST';
INSERT INTO public.item_proyeccion (id_plantilla, nombre_producto, datos_meses, stock_manual, stock_redondeado_manual, orden_fila)
SELECT id_plantilla, 'ESTACION MANUAL DOBLE ACCION HAGROY', '{}'::jsonb, 46, 30, 9
FROM public.plantilla_proyeccion WHERE codigo = 'CONST';
INSERT INTO public.item_proyeccion (id_plantilla, nombre_producto, datos_meses, stock_manual, stock_redondeado_manual, orden_fila)
SELECT id_plantilla, 'SIRENA ESTROBOSCOPICA HAGROY', '{}'::jsonb, 46, 30, 10
FROM public.plantilla_proyeccion WHERE codigo = 'CONST';
INSERT INTO public.item_proyeccion (id_plantilla, nombre_producto, datos_meses, stock_manual, stock_redondeado_manual, orden_fila)
SELECT id_plantilla, 'DETECTOR DE HUMO NUMENS', '{}'::jsonb, 42, 100, 11
FROM public.plantilla_proyeccion WHERE codigo = 'CONST';
INSERT INTO public.item_proyeccion (id_plantilla, nombre_producto, datos_meses, stock_manual, stock_redondeado_manual, orden_fila)
SELECT id_plantilla, 'LUMINARIA HIGH BAY LED 6500K LEDVANCE 200W', '{}'::jsonb, 46, 40, 12
FROM public.plantilla_proyeccion WHERE codigo = 'CONST';
INSERT INTO public.item_proyeccion (id_plantilla, nombre_producto, datos_meses, stock_manual, stock_redondeado_manual, orden_fila)
SELECT id_plantilla, 'LUCES DE EMERGENCIA 8H', '{}'::jsonb, 14, 50, 13
FROM public.plantilla_proyeccion WHERE codigo = 'CONST';
INSERT INTO public.item_proyeccion (id_plantilla, nombre_producto, datos_meses, stock_manual, stock_redondeado_manual, orden_fila)
SELECT id_plantilla, 'CABLE NH -90 DE 4 MM VERDE/AMARILLO INDECO X ROLLO', '{}'::jsonb, 30, 1, 14
FROM public.plantilla_proyeccion WHERE codigo = 'CONST';
INSERT INTO public.item_proyeccion (id_plantilla, nombre_producto, datos_meses, stock_manual, stock_redondeado_manual, orden_fila)
SELECT id_plantilla, 'CABLE NH -90 DE 4 MM NEGRO INDECO X ROLLO', '{}'::jsonb, 25, 1, 15
FROM public.plantilla_proyeccion WHERE codigo = 'CONST';
INSERT INTO public.item_proyeccion (id_plantilla, nombre_producto, datos_meses, stock_manual, stock_redondeado_manual, orden_fila)
SELECT id_plantilla, 'cable NH -90 de 2.5 mm INDECO NEGRO x rollo', '{}'::jsonb, 17, 15, 16
FROM public.plantilla_proyeccion WHERE codigo = 'CONST';
INSERT INTO public.item_proyeccion (id_plantilla, nombre_producto, datos_meses, stock_manual, stock_redondeado_manual, orden_fila)
SELECT id_plantilla, 'BATERIA 12V/7AH P/ PANEL', '{}'::jsonb, 22, 30, 17
FROM public.plantilla_proyeccion WHERE codigo = 'CONST';
INSERT INTO public.item_proyeccion (id_plantilla, nombre_producto, datos_meses, stock_manual, stock_redondeado_manual, orden_fila)
SELECT id_plantilla, 'cable NH -90 de 2.5 mm INDECO ROJO x rollo', '{}'::jsonb, 15, 15, 18
FROM public.plantilla_proyeccion WHERE codigo = 'CONST';
INSERT INTO public.item_proyeccion (id_plantilla, nombre_producto, datos_meses, stock_manual, stock_redondeado_manual, orden_fila)
SELECT id_plantilla, 'PANEL CONVENCIONAL 5 ZONAS', '{}'::jsonb, 11, 15, 19
FROM public.plantilla_proyeccion WHERE codigo = 'CONST';
INSERT INTO public.item_proyeccion (id_plantilla, nombre_producto, datos_meses, stock_manual, stock_redondeado_manual, orden_fila)
SELECT id_plantilla, 'LUMINARIA HIGH BAY LED 6500K PHILIPS 100W', '{}'::jsonb, 3, 0, 20
FROM public.plantilla_proyeccion WHERE codigo = 'CONST';
INSERT INTO public.item_proyeccion (id_plantilla, nombre_producto, datos_meses, stock_manual, stock_redondeado_manual, orden_fila)
SELECT id_plantilla, 'cable NH -90 de 2.5 mm INDECO AZUL x rollo', '{}'::jsonb, 13, 15, 21
FROM public.plantilla_proyeccion WHERE codigo = 'CONST';
INSERT INTO public.item_proyeccion (id_plantilla, nombre_producto, datos_meses, stock_manual, stock_redondeado_manual, orden_fila)
SELECT id_plantilla, 'cable NH -90 de 2.5 mm INDECO TIERRA AMARILLO/VERDE x rollo', '{}'::jsonb, 12, 12, 22
FROM public.plantilla_proyeccion WHERE codigo = 'CONST';
INSERT INTO public.item_proyeccion (id_plantilla, nombre_producto, datos_meses, stock_manual, stock_redondeado_manual, orden_fila)
SELECT id_plantilla, 'CABLE NH -90 DE 4 MM AZUL INDECO X ROLLO', '{}'::jsonb, 9, 15, 23
FROM public.plantilla_proyeccion WHERE codigo = 'CONST';
INSERT INTO public.item_proyeccion (id_plantilla, nombre_producto, datos_meses, stock_manual, stock_redondeado_manual, orden_fila)
SELECT id_plantilla, 'CABLE NH -90 DE 4 MM BLANCO INDECO X ROLLO', '{}'::jsonb, 9, 1, 24
FROM public.plantilla_proyeccion WHERE codigo = 'CONST';
INSERT INTO public.item_proyeccion (id_plantilla, nombre_producto, datos_meses, stock_manual, stock_redondeado_manual, orden_fila)
SELECT id_plantilla, 'CABLE NH -90 DE 4 MM ROJO INDECO X ROLLO', '{}'::jsonb, 9, 10, 25
FROM public.plantilla_proyeccion WHERE codigo = 'CONST';
INSERT INTO public.item_proyeccion (id_plantilla, nombre_producto, datos_meses, stock_manual, stock_redondeado_manual, orden_fila)
SELECT id_plantilla, 'ESTACION MANUAL DOBLE ACCION FIRE-LITE', '{}'::jsonb, 5, 12, 26
FROM public.plantilla_proyeccion WHERE codigo = 'CONST';
INSERT INTO public.item_proyeccion (id_plantilla, nombre_producto, datos_meses, stock_manual, stock_redondeado_manual, orden_fila)
SELECT id_plantilla, 'CABLE NH -90 DE 6 MM AZUL INDECO X ROLLO', '{}'::jsonb, 8, 1, 27
FROM public.plantilla_proyeccion WHERE codigo = 'CONST';
INSERT INTO public.item_proyeccion (id_plantilla, nombre_producto, datos_meses, stock_manual, stock_redondeado_manual, orden_fila)
SELECT id_plantilla, 'CABLE NH -90 DE 6 MM NEGRO INDECO X ROLLO', '{}'::jsonb, 8, 1, 28
FROM public.plantilla_proyeccion WHERE codigo = 'CONST';
INSERT INTO public.item_proyeccion (id_plantilla, nombre_producto, datos_meses, stock_manual, stock_redondeado_manual, orden_fila)
SELECT id_plantilla, 'SIRENA SYSTEM SENSOR (SIRENA ESTROBOSCOPICA SYSTEM SENSOR)', '{}'::jsonb, 5, 12, 29
FROM public.plantilla_proyeccion WHERE codigo = 'CONST';
INSERT INTO public.item_proyeccion (id_plantilla, nombre_producto, datos_meses, stock_manual, stock_redondeado_manual, orden_fila)
SELECT id_plantilla, 'CABLE NH -90 DE 6 MM ROJO INDECO X ROLLO', '{}'::jsonb, 7, 1, 30
FROM public.plantilla_proyeccion WHERE codigo = 'CONST';
INSERT INTO public.item_proyeccion (id_plantilla, nombre_producto, datos_meses, stock_manual, stock_redondeado_manual, orden_fila)
SELECT id_plantilla, 'CABLE FPLR 2X18 CALIBRE 18 AWG - 305 METROS', '{}'::jsonb, 5, 0, 31
FROM public.plantilla_proyeccion WHERE codigo = 'CONST';
INSERT INTO public.item_proyeccion (id_plantilla, nombre_producto, datos_meses, stock_manual, stock_redondeado_manual, orden_fila)
SELECT id_plantilla, 'DETECTOR PHOTOBEAN HAGROY', '{}'::jsonb, 5, 30, 32
FROM public.plantilla_proyeccion WHERE codigo = 'CONST';
INSERT INTO public.item_proyeccion (id_plantilla, nombre_producto, datos_meses, stock_manual, stock_redondeado_manual, orden_fila)
SELECT id_plantilla, 'REFLECTOR LED 300W 6500K PHILIPS', '{}'::jsonb, 16, 0, 33
FROM public.plantilla_proyeccion WHERE codigo = 'CONST';
INSERT INTO public.item_proyeccion (id_plantilla, nombre_producto, datos_meses, stock_manual, stock_redondeado_manual, orden_fila)
SELECT id_plantilla, 'CABLE NH -90 DE 6 MM BLANCO X ROLLO', '{}'::jsonb, 5, 1, 34
FROM public.plantilla_proyeccion WHERE codigo = 'CONST';
INSERT INTO public.item_proyeccion (id_plantilla, nombre_producto, datos_meses, stock_manual, stock_redondeado_manual, orden_fila)
SELECT id_plantilla, 'CABLE NH -90 DE 6 MM VERDE/AMARILLO X ROLLO', '{}'::jsonb, 5, 1, 35
FROM public.plantilla_proyeccion WHERE codigo = 'CONST';
INSERT INTO public.item_proyeccion (id_plantilla, nombre_producto, datos_meses, stock_manual, stock_redondeado_manual, orden_fila)
SELECT id_plantilla, 'DETECTOR PHOTOBEAN GST', '{}'::jsonb, 1, 4, 36
FROM public.plantilla_proyeccion WHERE codigo = 'CONST';
INSERT INTO public.item_proyeccion (id_plantilla, nombre_producto, datos_meses, stock_manual, stock_redondeado_manual, orden_fila)
SELECT id_plantilla, 'PANEL RAVEL 08 ZONAS (PANEL RAVEL 08 ZONAS 2 HILOS CERT UL)', '{}'::jsonb, 2, 5, 37
FROM public.plantilla_proyeccion WHERE codigo = 'CONST';
INSERT INTO public.item_proyeccion (id_plantilla, nombre_producto, datos_meses, stock_manual, stock_redondeado_manual, orden_fila)
SELECT id_plantilla, 'PANEL RAVEL 04 ZONAS 2 HILOS CERT UL (PANEL RAVEL 04 ZONAS)', '{}'::jsonb, 2, 0, 38
FROM public.plantilla_proyeccion WHERE codigo = 'CONST';
-- >>> 202609020025_modulo6_rango_meses_y_formulas_dinamicas.sql
-- ==============================================================================
-- Migración: Módulo 06 - Rango dinámico de meses y fórmulas por columna
-- Proyecto: Importaciones Shalom
-- Fecha: 2026-10-22
-- ==============================================================================


-- 1. Agregar columnas para selección de rango de meses y fórmulas dinámicas a plantilla_proyeccion
ALTER TABLE public.plantilla_proyeccion
  ADD COLUMN IF NOT EXISTS mes_inicio_promedio varchar DEFAULT 'SEP',
  ADD COLUMN IF NOT EXISTS mes_fin_promedio varchar DEFAULT 'JUL',
  ADD COLUMN IF NOT EXISTS ignorar_meses_cero boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS formula_stock_redondeado varchar DEFAULT 'REDONDEAR_COMERCIAL(stock_min_f)';

-- 2. Asegurar que las plantillas por defecto tengan sus rangos de meses configurados
UPDATE public.plantilla_proyeccion
SET 
  mes_inicio_promedio = COALESCE(mes_inicio_promedio, 'SEP'),
  mes_fin_promedio = COALESCE(mes_fin_promedio, 'JUL'),
  ignorar_meses_cero = COALESCE(ignorar_meses_cero, true)
WHERE codigo = 'IMP_STO';

-- CONST no usa columnas de meses: rango NULL (coincide con el fallback de projectionService.ts)
UPDATE public.plantilla_proyeccion
SET
  mes_inicio_promedio = NULL,
  mes_fin_promedio = NULL,
  ignorar_meses_cero = COALESCE(ignorar_meses_cero, true)
WHERE codigo = 'CONST';

-- >>> 202609020026_modulo6_columnas_personalizadas_proyeccion.sql
-- ==============================================================================
-- Migración: Módulo 06 - Columnas personalizadas con dinámica de ecuaciones Excel
-- Proyecto: Importaciones Shalom
-- Fecha: 2026-10-26
-- ==============================================================================


-- 1. Agregar columna para almacenar definiciones de columnas personalizadas y sus ecuaciones en formato JSONB
ALTER TABLE public.plantilla_proyeccion
  ADD COLUMN IF NOT EXISTS columnas_personalizadas jsonb NOT NULL DEFAULT '[]'::jsonb;


-- 0027: vínculo orden -> plantilla (las demás columnas ya existían)
alter table public.orden_importacion
  add column if not exists id_plantilla bigint references public.plantilla_proyeccion(id_plantilla) on delete set null;

grant select, insert, update, delete on public.plantilla_proyeccion, public.item_proyeccion to authenticated;

-- ------------------------------------------------------------------------------
-- MÓDULO 7: control de contenedores (de 202609020028, con RLS por rol)
-- ------------------------------------------------------------------------------
create table if not exists public.control_contenedor (
  id_contenedor bigserial primary key,
  numero_contenedor varchar(50) not null,
  placa_camion varchar(20) not null,
  empresa_transporte varchar(150),
  nombre_conductor varchar(150),
  telefono_conductor varchar(50),
  hora_llegada_contenedor timestamptz not null default now(),
  hora_salida_contenedor timestamptz,
  tipo_personal varchar(30) not null default 'PROPIO' check (tipo_personal in ('PROPIO', 'CUADRILLA_EXTERNA')),
  nombre_cuadrilla varchar(150),
  num_estibadores integer default 0,
  hora_llegada_cuadrilla timestamptz,
  hora_salida_cuadrilla timestamptz,
  fotos jsonb not null default '[]'::jsonb,
  estado varchar(30) not null default 'EN_PATIO' check (estado in ('EN_PATIO', 'EN_DESCARGA', 'DESCARGADO', 'DESPACHADO')),
  observaciones text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_contenedor_activo on public.control_contenedor (hora_salida_contenedor) where hora_salida_contenedor is null;
create index if not exists idx_contenedor_numero on public.control_contenedor (numero_contenedor);
create index if not exists idx_contenedor_placa on public.control_contenedor (placa_camion);

alter table public.sesion_recepcion
  add column if not exists id_contenedor bigint references public.control_contenedor(id_contenedor) on delete set null;
alter table public.recepcion_lectura
  add column if not exists id_contenedor bigint references public.control_contenedor(id_contenedor) on delete set null;

alter table public.control_contenedor enable row level security;
drop policy if exists "control_contenedor_lectura" on public.control_contenedor;
create policy "control_contenedor_lectura" on public.control_contenedor
  for select to authenticated
  using (public.tiene_rol(array['ADMINISTRADOR', 'COMPRADOR', 'OPERARIO', 'AUDITOR']));
drop policy if exists "control_contenedor_gestion" on public.control_contenedor;
create policy "control_contenedor_gestion" on public.control_contenedor
  for all to authenticated
  using (public.tiene_rol(array['ADMINISTRADOR', 'COMPRADOR', 'OPERARIO']))
  with check (public.tiene_rol(array['ADMINISTRADOR', 'COMPRADOR', 'OPERARIO']));
grant select, insert, update, delete on public.control_contenedor to authenticated;
grant usage, select on sequence public.control_contenedor_id_contenedor_seq to authenticated;

-- ------------------------------------------------------------------------------
-- MÓDULO 8: RPC admin_cambiar_password (de 202609020020)
-- ------------------------------------------------------------------------------
create or replace function public.admin_cambiar_password(p_id_usuario bigint, p_nueva_password text)
returns boolean
language plpgsql security definer
set search_path = public, auth, extensions
as $$
declare
  v_auth_user_id uuid;
begin
  if not public.tiene_rol(array['ADMINISTRADOR']) then
    raise exception 'Acceso denegado: solo un administrador puede cambiar contraseñas.';
  end if;
  if length(trim(p_nueva_password)) < 6 then
    raise exception 'La contraseña debe tener al menos 6 caracteres.';
  end if;
  select auth_user_id into v_auth_user_id from public.usuario where id_usuario = p_id_usuario;
  if v_auth_user_id is null then
    raise exception 'El usuario no tiene una cuenta de autenticación vinculada en auth.users.';
  end if;
  update auth.users
  set encrypted_password = extensions.crypt(trim(p_nueva_password), extensions.gen_salt('bf')),
      updated_at = now()
  where id = v_auth_user_id;
  return true;
end;
$$;

-- ------------------------------------------------------------------------------
-- SEGURIDAD (advisors de Supabase)
-- ------------------------------------------------------------------------------
-- 1. Ninguna función de public ejecutable sin sesión (anon)
revoke execute on all functions in schema public from anon, public;
alter default privileges in schema public revoke execute on functions from anon, public;

-- 2. RPCs que la app llama con sesión iniciada
grant execute on function public.tiene_rol(text[]) to authenticated;
grant execute on function public.es_administrador() to authenticated;
grant execute on function public.mi_perfil_acceso() to authenticated;
grant execute on function public.ajustar_inventario_paletas(bigint, bigint, integer, integer, text) to authenticated;
grant execute on function public.admin_cambiar_password(bigint, text) to authenticated;
grant execute on function public.asegurar_zona_campo(bigint) to authenticated;
grant execute on function public.conciliar_recepcion(bigint, bigint, bigint, jsonb, text) to authenticated;
grant execute on function public.configurar_carril_drivein(bigint, varchar, varchar, jsonb) to authenticated;
grant execute on function public.dar_baja_etiqueta_rfid(text, text) to authenticated;
grant execute on function public.ejecutar_movimiento_despacho(bigint, jsonb) to authenticated;
grant execute on function public.eliminar_paleta_liberar_codigo(varchar, bigint, text) to authenticated;
grant execute on function public.eliminar_paleta_liberar_codigo(bigint, varchar, bigint) to authenticated;
grant execute on function public.generar_uid_rfid(bigint) to authenticated;
grant execute on function public.resolver_alerta(bigint) to authenticated;
grant execute on function public.sincronizar_stock_con_paletas_almacen(bigint) to authenticated;
grant execute on function public.sugerir_uid_rfid(bigint) to authenticated;
grant execute on function public.transferir_carga_entre_almacenes(text, bigint, bigint, text) to authenticated;

-- 3. Funciones de trigger / internas: no expuestas vía /rest/v1/rpc
--    (los triggers siguen funcionando: EXECUTE solo se valida al crear el trigger)
revoke execute on function public.fn_auto_prefijo_almacen() from authenticated;
revoke execute on function public.fn_validar_regla_empaque_modo() from authenticated;
revoke execute on function public.trg_archivar_asignacion_etiqueta() from authenticated;
revoke execute on function public.rls_auto_enable() from authenticated;
revoke execute on function public._asignar_etiqueta_rfid(text, bigint, public.tipo_paleta, integer, numeric, bigint, text) from authenticated;

-- 4. search_path fijo
alter function public.eliminar_paleta_liberar_codigo(varchar, bigint, text) set search_path = public;
alter function public.eliminar_paleta_liberar_codigo(bigint, varchar, bigint) set search_path = public;
alter function public.fn_auto_prefijo_almacen() set search_path = public;

-- 5. Vista respetando RLS del usuario que consulta
alter view public.v_stock_por_sku set (security_invoker = true);
