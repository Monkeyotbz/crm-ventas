"""Genera scripts/demo/sembrar-tenant-demo.sql.

Determinístico, SIN llamadas a Claude: reutiliza las 30 conversaciones INVENTADAS del banco de
pruebas del Analista y los análisis que el Analista ya produjo en su última corrida (así el
tenant demo muestra scores reales del agente, sin gastar tokens al sembrar). Duplica el set
(60 conversaciones) para que la Bandeja tenga más de una tanda de 50 y se pueda probar "Ver más".

    python scripts/demo/generar-seed-demo.py

Documento y motivo: documentación importante/pruebas-en-produccion-que-se-deben-eliminar.md
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


# El banco de pruebas dice "web"; el dominio canal_type de la base se llama "chat_web". Un valor
# fuera del dominio rechaza la fila, así que se traduce aquí.
CANAL_EN_BASE = {"web": "chat_web"}


def canal_de(contexto: str) -> str:
    m = re.search(r"canal (\w+)", contexto)
    canal = m.group(1) if m else "web"
    return CANAL_EN_BASE.get(canal, canal)


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
-- Documento y motivo: documentación importante/pruebas-en-produccion-que-se-deben-eliminar.md
-- Para borrarlo todo: scripts/demo/limpiar-tenant-demo.sql
--
-- ANTES DE CORRERLO:
--   1. Crear el usuario de prueba en Authentication → Users (con contraseña, Auto Confirm).
--   2. Pegar este script en el SQL Editor y, AHÍ (no en este archivo), cambiar el correo de la
--      línea v_email por el del usuario. Así el correo no llega a git.
--
-- CÓMO FUNCIONA EL TENANT: al crear un usuario, el trigger on_auth_user_created le crea solo un
-- tenant nuevo (con el usuario de dueño y un embudo de 7 etapas). Este script NO crea otro: ADOPTA
-- ese, lo renombra a 'demo-pruebas' y lo llena. Por eso tiene candados: se niega si el tenant del
-- usuario es uno real (hellominus, turismo-colombia), si ya tiene contactos o conversaciones, o si
-- tiene otros miembros. Un script que adopta tenants ajenos sería peligroso.
--
-- Qué hace, todo en UNA transacción (si algo falla, no queda nada a medias):
--   - renombra el tenant del usuario a 'demo-pruebas' (el embudo y las etapas ya vienen hechos);
--   - crea {len(datos)} contactos y conversaciones con sus mensajes, y los análisis del Analista;
--   - APAGA tres triggers de `messages` mientras inserta, y los vuelve a encender al final:
--       * trg_disparar_router y trg_disparar_analista: sin apagarlos, cada mensaje entrante
--         dispararía a Haiku (gasto real) y al Router (crearía oportunidades que ensucian las
--         métricas), y los análisis que se ven serían otros distintos a los cargados;
--       * trg_validar_plantilla: rechaza todo mensaje saliente de WhatsApp si la conversación no
--         tiene la ventana de 24 h abierta, y las conversaciones de ejemplo no la tienen.
--   - NO envía nada a WhatsApp: eso solo lo hace la función de envío saliente.
--
-- El tenant no cambia de id (solo de nombre), así que el token del usuario ya lo trae: no hace
-- falta cerrar sesión. Si la sesión se abrió ANTES de correr esto, basta recargar la página.

do $demo$
declare
  v_email constant text := 'REEMPLAZAR_POR_EL_CORREO_DEL_USUARIO_DE_PRUEBA';
  v_slug constant text := 'demo-pruebas';
  datos constant jsonb := $demo_json${payload}$demo_json$;
  v_user uuid;
  v_tenant uuid;
  v_slug_actual text;
  v_cuenta bigint;
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
  select u.id, (u.raw_app_meta_data ->> 'tenant_id')::uuid into v_user, v_tenant
    from auth.users u where u.email = v_email;
  if v_user is null then
    raise exception 'No existe un usuario de Auth con el correo %. Crearlo primero en Authentication → Users.', v_email;
  end if;
  if v_tenant is null then
    raise exception 'El usuario % no tiene tenant asignado (el trigger de alta no corrió).', v_email;
  end if;
  if exists (select 1 from public.tenants where slug = v_slug) then
    raise exception 'El tenant % ya existe. Correr primero scripts/demo/limpiar-tenant-demo.sql.', v_slug;
  end if;

  select slug into v_slug_actual from public.tenants where id = v_tenant;
  if v_slug_actual is null then
    raise exception 'El tenant % del usuario no existe.', v_tenant;
  end if;
  -- CANDADOS: nunca se adopta un tenant real ni uno que ya tenga trabajo adentro.
  if v_slug_actual in ('hellominus', 'turismo-colombia') then
    raise exception 'El usuario % pertenece al tenant real "%": no se adopta. Usar un usuario NUEVO.', v_email, v_slug_actual;
  end if;
  select count(*) into v_cuenta from public.contacts where tenant_id = v_tenant;
  if v_cuenta > 0 then raise exception 'El tenant "%" ya tiene % contactos: no es un tenant vacío, no se adopta.', v_slug_actual, v_cuenta; end if;
  select count(*) into v_cuenta from public.conversations where tenant_id = v_tenant;
  if v_cuenta > 0 then raise exception 'El tenant "%" ya tiene % conversaciones: no se adopta.', v_slug_actual, v_cuenta; end if;
  select count(*) into v_cuenta from public.team_members where tenant_id = v_tenant and user_id <> v_user;
  if v_cuenta > 0 then raise exception 'El tenant "%" tiene otros miembros: no se adopta.', v_slug_actual; end if;

  update public.tenants set slug = v_slug, nombre = 'Demo (pruebas)' where id = v_tenant;

  alter table public.messages disable trigger trg_disparar_router;
  alter table public.messages disable trigger trg_disparar_analista;
  alter table public.messages disable trigger trg_validar_plantilla;

  v_total := jsonb_array_length(datos);
  for v_i in 0 .. v_total - 1 loop
    c := datos -> v_i;
    v_n := jsonb_array_length(c -> 'mensajes');
    v_ult := v_ahora - make_interval(hours => (c ->> 'horas_atras')::int);

    -- contacts.origen es el dominio fuente_type (chat_web, whatsapp, instagram, messenger, linkedin,
    -- meta_ads, manual, api): un valor inventado como 'demo' lo rechaza. Se usa el canal de la
    -- conversación, que es un valor válido y además es de dónde vendría ese lead de verdad.
    insert into public.contacts (tenant_id, nombre, origen, owner_id)
    values (v_tenant, c ->> 'nombre', c ->> 'canal', v_user) returning id into v_contact;

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
  alter table public.messages enable trigger trg_validar_plantilla;

  raise notice 'Listo: el tenant "%" (antes "%") tiene % conversaciones. Recargar la página con el usuario %.', v_slug, v_slug_actual, v_total, v_email;
end
$demo$;
"""
    SALIDA.write_text(sql, encoding="utf-8")
    print(f"{SALIDA.name}: {len(datos)} conversaciones, {len(sql) // 1024} KB, "
          f"{sum(1 for d in datos if d['insight'] is None)} sin análisis")


if __name__ == "__main__":
    main()
