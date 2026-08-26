# Esquema de referencia — proyecto `crm-ventas`

> ⚠️ **GENERADO AUTOMÁTICAMENTE. NO ES EJECUTABLE Y NO ES LA FUENTE DE VERDAD.**
>
> Esto es una **foto** del esquema real, para poder leerlo de un vistazo sin abrir 8 migraciones.
> La fuente de verdad son los archivos de [`migrations/`](migrations/) — si esta foto y una
> migración se contradicen, manda la migración.
>
> Está en Markdown y no en `.sql` a propósito: un archivo `.sql` marcado "no ejecutar" sigue
> siendo ejecutable por accidente. Así no hay ambigüedad posible.
>
> **Regenerar:** correr [`../scripts/generar-schema-referencia.sql`](../scripts/generar-schema-referencia.sql)
> contra la base y pegar la salida acá.
>
> - Proyecto: `crm-ventas` · ref `jrygtluycndiyvrxjmib` · región `us-east-1`
> - Generado: 25 ago 2026, tras la migración `20260825121130`
> - **36 tablas, todas con RLS activo. 0 advertencias del linter de seguridad.**

## Cómo leer este esquema

Tres reglas de diseño explican casi todo lo que sigue:

1. **Multi-tenant por RLS, no por filtros en el código.** Cada tabla de negocio lleva `tenant_id`
   y su policy lo compara contra `private.current_tenant_id()`. El frontend nunca filtra por
   tenant a mano.
2. **FK compuestas `(tenant_id, padre_id)`.** RLS aísla la lectura; las FK compuestas impiden
   *escribir* una fila que cruce tenants. Por eso casi toda tabla padre tiene un
   `UNIQUE (tenant_id, id)` que parece redundante con su PK y no lo es.
3. **Separación cliente / plataforma.** Lo que ve un tenant sobre su negocio, frente a los
   indicadores internos del SaaS que ningún tenant-cliente puede ver nunca.

---

## Tablas por propósito

### Núcleo multi-tenant y control de acceso

| Tabla | Para qué |
|---|---|
| `tenants` | Una fila por empresa-cliente. Hellominus es la primera |
| `team_members` | Quién trabaja en qué tenant y con qué rol (`owner`/`admin`/`agent`). Un tenant por persona |
| `platform_admins` | El equipo que opera el SaaS. Rol que cruza tenants |
| `support_sessions` | Sesión declarada para entrar al CRM de otro tenant: motivo obligatorio, vence a los 60 min |
| `audit_log` | Cambios de etapa de deals + toda escritura hecha durante un soporte |

### CRM — el negocio del tenant

| Tabla | Para qué |
|---|---|
| `contacts` | Personas y empresas. Incluye opt-in de WhatsApp y atribución declarada |
| `contact_channels` | Los canales de cada contacto (WhatsApp, IG, email…) |
| `sectors` | Verticales configurables por tenant (reemplazó un `check` hardcodeado) |
| `conversations` | Una conversación por canal. Lleva la ventana de servicio de 24 h |
| `messages` | Cada mensaje. Idempotencia por `externo_id`, costo y categoría de Meta |
| `conversation_insights` | Snapshot 1:1 del Copiloto IA por conversación |
| `pipelines` | Los pipelines del tenant (transaccional / consultivo / expansión) |
| `pipeline_stages` | Las etapas de cada pipeline |
| `deals` | Oportunidades, ancladas a un pipeline y una etapa |
| `deal_items` | Qué productos componen cada deal |
| `products` | Catálogo: catálogo vs. a medida, entregable, precios y costo |
| `quotes` | Cotizaciones versionadas (Pipeline B) |
| `payment_links` | Links de pago (Pipeline A: el bot cobra solo) |
| `payments` | Pago confirmado — viene de una cotización **o** de un link |
| `activities` | Recordatorios, notas y llamadas |
| `meetings` | Reuniones agendadas (horario + duración) |
| `contact_touchpoints` | Cada toque previo al contacto: campaña, UTM, referrer, dispositivo |
| `kb_chunks` | Base de conocimiento del tenant para RAG (`pgvector`) |
| `pipeline_transfers` | El salto A→B: quién lo detectó y si se descubrió tarde |

### WhatsApp / Meta

| Tabla | Para qué |
|---|---|
| `whatsapp_numbers` | Un registro por número conectado. **Es el mapeo `phone_number_id` → tenant** del que depende la ingesta |
| `message_templates` | Plantillas aprobadas por Meta — lo único enviable fuera de la ventana de 24 h |
| `quality_rating_history` | Histórico de calidad del número |
| `whatsapp_pricing` | Tarifas de Meta por país y categoría. **Sin `tenant_id`: son globales** |

