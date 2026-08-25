# Hoja de Ruta de Construcción — Herramientas del proyecto

> **Fuente de este documento:** convertido desde [`hoja-de-ruta-construccion.html`](hoja-de-ruta-construccion.html)
> (versión visual original, se conserva como snapshot de referencia — **no se edita más**, este `.md`
> es la copia de trabajo a partir de ahora). Última actualización del original: 20 ago 2026.

## Cómo usar este documento — leer antes de construir nada

Esto **es un mapa, no una orden de ejecución al pie de la letra**. Sirve para tener una idea de para
dónde va el proyecto y por qué cada pieza hace falta, pero **no nos vamos a comprometer a seguirlo
literalmente**: el orden real de construcción, los nombres exactos de tablas/columnas y hasta si una
pieza se necesita tal cual está descrita, se van a decidir en el momento con el contexto que tengamos
ahí — no porque este documento lo diga hoy.

Dos cosas puntuales a tener en cuenta:

- **El orden de los pasos acá es el orden en que se fueron *definiendo*, no el orden en que se van a
  *instalar***. El propio documento original lo dice explícito para el Paso 04 (Normalización): aparece
  después del Router en esta lista, pero en la arquitectura real corre *antes*.
- Este proyecto ya tiene su propio esquema de base de datos diseñado y documentado en
  [`supabase/setup.sql`](../supabase/setup.sql) y [`supabase/README.md`](../supabase/README.md), pensado
  específicamente para candyCRM/Hellominus (contactos, canales, conversaciones, `conversation_insights`,
  `meetings`, etc.). El "Paso 01 — Modelo de datos" de este roadmap usa nombres genéricos
  (`organizations`, `pipelines`, `stages`, `events`) que **no coinciden literalmente** con los nombres
  reales de `setup.sql` (`tenants`, `pipeline_stages`, `deals`...) — son ilustrativos, no una migración a
  copiar tal cual. El concepto de fondo que sí ya se sincronizó (24 ago 2026): `setup.sql` es
  **multi-tenant**, con Hellominus como primer tenant y el mismo esquema pensado para venderse a otras
  empresas — ver [`guia-fases-1-2.md`](guia-fases-1-2.md) para el detalle de esa decisión.

Documentos hermanos mencionados en el original pero que **todavía no llegaron al repo** (los enlaces del
HTML original apuntan a ellos): `pipeline-crm-ventas.html`, `pipelines-por-tipo-de-lead.html`,
`catalogo-de-agentes.html`. Si los vas a traer también, avisame y los sumamos acá con el mismo criterio.

---

## Progreso declarado en el documento original

01. Modelo de datos — *Definido*
02. Router — *Definido*
03. Atribución de campañas — *Definido*
04. Normalización — *Definido*
05. Orquestación de agentes — *Definido*
06. Core CRM + API — *Definido*
07. Por definir — *pendiente*

---

## Paso 01 — Modelo de datos

**Categoría:** Base de datos · Postgres (Supabase) · fundación de todo lo demás

El conjunto de tablas SQL que sostiene el CRM completo: organizaciones, contactos, deals, pipelines,
mensajes y el histórico de eventos. Va antes que el Router y antes que cualquier bot — sin tablas, no
hay dónde escribir ni leer nada.

**Por qué importa:**
- *Si queda mal:* todo lo demás se rompe después. Reestructurar el modelo con datos reales adentro es doloroso y arriesgado.
- *Si falta atribución:* sin campos como `source`, `campaign_id`, `utm_*` desde el día 1, no se puede medir ROI de ninguna campaña después.
- *Si "source" es texto libre:* en cuanto alguien escriba "instagram", "IG" e "Insta", los reportes por canal dejan de servir.
- *Si no hay RLS desde el inicio:* activar seguridad multi-tenant después de tener clientes reales en la base es mucho más riesgoso que definirla ahora.

**Esqueleto mínimo (migración SQL, del documento original — genérico, no es el esquema real del proyecto):**

