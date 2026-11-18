-- ==============================================================================
-- Migración: Modelo de empaque de 3 modos (Paletizado, Por caja, Serializado)
-- Proyecto: Importaciones Shalom (pzsxzzfrwpamjkyyjodj)
-- Fecha: 2026-11-17
--
-- Reglas acordadas con el usuario:
--   * El modo de manejo se define SOLO por la categoría.
--   * PALETIZADO: unidad -> empaque -> fila -> paleta. Paletas completas siempre
--     cerradas. Máx. 1 pucho por producto y almacén; el pucho puede tener máx.
--     1 empaque abierto (unidades sueltas).
--   * POR CAJA (código PICKING_CAJA): unidad -> caja. Sin paletas ni tags.
--     Stock = cajas cerradas + máx. 1 caja abierta.
--   * SERIALIZADO: 1 unidad = 1 número de serie. Sin tag RFID.
--   * Solo las paletas (completas y puchos) llevan tag RFID.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Modos de manejo: 3 activos, el resto desactivado (no se borra)
-- ------------------------------------------------------------------------------
update public.modo_manejo set
  nombre = 'Paletizado',
  descripcion = 'Unidad, empaque, fila y paleta. Paletas con tag RFID; máximo 1 pucho con 1 empaque abierto.',
  requiere_regla_empaque = true, requiere_serie = false, permite_puchos = true, activo = true
where codigo = 'PALETIZADO';

update public.modo_manejo set
  nombre = 'Por caja',
  descripcion = 'Unidad y caja, sin paletizar. Control por conteo: cajas cerradas y máximo 1 caja abierta.',
  requiere_regla_empaque = true, requiere_serie = false, permite_puchos = false, activo = true
where codigo = 'PICKING_CAJA';

update public.modo_manejo set
  nombre = 'Serializado',
  descripcion = 'Maquinaria y equipos. Cada unidad se identifica por su número de serie de fábrica.',
  requiere_regla_empaque = false, requiere_serie = true, permite_puchos = false, activo = true
where codigo = 'SERIALIZADO';

update public.modo_manejo set activo = false
where codigo in ('GRANEL', 'LOTE', 'LARGO', 'PESO_VARIABLE', 'PERECEDERO', 'PELIGROSO');

-- ------------------------------------------------------------------------------
-- 2. Regla de empaque: tipo de empaque (solo para mostrar "paquete", "caja", etc.)
--    cajas_por_camada  = "Empaques por fila"   (UI)
--    numero_camadas    = "Filas por paleta"    (UI)
--    Para POR CAJA ambos quedan en 1 y la UI no los pide.
-- ------------------------------------------------------------------------------
alter table public.regla_empaque
  add column if not exists tipo_empaque varchar(20) not null default 'CAJA';

alter table public.regla_empaque drop constraint if exists regla_empaque_tipo_empaque_chk;
alter table public.regla_empaque add constraint regla_empaque_tipo_empaque_chk
  check (tipo_empaque in ('CAJA', 'PAQUETE', 'BOLSA', 'ROLLO', 'FARDO'));

update public.regla_empaque r set tipo_empaque = 'PAQUETE'
from public.producto p
where p.id_producto = r.id_producto and p.nombre ilike '%paquete%' and r.tipo_empaque = 'CAJA';

-- ------------------------------------------------------------------------------
-- 3. Empaque abierto
--    * etiqueta_rfid.unidades_sueltas: unidades del empaque abierto del PUCHO.
--      cantidad_paquetes = empaques cerrados; cantidad_actual = total de unidades.
--    * inventario.cajas_cerradas / unidades_caja_abierta: solo modo POR CAJA.
-- ------------------------------------------------------------------------------
alter table public.etiqueta_rfid
  add column if not exists unidades_sueltas numeric not null default 0;
alter table public.etiqueta_rfid drop constraint if exists etiqueta_unidades_sueltas_chk;
alter table public.etiqueta_rfid add constraint etiqueta_unidades_sueltas_chk
  check (unidades_sueltas >= 0 and (tipo_paleta = 'PUCHO' or unidades_sueltas = 0));

alter table public.inventario
  add column if not exists cajas_cerradas integer not null default 0,
  add column if not exists unidades_caja_abierta numeric not null default 0;
alter table public.inventario drop constraint if exists inventario_cajas_chk;
alter table public.inventario add constraint inventario_cajas_chk
  check (cajas_cerradas >= 0 and unidades_caja_abierta >= 0);

-- El empaque abierto nunca puede tener tantas unidades como uno lleno
create or replace function public.fn_validar_empaque_abierto()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_upc integer;
  v_sueltas numeric;
