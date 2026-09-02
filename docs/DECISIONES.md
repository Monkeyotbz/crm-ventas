# DECISIONES.md — candyCRM (CRM VENTAS)

<!--
FORMATO DE UNA ENTRADA — no editar este comentario al agregar entradas nuevas.

### [N] Nombre tentativo
Estado: ACEPTADO | RECHAZADO | APLAZADO
Procedencia: qué documento/línea/observación disparó el candidato
Mecanismo: script | subagente markdown | script SDK (con/sin loop) | Dynamic Workflow | guardrail
Composición: no aplica | un solo agente | orquestador + N subagentes
Condición de activación: (solo si APLAZADO) qué tiene que cambiar para revisitarlo
Fecha de la entrada / última actualización

Reglas:
- Un candidato RECHAZADO no se vuelve a proponer, salvo que el usuario mismo
  pida reabrirlo con evidencia nueva.
- Un candidato APLAZADO sin condición de activación escrita es un rechazado
  disfrazado — toda entrada aplazada debe tener su condición.
- El estado lo cambia únicamente una decisión explícita del usuario, nunca un
  agente por su cuenta ni por inferencia de otro mensaje.
-->

## Estado general

Modo en que se generó esta primera tanda: **INICIAL** (25 ago 2026, no existía
DECISIONES.md todavía). Los 8 candidatos de abajo salen de la propuesta del
agente `seleccionar-forma` tras leer `CLAUDE.md`, `README.md`,
`supabase/README.md` y `docs/*.md`.

**Decisión del usuario sobre esta tanda (25 ago 2026):** los 8 quedan
**APLAZADO** — "tenerlos en cuenta pero todavía no ejecutarlos". Ninguno fue
aceptado ni rechazado, **incluido el candidato [1]** (el guardrail que el
agente había recomendado aceptar de inmediato): esa recomendación no equivale
a decisión del usuario, y el usuario todavía no se pronunció sobre ella.

---

## Candidatos

### [1] Bloqueo de exposición de la service_role key
Estado: ACEPTADO
Procedencia: `supabase/README.md` (§ Credenciales) y `docs/guia-fases-1-2.md`
  (1.1, marcado "crítico")
Mecanismo: guardrail — `.claude/settings.json` (deny)
Composición: no aplica
Condición de activación: ninguna técnica — el agente `seleccionar-forma` lo
  identificó como candidato a ACEPTAR de inmediato (cumple la excepción de
  guardrails: prevención, no automatización, no espera evidencia de dolor).
  Implementado el 28 ago 2026: deny sobre escritura/push de service_role keys,
  ANON keys de Postgres, y passwords de bases de datos en texto plano.