```sql
create table organizations (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  dominio text,
  created_at timestamptz default now()
);

create table contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id),
  nombre text, email text, telefono text,
  -- atribución desde el día 1
  source text, campaign_id text, utm_source text, utm_medium text,
  created_at timestamptz default now()
);

create table pipelines (id uuid primary key default gen_random_uuid(), nombre text, tipo text);
create table stages    (id uuid primary key default gen_random_uuid(), pipeline_id uuid references pipelines(id), orden int, nombre text, probabilidad numeric);

create table deals (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid references contacts(id),
  pipeline_id uuid references pipelines(id),
  stage_id uuid references stages(id),
  monto numeric,
  created_at timestamptz default now()
);

-- append-only: nunca se hace update ni delete aquí
create table events (id uuid primary key default gen_random_uuid(), deal_id uuid, tipo text, payload jsonb, created_at timestamptz default now());
```

**Piezas involucradas:** Supabase Postgres · `supabase/migrations/*.sql` · Row Level Security (RLS) ·
enum `lead_source` · tabla `events` (append-only)

**Riesgo — el orden de creación importa:**
- Primero las tablas sin dependencias (`organizations`, `pipelines`), luego las que las referencian.
- Postgres rechaza una foreign key hacia una tabla que todavía no existe.
- Se hace por migraciones versionadas en Git, no por el Table Editor a mano — así queda registro de cada cambio.

---

## Paso 02 — Router (Agente de enrutamiento)

**Categoría:** Backend · lógica de decisión · corre antes que cualquier bot responda

Decide, en el momento en que entra un mensaje, a qué pipeline pertenece el lead (Transaccional,
Consultivo o Expansión) y qué agente debe responderle. No es un chatbot conversacional — no le habla
al cliente. Es un paso de decisión que corre antes de generar cualquier respuesta.

**Sin Router:**
- Todos los leads reciben la misma respuesta automática, sin importar si valen $15 o $18,000.
- La tabla `deals` no tiene `pipeline_id` → los reportes no pueden separar métricas por tipo de lead.
- No hay detección de escalamiento — un lead corporativo disfrazado de compra pequeña se pierde para siempre.
- Todo depende de que un humano reclasifique a mano, y en la práctica eso no pasa a tiempo.

**Qué hace, en orden:**
1. Recibe el mensaje nuevo apenas se guarda en la base de datos.
2. **Capa 1 — reglas determinísticas:** revisa señales duras contra una tabla de reglas (fuente, dominio de correo, SKU mencionado, ticket estimado). Rápido y sin costo de LLM.
3. **Capa 2 — semántica:** si las reglas no alcanzan, llama a un modelo pequeño (no el que conversa con el cliente) y le pide una salida estructurada: pipeline sugerido, confianza, señales detectadas.
4. Si la confianza es baja, por defecto manda al pipeline consultivo (B) — nunca al transaccional. El costo de calificar de más es bajo; el de perder un lead grande es alto.
5. Escribe `pipeline_id` y `stage_id` en el deal, y dispara al agente correspondiente.
6. Se vuelve a ejecutar en cada mensaje siguiente — así detecta si un lead debe saltar de pipeline (ej. de A a B).

**Piezas involucradas:** Supabase Edge Function · Database Webhook (on INSERT) · tabla `routing_rules` ·
tabla `pipeline_transfers` · LLM pequeño (ej. Claude Haiku) · Postgres

**Riesgo — no viene configurado por defecto:**
- Supabase da la infraestructura (Edge Functions, Webhooks, Postgres) — no la lógica de negocio.
- El Router es código que se escribe una vez y vive en `supabase/functions/router/`.
- Las reglas de la tabla `routing_rules` sí se pueden ajustar después sin tocar código.

---

## Paso 03 — Atribución y medición de campañas (ROI de Meta Ads)

**Categoría:** Medición · cierra el ciclo entre gasto publicitario e ingreso real

Meta sabe cuánto gastaste y cuántos leads generó cada campaña — no sabe cuáles de esos leads terminaron
pagando. Esa mitad de la ecuación solo la tiene el CRM. Esta pieza conecta el gasto publicitario con el
ingreso real de cada deal cerrado.

**Por qué el costo por lead no basta — ejemplo con dos campañas de $500:**

| | Campaña "Gadgets" | Campaña "ERP Construcción" |
|---|---|---|
| Leads generados | 200 | 12 |
| Costo por lead | $2.50 | $41.67 |
| Cerrados | 30 ventas | 1 venta |
| Ingreso | $450 | $18,400 |
| **ROI real** | **−10%** | **+3,580%** |

