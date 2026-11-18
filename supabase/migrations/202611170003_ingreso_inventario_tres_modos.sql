-- ==============================================================================
-- Migración: Ingreso de inventario atómico para los 3 modos (MOD-02)
-- Proyecto: Importaciones Shalom (pzsxzzfrwpamjkyyjodj)
-- Fecha: 2026-11-17
--
-- Reemplaza las escrituras directas del frontend (que sumaban el stock dos veces)
-- por una sola transacción por ingreso:
--   * registrar_ingreso_inventario: paleta/pucho (Paletizado), cajas (Por caja),
--     equipo por número de serie (Serializado). Suma stock y registra Kardex.
--   * ajustar_conteo_cajas: conteo físico absoluto para productos Por caja.
-- ==============================================================================

create or replace function public.registrar_ingreso_inventario(
  p_id_producto bigint,
  p_id_almacen bigint,
  p_datos jsonb,
  p_motivo text default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_modo varchar;
  v_upc integer;
  v_por_paleta integer;
  v_id_usuario bigint;
  v_unidades numeric := 0;
  v_tipo_mov public.movimiento_tipo := 'INGRESO_COMPLETO';
  v_id_etiqueta bigint;
  v_detalle text;
  -- paletizado
  v_uid text;
  v_tipo_paleta public.tipo_paleta;
  v_empaques integer;
  v_sueltas numeric;
  v_tag record;
  v_id_campo bigint;
  -- por caja
  v_cajas integer;
  v_cerradas integer;
  v_abierta numeric;
  -- serializado
  v_serie text;
  v_estado text;
  v_stock numeric;
  v_minimo numeric;
begin
  if not public.tiene_rol(array['ADMINISTRADOR', 'OPERARIO']) then
    raise exception 'Acceso denegado: solo Administrador u Operario pueden ingresar stock.';
  end if;

  select coalesce(c.modo_manejo, 'PALETIZADO'), r.unidades_por_caja,
         coalesce(r.cajas_por_camada, 1) * coalesce(r.numero_camadas, 1)
  into v_modo, v_upc, v_por_paleta
  from public.producto p
  left join public.categoria c on c.id_categoria = p.id_categoria
  left join public.regla_empaque r on r.id_producto = p.id_producto
  where p.id_producto = p_id_producto;

  if not found then
    raise exception 'Producto % no encontrado.', p_id_producto;
  end if;
  if not exists (select 1 from public.almacen where id_almacen = p_id_almacen and activo) then
    raise exception 'El almacén % no existe o está inactivo.', p_id_almacen;
  end if;

  select id_usuario into v_id_usuario from public.usuario where auth_user_id = auth.uid();

  -- ---------------------------------------------------------------- PALETIZADO
  if v_modo = 'PALETIZADO' then
    if v_upc is null then
      raise exception 'El producto no tiene regla de empaque: complétala en Maestros y empaque.';
    end if;

    v_uid := upper(trim(coalesce(p_datos->>'uid_tag', '')));
    v_tipo_paleta := coalesce(p_datos->>'tipo_paleta', 'COMPLETO')::public.tipo_paleta;
    if v_uid = '' then
      raise exception 'El código del tag RFID es obligatorio.';
    end if;

    if v_tipo_paleta = 'COMPLETO' then
      v_empaques := v_por_paleta;
      v_sueltas := 0;
    else
      v_empaques := coalesce((p_datos->>'empaques')::integer, 0);
      v_sueltas := coalesce((p_datos->>'unidades_sueltas')::numeric, 0);
      if v_empaques < 0 or v_sueltas < 0 or (v_empaques = 0 and v_sueltas = 0) then
        raise exception 'Indica los empaques cerrados y/o las unidades sueltas del pucho.';
      end if;
      if v_sueltas >= v_upc then
        raise exception 'Las unidades sueltas (%) completan un empaque de %: regístralas como empaque cerrado.', v_sueltas, v_upc;
      end if;
      if v_empaques >= v_por_paleta then
        raise exception 'Un pucho debe tener menos de % empaques; con esa cantidad es una paleta completa.', v_por_paleta;
      end if;
      if exists (select 1 from public.etiqueta_rfid where id_producto = p_id_producto
                   and id_almacen_actual = p_id_almacen and tipo_paleta = 'PUCHO' and estado = 'ACTIVA') then
        raise exception 'Ya existe un pucho activo de este producto en el almacén: solo se permite uno.';
      end if;
    end if;

    v_unidades := v_empaques * v_upc + v_sueltas;
    v_tipo_mov := case when v_tipo_paleta = 'COMPLETO' then 'INGRESO_COMPLETO' else 'INGRESO_PUCHO' end;
    v_id_campo := public.asegurar_zona_campo(p_id_almacen);

    select id_etiqueta, estado into v_tag from public.etiqueta_rfid where uid_tag = v_uid for update;
    if found and v_tag.estado = 'ACTIVA' then
      raise exception 'El tag % ya está activo en otra paleta.', v_uid;
    end if;

    if found then
      update public.etiqueta_rfid set
        id_producto = p_id_producto, id_almacen_actual = p_id_almacen, id_celda = v_id_campo,
        tipo_paleta = v_tipo_paleta, cantidad_paquetes = v_empaques, cantidad_actual = v_unidades,
        unidades_sueltas = v_sueltas, estado = 'ACTIVA', fecha_enrolamiento = now(),
        notas = 'Reactivada por ingreso en almacén'
      where id_etiqueta = v_tag.id_etiqueta
      returning id_etiqueta into v_id_etiqueta;
    else
      insert into public.etiqueta_rfid (uid_tag, id_producto, id_almacen_actual, id_celda, tipo_paleta,
        cantidad_paquetes, cantidad_actual, unidades_sueltas, estado)
      values (v_uid, p_id_producto, p_id_almacen, v_id_campo, v_tipo_paleta,
        v_empaques, v_unidades, v_sueltas, 'ACTIVA')
      returning id_etiqueta into v_id_etiqueta;
    end if;

    v_detalle := format('%s %s: %s empaques%s = %s u',
      case when v_tipo_paleta = 'COMPLETO' then 'Paleta' else 'Pucho' end, v_uid, v_empaques,
      case when v_sueltas > 0 then format(' + %s u sueltas', v_sueltas) else '' end, v_unidades);
    v_minimo := v_por_paleta * v_upc;

  -- ---------------------------------------------------------------- POR CAJA
  elsif v_modo = 'PICKING_CAJA' then
    if v_upc is null then
      raise exception 'El producto no tiene regla de empaque: complétala en Maestros y empaque.';
    end if;

    v_cajas := coalesce((p_datos->>'cajas')::integer, 0);
    v_sueltas := coalesce((p_datos->>'unidades_sueltas')::numeric, 0);
    if v_cajas < 0 or v_sueltas < 0 or (v_cajas = 0 and v_sueltas = 0) then
      raise exception 'Indica las cajas cerradas y/o las unidades sueltas a ingresar.';
    end if;
    if v_sueltas >= v_upc then
      raise exception 'Las unidades sueltas (%) completan una caja de %: regístralas como caja cerrada.', v_sueltas, v_upc;
    end if;

    select cajas_cerradas, unidades_caja_abierta into v_cerradas, v_abierta
    from public.inventario where id_producto = p_id_producto and id_almacen = p_id_almacen for update;
    v_cerradas := coalesce(v_cerradas, 0) + v_cajas;
    v_abierta := coalesce(v_abierta, 0) + v_sueltas;
    -- Regla: máximo 1 caja abierta. Si las sueltas completan la caja abierta, se cierra.
    if v_abierta >= v_upc then
      v_cerradas := v_cerradas + floor(v_abierta / v_upc)::integer;
      v_abierta := mod(v_abierta, v_upc);
    end if;

    v_unidades := v_cajas * v_upc + v_sueltas;
    v_detalle := format('%s cajas cerradas%s = %s u', v_cajas,
      case when v_sueltas > 0 then format(' + %s u sueltas', v_sueltas) else '' end, v_unidades);
    v_minimo := v_upc;

  -- ---------------------------------------------------------------- SERIALIZADO
  elsif v_modo = 'SERIALIZADO' then
    v_serie := trim(coalesce(p_datos->>'numero_serie', ''));
    v_estado := coalesce(p_datos->>'estado', 'DISPONIBLE');
    if v_serie = '' then
      raise exception 'El número de serie es obligatorio.';
    end if;
    if v_estado not in ('DISPONIBLE', 'EN_MANTENIMIENTO') then
      raise exception 'Estado inicial no válido: %.', v_estado;
    end if;
    if exists (select 1 from public.unidad_serializada where id_producto = p_id_producto and numero_serie = v_serie) then
      raise exception 'El número de serie % ya está registrado para este producto.', v_serie;
    end if;

    insert into public.unidad_serializada (id_producto, numero_serie, id_almacen, estado)
    values (p_id_producto, v_serie, p_id_almacen, v_estado);

    v_unidades := 1;
    v_detalle := format('Equipo serie %s', v_serie);
    v_minimo := 1;
  else
    raise exception 'Modo de manejo % no soportado.', v_modo;
  end if;

  -- ---------------------------------------------------------------- Stock y Kardex
  insert into public.inventario (id_producto, id_almacen, stock_real, stock_minimo, estado_semaforo,
    cajas_cerradas, unidades_caja_abierta)
  values (p_id_producto, p_id_almacen, v_unidades, v_minimo, 'VERDE',
    coalesce(v_cerradas, 0), coalesce(v_abierta, 0))
  on conflict (id_producto, id_almacen) do update set
    stock_real = public.inventario.stock_real + excluded.stock_real,
    cajas_cerradas = case when v_modo = 'PICKING_CAJA' then excluded.cajas_cerradas else public.inventario.cajas_cerradas end,
    unidades_caja_abierta = case when v_modo = 'PICKING_CAJA' then excluded.unidades_caja_abierta else public.inventario.unidades_caja_abierta end
  returning stock_real, stock_minimo into v_stock, v_minimo;

  update public.inventario set estado_semaforo = case
      when v_stock <= 0 then 'ROJO' when v_stock <= v_minimo then 'AMARILLO' else 'VERDE' end
  where id_producto = p_id_producto and id_almacen = p_id_almacen;

  insert into public.movimiento (id_usuario, id_etiqueta, id_producto, tipo, cantidad_afectada, destino_almacen, motivo)
  values (v_id_usuario, v_id_etiqueta, p_id_producto, v_tipo_mov, v_unidades, p_id_almacen,
    coalesce(nullif(trim(p_motivo), ''), 'Ingreso de stock') || ' · ' || v_detalle);

  return jsonb_build_object('ok', true, 'modo', v_modo, 'unidades', v_unidades,
    'stock_nuevo', v_stock, 'detalle', v_detalle, 'id_etiqueta', v_id_etiqueta);
end;
$$;

revoke execute on function public.registrar_ingreso_inventario(bigint, bigint, jsonb, text) from anon, public;
grant execute on function public.registrar_ingreso_inventario(bigint, bigint, jsonb, text) to authenticated;

-- Conteo físico absoluto de un producto Por caja (corrige cajas cerradas + caja abierta)
create or replace function public.ajustar_conteo_cajas(
  p_id_producto bigint,
  p_id_almacen bigint,
  p_cajas_cerradas integer,
  p_unidades_caja_abierta numeric,
  p_motivo text default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_modo varchar;
  v_upc integer;
  v_anterior numeric := 0;
  v_nuevo numeric;
  v_id_usuario bigint;
begin
  if not public.tiene_rol(array['ADMINISTRADOR', 'OPERARIO']) then
    raise exception 'Acceso denegado: solo Administrador u Operario pueden ajustar conteos.';
  end if;

  select c.modo_manejo, r.unidades_por_caja into v_modo, v_upc
  from public.producto p
  join public.categoria c on c.id_categoria = p.id_categoria
  left join public.regla_empaque r on r.id_producto = p.id_producto
  where p.id_producto = p_id_producto;

  if v_modo is distinct from 'PICKING_CAJA' then
    raise exception 'El conteo por cajas solo aplica a productos en modo Por caja.';
  end if;
  if v_upc is null then
    raise exception 'El producto no tiene regla de empaque.';
  end if;
  if p_cajas_cerradas < 0 or p_unidades_caja_abierta < 0 or p_unidades_caja_abierta >= v_upc then
    raise exception 'Conteo no válido: la caja abierta debe tener entre 0 y % unidades.', v_upc - 1;
  end if;

  select stock_real into v_anterior from public.inventario
  where id_producto = p_id_producto and id_almacen = p_id_almacen for update;
  v_anterior := coalesce(v_anterior, 0);
  v_nuevo := p_cajas_cerradas * v_upc + p_unidades_caja_abierta;

  insert into public.inventario (id_producto, id_almacen, stock_real, stock_minimo, estado_semaforo,
    cajas_cerradas, unidades_caja_abierta)
  values (p_id_producto, p_id_almacen, v_nuevo, v_upc,
    case when v_nuevo <= 0 then 'ROJO' when v_nuevo <= v_upc then 'AMARILLO' else 'VERDE' end,
    p_cajas_cerradas, p_unidades_caja_abierta)
  on conflict (id_producto, id_almacen) do update set
    stock_real = excluded.stock_real,
    cajas_cerradas = excluded.cajas_cerradas,
    unidades_caja_abierta = excluded.unidades_caja_abierta,
    estado_semaforo = case when excluded.stock_real <= 0 then 'ROJO'
      when excluded.stock_real <= public.inventario.stock_minimo then 'AMARILLO' else 'VERDE' end;

  select id_usuario into v_id_usuario from public.usuario where auth_user_id = auth.uid();
  if v_nuevo <> v_anterior then
    insert into public.movimiento (id_usuario, id_producto, tipo, cantidad_afectada, destino_almacen, motivo)
    values (v_id_usuario, p_id_producto, 'AJUSTE', abs(v_nuevo - v_anterior), p_id_almacen,
      format('%s · conteo: %s cajas cerradas + %s u en caja abierta = %s u (antes %s u)',
        coalesce(nullif(trim(p_motivo), ''), 'Conteo físico'), p_cajas_cerradas, p_unidades_caja_abierta, v_nuevo, v_anterior));
  end if;

  return jsonb_build_object('ok', true, 'stock_anterior', v_anterior, 'stock_nuevo', v_nuevo);
end;
$$;

revoke execute on function public.ajustar_conteo_cajas(bigint, bigint, integer, numeric, text) from anon, public;
grant execute on function public.ajustar_conteo_cajas(bigint, bigint, integer, numeric, text) to authenticated;
