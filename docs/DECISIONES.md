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
Estado: APLAZADO
Procedencia: `supabase/README.md` (§ Credenciales) y `docs/guia-fases-1-2.md`
  (1.1, marcado "crítico")
Mecanismo: guardrail — `.claude/settings.json` (deny)
Composición: no aplica
Condición de activación: ninguna técnica — el agente `seleccionar-forma` lo
  identificó como candidato a ACEPTAR de inmediato (cumple la excepción de
  guardrails: prevención, no automatización, no espera evidencia de dolor).
  Sigue APLAZADO porque el usuario todavía no dio el veredicto explícito.

### [2] Validador de aislamiento multi-tenant en el esquema
Estado: APLAZADO
Procedencia: `docs/guia-fases-1-2.md` (Paso 2, "el error que hunde proyectos
  multi-tenant")
Mecanismo: script (`scripts/`)
Composición: no aplica
Condición de activación: antes de la primera corrida del esquema contra un
  proyecto Supabase real. Ver pregunta abierta 1 más abajo — no está resuelto
  si esto se trata con la urgencia de guardrail o se espera al proyecto real.

### [3] Normalización de mensajes por canal + deduplicación de contacto
Estado: APLAZADO
Procedencia: `docs/hoja-de-ruta-construccion.md` (Paso 04),
  `docs/guia-fases-1-2.md` (1.5)
Mecanismo: script (`scripts/`, futura Edge Function sin llamada a Claude)
Composición: no aplica
Condición de activación: proyecto Supabase real creado + arranque del
  Sprint 1.5. **Actualización 25 ago 2026: la primera mitad se cumplió** — el
  proyecto Supabase real existe, y su esquema ya tiene todo lo que la ingesta
  necesita escribir (`whatsapp_numbers` para el mapeo número→tenant,
  `messages.externo_id` para idempotencia, `conversations.ventana_abierta_hasta`,
  `contacts.opt_in_*`, `webhook_errors`). Queda pendiente solo el arranque del
  Sprint 1.5. Sigue APLAZADO: el usuario no dio veredicto sobre este candidato.

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