La campaña que parecía mejor por costo-por-lead hizo perder dinero. La "cara" pagó el año — y ese
cálculo solo lo puede hacer el CRM, porque solo él conoce el monto final de cada deal.

**Cómo funciona, en orden:**
1. El anuncio pasa un identificador: `ctwa_clid` en Click-to-WhatsApp, `campaign_id`/`adset_id`/`ad_id` en Lead Ads, `utm_*` en tráfico web.
2. La ingesta lo guarda en el contacto apenas entra — si no se captura en ese primer momento, se pierde para siempre.
3. El dato viaja con el deal hasta que se cierra; el monto final queda ligado al `ad_id` que lo originó.
4. Una consulta agrega ventas e ingreso por campaña y calcula el ROI real, no solo el costo por lead.
5. **Conversions API (opcional):** cuando un deal se cierra, el backend le avisa a Meta — el algoritmo optimiza por clientes que pagan, no solo por leads.

**Consulta de ROI por campaña:**

```sql
select campaign_id,
       count(*) filter (where stage = 'ganado') as ventas,
       sum(monto) filter (where stage = 'ganado') as ingreso
from deals join contacts using (contact_id)
group by campaign_id;
```

**Piezas involucradas:** Meta Ads (conector disponible) · Meta Conversions API · campos `utm_*`/`ad_id`
en `contacts` · tabla `events` · vista SQL de ROI por campaña

**Riesgo — depende de los dos pasos anteriores:**
- Sin el modelo de datos (Paso 01) no hay dónde guardar los campos de atribución.
- Sin el Router (Paso 02) clasificando correctamente el pipeline, el ROI mezclaría deals de $15 con deals de $18,000.

---

## Paso 04 — Normalización de mensajes

**Categoría:** Arquitectura · Capa 2 (Ingesta → Normalización → Router) · traduce todo a un solo esquema

WhatsApp, un formulario web, Instagram y el email no mandan la información con la misma estructura. La
normalización es el código que traduce cada formato de entrada a un solo esquema interno, para que el
Router, los agentes y los reportes nunca tengan que saber de dónde vino el mensaje.

**Sin normalización / sin deduplicación:**
- Cada agente y cada reporte tendría que entender el formato particular de cada canal por separado.
- Agregar un canal nuevo (Telegram, LinkedIn) obliga a reescribir la lógica en todos los puntos que leen mensajes.
- Si Ana escribe por WhatsApp y luego llena el formulario con el mismo correo, se crean dos contactos en vez de uno.

**Mismo mensaje, dos formatos de entrada distintos:**

```jsonc
// Lo que manda WhatsApp Cloud API
{
  "messages": [{
    "from": "573001234567",
    "type": "text",
    "text": { "body": "Hola, necesito info" },
    "timestamp": "1724175600"
  }]
}

// Lo que manda un formulario web
{
  "name": "Ana Gómez",
  "email": "ana@edifica.com",
  "message": "Hola, necesito info"
}
```

**Lo que se guarda en `messages` después de normalizar — un solo esquema, siempre:**

```jsonc
{
  "canal": "whatsapp",
  "contact_id": "uuid-del-contacto",
  "direccion": "entrante",
  "contenido": "Hola, necesito info",
  "timestamp": "2026-08-20T10:00:00Z"
}
```

**Dónde vive, en la arquitectura por capas:**
1. **Capa 1 — Ingesta:** cada canal llega con su propio formato (webhook de WhatsApp, POST del formulario, etc.).
2. **Capa 2 — Normalización (esta pieza):** traduce todo al esquema único y hace la deduplicación de contactos por teléfono/email.
3. **Capa 3 — Router:** ya solo lee el formato normalizado, nunca el original del canal.
4. **Capas 4 y 5 — Core CRM + API, Frontend:** consumen datos ya limpios y predecibles.

**Piezas involucradas:** Supabase Edge Function (por canal) · esquema JSON único (tabla `messages`) ·
deduplicación por teléfono/email · tabla `contacts`