### Indicadores internos del SaaS — nunca visibles a un tenant-cliente

| Tabla | Para qué |
|---|---|
| `agent_executions` | Una fila por ejecución de agente: tokens, latencia, escalamiento |
| `router_decisions` | Qué decidió el Router, con qué confianza, y si un humano lo corrigió |
| `subscriptions` | Plan y precio por tenant (MRR) |
| `feature_usage` | Qué funcionalidad usó qué tenant |
| `webhook_errors` | Fallos de webhooks. `tenant_id` nullable: puede fallar antes de saber de quién es |
| `metrics_snapshots` | Agregado diario por tenant (series de tiempo para dashboards) |
| `search_console_data` | Importación de Google Search Console |
| `n8n_dead_letters` | Eventos de n8n que agotaron reintentos |

---

## Columnas por tabla

Solo lo distintivo de cada una. Toda tabla de negocio lleva además `id`, `tenant_id`,
`created_at`, y varias `updated_at`.

**`tenants`** — `nombre`, `slug` (único), `meta_business_verificado`, `meta_verified_at`,
`onboarding_completado_at`, `primer_deal_cerrado_at`, `ultimo_login_at`,
`deals_movidos_ultimos_30d`

**`team_members`** — PK `user_id`, `tenant_id`, `rol` (`owner`/`admin`/`agent`)

**`platform_admins`** — PK `user_id`, `nota`

**`support_sessions`** — PK `uuid`, `admin_user_id`, `tenant_id`, `motivo` (mín. 10 caracteres),
`inicio_at`, `expira_at` (default +60 min), `cerrada_at`

**`audit_log`** — `tabla`, `registro_id` (nullable), `operacion`, `campo`, `valor_anterior`,
`valor_nuevo`, `fila_anterior` jsonb, `fila_nueva` jsonb, `actor`, `support_session_id`

**`sectors`** — `nombre`, `slug`, `orden`, `activo` · único `(tenant_id, slug)`

**`contacts`** — `nombre`, `empresa`, `sector_id`, `email`, `telefono`, `origen`, `owner_id`,
`opt_in_at`, `opt_in_source`, `opt_out_at`, `como_nos_conocio`, `visitas_antes_contacto`

**`contact_channels`** — `contact_id`, `tipo`, `valor` · único `(tenant_id, tipo, valor)`

**`conversations`** — `contact_id`, `canal`, `estado`, `ultimo_mensaje_at`, `owner_id`,
`ventana_abierta_hasta`, `ventana_horas` (default 24), `resuelta_por` (`ia`/`humano`),
`resuelta_at`, `primera_respuesta_at`

**`messages`** — `conversation_id`, `direccion` (`in`/`out`), `canal`, `contenido`, `payload_raw`,
`lead_score`, `sentimiento`, `template_id`, `categoria`, `costo_estimado`, `moneda_costo`,
`entregado`, `entregado_at`, `corregido_por_humano`, `motivo_correccion`, `externo_id`
· único parcial `(conversation_id, externo_id)` — la idempotencia de los reintentos de Meta
· *sin `tenant_id`: lo hereda de `conversations`*

**`conversation_insights`** — PK `conversation_id`, `score`, `nivel_interes` (generada del score),
`sentimiento`, `resumen`, `sugerencia`, `presupuesto_extraido`, `proxima_accion_sugerida`,
`citas_rag` jsonb (máx. 5)

**`pipelines`** — `nombre`, `tipo` (`transaccional`/`consultivo`/`expansion`), `orden`, `activo`

**`pipeline_stages`** — `pipeline_id`, `nombre`, `orden`, `color`
· único `(tenant_id, pipeline_id, nombre)`

**`deals`** — `contact_id`, `stage_id`, `pipeline_id`, `valor_estimado`, `probabilidad`,
`fuente`, `owner_id`

**`deal_items`** — `deal_id`, `product_id`, `cantidad`, `precio_unitario`

**`products`** — `sku`, `nombre`, `descripcion`, `tipo_venta`, `pipeline_default_id`,
`requiere_cotizacion`, `precio`, `costo`, `moneda`, `precio_desde`, `precio_hasta`,
`entregable_tipo`, `entregable_config` jsonb, `activo`, `disponible_desde`, `disponible_hasta`
· único `(tenant_id, sku)` · check: `a_medida` obliga `requiere_cotizacion`

**`quotes`** — `deal_id`, `version`, `items` jsonb, `total`, `estado`, `pdf_url`, `owner_id`
· único `(tenant_id, deal_id, version)`

