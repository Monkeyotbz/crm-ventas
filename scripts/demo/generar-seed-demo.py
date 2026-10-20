"""Genera scripts/demo/sembrar-tenant-demo.sql.

Determinístico, SIN llamadas a Claude: reutiliza las 30 conversaciones INVENTADAS del banco de
pruebas del Analista y los análisis que el Analista ya produjo en su última corrida (así el
tenant demo muestra scores reales del agente, sin gastar tokens al sembrar). Duplica el set
(60 conversaciones) para que la Bandeja tenga más de una tanda de 50 y se pueda probar "Ver más".

    python scripts/demo/generar-seed-demo.py

Documento y motivo: docs/pruebas-en-produccion-que-se-deben-eliminar.md
"""
import glob
import json
import re
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
BANCO = RAIZ / "agentes-sdk" / "validacion-analista"
SALIDA = Path(__file__).resolve().parent / "sembrar-tenant-demo.sql"

# Cada 10.ª conversación queda SIN análisis, para ver el contador "Sin analizar" y el guion.
CADA_CUANTAS_SIN_ANALISIS = 10
# Las bases del banco de pruebas, de la más reciente a la más antigua.
RESULTADO = sorted(glob.glob(str(BANCO / "resultados" / "*_v4-interes.json")))[-1]


def canal_de(contexto: str) -> str:
    m = re.search(r"canal (\w+)", contexto)
    return m.group(1) if m else "web"


def nombre_de(contexto: str) -> str:
    m = re.search(r"contacto (.+?), canal", contexto)
    return m.group(1) if m else "Sin nombre"