**Riesgo — va antes que el Router, aunque se definió después:**
- En orden de construcción real, la normalización corre primero: el Router necesita el mensaje ya en formato único para poder aplicar sus reglas.
- Esta hoja de ruta lista las piezas en el orden en que se van definiendo, no en el orden en que se instalan — por eso aparece como Paso 04 aunque en la arquitectura antecede al Router.

---

## Paso 05 — Orquestación de agentes

**Categoría:** Arquitectura · Capa 3 · "el cerebro" — decide qué agente atiende qué

El error típico es construir un solo bot gigante. Este proyecto se divide en **8 agentes con roles
específicos** — 5 conversan con el cliente, 3 trabajan en segundo plano sobre los datos. El detalle
completo de cada uno (función, dónde se activa, nivel de uso) vive en un documento aparte,
`catalogo-de-agentes.html` (**todavía no está en el repo** — ver nota al principio de este documento).

**Resumen — 8 agentes, ordenados por nivel de uso:**

| Agente | Tipo | Pipeline | Nivel de uso |
|---|---|---|---|
| Router | Orquestación | Todos | Alto |
| Bot de Catálogo | Ventas | A | Alto |
| SDR / Calificador | Ventas | B | Alto |
| Soporte / FAQ | Atención | A y B | Medio |
| Enriquecedor | Backend | B | Medio |
| Agendador | Ventas | B | Medio |
| Analista | Backend | B y C | Bajo |
| Agente de Recuperación | Ventas | A | Bajo |

**Piezas involucradas:** grafo de agentes (LangGraph / Claude Agent SDK) · tools por agente · handoff a
humano · observabilidad (Langfuse)

**Riesgo — quién asigna a cuál agente le toca responder:**
- Solo el Router (Paso 02) decide el pipeline y, con eso, qué agente conversacional entra.
- Ningún agente conversacional se auto-asigna un pipeline — el Bot de Catálogo y el SDR solo ejecutan una vez que el Router ya decidió.

---

## Paso 06 — Core CRM + API

**Categoría:** Arquitectura · Capa 4 · fuente de verdad — parte automática, parte por configurar

Es la capa que guarda y expone los datos reales del negocio: contactos, deals, pipelines, productos. No
conversa ni decide nada — todos los demás componentes (Router, agentes, frontend, integraciones) la
consultan y actualizan. La confusión más común: parte de esto viene automático con Supabase, y parte no.

**Viene automático:**
- En cuanto creás una tabla en Postgres, PostgREST genera solo los endpoints REST (GET/POST/PATCH/DELETE) — sin escribir backend.
- También expone GraphQL y suscripciones en tiempo real sobre esas mismas tablas.

**NO viene automático:**
- Row Level Security (RLS): sin activarla, cualquiera con la API key pública puede leer o modificar **todas** las filas.
- Reglas de negocio (ej. "un deal no pasa a Ganado sin monto") — se escriben como constraints, triggers o funciones.

**Cómo separarlo mentalmente:**
1. **La API** — el "cómo se accede" — sí viene resuelta por Supabase al crear cada tabla.
2. **El Core** — las reglas de qué es válido y quién puede hacer qué — no viene resuelto; es trabajo de configuración explícito.
3. Sin políticas de RLS, no hay separación entre lo que puede tocar un cliente, un vendedor, o el Router.
4. Lógica que cruza varias tablas a la vez (mover un deal Y registrar el evento) tampoco existe sola — se escribe como función de Postgres o Edge Function.

**Piezas involucradas:** PostgREST (automático) · Row Level Security — se configura · constraints y
triggers — se configuran · Edge Functions para lógica multi-tabla

**Riesgo — la trampa más común:**
- Activar Supabase y empezar a meter datos reales sin haber configurado RLS deja la base técnicamente abierta.
- La clave pública (`anon key`) vive expuesta en el frontend y en los bots — por eso RLS no es opcional, es la barrera real de seguridad.

> Nota de conciliación con este proyecto: `supabase/setup.sql` **ya tiene RLS activado en las 15 tablas
> desde el diseño inicial**, no es algo pendiente acá — este paso del roadmap describe el riesgo genérico,
> no el estado real de candyCRM.

---

## Paso 07 — Por definir

*(pendiente — se agrega cuando se indique cuál es la siguiente herramienta)*