**`payment_links`** — `deal_id`, `contact_id`, `monto`, `moneda`, `estado`, `proveedor`,
`proveedor_link_id`, `url`, `expira_at`

**`payments`** — `quote_id` (nullable), `payment_link_id` (nullable),
`stripe_payment_intent_id`, `monto`, `estado` · check: viene de una cotización **o** de un link

**`activities`** — `deal_id`, `tipo`, `contenido`, `vence_at`, `completada`, `owner_id`

**`meetings`** — `contact_id`, `deal_id`, `contenido`, `inicio_at`, `duracion_minutos`,
`estado`, `owner_id`

**`contact_touchpoints`** — `contact_id` (nullable: toques anónimos), `sesion_anonima`,
`ocurrido_at`, `canal`, `campaign_id`, `adset_id`, `ad_id`, `ctwa_clid`, `utm_*` (5),
`referrer`, `landing_page`, `dispositivo`, `ciudad`, `pais`

**`kb_chunks`** — `contenido`, `embedding` `vector(1536)` (índice HNSW), `fuente`, `metadata`

**`pipeline_transfers`** — `deal_id`, `conversation_id`, `pipeline_origen_id`,
`pipeline_destino_id`, `detectado_por` (`router`/`humano`), `detectado_tarde`, `motivo`

**`whatsapp_numbers`** — `phone_number_id` (**único**), `numero_display`, `waba_id`,
`business_portfolio_id`, `tier_actual`, `quality_rating`, `throughput_limite`, `activo`

**`message_templates`** — `nombre`, `categoria`, `idioma`, `estado`, `cuerpo`, `variables` jsonb,
`meta_template_id`, `motivo_rechazo` · único `(tenant_id, nombre, idioma)`

**`quality_rating_history`** — `whatsapp_number_id`, `quality_rating`, `tier`, `registrado_at`

**`whatsapp_pricing`** — `pais`, `categoria`, `tarifa`, `moneda`, `vigente_desde`,
`vigente_hasta` · único `(pais, categoria, vigente_desde)` · *sin `tenant_id`*

**`agent_executions`** — `agente`, `conversation_id`, `deal_id`, `modelo`, `latencia_ms`,
`resultado`, `error`, `escalado`, `motivo_escalamiento`, `tokens_entrada`, `tokens_salida`,
`costo_tokens`

**`router_decisions`** — `conversation_id`, `message_id`, `pipeline_id`, `capa`
(`reglas`/`semantica`), `regla_aplicada`, `confianza` (0–1), `senales` jsonb,
`corregido_por_humano`, `pipeline_corregido_id`, `corregido_at`

**`subscriptions`** — `plan`, `precio_mensual`, `moneda`, `estado`, `inicio_at`, `renueva_at`,
`cancelada_at`

**`feature_usage`** — `feature`, `user_id`, `usado_at`

**`webhook_errors`** — `tenant_id` (nullable), `origen`, `evento`, `http_status`, `error`,
`payload`, `reintentos`, `resuelto`

**`metrics_snapshots`** — `fecha`, `conversaciones_nuevas`, `conversaciones_resueltas`,
`resueltas_por_ia`, `mensajes_entrantes`, `mensajes_salientes`, `deals_creados`, `deals_ganados`,
`ingreso`, `costo_mensajes`, `costo_tokens` · único `(tenant_id, fecha)`

**`search_console_data`** — `fecha`, `consulta`, `pagina`, `impresiones`, `clics`, `posicion`

**`n8n_dead_letters`** — `tenant_id` (nullable), `flujo`, `payload`, `error`, `resuelto`

---

## Domains (vocabularios compartidos)

- **`canal_type`** — `chat_web` · `whatsapp` · `instagram` · `messenger` · `linkedin`
- **`fuente_type`** — los anteriores + `meta_ads` · `manual`
- **`sentimiento_type`** — `positivo` · `neutro` · `negativo`
- **`categoria_mensaje_t`** — `marketing` · `utility` · `authentication` · `service`
- **`tipo_venta_t`** — `catalogo` · `a_medida`
- **`entregable_t`** — `archivo` · `licencia` · `acceso_plataforma` · `servicio` · `ninguno`
- **`motivo_escalamiento_t`** — `monto_alto` · `cliente_molesto` · `fuera_de_alcance` · `no_supo_responder` · `pedido_explicito`

## Funciones — todas en el schema `private`

Viven en `private` y no en `public` porque PostgREST solo expone `public`: ahí quedaban
publicadas como `/rest/v1/rpc/<nombre>`, invocables con la anon key.

