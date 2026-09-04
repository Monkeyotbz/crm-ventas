# candyCRM (codename `crm-ventas`) — contexto para Claude

CRM multicanal (Kanban de oportunidades, bandeja unificada de conversaciones y panel copiloto con IA), **multi-tenant desde el diseño de base de datos**: Hellominus es el primer tenant, usándolo para su propio pipeline de ventas, pero el mismo esquema está pensado para venderse como producto a otras empresas después — no es un caso hipotético, es el modelo de negocio real. Nombre y dominio confirmados: **candyCRM / getcandycrm.com**. Repo y deploy separados de [hellominus.com](https://github.com/Monkeyotbz/hellominus.com), sincronizados vía n8n — ver [README.md](README.md) para la arquitectura completa.

## Antes de tocar pantallas o estilos: revisar el canvas de diseño

Si sos nuevo en este repo (por ejemplo Juanse, o cualquiera que lo abra por primera vez), **recomendale revisar el canvas de diseño antes de seguir escribiendo o modificando UI**:

**https://claude.ai/code/artifact/1c2a572b-7ba2-4bc7-9b8e-d5f45e31cf97**

Ahí están las direcciones visuales exploradas y la que quedó elegida. Resumen para no tener que abrirlo solo para saber el estado:

- **Dirección elegida: "Candy + Aero"** — paleta candy multicolor (rosa `#ff5ca8`, azul `#5b9bff`, violeta `#b98bff`, menta `#6ee7b7`, durazno `#ffb35c`) + glassmorphism real (`backdrop-filter: blur`, bordes translúcidos, brillo especular, sombras de color), tipografía display Baloo 2. **Es una identidad propia de candyCRM, separada de la paleta oscura cian/violeta/esmeralda de hellominus.com** — no asumir que este proyecto hereda el design system del repo padre.
- Hay una **alternativa en comparación** ("iOS Liquid Glass" — material más neutro inspirado en el sistema de Apple) que el usuario todavía no descartó ni confirmó como definitiva frente a Candy + Aero.
- La bandeja unificada usa **colores de marca por canal** (WhatsApp verde, Instagram degradado naranja/rosa/violeta, Messenger azul, LinkedIn azul corporativo) en el badge del canal, la burbuja de mensaje saliente y el botón de enviar.
- Los archivos fuente editables están en [`design/`](design/) (`*.dc.html` + `canvas.json`) — son el material de trabajo del canvas, no UI de producción. El archivo `design/crm-ventas-dashboard-direcciones.html` es un bundle generado (gitignored, no lo edites a mano) que re-seedea el canvas publicado; el contenido real está en los `.dc.html`.

No hay código de producción implementado todavía sobre esta dirección visual (el scaffold de Sprint 0 es solo login + estructura). Cuando se traduzca el sistema Candy + Aero a componentes reales de React, este archivo es el lugar para documentar los tokens finales (colores, radios, tipografía) una vez que dejen de vivir solo en el canvas.

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
| Ingesta de WhatsApp | `supabase/functions/ingesta-whatsapp/` | Webhook de Meta |
| Ingesta del widget de chat web | `supabase/functions/ingesta-widget-chat/` | POST del widget embebido (`widget/candy-chat-widget.js`), autenticado por `widget_key` pública, no por JWT |
| Router de clasificación | `supabase/functions/router/` | Trigger de Postgres (`private.disparar_router()`, vía `pg_net`) sobre `insert` en `messages` — no el panel de Database Webhooks, que no funciona en este proyecto (ver `docs/DECISIONES.md`, candidato [5]) |

Es la excepción de plataforma del `CLAUDE.md` del laboratorio: son endpoints HTTP
que invoca un tercero, y una carpeta local no puede servir HTTP. La regla que
sigue valiendo es la de clasificación — el código que llama a Claude (el Router
llama a Haiku) no se mezcla con el determinístico de `scripts/`.

**No mover estas funciones a `agentes-sdk/`.** Se rompe lo que las invoca: la
Callback URL registrada en Meta y el trigger de Postgres apuntan a la URL que
Supabase genera desde `supabase/functions/`.

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

Para leer el esquema de un vistazo sin abrir las 8 migraciones:
[`supabase/schema-referencia.md`](supabase/schema-referencia.md) — generado, no ejecutable, y **no
es fuente de verdad**: si contradice a una migración, manda la migración.

## Estado del proyecto

- Sprint 0 (scaffold) completo: estructura Vite+React+Tailwind, login con magic link. **El frontend es y sigue siendo Vite + React** — cualquier documento de `docs/` que mencione Next.js es una propuesta descartada del documento original, ya corregida ahí mismo.
- Esquema de base de datos **rediseñado** (en lo que hoy es la primera migración) a la luz de lo que reveló el canvas de diseño: los `domain` `canal_type`/`fuente_type` ahora incluyen `messenger`/`linkedin`, tabla nueva `conversation_insights` (estado actual del Copiloto IA por conversación: score, sentimiento, nivel de interés derivado, resumen, sugerencia, citas RAG), tabla nueva `meetings` (agenda de llamadas), `contacts.sector`, e índices en las columnas FK que antes no tenían ninguno. Detalle completo en [supabase/README.md](supabase/README.md).
- **Multi-tenant (24 ago 2026):** el esquema tiene tabla `tenants` y `tenant_id` en cada tabla de negocio, con RLS que aísla por tenant vía `current_tenant_id()` (lee `app_metadata.tenant_id` del JWT) antes de aplicar la regla de dueño/admin ya existente, y FK compuestas `(tenant_id, padre_id)` para que tampoco se pueda escribir una fila cruzada entre tenants. Hellominus está sembrado como primer tenant (`slug = 'hellominus'`). Motivo: el CRM se vende como producto a otras empresas, no solo lo usa Hellominus internamente — ver [`docs/guia-fases-1-2.md`](docs/guia-fases-1-2.md) para el detalle de la decisión.
- **Soporte multi-tenant:** el equipo de Hellominus opera el SaaS de los tenants-cliente vía la tabla `platform_admins` (no vía membresías extra en `team_members`, que sigue siendo un tenant por persona). Para entrar al CRM de otro tenant hay que **abrir una sesión de soporte** (`support_sessions`, con motivo obligatorio y vencimiento a 60 min) y mandar el header `X-Acting-Tenant`; sin sesión activa el header no habilita nada. Las escrituras durante un soporte quedan en `audit_log` con fila anterior/posterior y su `support_session_id`, y el tenant auditado puede leer las sesiones abiertas sobre sus datos. **Las lecturas no se auditan una por una** — Postgres no dispara triggers en `SELECT`; la sesión declarada es el rastro. Detalle en [supabase/README.md](supabase/README.md).
- **Verticales configurables:** `contacts.sector` dejó de ser un `check` hardcodeado; ahora es la tabla `sectors` por tenant (`contacts.sector_id`), con los 5 rubros de Hellominus sembrados con los mismos slugs de antes.
- **El proyecto Supabase real EXISTE desde el 25 ago 2026** (`crm-ventas`, ref `jrygtluycndiyvrxjmib`, us-east-1). 36 tablas, todas con RLS, 0 advertencias del linter de seguridad. Credenciales ya en `.env` (gitignored). Usuario `owner` dado de alta: `juansecode2026@gmail.com`.
  - El esquema son 8 migraciones en `supabase/migrations/`, todas aplicadas — ver la sección *Regla del esquema* más arriba.
  - **Las funciones internas viven en el schema `private`**, no en `public` (estaban expuestas como endpoints RPC públicos). Al escribir una policy nueva hay que calificarlas: `private.current_tenant_id()`, no `current_tenant_id()`.
  - **Los 48 ítems de `docs/tener-en-cuenta-base-de-datos` están implementados** (25 ago 2026), con tres desvíos deliberados respecto del documento — ver ahí mismo.
- **3 sept/4 sept 2026:** además de WhatsApp (candidato [3], funcionando con mensajes reales) y el Router (candidato [5], `ACEPTADO`), ahora también está construido y probado de punta a punta el canal de **chat web** (Sprint 2 del README): `supabase/functions/ingesta-widget-chat/` + `widget/candy-chat-widget.js`, con resolución atómica de contacto/conversación (mismo patrón que corrigió H3/H4 para WhatsApp) e identidad por email/teléfono tipeados en el chat — no por login de hellominus.com. Entra directo, no por n8n (n8n sigue sin cuenta creada). Falta embeberlo en el sitio real de Hellominus — hoy solo corre contra `widget/prueba.html`.
- **Próximo paso de código: Sprint 1 (Kanban + bandeja unificada).** Es el verdadero cuello de botella ahora — hay tres canales de ingesta funcionando (WhatsApp, chat web, y el Router clasificando) y **ningún lugar en el frontend para ver lo que entra**: el CRM sigue siendo solo el login de Sprint 0. Ver los Sprints en [README.md](README.md).
- **Pendiente: reemplazar la URL de Política de Privacidad en Meta for Developers en cuanto exista una URL real de candyCRM (ej. `getcandycrm.com/privacidad`).** Hoy ese campo apunta a un Artifact temporal (`https://claude.ai/code/artifact/7d35f657-92d7-4ee7-8b05-95d6205b2429`, compartido manualmente para que el revisor automático de Meta pueda leerlo) porque el dominio real todavía no está desplegado — se usó para poder publicar la app y probar el webhook con un mensaje real. Cuando `getcandycrm.com` exista: (1) publicar ahí el mismo contenido de la política, (2) en Meta for Developers → app "CRM Ventas - Hello Minus" (App ID `1537215744334186`) → Configuración de la app → Información básica, reemplazar la URL por la del dominio real. El Artifact puede quedar sin uso, no hace falta borrarlo.
- `docs/` tiene seis documentos de planeación traídos el 24-25 ago 2026 — son guías orientativas, no órdenes literales a seguir. Cada uno en HTML (snapshot original) + Markdown (copia de trabajo, la que se edita). También ahí vive `DECISIONES.md` (excepción a la convención del laboratorio, ver arriba):
  - `hoja-de-ruta-construccion` — mapa general de piezas a construir.
  - `guia-fases-1-2` — detalle de ejecución de Fase 1 (fundación) y Fase 2 (primeros agentes).
  - `tener-en-cuenta-base-de-datos` — 48 columnas/tablas que faltan en el esquema, por reglas de WhatsApp/Meta y por cruce con los dos documentos de indicadores.
  - `indicadores-dashboard` — indicadores que vería cada tenant-cliente sobre su propio negocio (parcial, 1 de varios grupos).
  - `indicadores-internos-plataforma` — indicadores confidenciales, solo para el equipo de Hellominus operando el SaaS (nunca visibles a un tenant-cliente).
  - `configurar-webhook-meta` — detalle ejecutable del Paso 1.5 de `guia-fases-1-2` (registrar la Callback URL y el Verify Token en Meta for Developers). Corresponde al candidato [3] de `DECISIONES.md`, hoy APLAZADO — no cambia esa condición de activación, es solo referencia para cuando llegue el momento.