### [2] Validador de aislamiento multi-tenant en el esquema
Estado: ACEPTADO
Procedencia: `docs/guia-fases-1-2.md` (Paso 2, "el error que hunde proyectos
  multi-tenant")
Mecanismo: script (`scripts/validar-multitenant.sql`)
Composición: no aplica
Condición de activación: ya cumplida — proyecto Supabase real existe (25 ago 2026).
  Implementado el 29 ago 2026: SQL puro que verifica las tres capas (columna
  `tenant_id`, FK compuestas, RLS con policy por tenant) contra la base real. Se
  corre por el MCP de Supabase o el SQL Editor — no hay wrapper de shell porque
  esta máquina no tiene `psql`. Ver `scripts/README.md`.
  **Primera corrida (29 ago 2026): encontró 5 FK simples donde deberían ser
  compuestas** (`agent_executions`, `pipeline_transfers`, `router_decisions` →
  `conversations`; `payments` → `quotes`; `audit_log` → `support_sessions`).
  **Corregido el mismo día** con la migración
  `20260829205609_fk_compuestas_pendientes_atribucion` — agrega
  `unique (tenant_id, id)` a `conversations` y `support_sessions` (les faltaba;
  `quotes` ya lo tenía), pone `payments.tenant_id` en `not null` (hallazgo
  adicional: era nullable, lo que habría dejado sin proteger cualquier fila con
  `tenant_id` nulo bajo `MATCH SIMPLE`; la tabla estaba vacía, sin riesgo de
  romper filas existentes), y recompone las 5 FK. Re-corrida del validador tras
  aplicar: 0 hallazgos de Capa 2. `get_advisors(type: "security")`: 0
  hallazgos nuevos (el único WARN pendiente, protección de passwords filtrados,
  es preexistente y no relacionado).

### [3] Normalización de mensajes por canal + deduplicación de contacto
Estado: ACEPTADO
Procedencia: `docs/hoja-de-ruta-construccion.md` (Paso 04),
  `docs/guia-fases-1-2.md` (1.5)
Mecanismo: Edge Function de Supabase sin llamada a Claude
  (`supabase/functions/ingesta-whatsapp/`)
Composición: no aplica
Condición de activación: cumplida. La primera mitad ya lo estaba desde el 25 ago
  2026 (proyecto Supabase real + esquema con todo lo que la ingesta escribe); el
  usuario dio el veredicto de ACEPTADO el 29 ago 2026 y se escribió la función.
  **Desplegada y verificada de punta a punta con un mensaje real (1-2 sept 2026).**
  El código tiene verificación de firma `X-Hub-Signature-256`, resolución de
  tenant por `phone_number_id`, dedup de contacto por `contact_channels`,
  idempotencia por `messages.externo_id` y ventana de 24 h. `whatsapp_numbers`
  sembrada con el número de prueba de Meta; secrets `WA_VERIFY_TOKEN` y
  `META_APP_SECRET` seteados vía `supabase secrets set` (nunca tocaron un
  archivo del repo). Un WhatsApp real, mandado desde un teléfono real al número
  de prueba, quedó guardado en `messages` — no fue solo el payload de muestra de
  Meta.

  **Tres bloqueos reales encontrados y resueltos en el camino, ninguno obvio de
  antemano:**
  1. La app tiene que estar **publicada** en Meta — mientras esté "Sin publicar",
     Meta no entrega webhooks reales ni siquiera a los admins de la app.
     Publicar exigió completar "URL de la Política de privacidad" (Meta lo pide
     siempre, sin excepción) — se usó un Artifact temporal de candyCRM como
     solución transitoria, con nota en `CLAUDE.md` para reemplazarlo cuando
     `getcandycrm.com` exista.
  2. **El Verify Token se desincronizó en algún punto** de la configuración por
     UI (posiblemente la propia pantalla de Meta, que redirigía sola después de
     "Verificar y guardar" sin completar el handshake) — el toggle de `messages`
     seguía en "Suscrito" pero la verificación real había fallado (403 en los
     logs). Se resolvió reconfigurando el webhook directo por la Graph API
     (`POST /{app-id}/subscriptions`), evitando la UI.
  3. **La WABA de prueba nunca tuvo esta app suscrita** — solo tenía la app
     interna de demo de Meta ("WA DevX Webhook Events 1P App"). Era el bloqueo
     de fondo real: ningún mensaje iba a llegar nunca, sin importar qué tan bien
     estuviera configurado todo lo demás. Se resolvió con
     `POST /{waba-id}/subscribed_apps` usando el token de usuario temporal del
     panel de Meta.

  **Un bug de código propio, también encontrado recién con datos reales:** el
  `.upsert()` de `messages` con `onConflict: "conversation_id,externo_id"` no
  puede apuntar a un índice único **parcial** (`where externo_id is not null`)
  — Postgres lo rechaza. Se cambió a `insert` liso + capturar el código `23505`
  (unique_violation) como éxito idempotente. Corregido, redesplegado y
  reverificado con un segundo mensaje real.

  Ver `supabase/functions/ingesta-whatsapp/README.md` para el detalle técnico
  completo.

### [4] Vista de ROI por campaña (atribución Meta Ads)
Estado: APLAZADO
Procedencia: `docs/hoja-de-ruta-construccion.md` (Paso 03)
Mecanismo: script (vista/query SQL)
Composición: no aplica
Condición de activación: campos de atribución (`utm_*`/`ad_id`/`ctwa_clid`)
  agregados al esquema + al menos una campaña real corriendo.

### [5] Router de clasificación de leads
Estado: APLAZADO
Procedencia: `docs/hoja-de-ruta-construccion.md` (Paso 02),
  `docs/guia-fases-1-2.md` (2.1-2.3)
Mecanismo: script SDK sin loop, un solo agente
Composición: un solo agente
Condición de activación: Fase 1 cerrada (bandeja funcionando con mensajes
  reales, puerta de salida de `docs/guia-fases-1-2.md` cumplida). Ver
  pregunta abierta 2 — no está resuelto si se desagrupa de [6]/[7].

### [6] Agentes conversacionales (Bot de Catálogo, SDR, Soporte/FAQ, Agendador)
Estado: APLAZADO
Procedencia: `docs/hoja-de-ruta-construccion.md` (Paso 05),
  `docs/guia-fases-1-2.md` (2.4-2.6)
Mecanismo: script SDK sin loop
Composición: orquestador (Router, candidato [5]) + 4 subagentes
Condición de activación: candidato [5] aceptado y construido, más Fase 1
  cerrada. Ver pregunta abierta 2 — el Agendador podría desagruparse por su
  dependencia externa a Cal.com/Google Calendar.

### [7] Agentes de backend (Enriquecedor, Analista, Agente de Recuperación)
Estado: APLAZADO
Procedencia: `docs/hoja-de-ruta-construccion.md` (Paso 05)
Mecanismo: Agente de Recuperación → script SDK con loop (necesita condición
  de salida, manejo de errores y control de gasto); Enriquecedor y Analista →
  script SDK sin loop
Composición: un agente por rol, sin orquestador entre ellos
Condición de activación: Fase 1 cerrada; el Agente de Recuperación además
  necesita que `payment_links` exista en el esquema (hoy no existe, pendiente
  🔴 en `docs/tener-en-cuenta-base-de-datos.md`, ítem 20).

### [8] Chequeo de consistencia entre docs/ y el esquema
Estado: APLAZADO
Procedencia: notas de conciliación manuales ya presentes 3 veces en
  `docs/guia-fases-1-2.md`, `docs/hoja-de-ruta-construccion.md` y
  `docs/tener-en-cuenta-base-de-datos.md`
Mecanismo: subagente markdown
Composición: un solo agente
Condición de activación: una cuarta ronda de cambios de esquema que vuelva a
  requerir reconciliar prosa a mano en los docs.

---

## Preguntas abiertas — pendientes de que el usuario retome la decisión

Estas quedaron sin resolver en la propuesta inicial (25 ago 2026). No son
candidatos en sí, son bifurcaciones que van a afectar cómo terminan
redactadas las entradas de arriba cuando el usuario se pronuncie:

1. **Sobre [2]** — ¿se trata con la urgencia de un guardrail de
   `.claude/settings.json` (aceptar ya, sin esperar al proyecto Supabase
   real), o se espera a tener el proyecto real armado como dice hoy su
   condición de activación?
2. **Sobre [5]/[6]/[7]** — hoy agrupan los 8 agentes descritos en
   `docs/hoja-de-ruta-construccion.md`. ¿Se desagrupan? Ejemplo concreto: el
   Agendador (dentro de [6]) depende de Cal.com/Google Calendar, una
   dependencia externa que ningún otro agente del grupo tiene — podría
   justificar tratarlo como candidato aparte.
3. **Sobre documentos hermanos no traídos todavía** — `catalogo-de-agentes.html`,
   `pipelines-por-tipo-de-lead.html`, e `indicadores-dashboard.html` /
   `indicadores-internos-plataforma.html` completos (hoy solo hay una porción
   de indicadores en el repo). Si se traen al repo, es probable que aparezcan
   candidatos nuevos — el propio `docs/hoja-de-ruta-construccion.md` lo
   anticipa explícitamente.

---

## Mapa de carpetas

No aplica todavía — el paso 6 (mapa de qué carpetas se usan) se arma recién
cuando al menos un candidato pase a ACEPTADO. Con los 8 en APLAZADO, todas
las carpetas de `.claude/agents/`, `.claude/skills/`, `.claude/workflows/`,
`scripts/`, `agentes-sdk/` y `.mcp.json` siguen vacías a propósito.