- **`private.current_tenant_id()`** → `uuid` · SECURITY DEFINER
- **`private.is_admin(uid uuid)`** → `boolean` · SECURITY DEFINER
- **`private.is_platform_admin(uid uuid DEFAULT auth.uid())`** → `boolean` · SECURITY DEFINER
- **`private.active_support_session_id()`** → `uuid` · SECURITY DEFINER
- **`private.audit_deal_stage_change()`** → `trigger` · SECURITY DEFINER
- **`private.audit_support_write()`** → `trigger` · SECURITY DEFINER
- **`private.validar_plantilla_para_iniciar()`** → `trigger` · SECURITY DEFINER
- **`private.set_updated_at()`** → `trigger`
- **`private.support_session_solo_cerrar()`** → `trigger`

> Al escribir una policy nueva hay que calificarlas: `private.current_tenant_id()`. Sin el
> prefijo, la creación de la policy falla — `private` no está en el `search_path`.

## Triggers

**`trg_audit_support`** (auditoría de escrituras durante un soporte) en 22 tablas con datos de
tenant: `activities`, `contact_channels`, `contact_touchpoints`, `contacts`,
`conversation_insights`, `conversations`, `deal_items`, `deals`, `kb_chunks`, `meetings`,
`message_templates`, `messages`, `payment_links`, `payments`, `pipeline_stages`,
`pipeline_transfers`, `pipelines`, `products`, `quotes`, `sectors`, `team_members`,
`whatsapp_numbers`.

**`trg_set_updated_at`** en: `contacts`, `conversations`, `conversation_insights`, `deals`,
`meetings`, `message_templates`, `payment_links`, `payments`, `products`, `quotes`,
`subscriptions`, `whatsapp_numbers`.

**Específicos:**
- `trg_audit_deal_stage` en `deals` — historia de cambios de etapa para el Kanban
- `trg_validar_plantilla` en `messages` — impide un saliente de WhatsApp sin ventana ni plantilla
- `trg_support_session_inmutable` en `support_sessions` — de una sesión solo se puede cerrar

## Realtime

Publicación `supabase_realtime`: `messages`, `deals`, `conversation_insights`.

## Vistas

- `contact_latest_insight` — contacto → su conversación más reciente → insights actuales
  (`security_invoker = true`, obligatorio para que RLS corra como quien consulta)

---

## Mapa de RLS — quién ve qué

| Patrón | Tablas | Regla |
|---|---|---|
| **Dueño o admin del tenant** | `contacts`, `conversations`, `deals`, `quotes`, `activities`, `meetings` | `tenant_id = current_tenant_id()` **y** (`owner_id = auth.uid()` **o** es admin) |
| **Vía tabla padre** | `contact_channels`, `messages`, `conversation_insights`, `payments`, `deal_items`, `pipeline_transfers`, `payment_links`, `contact_touchpoints` | Se resuelve por el `owner_id` del padre |
| **Catálogo: lee el tenant, escribe el admin** | `sectors`, `pipelines`, `products`, `message_templates` | Lectura para todo el tenant; escritura solo admin |
| **Solo lectura del tenant** | `pipeline_stages`, `kb_chunks`, `metrics_snapshots` | `tenant_id = current_tenant_id()` |
| **Lee el tenant, escribe la plataforma** | `whatsapp_numbers` | El tenant ve el estado de su canal; conectar números es de plataforma |
| **Solo admin del tenant** | `audit_log`, `quality_rating_history`, `search_console_data` | Visibilidad operativa, no de agente individual |
| **Solo plataforma** | `agent_executions`, `router_decisions`, `subscriptions`, `feature_usage`, `webhook_errors` | Indicadores internos: ningún tenant-cliente los ve |
| **Mixto** | `n8n_dead_letters` | Admin del tenant, o plataforma si el `tenant_id` es nulo |
| **Casos propios** | `tenants`, `team_members`, `platform_admins`, `support_sessions`, `whatsapp_pricing` | Ver detalle en la migración correspondiente |

### Las dos reglas que sostienen el soporte multi-tenant

- **`support_sessions`** las ve el admin de plataforma **y el admin del tenant auditado** — quién
  entró a sus datos, cuándo y con qué motivo. Un registro de acceso que el auditado no puede leer
  no es transparencia. No hay policy de `DELETE`: el rastro no se borra desde la aplicación.
- **`platform_admins`** solo se lee a sí misma. El alta y la baja van por `service_role`: un admin
  de plataforma no puede sumar a otro ni quitarse el rol solo.
