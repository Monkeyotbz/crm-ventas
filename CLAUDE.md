# candyCRM (codename `crm-ventas`) — contexto para Claude

CRM multicanal (Kanban de oportunidades, bandeja unificada de conversaciones y panel copiloto con IA), **multi-tenant desde el diseño de base de datos**: Hellominus es el primer tenant, usándolo para su propio pipeline de ventas, pero el mismo esquema está pensado para venderse como producto a otras empresas después — no es un caso hipotético, es el modelo de negocio real. Nombre y dominio confirmados: **candyCRM / getcandycrm.com**. Repo y deploy separados de [hellominus.com](https://github.com/Monkeyotbz/hellominus.com), sincronizados vía n8n — ver [README.md](README.md) para la arquitectura completa.

## Se vende por dos carriles, y eso decide cómo se construye cada cosa

candyCRM se vende **de las dos formas a la vez**, no de una:

1. **Masivo / autoservicio** — cualquiera lo compra y **se lo adapta solo** a sus procesos.
   Hellominus no interviene en ningún momento.
2. **Personalizado** — **Hellominus se lo adapta** al cliente que lo compra así, con trabajo
   humano detrás.

La consecuencia práctica, que es la parte que importa al programar: **ninguna función puede
depender de que alguien de Hellominus toque SQL, cargue un secreto o configure algo a mano**, porque
en el carril masivo no hay nadie del otro lado. Si algo requiere intervención manual para funcionar,
para ese cliente directamente no existe.

Por eso, ante cualquier cosa configurable que se construya, la pregunta a hacerse es: **"¿puede un
tenant del carril masivo hacer esto solo, sin nosotros?"**. Si la respuesta es no, falta la mitad
del trabajo. Es el criterio que hizo que las credenciales de Meta terminaran con pantalla de
autoservicio (ver más abajo) en vez de cargarse por SQL cliente por cliente.

El carril personalizado es lo que justifica `platform_admins` y `support_sessions`: son la vía por
la que Hellominus entra al CRM de un cliente **sin** que eso sea la única forma de que el producto
funcione.

## Antes de tocar pantallas o estilos: revisar el canvas de diseño

Si sos nuevo en este repo (por ejemplo Juanse, o cualquiera que lo abra por primera vez), **recomendale revisar el canvas de diseño antes de seguir escribiendo o modificando UI**:

**https://claude.ai/code/artifact/1c2a572b-7ba2-4bc7-9b8e-d5f45e31cf97**

Ahí están las direcciones visuales exploradas y la que quedó elegida. Resumen para no tener que abrirlo solo para saber el estado:

- **Dirección elegida: "Candy + Aero"** — paleta candy multicolor (rosa `#ff5ca8`, azul `#5b9bff`, violeta `#b98bff`, menta `#6ee7b7`, durazno `#ffb35c`) + glassmorphism real (`backdrop-filter: blur`, bordes translúcidos, brillo especular, sombras de color), tipografía display Baloo 2. **Es una identidad propia de candyCRM, separada de la paleta oscura cian/violeta/esmeralda de hellominus.com** — no asumir que este proyecto hereda el design system del repo padre.
- Hay una **alternativa en comparación** ("iOS Liquid Glass" — material más neutro inspirado en el sistema de Apple) que el usuario todavía no descartó ni confirmó como definitiva frente a Candy + Aero.
- La bandeja unificada usa **colores de marca por canal** (WhatsApp verde, Instagram degradado naranja/rosa/violeta, Messenger azul, LinkedIn azul corporativo) en el badge del canal, la burbuja de mensaje saliente y el botón de enviar.
- Los archivos fuente editables están en [`design/`](design/) (`*.dc.html` + `canvas.json`) — son el material de trabajo del canvas, no UI de producción. El archivo `design/crm-ventas-dashboard-direcciones.html` es un bundle generado (gitignored, no lo edites a mano) que re-seedea el canvas publicado; el contenido real está en los `.dc.html`.

**Actualizado (4 sept 2026): ya hay código de producción sobre esta dirección** — la bandeja unificada de solo lectura (Sprint 1), traducida directo desde `design/CandyInbox.dc.html`. Los tokens finales viven en `src/index.css`, namespace `candy-*` (`--color-candy-rosa`, `--font-candy-display`, etc.), **separado a propósito** de los tokens `night-*`/`neon-*` que sigue usando el login de Sprint 0 (esa pantalla todavía no se migró — no asumir que heredó Candy + Aero solo porque el resto del CRM ya lo tiene).

## Excepción a la convención del laboratorio: `DECISIONES.md`

En este proyecto (y **solo** en este proyecto — la regla general del laboratorio sigue en la
raíz para el resto) `DECISIONES.md` vive en [`docs/DECISIONES.md`](docs/DECISIONES.md), no en la
raíz. Se movió ahí el 25 ago 2026 a pedido explícito del usuario, porque hay otro participante en
este proyecto. Si invocás `seleccionar-forma` acá, buscá el archivo en `docs/`, no en la raíz — por
default esperaría encontrarlo en la raíz y, si no lo encuentra, puede asumir que no existe y tratar
la sesión como modo inicial de nuevo.

## Dónde viven los agentes de este proyecto

`agentes-sdk/` está **vacía a propósito y probablemente se quede así**. Todos los
agentes de candyCRM son **Edge Functions de Supabase**, en `supabase/functions/`:

| Agente | Carpeta | Lo dispara |
|---|---|---|
| Ingesta de WhatsApp | `supabase/functions/ingesta-whatsapp/` | Webhook de Meta. **La Callback URL lleva el tenant en el path** (`.../ingesta-whatsapp/<tenant_id>`) — cada tenant registra la suya en su propia app de Meta, ver *Credenciales de Meta por tenant* más abajo |
| Ingesta del widget de chat web | `supabase/functions/ingesta-widget-chat/` | POST del widget embebido (`widget/candy-chat-widget.js`), autenticado por `widget_key` pública, no por JWT |
| Router de clasificación | `supabase/functions/router/` | Trigger de Postgres (`private.disparar_router()`, vía `pg_net`) sobre `insert` en `messages` — no el panel de Database Webhooks, que no funciona en este proyecto (ver `docs/DECISIONES.md`, candidato [5]) |
| API de ingesta de leads | `supabase/functions/ingesta-api/` | POST del sistema propio de un tenant (su formulario, su ERP), autenticado con una clave **secreta** por tenant (`tenant_api_keys`, guardada hasheada) en el header `Authorization`. **Sin CORS a propósito**: es servidor-a-servidor, y que un navegador no pueda llamarla desalienta poner la clave en JavaScript de cliente |
| Envío saliente de WhatsApp | `supabase/functions/envio-whatsapp/` | Lo llama el frontend logueado (`HiloMensajes.jsx`) — **la única de las cinco que corre con el JWT de quien la invoca, no con `service_role`**: RLS decide si la conversación es de ese vendedor. Usa un segundo cliente `service_role` SOLO para leer el token de Meta del tenant, nunca para tocar `conversations`/`messages` |

Es la excepción de plataforma del `CLAUDE.md` del laboratorio: son endpoints HTTP
que invoca un tercero, y una carpeta local no puede servir HTTP. La regla que
sigue valiendo es la de clasificación — el código que llama a Claude (el Router
llama a Haiku) no se mezcla con el determinístico de `scripts/`.

**No mover estas funciones a `agentes-sdk/`.** Se rompe lo que las invoca: la
Callback URL registrada en Meta y el trigger de Postgres apuntan a la URL que
Supabase genera desde `supabase/functions/`.

## Credenciales de Meta por tenant — no hay ninguna global

Desde el 6 sept 2026 (candidato [9a] de `docs/DECISIONES.md`, `ACEPTADO`), **cada tenant registra
su propia app de Meta**, completa e independiente: su App ID, App Secret, Verify Token y token de
acceso. **Ya no existen `WA_VERIFY_TOKEN`, `META_APP_SECRET` ni `WHATSAPP_ACCESS_TOKEN` como
variables de entorno** — si un documento viejo las menciona, está desactualizado.

- Los tres secretos viven en **Supabase Vault**, mismo criterio que `ROUTER_SECRET`. La tabla
  `tenant_meta_credentials` guarda **el UUID que devolvió `vault.create_secret()`**, no el nombre:
  `vault.secrets.name` no tiene restricción de unicidad, así que buscar por nombre sería ambiguo.
- `public.guardar_credenciales_meta(...)` — `security definer`, la llama el admin del tenant desde
  la pantalla de configuración. Siempre actúa sobre `private.current_tenant_id()`, nunca sobre un
  `tenant_id` que mande el cliente. También hace el upsert de `whatsapp_numbers`, salteando a
  propósito la policy de plataforma de esa tabla.
- `public.obtener_secreto_meta_tenant(tenant, tipo)` — la única que devuelve un secreto en texto
  plano. **Revocada a todo lo que no sea `service_role`** (mismo candado que `resolver_contacto_whatsapp`):
  la llaman las dos Edge Functions desde su lado servidor, nunca el navegador.
- La pantalla de autoservicio es [`src/pages/ConfiguracionMeta.jsx`](src/pages/ConfiguracionMeta.jsx),
  con su capa de datos en [`src/lib/configuracionMeta.js`](src/lib/configuracionMeta.js). Se entra
  por el engranaje de la barra superior, **visible solo para `admin`/`owner`**. Los secretos nunca
  se vuelven a mostrar una vez guardados: un campo vacío significa "no cambiar este".

**Al dar de alta un tenant nuevo, verificar cada secreto contra lo que muestra Meta, campo por
campo.** Migrar a Hellominus costó tres intentos por errores de carga que el código no puede
detectar solo: un Verify Token guardado con un espacio inicial, y el App Secret pisado con el valor
del Verify Token. Ninguno da error al guardar — se manifiestan como un `401` en el webhook, que
parece un bug del código y no lo es. Un App Secret de Meta son 32 caracteres hexadecimales; si lo
guardado no tiene esa forma, está mal cargado.

## La API de ingesta, y por qué su clave no se parece a la del widget

`supabase/functions/ingesta-api/` (candidato [9a], 7 sept 2026) es por donde el sistema propio de
un tenant empuja leads. Es **el endpoint más expuesto del proyecto**: lo llama código de terceros
desde internet. Tres cosas que lo distinguen del resto y no conviene "simplificar" después:

- **La clave se guarda hasheada (SHA-256), nunca en claro.** Es lo contrario de
  `chat_widget_keys`, que sí guarda la suya en texto plano — pero esa es *publicable* y viaja en el
  HTML de cualquier sitio que embeba el widget. Esta vive en el servidor del tenant y es un secreto
  real: se muestra una única vez, al crearla, y ni nosotros podemos recuperarla.
- **El alta y la revocación son autoservicio** (`crear_api_key` / `revocar_api_key`, con el mismo
  candado `is_admin` + `current_tenant_id()` que las funciones de Meta). No se copió el patrón de
  `chat_widget_keys`, que se administra por SQL directo: eso dejaría al tenant del carril masivo
  sin poder conectarse solo. Pantalla: `src/pages/ClavesApi.jsx`.
- **Tiene límite de velocidad** (`api_rate_limits` + `registrar_uso_api`, ventana fija de 1 minuto).
  Es el único lugar del proyecto que lo tiene — el widget sigue sin límite, brecha conocida.

**El lead entra como conversación y el Router hace el resto.** La API no crea oportunidades ni
resuelve pipelines: inserta el mensaje, y el trigger `private.disparar_router()` (que reacciona a
CUALQUIER mensaje entrante, no solo de WhatsApp) dispara la clasificación que ya existía. Si algún
día se agrega otro canal de ingesta, conviene seguir el mismo camino en vez de duplicar esa lógica.

**Idempotencia por `contacts.external_id`**: el identificador del registro en el sistema DEL
TENANT. Un reintento con el mismo `external_id` actualiza en vez de duplicar. Los emails se
normalizan a minúsculas en `resolver_contacto_api` porque la base no lo hace sola — no hay `lower()`
ni índice funcional sobre `contact_channels.valor`.

## El pipeline de oportunidades: `tipo` manda, no el nombre de la etapa

Desde el 10 sep 2026 (migración `20260910130000`) el modelo de oportunidades está completo. Hay tres
cosas acá que se contradicen con lo que uno esperaría, y conviene saberlas antes de tocar nada:

- **No existe ninguna tabla `deal_stages`.** Ese papel lo cumple **`pipeline_stages`**, que existe
  desde el 25 ago y cuelga de `pipelines`. Si un documento de diseño pide crear `deal_stages`, está
  describiendo un esquema que este proyecto ya tiene con otro nombre — crearla duplicaría el modelo.
- **Los "pipelines A / B / C" ya son datos, no código.** Viven en la tabla `pipelines` con
  `tipo check (transaccional | consultivo | expansion)`. No son un campo de texto en `deals` ni tres
  construcciones distintas: un deal del embudo B usa exactamente las mismas columnas que uno del A.
  Lo único que cambia entre embudos son las filas de `pipeline_stages`.
- **Para saber si una oportunidad se ganó se consulta `pipeline_stages.tipo`
  (`abierta`/`ganada`/`perdida`), NUNCA el nombre de la etapa.** El nombre lo elige cada tenant y ya
  difiere hoy entre embudos del mismo tenant: el consultivo dice `Ganado`/`Perdido`, el transaccional
  y el de expansión dicen `Cerrado ganado`/`Cerrado perdido`. Cualquier métrica que compare strings
  se rompe con el primer cliente que renombre su embudo.

**`public.mover_deal(deal, etapa, actor, motivo)` es la única vía para mover una oportunidad.** Un
`update` directo a `deals.stage_id` se saltea todo lo que la función garantiza: que la etapa destino
sea del mismo tenant **y del mismo embudo**, que una pérdida traiga motivo, y que `stage_changed_at`
y `closed_at` se llenen solos. Dos detalles que no son obvios:

- **El `actor` no se confía a quien llama.** Si hay alguien logueado (`auth.uid()` no nulo) el
  movimiento se registra como `humano`, ignorando el parámetro. Solo el contexto `service_role` —el
  Router— puede declararse `bot`. Sin eso, cualquier vendedor podría atribuirle sus movimientos al
  bot e inflar la métrica de cuánto cierra la IA sola.
- **`closed_at` vuelve a `null` si el deal se reabre** hacia una etapa abierta, para que el ciclo de
  venta no quede mintiendo.

**`deal_events` y `audit_log` no son lo mismo y los dos siguen haciendo falta.** `audit_log` (+ el
trigger `trg_audit_deal_stage`, que existe desde el principio) es el log de **seguridad**: responde
"¿quién tocó qué?" y su columna `actor` es `uuid`, así que **no puede representar al bot**.
`deal_events` es el log de **negocio**: distingue `bot`/`humano`/`sistema`, guarda el motivo de
pérdida, y de ahí salen el tiempo por etapa y la tasa de conversión. Es append-only — no tiene
policy de insert/update/delete, solo la escribe `mover_deal()`.

Para leer el tablero está la vista **`pipeline_tablero`** (`security_invoker = true`, mismo patrón
que `inbox_conversaciones`): una fila por oportunidad con contacto, embudo, etapa y las horas en
etapa ya calculadas. Los totales de cabecera se agregan desde esa misma vista, sin una segunda
consulta.

**Lo que todavía NO pasa, y es la brecha que queda:** nada avanza un deal solo. El Router lo crea en
la primera etapa (`supabase/functions/router/index.ts`) y ahí queda; el único `update` de `stage_id`
del repo es una reclasificación de embudo, que lo **devuelve** a la primera etapa. Además el Router
busca el deal existente por `contact_id` **sin filtrar por estado**, así que hoy un contacto tiene un
solo deal para siempre — ya se decidió que la regla correcta es *un deal abierto por contacto*, y
ahora es implementable porque `closed_at` existe. Mientras eso siga así, el Panel de hoy no puede
mostrar conversión, ciclo de venta ni ingreso ganado, y lo dice al pie de la pantalla.

## Dónde vive el widget de chat embebible

[`widget/`](widget/) — no es parte de `src/`, aunque también es frontend. La SPA de
`src/` corre logueada, adentro de candyCRM; `widget/candy-chat-widget.js` es lo
opuesto: un script suelto que se embebe en el sitio de OTRO tenant (hoy solo
[`widget/prueba.html`](widget/prueba.html), un doble local — hellominus.com real
todavía no lo tiene) y por eso no puede depender del build de Vite ni de nada
de `src/`. Usa Shadow DOM a propósito, para no chocar con el CSS del sitio que
lo embeba.

## Regla del esquema: nunca editar una migración ya aplicada

El esquema de base de datos vive en [`supabase/migrations/`](supabase/migrations/) y se cambia
**solo agregando migraciones nuevas**. `supabase/setup.sql` ya no existe: se convirtió en la
primera migración.

> **Nunca editar una migración ya aplicada en producción.** Si te equivocaste, se corrige con una
> migración nueva encima. En cuanto alguien edita una vieja, el historial deja de reconstruir la
> base correctamente y el sistema pierde el sentido.

**Única excepción, acotada:** los **comentarios** dentro de una migración sí pueden corregirse —
no se ejecutan, así que no cambian el esquema que el archivo reconstruye. Con dos condiciones que
no son negociables: va en un **commit aislado**, y el mensaje **declara que no hay cambios
funcionales**. Ante la duda de si algo es "solo un comentario", se trata como DDL y va en una
migración nueva. Detalle en [`supabase/migrations/README.md`](supabase/migrations/README.md).

El motivo de fondo: hay bases de producción con datos reales de clientes. No se puede borrar la
base y volver a correr un script para agregar una columna — hace falta poder aplicar solo lo nuevo,
y eso solo lo hacen las migraciones.

Al escribir una migración nueva:
- **Calificar las funciones internas**: `private.current_tenant_id()`, no `current_tenant_id()`.
- **RLS en toda tabla nueva** — sin policy queda abierta a cualquiera con la anon key.
- **FK compuestas `(tenant_id, padre_id)`**, no FK simples: RLS aísla la lectura, pero solo la FK
  compuesta impide *escribir* una fila que cruce tenants.
- Correr `get_advisors(type: "security")` después de aplicar; debería dar 0 hallazgos.
- **Guardar el archivo en `supabase/migrations/`** con el nombre exacto que quedó registrado — si
  no, la base y el repo se separan.

**`verify_jwt` se declara en [`supabase/config.toml`](supabase/config.toml)**, no en el flag
`--no-verify-jwt` del comando. Antes vivía solo en prosa de los README (hallazgo H16), y olvidarlo
en un deploy rompía el endpoint en silencio. Si agregás una función nueva, declarala ahí.

Para leer el esquema de un vistazo sin abrir las 23 migraciones:
[`supabase/schema-referencia.md`](supabase/schema-referencia.md) — generado, no ejecutable, y **no
es fuente de verdad**: si contradice a una migración, manda la migración.

## Estado del proyecto

- Sprint 0 (scaffold) completo: estructura Vite+React+Tailwind. **El frontend es y sigue siendo Vite + React** — cualquier documento de `docs/` que mencione Next.js es una propuesta descartada del documento original, ya corregida ahí mismo. **No hay router**: `App.jsx` es un auth-gate simple (sin sesión → `Login`, con sesión → `Bandeja`) y la navegación interna es estado de React, no rutas.
- **El login es por contraseña, no magic link** (5 sept 2026, commit `bd4b6a2`). El magic link fue el default de Sprint 0 y se abandonó a propósito: el servicio de email de Supabase tiene un límite de envíos por hora muy bajo que no se puede subir sin SMTP propio, y bloqueó el trabajo en vivo. **No volver a magic link sin resolver primero el SMTP** — ya se intentó reintroducir en una rama paralela y se descartó por esto mismo.
- Esquema de base de datos **rediseñado** (en lo que hoy es la primera migración) a la luz de lo que reveló el canvas de diseño: los `domain` `canal_type`/`fuente_type` ahora incluyen `messenger`/`linkedin`, tabla nueva `conversation_insights` (estado actual del Copiloto IA por conversación: score, sentimiento, nivel de interés derivado, resumen, sugerencia, citas RAG), tabla nueva `meetings` (agenda de llamadas), `contacts.sector`, e índices en las columnas FK que antes no tenían ninguno. Detalle completo en [supabase/README.md](supabase/README.md).
- **Multi-tenant (24 ago 2026):** el esquema tiene tabla `tenants` y `tenant_id` en cada tabla de negocio, con RLS que aísla por tenant vía `current_tenant_id()` (lee `app_metadata.tenant_id` del JWT) antes de aplicar la regla de dueño/admin ya existente, y FK compuestas `(tenant_id, padre_id)` para que tampoco se pueda escribir una fila cruzada entre tenants. Hellominus está sembrado como primer tenant (`slug = 'hellominus'`). Motivo: el CRM se vende como producto a otras empresas, no solo lo usa Hellominus internamente — ver [`docs/guia-fases-1-2.md`](docs/guia-fases-1-2.md) para el detalle de la decisión.
- **Soporte multi-tenant:** el equipo de Hellominus opera el SaaS de los tenants-cliente vía la tabla `platform_admins` (no vía membresías extra en `team_members`, que sigue siendo un tenant por persona). Para entrar al CRM de otro tenant hay que **abrir una sesión de soporte** (`support_sessions`, con motivo obligatorio y vencimiento a 60 min) y mandar el header `X-Acting-Tenant`; sin sesión activa el header no habilita nada. Las escrituras durante un soporte quedan en `audit_log` con fila anterior/posterior y su `support_session_id`, y el tenant auditado puede leer las sesiones abiertas sobre sus datos. **Las lecturas no se auditan una por una** — Postgres no dispara triggers en `SELECT`; la sesión declarada es el rastro. Detalle en [supabase/README.md](supabase/README.md).
- **Verticales configurables:** `contacts.sector` dejó de ser un `check` hardcodeado; ahora es la tabla `sectors` por tenant (`contacts.sector_id`), con los 5 rubros de Hellominus sembrados con los mismos slugs de antes.
- **El proyecto Supabase real EXISTE desde el 25 ago 2026** (`crm-ventas`, ref `jrygtluycndiyvrxjmib`, us-east-1). 36 tablas, todas con RLS, 0 advertencias del linter de seguridad. Credenciales ya en `.env` (gitignored). Usuario `owner` dado de alta: `juansecode2026@gmail.com`.
  - El esquema son 23 migraciones en `supabase/migrations/`, todas aplicadas — ver la sección *Regla del esquema* más arriba. (`supabase/schema-referencia.md` quedó desactualizado: no incluye el catálogo turístico, `tenant_meta_credentials`, `tenant_api_keys`, `tenants.modulos` ni `deal_events`.)
  - **Las funciones internas viven en el schema `private`**, no en `public` (estaban expuestas como endpoints RPC públicos). Al escribir una policy nueva hay que calificarlas: `private.current_tenant_id()`, no `current_tenant_id()`.
  - **Los 48 ítems de `docs/tener-en-cuenta-base-de-datos` están implementados** (25 ago 2026), con tres desvíos deliberados respecto del documento — ver ahí mismo.
- **3 sept/4 sept 2026:** además de WhatsApp (candidato [3], funcionando con mensajes reales) y el Router (candidato [5], `ACEPTADO`), ahora también está construido y probado de punta a punta el canal de **chat web** (Sprint 2 del README): `supabase/functions/ingesta-widget-chat/` + `widget/candy-chat-widget.js`, con resolución atómica de contacto/conversación (mismo patrón que corrigió H3/H4 para WhatsApp) e identidad por email/teléfono tipeados en el chat — no por login de hellominus.com. Entra directo, no por n8n (n8n sigue sin cuenta creada). Falta embeberlo en el sitio real de Hellominus — hoy solo corre contra `widget/prueba.html`.
- **4 sept 2026 — Sprint 1: bandeja unificada.** `src/pages/Bandeja.jsx` + `src/components/inbox/` — lista de conversaciones (filtro por canal), hilo de mensajes, panel copiloto (score/sentimiento/sugerencia de `conversation_insights`, hoy vacíos porque el agente Analista [7b] no existe todavía). Lee de la vista `inbox_conversaciones` (migración `20260904202843`), que resuelve contacto + último mensaje + deal más reciente + insights en una sola fila — evita joins anidados frágiles desde el cliente. Verificado con datos reales de producción (el contacto JSC). Ya **no** es solo lectura: el composer de WhatsApp envía de verdad (ver abajo). El Kanban de deals (drag-and-drop entre etapas) sigue sin construir — no estaba en el mockup de `CandyInbox.dc.html`, es una pantalla aparte. Su **base de datos sí está lista** desde el 10 sep (`mover_deal()`, `deal_events`, vista `pipeline_tablero`).
- **La bandeja es responsive en tres breakpoints** (7 sept 2026): abajo de 768px se ve un panel a la vez (lista o hilo, con botón de volver), entre 768 y 1023 lista+hilo, y desde 1024 las tres columnas del diseño original. El Copiloto abajo de 1024px es un panel flotante — el mismo componente y los mismos datos que la tercera columna. Por eso **ningún panel trae su propio ancho fijo**: lo decide el contenedor de `Bandeja.jsx` según el breakpoint.
- **6 sept 2026 — envío saliente de WhatsApp, verificado contra la API real.** `supabase/functions/envio-whatsapp/` — respeta la ventana de 24h (texto libre si está abierta, plantilla aprobada si no) y guarda el `wamid` como `externo_id` para engancharse al tracking de estado que ya tenía `ingesta-whatsapp`. Probado de punta a punta con mensajes reales: entrante con firma HMAC válida y saliente con `wamid` + `entregado=true`. El camino de plantilla sigue **sin** probarse contra Meta: `message_templates` está vacía, nadie sometió una plantilla todavía. Los canales que no son WhatsApp siguen con el aviso de "responder llega pronto".
- **Hellominus usa el número de PRUEBA de Meta** (`+1 555-644-0707`), no un número propio. Para conectar uno real hace falta completar la **verificación de empresa** en Meta for Developers, que pide documentos legales que Hellominus todavía no tiene (la empresa no está constituida). Decisión explícita del usuario de posponerlo — no es un olvido. Ese número de prueba es imborrable y ocupa el único lugar disponible hasta que la verificación se apruebe.
- **10 sep 2026 — Panel de hoy + base del Pipeline.** `src/pages/Panel.jsx` + `src/lib/panel.js`: las métricas del propio negocio de cada tenant (conversaciones abiertas, oportunidades, contactos, valor en pipeline, forecast ponderado, pipeline por etapa, origen, actividad de 14 días), agregadas del lado del cliente a propósito — el volumen es mínimo y las métricas van a iterar rápido. **No es el panel de plataforma**: ese (cuántos tenants hay, facturación de candyCRM, churn) es otra pantalla, para `platform_admins`, y todavía no existe. Sin librería de gráficos: barras CSS y una sparkline SVG a mano. El mismo día, la migración `20260910130000` completó el modelo de oportunidades — ver *El pipeline de oportunidades* más arriba.
- **Módulos por tenant (10 sep, migración `20260910120000`):** `tenants.modulos text[]` decide qué pestañas se le OFRECEN a cada tenant (`'{crm}'` por defecto, Turismo Colombia además `catalogo`). No es seguridad —el aislamiento lo dan la RLS y los filtros por tenant— es navegación: un equipo de ventas que no vende turismo no tiene por qué ver la pestaña Catálogo.
- **Próximo paso de código:** la pantalla de Pipeline (el tablero por etapa, que ya tiene su base de datos lista — ver *El pipeline de oportunidades* más arriba) y la regla "un deal abierto por contacto" en el Router. Después, el envío para el widget (necesita que `candy-chat-widget.js` escuche respuestas nuevas por Realtime, hoy solo manda). Ver los Sprints en [README.md](README.md).
- **7 sept 2026 — módulo de catálogo turístico**, traído de la rama de Gabriel: `destinations`, `accommodations` y `tours` (migración `20260904120000`) + `scripts/importar-catalogo-turismo.mjs`. Es un **vertical de un tenant nuevo** ("Turismo Colombia", turismocolombia.fit), no una pieza del CRM genérico: por eso está separado de `products`, y por eso esas tablas **rompen el patrón del resto del esquema** — además de la policy por `current_tenant_id()`, llevan una policy de lectura pública para `status = 'published'`, porque el sitio del tenant las lee sin login. Los textos son `jsonb {es, en}`.
- **La rama de trabajo es `juanse-candycrm-ventas`** (renombrada el 7 sept; antes `multi-tenant-y-documentacion`). `main` está 40+ commits atrás y **nadie fusionó nada ahí todavía** — no asumir que `main` refleja el estado del proyecto. La rama `gabo` es de Gabriel y ya está fusionada acá; de ella se conservó el catálogo turístico, el isotipo y el layout responsive, y se **descartó** su login (magic link + react-router) y su bandeja con datos mock (`src/features/inbox/`, que no existe en esta rama). Si alguien vuelve a traer esos archivos, está reintroduciendo trabajo ya descartado a propósito.
- **Pendiente: reemplazar la URL de Política de Privacidad en Meta for Developers en cuanto exista una URL real de candyCRM (ej. `getcandycrm.com/privacidad`).** Hoy ese campo apunta a un Artifact temporal (`https://claude.ai/code/artifact/7d35f657-92d7-4ee7-8b05-95d6205b2429`, compartido manualmente para que el revisor automático de Meta pueda leerlo) porque el dominio real todavía no está desplegado — se usó para poder publicar la app y probar el webhook con un mensaje real. Cuando `getcandycrm.com` exista: (1) publicar ahí el mismo contenido de la política, (2) en Meta for Developers → app "CRM Ventas - Hello Minus" (App ID `1537215744334186`) → Configuración de la app → Información básica, reemplazar la URL por la del dominio real. El Artifact puede quedar sin uso, no hace falta borrarlo.
- `docs/` tiene seis documentos de planeación traídos el 24-25 ago 2026 — son guías orientativas, no órdenes literales a seguir. Cada uno en HTML (snapshot original) + Markdown (copia de trabajo, la que se edita). También ahí vive `DECISIONES.md` (excepción a la convención del laboratorio, ver arriba):
  - `hoja-de-ruta-construccion` — mapa general de piezas a construir.
  - `guia-fases-1-2` — detalle de ejecución de Fase 1 (fundación) y Fase 2 (primeros agentes).
  - `tener-en-cuenta-base-de-datos` — 48 columnas/tablas que faltan en el esquema, por reglas de WhatsApp/Meta y por cruce con los dos documentos de indicadores.
  - `indicadores-dashboard` — indicadores que vería cada tenant-cliente sobre su propio negocio (parcial, 1 de varios grupos).
  - `indicadores-internos-plataforma` — indicadores confidenciales, solo para el equipo de Hellominus operando el SaaS (nunca visibles a un tenant-cliente).
  - `configurar-webhook-meta` — detalle ejecutable del Paso 1.5 de `guia-fases-1-2` (registrar la Callback URL y el Verify Token en Meta for Developers). Corresponde al candidato [3] de `DECISIONES.md`, hoy APLAZADO — no cambia esa condición de activación, es solo referencia para cuando llegue el momento.
  - `brand-vision` (agregado 5 sep 2026, solo Markdown — no hay snapshot HTML original) — arquetipo de marca (El Mago + El Inocente), promesa de marca, reglas de tono de voz y de identidad visual (paleta candy/glassmorphism, tipografía geométrica). Coincide con la dirección "Candy + Aero" ya elegida en el canvas de diseño; usarlo como referencia al escribir copys o contenido de marketing para candyCRM, no solo UI.