begin
  select unidades_por_caja into v_upc from public.regla_empaque where id_producto = new.id_producto;
  if v_upc is null then
    return new;
  end if;

  if tg_table_name = 'etiqueta_rfid' then
    v_sueltas := new.unidades_sueltas;
  else
    v_sueltas := new.unidades_caja_abierta;
  end if;

  if v_sueltas >= v_upc then
    raise exception 'El empaque abierto tiene % unidades y el empaque completo es de %: debe registrarse como empaque cerrado.', v_sueltas, v_upc;
  end if;
  return new;
end;
$$;
revoke execute on function public.fn_validar_empaque_abierto() from anon, authenticated, public;

drop trigger if exists trg_validar_empaque_abierto on public.etiqueta_rfid;
create trigger trg_validar_empaque_abierto
  before insert or update of unidades_sueltas on public.etiqueta_rfid
  for each row when (new.unidades_sueltas > 0)
  execute function public.fn_validar_empaque_abierto();

drop trigger if exists trg_validar_caja_abierta on public.inventario;
create trigger trg_validar_caja_abierta
  before insert or update of unidades_caja_abierta on public.inventario
  for each row when (new.unidades_caja_abierta > 0)
  execute function public.fn_validar_empaque_abierto();

-- ------------------------------------------------------------------------------
-- 4. Categorías nuevas (el modo lo define la categoría)
-- ------------------------------------------------------------------------------
update public.categoria set nombre = 'Maquinaria y equipos',
  descripcion = 'Maquinaria y equipos controlados por número de serie', modo_manejo = 'SERIALIZADO', activo = true
where nombre = 'Maquinaria';

update public.categoria set nombre = 'Herramientas',
  descripcion = 'Herramientas menores', modo_manejo = 'PICKING_CAJA', activo = true
where nombre = 'HERRAMIENTAS';

insert into public.categoria (nombre, descripcion, modo_manejo, activo) values
  ('Embalaje y paquetería', 'Paquetes, bolsas de seguridad, sobres, burbupack y sacos', 'PALETIZADO', true),
  ('Cintas, film y precintos', 'Cintas de embalaje, stretch film, precintos y rollos', 'PALETIZADO', true),
  ('Cerámicos y porcelanatos', 'Cerámicos y porcelanatos para construcción', 'PALETIZADO', true),
  ('Iluminación', 'Luminarias, paneles LED, reflectores y luces de emergencia', 'PICKING_CAJA', true),
  ('Seguridad contra incendios', 'Detectores, sirenas, estaciones manuales, paneles y baterías', 'PICKING_CAJA', true),
  ('Material eléctrico', 'Cables por rollo', 'PICKING_CAJA', true)
on conflict (nombre) do update set
  descripcion = excluded.descripcion, modo_manejo = excluded.modo_manejo, activo = true;

-- Reasignación de los productos actuales (por SKU)
update public.producto set id_categoria = (select id_categoria from public.categoria where nombre = 'Embalaje y paquetería')
where sku in ('SKU-0004', 'SKU-0005', 'SKU-0006', 'SKU-0007', 'SKU-0008', 'SKU-0009',
              'SKU-0010', 'SKU-0011', 'SKU-0012', 'SKU-0015', 'SKU-0016');

update public.producto set id_categoria = (select id_categoria from public.categoria where nombre = 'Cintas, film y precintos')
where sku in ('SKU-0001', 'SKU-0002', 'SKU-0003', 'SKU-0013', 'SKU-0014', 'SKU-0017', 'SKU-0018',
              'SKU-0019', 'SKU-0020', 'ROLLO-CONTOMETRO-01', 'CINTA-EMBALAJE-02');

update public.producto set id_categoria = (select id_categoria from public.categoria where nombre = 'Seguridad contra incendios')
where sku = 'SKU-00022';

update public.producto set id_categoria = (select id_categoria from public.categoria where nombre = 'Maquinaria y equipos')
where sku = 'SKU-00021';

-- Categorías antiguas: se desactivan (quedan sin productos)
update public.categoria set activo = false
where nombre in ('VENTAS', 'SUMINISTRO', 'SERVICIO DE EMBALAJE', 'Suministros y Empaques',
                 'Papelería y Suministros', 'Ferretería Industrial', 'Carga Pesada / Sobredimensionada');

-- ------------------------------------------------------------------------------
-- 5. Conversión de datos existentes
-- ------------------------------------------------------------------------------
-- 5a. Productos POR CAJA que tenían paletas con tag: el stock pasa a conteo de
--     cajas (cerradas + 1 abierta) y los tags se cierran (quedan en el historial).
insert into public.inventario (id_producto, id_almacen, stock_real, stock_minimo, cajas_cerradas, unidades_caja_abierta)
select e.id_producto, e.id_almacen_actual,
       sum(e.cantidad_actual),
       r.unidades_por_caja,
       floor(sum(e.cantidad_actual) / r.unidades_por_caja)::integer,
       mod(sum(e.cantidad_actual), r.unidades_por_caja)