def main():
    banco = json.loads((BANCO / "conversaciones.json").read_text(encoding="utf-8"))["conversaciones"]
    obtenido = {f["id"]: f["obtenido"] for f in json.loads(Path(RESULTADO).read_text(encoding="utf-8"))["filas"]}

    datos, n = [], 0
    for copia in (0, 1):
        for c in banco:
            n += 1
            ins = obtenido[c["id"]]
            sin = n % CADA_CUANTAS_SIN_ANALISIS == 0
            datos.append({
                "nombre": nombre_de(c["contexto"]) + (" (2)" if copia else ""),
                "canal": canal_de(c["contexto"]),
                "mensajes": c["mensajes"],
                # Reparte las conversaciones en ~12 días hacia atrás, la más reciente primero.
                "horas_atras": 2 + (n - 1) * 5,
                "insight": None if sin else {
                    "score": ins["score"], "sentimiento": ins["sentimiento"],
                    "resumen": ins["resumen"], "sugerencia": ins["sugerencia"],
                    "presupuesto_extraido": ins.get("presupuesto_extraido"),
                    "proxima_accion_sugerida": ins["proxima_accion_sugerida"],
                },
            })

    payload = json.dumps(datos, ensure_ascii=False)
    assert "$demo_json$" not in payload

    sql = f"""-- Siembra el tenant de PRUEBA 'demo-pruebas' con {len(datos)} conversaciones de ejemplo.
-- GENERADO por scripts/demo/generar-seed-demo.py: no editar a mano, volver a generar.
-- Documento y motivo: docs/pruebas-en-produccion-que-se-deben-eliminar.md
-- Para borrarlo todo: scripts/demo/limpiar-tenant-demo.sql
--
-- ANTES DE CORRERLO:
--   1. Crear el usuario de prueba en Authentication → Users (con contraseña).
--   2. Cambiar el correo en la línea v_email de abajo por el de ese usuario.
--
-- Qué hace, todo en UNA transacción (si algo falla, no queda nada a medias):
--   - crea el tenant, un embudo 'Ventas' con sus etapas, y deja al usuario como owner;
--   - crea {len(datos)} contactos y conversaciones con sus mensajes, y los análisis del Analista;
--   - APAGA los triggers del Router y del Analista mientras inserta los mensajes. Sin eso, cada
--     mensaje entrante dispararía a Haiku (gasto real) y al Router (crearía oportunidades que
--     ensucian las métricas), y los análisis que se ven serían otros distintos a los cargados.
--   - NO envía nada a WhatsApp: eso solo lo hace la función de envío saliente.
--
-- Después de correrlo, el usuario de prueba tiene que CERRAR SESIÓN y volver a entrar: el tenant
-- viaja en el token, y el token viejo no lo trae.

do $demo$
declare
  v_email constant text := 'REEMPLAZAR_POR_EL_CORREO_DEL_USUARIO_DE_PRUEBA';
  v_slug constant text := 'demo-pruebas';
  datos constant jsonb := $demo_json${payload}$demo_json$;
  v_user uuid;
  v_tenant uuid;
  v_pipe bigint;
  c jsonb;
  m jsonb;
  v_contact bigint;
  v_conv bigint;
  v_msg bigint;
  v_ultimo bigint;
  v_total int;
  v_ahora timestamptz := now();
  v_ult timestamptz;
  v_n int;
  v_i int;
begin
  if v_email like 'REEMPLAZAR%' then
    raise exception 'Falta cambiar v_email por el correo del usuario de prueba.';
  end if;
  select id into v_user from auth.users where email = v_email;
  if v_user is null then
    raise exception 'No existe un usuario de Auth con el correo %. Crearlo primero en Authentication → Users.', v_email;
  end if;
  if exists (select 1 from public.tenants where slug = v_slug) then
    raise exception 'El tenant % ya existe. Correr primero scripts/demo/limpiar-tenant-demo.sql.', v_slug;
  end if;

  insert into public.tenants (nombre, slug, modulos)
  values ('Demo (pruebas)', v_slug, array['crm']) returning id into v_tenant;

  insert into public.team_members (user_id, tenant_id, rol) values (v_user, v_tenant, 'owner');

  update auth.users
     set raw_app_meta_data = coalesce(raw_app_meta_data, '{{}}'::jsonb) || jsonb_build_object('tenant_id', v_tenant)
   where id = v_user;

  insert into public.pipelines (tenant_id, nombre, tipo, orden)
  values (v_tenant, 'Ventas', 'consultivo', 1) returning id into v_pipe;
  insert into public.pipeline_stages (tenant_id, pipeline_id, nombre, orden, color, tipo, horas_alerta) values
    (v_tenant, v_pipe, 'Nuevo', 1, '#22d3ee', 'abierta', 48),
    (v_tenant, v_pipe, 'Contactado', 2, '#22d3ee', 'abierta', 48),
    (v_tenant, v_pipe, 'Calificado', 3, '#a78bfa', 'abierta', 48),
    (v_tenant, v_pipe, 'Propuesta', 4, '#a78bfa', 'abierta', 48),
    (v_tenant, v_pipe, 'Negociación', 5, '#a78bfa', 'abierta', 48),
    (v_tenant, v_pipe, 'Ganado', 6, '#34d399', 'ganada', null),
    (v_tenant, v_pipe, 'Perdido', 7, '#64748b', 'perdida', null);

  alter table public.messages disable trigger trg_disparar_router;
  alter table public.messages disable trigger trg_disparar_analista;

  v_total := jsonb_array_length(datos);
  for v_i in 0 .. v_total - 1 loop
    c := datos -> v_i;
    v_n := jsonb_array_length(c -> 'mensajes');
    v_ult := v_ahora - make_interval(hours => (c ->> 'horas_atras')::int);

    insert into public.contacts (tenant_id, nombre, origen, owner_id)
    values (v_tenant, c ->> 'nombre', 'demo', v_user) returning id into v_contact;

    insert into public.conversations (tenant_id, contact_id, canal, estado, ultimo_mensaje_at, owner_id)
    values (v_tenant, v_contact, c ->> 'canal', 'abierta', v_ult, v_user) returning id into v_conv;

    v_ultimo := null;
    for k in 0 .. v_n - 1 loop
      m := (c -> 'mensajes') -> k;
      insert into public.messages (conversation_id, direccion, canal, contenido, created_at)
      values (v_conv, m ->> 0, c ->> 'canal', m ->> 1,
              v_ult - make_interval(mins => 7 * (v_n - 1 - k))) returning id into v_msg;
      v_ultimo := v_msg;
    end loop;

    if c -> 'insight' is not null and jsonb_typeof(c -> 'insight') = 'object' then
      insert into public.conversation_insights
        (conversation_id, score, sentimiento, resumen, sugerencia, presupuesto_extraido,
         proxima_accion_sugerida, modelo, ultimo_mensaje_id, analizado_at)
      values (v_conv, (c -> 'insight' ->> 'score')::smallint, c -> 'insight' ->> 'sentimiento',
              c -> 'insight' ->> 'resumen', c -> 'insight' ->> 'sugerencia',
              c -> 'insight' ->> 'presupuesto_extraido', c -> 'insight' ->> 'proxima_accion_sugerida',
              'claude-haiku-4-5-20251001', v_ultimo, v_ult);
    end if;
  end loop;

  alter table public.messages enable trigger trg_disparar_router;
  alter table public.messages enable trigger trg_disparar_analista;

  raise notice 'Listo: tenant % con % conversaciones. El usuario % debe cerrar sesión y volver a entrar.', v_slug, v_total, v_email;
end
$demo$;
"""
    SALIDA.write_text(sql, encoding="utf-8")
    print(f"{SALIDA.name}: {len(datos)} conversaciones, {len(sql) // 1024} KB, "
          f"{sum(1 for d in datos if d['insight'] is None)} sin análisis")


if __name__ == "__main__":
    main()