from public.etiqueta_rfid e
join public.producto p on p.id_producto = e.id_producto
join public.categoria c on c.id_categoria = p.id_categoria
join public.regla_empaque r on r.id_producto = e.id_producto
where c.modo_manejo = 'PICKING_CAJA' and e.estado = 'ACTIVA' and e.id_almacen_actual is not null
group by e.id_producto, e.id_almacen_actual, r.unidades_por_caja
on conflict (id_producto, id_almacen) do update set
  stock_real = excluded.stock_real,
  cajas_cerradas = excluded.cajas_cerradas,
  unidades_caja_abierta = excluded.unidades_caja_abierta;

update public.etiqueta_rfid e set
  estado = 'VACIA', id_almacen_actual = null, id_celda = null,
  notas = 'Cerrado por migración: el producto pasó a modo Por caja (sin tags)'
from public.producto p
join public.categoria c on c.id_categoria = p.id_categoria
where p.id_producto = e.id_producto and c.modo_manejo = 'PICKING_CAJA' and e.estado = 'ACTIVA';

-- 5b. Maquinaria: se desvincula el tag; la unidad queda identificada por su serie.
update public.etiqueta_rfid e set
  estado = 'VACIA', id_almacen_actual = null, id_celda = null,
  notas = 'Cerrado por migración: la maquinaria se controla solo por número de serie'
from public.unidad_serializada u
where u.id_etiqueta = e.id_etiqueta and e.estado = 'ACTIVA';

update public.unidad_serializada set id_etiqueta = null where id_etiqueta is not null;

-- ------------------------------------------------------------------------------
-- 6. Vista de detalle: expone tipo_empaque (columna nueva al final)
-- ------------------------------------------------------------------------------
create or replace view public.v_producto_detalle with (security_invoker = true) as
select p.id_producto, p.sku, p.nombre, p.descripcion, p.unidad_medida, p.peso_unitario_kg,
  p.costo_unitario, p.clasificacion_abc, p.activo as producto_activo, p.created_at,
  c.id_categoria, c.nombre as categoria_nombre, c.descripcion as categoria_descripcion,
  c.activo as categoria_activo,
  coalesce(c.modo_manejo, 'PALETIZADO'::character varying) as modo_manejo,
  m.nombre as modo_manejo_nombre, m.descripcion as modo_manejo_descripcion,
  coalesce(m.requiere_regla_empaque, true) as requiere_regla_empaque,
  coalesce(m.requiere_serie, false) as requiere_serie,
  coalesce(m.permite_puchos, true) as permite_puchos,
  r.id_empaque, r.unidades_por_caja, r.cajas_por_camada, r.numero_camadas,
  coalesce(r.cajas_por_camada, 0) * coalesce(r.numero_camadas, 0) as cajas_por_paleta,
  coalesce(r.cajas_por_camada, 0) * coalesce(r.numero_camadas, 0) * coalesce(r.unidades_por_caja, 0) as unidades_por_paleta,
  r.permite_puchos as empaque_permite_puchos, r.notas_armado, r.imagen_armado_path,
  r.largo_caja_cm, r.ancho_caja_cm, r.alto_caja_cm, r.peso_caja_kg,
  case when r.largo_caja_cm is not null and r.ancho_caja_cm is not null and r.alto_caja_cm is not null
    then round(r.largo_caja_cm * r.ancho_caja_cm * r.alto_caja_cm / 1000000.0, 4) end as volumen_caja_m3,
  case when r.largo_caja_cm is not null and r.ancho_caja_cm is not null and r.alto_caja_cm is not null
         and r.cajas_por_camada is not null and r.numero_camadas is not null
    then round(r.largo_caja_cm * r.ancho_caja_cm * r.alto_caja_cm / 1000000.0 * (r.cajas_por_camada * r.numero_camadas)::numeric, 4) end as volumen_paleta_m3,
  ps.peso_unitario_kg as serial_peso_unitario_kg, ps.largo_cm as serial_largo_cm,
  ps.ancho_cm as serial_ancho_cm, ps.alto_cm as serial_alto_cm,
  ps.requiere_equipo_izaje as serial_requiere_equipo_izaje,
  ps.ubicacion_permitida as serial_ubicacion_permitida,
  ps.atributos as serial_atributos, ps.notas as serial_notas,
  r.tipo_empaque
from public.producto p
left join public.categoria c on c.id_categoria = p.id_categoria
left join public.modo_manejo m on m.codigo::text = coalesce(c.modo_manejo, 'PALETIZADO'::character varying)::text
left join public.regla_empaque r on r.id_producto = p.id_producto
left join public.perfil_serializado ps on ps.id_producto = p.id_producto;
