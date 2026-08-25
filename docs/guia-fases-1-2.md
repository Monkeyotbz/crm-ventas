# Guía de ejecución — Fase 1 y Fase 2

> **Fuente de este documento:** convertido desde [`guia-fases-1-2.html`](guia-fases-1-2.html)
> (versión visual original, se conserva como snapshot de referencia — no se edita más, este `.md` es la
> copia de trabajo). Última actualización del original: 23 ago 2026.
>
> **Relación con [`hoja-de-ruta-construccion.md`](hoja-de-ruta-construccion.md):** este documento la
> **complementa**, no la reemplaza — es el mismo mapa con más detalle de ejecución (dónde corre cada
> paso, qué hacer exactamente, cómo verificar que quedó bien). Aplica la misma regla que ya vale para
> la hoja de ruta: **es una guía, no una orden a seguir al pie de la letra**. El orden y el detalle de
> los pasos se ajustan con lo que vayamos aprendiendo en el camino.
>
> ✅ **Decisiones ya tomadas y sincronizadas con el repo (24 ago 2026):**
> - **Multi-tenant, confirmado.** [`supabase/setup.sql`](../supabase/setup.sql) ya tiene la tabla
>   `tenants` y `tenant_id` en cada tabla de negocio. **Hellominus es el primer tenant** (usa el CRM
>   para su propio pipeline de ventas) — el mismo esquema es el que se vende como CRM a otras empresas
>   más adelante. Los ejemplos de este documento con "acero, ropa y tecnología" eran genéricos, para
>   explicar el concepto con varios negocios ficticios — se reemplazan acá por el caso real.
> - **Frontend: Vite + React**, no Next.js — es el que ya está scaffoldeado en `src/` desde Sprint 0.
>   Donde el documento original decía Next.js, queda corregido más abajo.

---

## Las dos fases, en resumen

| | Fase 1 — Fundación operativa | Fase 2 — Primeros agentes |
|---|---|---|
| **Qué logra** | Modelo de datos, ingesta de WhatsApp y bandeja unificada. El equipo ya puede vender con el sistema — todavía sin IA. | Router, agente calificador y agendador trabajando sobre conversaciones reales, con handoff a humano. |
| **Duración estimada** | 9 pasos · 4–6 semanas | 8 pasos · 4 semanas |

---

## Preparación — antes de abrir VS Code (bitácora de sesión, 23 de agosto)

### Paso 1 — Qué tener en cuenta para iniciar

| Qué | Para qué | Tiempo |
|---|---|---|
| Cuenta Supabase | Base de datos y backend | 15 min |
| Meta Business Manager verificado | Requisito para WhatsApp API | **días** (crítico) |
| Número de teléfono dedicado | Libre de WhatsApp/Business al momento de registrar — Paso 3 | 0–3 días |
| Cuenta Vercel (o similar) | Desplegar el frontend | 15 min |
| Repositorio Git | Versionar migraciones y código | 15 min |

La verificación de Meta es el único paso que no se controla directamente. Arrancarla primero, en paralelo con todo lo demás.

**Decisiones que hay que tomar ahora, no después:**
- **¿Multi-tenant o single-tenant?** Se resuelve en el Paso 2: si el CRM se va a usar en más de una empresa, sí, y se define desde la primera migración.
- **¿Qué moneda(s) maneja el sistema?** Si son varias, hay que guardar la moneda y la tasa de cambio en el momento del cierre del deal, o los reportes de ingreso van a mentir.
- **¿Quién es el "owner" de un deal?** Vendedor fijo o rotativo — define si hace falta lógica de asignación desde ya.
- **¿Zona horaria?** Todo en UTC en la base, conversión solo en el frontend. Se rompe seguido si no se fija como regla desde el inicio.

**Orden de trabajo sugerido:**
- **Semana 1 — Datos:** proyecto Supabase, migraciones aplicadas, seeds cargados, RLS verificado.
- **Semana 2 — Ingesta:** webhook de WhatsApp recibiendo, normalización y deduplicación probadas.
- **Semana 3 — Frontend base:** Vite + React (ya scaffoldeado), autenticación del equipo, bandeja leyendo conversaciones.
- **Semana 4 — Bandeja completa:** envío de mensajes salientes, Realtime, panel de contexto.
- **Semanas 5–6 — Pipeline visual y ajustes:** Kanban, ficha del deal, colchón para atrasos.

**Los tres riesgos reales de esta fase:**
- **Verificación de Meta:** puede tumbar hasta dos semanas. Mitigación: empezarla el día 1 y, si se demora, construir primero con el widget web como canal de prueba.
- **La ventana de 24 horas de WhatsApp:** fuera de ese margen solo se pueden enviar plantillas aprobadas por Meta. Se necesitan 2 o 3 aprobadas antes de terminar la fase.
- **Scope creep hacia la IA:** la tentación de "ya que estamos, metámosle el bot" es fuerte. Hacerlo aquí produce un bot mediocre sobre datos sucios. Esta fase termina **sin un solo agente**.

### Paso 2 — Arquitectura multi-tenant

**Qué es:** un solo CRM, un solo código, una sola base de datos — pero los datos de cada empresa quedan completamente aislados entre sí. Es el mismo modelo que usa cualquier SaaS: Shopify corre millones de tiendas independientes con el mismo código.

**Por qué se necesita — caso real: Hellominus hoy, más clientes del CRM después:**
1. Hellominus es el primer tenant, usando el CRM para su propio pipeline de ventas. El CRM se construye para venderse como producto — cada empresa que lo compre es un tenant nuevo, con catálogos, pipelines y clientes sin relación entre sí. Mezclarlos en tablas sin separación sería un riesgo de seguridad, no una conveniencia.
2. Sin aislamiento, un bug o una consulta mal filtrada podría mostrarle a un vendedor de un tenant-cliente un deal de otro tenant-cliente — o de Hellominus mismo.
3. Cada tenant probablemente necesita su propio pipeline: uno puede ser consultivo B2B, otro transaccional. El multi-tenant permite que cada uno configure lo suyo sin tocar el código de los demás.
4. Construirlo desde el inicio cuesta poco. Agregarlo después, con datos reales de varios tenants ya mezclados en las mismas tablas, es una migración riesgosa y cara — por eso ya quedó así desde la primera versión de `setup.sql`, antes de tener un segundo tenant real.

**Cómo se ejecuta:** no es principalmente código — es 70% base de datos, 30% código. Si se resuelve solo filtrando en cada consulta, tarde o temprano se escapa una y se filtran datos entre empresas. La base de datos tiene que ser la que lo impida. Son tres capas:

**Capa 1 — La columna (base de datos):** ya aplicada en [`supabase/setup.sql`](../supabase/setup.sql) con los nombres reales del esquema (`contacts`, `conversations`, `deals`, `quotes`, `activities`, `meetings`, `pipeline_stages`, `kb_chunks`, `audit_log`, `team_members`). Versión ilustrativa del documento original, con los nombres genéricos que traía:
```sql
create table tenants (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,        -- "Hellominus", "Empresa Cliente 2", ...
  slug   text unique not null,
  created_at timestamptz default now()
);

-- Cada tabla existente recibe esta columna:
alter table contacts       add column tenant_id uuid references tenants(id) not null;
alter table deals          add column tenant_id uuid references tenants(id) not null;
alter table conversations  add column tenant_id uuid references tenants(id) not null;
alter table messages       add column tenant_id uuid references tenants(id) not null;
-- y así con el resto de tablas de negocio.
```
Es solo una columna más, pero es la que hace posible todo lo demás.

**Capa 2 — La identidad del usuario (autenticación):**
```js
// Al crear el usuario, se le asigna su tenant en app_metadata
await supabase.auth.admin.createUser({
  email: "vendedor@hellominus.com",
  app_metadata: { tenant_id: "uuid-del-tenant-hellominus" }   // ← aquí, NO en user_metadata
});

// El token (JWT) del usuario ya lleva adentro a qué tenant pertenece
```
> **Por qué `app_metadata` y no `user_metadata`:** el usuario no puede modificar `app_metadata` desde el cliente. Si el tenant se guarda en `user_metadata`, alguien podría cambiarse el tenant y ver datos de otra empresa.

**Capa 3 — Las políticas de RLS (la que realmente protege):**
```sql
create policy tenant_aislado on deals
  for all to authenticated
  using (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);

-- Se repite para cada tabla: contacts, conversations, messages, products...
```
Significa: *"para este usuario, la tabla deals solo contiene las filas de su tenant"*. No es un filtro que el código agrega — es una regla que Postgres aplica siempre, en toda consulta, venga de donde venga.

> **Por qué esto es tan poderoso:** el código del frontend queda igual que si fuera single-tenant: `supabase.from('deals').select('*')` — sin ningún `where tenant_id`. Postgres ya filtró. Si un desarrollador olvida el filtro, no pasa nada malo. Esa es la diferencia entre "seguro por diseño" y "seguro si nadie se equivoca".

**Dónde sí interviene el código explícitamente:**
1. Las Edge Functions (Router, ingesta, agentes) usan la `service_role` key, que **salta RLS por diseño** — necesita ver todo para poder escribir en cualquier tenant. Ahí hay que pasar el `tenant_id` explícitamente en cada operación, porque nadie está protegiendo.
2. La ingesta de WhatsApp: el webhook llega sin saber de qué empresa es. Se resuelve con una tabla que mapea número de WhatsApp → tenant.
3. Al crear un usuario nuevo: asignarle su tenant en `app_metadata`.

> ⚠️ **El error que hunde proyectos multi-tenant:** confiar en el filtro del código en vez de en RLS. Funciona en desarrollo, funciona en las pruebas, y un día una consulta sin filtrar expone los deals de un cliente a otro. Con RLS bien puesto, ese escenario es imposible aunque el código esté mal.

**Se comparte — una sola vez, para todas:** el código (Edge Functions, Router, agentes, frontend), el motor de reglas y la arquitectura de pipelines, las mejoras (un fix al SDR beneficia a las tres al instante).

**Es propio de cada tenant — vive en la base:** sus pipelines y etapas, su catálogo de productos, sus `routing_rules`, su base de conocimiento RAG, su propio número de WhatsApp.

> **La excepción — cuándo SÍ conviene separar en instancias distintas** (no es la regla, es el caso especial):
> - **Vecino ruidoso:** un tenant crece tanto que su volumen de consultas afecta el rendimiento de los demás.
> - **Residencia de datos:** requisitos legales distintos por país obligan a que los datos no salgan de cierta región.
> - **Exigencia contractual enterprise:** un cliente grande exige infraestructura aislada por contrato.
>
> Para Hellominus y los tenants que se sumen en el corto plazo, ninguna aplica todavía — el camino correcto es una sola base con `tenant_id`.

### Paso 3 — Canales de entrada: WhatsApp con Meta Business y widget web

**Primero, el número para WhatsApp Cloud API.** La regla de Meta: el número no puede estar activo en WhatsApp normal ni en WhatsApp Business en el momento de registrarlo. No tiene que ser un número que nunca haya tenido WhatsApp — solo tiene que estar libre en ese momento.

**Opción A — línea nueva** (recomendado siempre que sea posible): se activa directo en la Cloud API, sin pasos previos, sin espera, sin riesgo de perder nada.

**Opción B — reutilizar una línea con WhatsApp:**
1. En el celular: `Ajustes → Cuenta → Eliminar mi cuenta`. Cerrar sesión no es suficiente.
2. Esperar 24 a 72 horas a que Meta libere el número.
3. Recién ahí registrarlo en Meta Business/Developers.
4. **Se pierde todo** el historial de chats de esa cuenta — es irreversible.

> ⚠️ Si se intenta registrar el número mientras sigue activo en la app, Meta rechaza la verificación por SMS directamente — la eliminación no es opcional.

> **Cuándo sí conviene reutilizar:** solo si esa línea ya tiene reconocimiento importante con clientes reales y no importa perder el historial de chats de la app.

**Reglas de mensajería de Meta** — no son detalles opcionales, determinan qué puede enviar el bot, cuándo, y a qué costo:

*Reglas de conversación:*
| Regla | Qué significa |
|---|---|
| Ventana de 24 horas | Se abre cuando el cliente escribe. Dentro de ella se responde libre. Fuera, solo con plantilla. Se reinicia con cada mensaje del cliente. |
| Plantillas (templates) | Todo mensaje iniciado por la empresa fuera de la ventana debe usar una plantilla pre-aprobada. Aprobación: minutos a días. Se necesitan 2-3 listas antes de cerrar la Fase 1. |
| Categorías de mensaje | Marketing (más caro), Utility, Authentication, Service. Cada una con tarifa distinta. |
| Solo plantilla para iniciar | Si el cliente nunca ha escrito, el primer mensaje de la empresa tiene que ser una plantilla aprobada. Nunca texto libre. |

*Límites de volumen:*
| Regla | Qué significa |
|---|---|
| Tiers de mensajería | 250 → 1.000 → 10.000 → 100.000 → ilimitado usuarios únicos por 24h. Escalan solos según volumen y calidad. |
| Límite compartido | Se calcula a nivel de portafolio empresarial — todos los números bajo el mismo portafolio comparten el límite. Relevante en multi-tenant. |
| Quality Rating | Alta / Media / Baja. Se calcula por bloqueos y reportes de spam. Dispara ascensos de tier o recorta límites. |
| Throughput | Velocidad de envío, ~80 mensajes por segundo en cuentas estándar. |

*Reglas de cuenta:*
| Regla | Qué significa |
|---|---|
| Un número, una WABA | No puede estar en dos cuentas de WhatsApp Business API a la vez. |
| Verificación de negocio | Nombre legal, documento fiscal, dirección física verificable, sitio web activo. |
| Consentimiento (opt-in) | Solo se puede escribir a quien aceptó recibir mensajes. Causa más común de caída del Quality Rating. |

*Costos:*
| Regla | Qué significa |
|---|---|
| Plataforma gratis, mensaje no | Cloud API no cobra hospedaje ni llamadas a la API. Se paga por mensaje entregado. |
| Precio por país | Presupuestar con la tarifa de un solo mercado subestima el gasto real hasta 50% en operaciones multi-país. |
| Click-to-WhatsApp | Da 72 horas gratis para todo tipo de mensaje. |
| Costo de BSP (si aplica) | Un intermediario (Twilio, 360dialog) cobra encima de la tarifa de Meta. |

> ⚠️ **Desde el 1 de octubre de 2026 — responder deja de ser gratis:** los mensajes de servicio (respuestas dentro de la ventana de 24h) pasan a cobrarse por mensaje, igual que utility y authentication. Cada respuesta del Agente SDR o del Bot de Catálogo va a tener costo — revisar si el margen del Pipeline A lo aguanta antes de esa fecha.
>
> ⚠️ **Desde el 1 de agosto de 2026 — Meta Business Agent cobra por tokens:** $2.00 USD por millón de tokens. Solo aplica si se usa el agente nativo de Meta — como los agentes de este proyecto se construyen con Claude, no afecta directamente.

**El segundo canal: widget web (independiente de Meta).** La burbuja de chat que se incrusta en el sitio web. Meta no participa en absoluto — no requiere verificación de negocio, ni número dedicado, ni plantillas aprobadas, ni ventana de 24 horas.

- **Widget web — captura:** atrapa a alguien que está ahora mismo en el sitio, con la duda fresca. Cero dependencias externas. Debilidad: el visitante llega anónimo.
- **WhatsApp — sostiene:** la conversación sobrevive al cierre del navegador, el contacto llega identificado por su teléfono. Dependencia: todas las reglas de Meta.

> No se dividen por función — se dividen por momento: no es "widget = soporte, WhatsApp = ventas". Los dos venden y atienden, usan los mismos agentes, el mismo Router y el mismo pipeline. **El widget captura, WhatsApp sostiene.**

**Qué hay que tener en cuenta al construir el widget:**
1. **Identificador de sesión anónimo:** generar un ID que persista en cookie o localStorage.
2. **Pedir un dato de contacto real** en algún punto, o ese lead no sirve para el pipeline.
3. **El movimiento más valioso — puente a WhatsApp:** ofrecer *"para no perder el hilo si cierras la página, ¿seguimos por WhatsApp?"* con un botón que abra WhatsApp con el contexto ya cargado.
4. **Mismo esquema normalizado:** el widget escribe en las mismas tablas `conversations` y `messages` que WhatsApp.
5. **Deduplicación entre canales:** widget + WhatsApp con el mismo correo deben unirse bajo un solo `contact_id`.
6. **`tenant_id` en el script:** el widget debe declarar a qué empresa pertenece (`data-tenant="hellominus"`).

> **Orden recomendado de construcción:** WhatsApp primero — es donde está el mercado y tiene dependencias externas que conviene arrancar temprano. Widget después, en Fase 1 tardía o Fase 2. **La excepción:** si la verificación de Meta se demora, invertir el orden — el widget permite probar el sistema completo mientras se espera.

---

## Fase 1 — Fundación operativa (4–6 semanas)

**Meta de salida:** un vendedor puede atender leads reales de WhatsApp desde una sola pantalla, y cada conversación queda registrada con su atribución. Sin agentes IA todavía — primero el riel, después el tren.

### 1.1 — Crear el proyecto Supabase · `supabase.com` · 15 minutos · **te toca a ti**
1. Crear proyecto nuevo. Región: la más cercana a tus clientes (para LATAM, `us-east-1` o `sa-east-1`).
2. Guardar en un gestor de contraseñas: Project URL, anon key y service_role key.
3. Instalar el CLI: `npm i -g supabase` y correr `supabase init`.
4. Enlazar: `supabase link --project-ref TU_REF`

> ⚠️ **Crítico:** la `service_role` key salta RLS por diseño. Nunca va en el frontend ni en el repositorio — solo en variables de entorno de las Edge Functions.

### 1.2 — Aplicar el modelo de datos · `supabase/migrations/` · **código listo (según el documento original)**
El archivo `20260823000001_modelo_base.sql` (no está en este repo — ver nota de conflicto al principio) crea 11 tablas, enums controlados, índices de deduplicación, triggers y políticas de RLS, con reglas de negocio como constraints (un deal no se cierra como perdido sin motivo, ni se gana sin monto).

- Copiar el archivo a `supabase/migrations/`.
- Aplicar con `supabase db push`, o pegar en el SQL Editor.
- Verificar en Table Editor que aparezcan las 11 tablas.

> ✅ **Cómo saber que quedó bien:** cada tabla debe mostrar el candado de RLS enabled.

### 1.3 — Cargar pipelines, etapas y catálogo · **código listo (según el documento original)**
El archivo `20260823000002_seed_pipelines.sql` inserta tres pipelines con sus etapas y probabilidades, los productos del catálogo, y 6 reglas iniciales del Router.

> ✅ **Cómo saber que quedó bien:** `select p.nombre, count(s.id) from pipelines p join stages s on s.pipeline_id = p.id group by 1;` — debe devolver A con 5 etapas, B con 7 y C con 5.

### 1.4 — Configurar WhatsApp Cloud API · `developers.facebook.com` · 1–2 días · **te toca a ti**
1. Crear una app de tipo Business en Meta for Developers y agregar el producto WhatsApp.
2. Verificar el negocio en Business Manager (puede tardar días — empezarlo ya).
3. Registrar un número dedicado (no puede estar ya en WhatsApp normal o Business).
4. Guardar: Phone Number ID, WABA ID y generar un token permanente de sistema.

> ⚠️ La verificación de negocio de Meta es el cuello de botella más común de esta fase — arrancarla en paralelo con el paso 1.2.

### 1.5 — Edge Function de ingesta + normalización · `supabase/functions/ingesta-whatsapp/` · **siguiente entrega**
Capa 2 de la arquitectura. Recibe el webhook de WhatsApp y lo traduce al esquema único de `messages`: normaliza, deduplica el contacto por teléfono, y captura la atribución del `ctwa_clid` si vino de un anuncio Click-to-WhatsApp.

```js
// GET: Meta verifica el endpoint una sola vez
if (req.method === "GET") {
  const token = url.searchParams.get("hub.verify_token");
  if (token === Deno.env.get("WA_VERIFY_TOKEN"))
    return new Response(url.searchParams.get("hub.challenge"));
}

// POST: llega un mensaje real → se normaliza
const normalizado = {
  canal: "whatsapp",
  contact_id: contacto.id,   // deduplicado por teléfono
  direccion: "entrante",
  contenido: msg.text?.body,
  externo_id: msg.id,        // idempotencia: evita duplicados
  payload_raw: msg           // el original, por si hay que depurar
};
```

> ✅ **Cómo saber que quedó bien:** enviar un mensaje al número desde tu celular → debe aparecer una fila nueva en `messages` y una en `contacts`. Enviar un segundo mensaje: no debe crear un contacto nuevo.

### 1.6 — Envío de mensajes salientes · `supabase/functions/enviar-whatsapp/` · **siguiente entrega**
La contraparte del paso anterior: toma un mensaje del CRM y lo envía por la API de WhatsApp, registrándolo con `direccion = 'saliente'`. Permite que el vendedor responda desde la bandeja sin abrir WhatsApp.

> ⚠️ **Ventana de 24 horas:** fuera de ella hay que usar plantillas aprobadas — conviene tener 2 o 3 aprobadas desde ya.

### 1.7 — Frontend: autenticación del equipo · Vite + React (ya scaffoldeado) + Tailwind · **siguiente entrega**
El proyecto base ya existe desde Sprint 0 (`npm install`, `npm run dev` — ver [README.md](../README.md)), así que este paso es solo:
1. Confirmar `@supabase/supabase-js` instalado (ya está en `package.json`).
2. Configurar login con magic link para el equipo interno (Supabase Auth) — el scaffold de Sprint 0 ya trae la pantalla de login, falta la lógica de sesión completa.
3. Variables de entorno: solo `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` — nunca la `service_role` (ver `.env.example`).

> Corrección sobre el documento original: proponía Next.js + shadcn/ui + `@supabase/ssr` (paquete específico para SSR). El repo usa Vite + React — sin SSR, no hace falta `@supabase/ssr`, alcanza con el cliente normal de `@supabase/supabase-js`. Todavía no hay librería de ruteo elegida (`react-router` u otra) — los paths `app/inbox/`, `app/pipeline/`, `app/deals/[id]/` de los pasos siguientes son la convención de carpetas de Next.js del documento original; en Vite van a vivir donde se organice el router que se elija, sin decidir todavía.

### 1.8 — Bandeja unificada de conversaciones · **el panel más importante · siguiente entrega**
Tres columnas: lista de conversaciones con filtros, hilo de mensajes, panel de contexto del contacto. Usa Supabase Realtime para que los mensajes nuevos aparezcan sin recargar.

> ✅ **Cómo saber que quedó bien:** escribir al número desde otro celular con la bandeja abierta — el mensaje debe aparecer solo, en menos de 2 segundos, sin refrescar.

### 1.9 — Kanban del pipeline y ficha del deal · ruta por definir (ver nota del paso 1.7) · **siguiente entrega**
Cierra la Fase 1. Tarjetas arrastrables por etapa con filtro obligatorio por pipeline, y la ficha con la línea de tiempo completa del deal. El trigger `deals_on_stage_change` registra cada movimiento automáticamente en `events`.

### 🚪 Puerta de salida de la Fase 1 — no avanzar sin esto
- Un lead real entra por WhatsApp y aparece en la bandeja en segundos.
- El vendedor responde desde el CRM y el cliente lo recibe en WhatsApp.
- Un segundo mensaje del mismo número no crea un contacto duplicado.
- Un deal se puede mover de etapa y el movimiento queda registrado en `events`.
- La atribución llegó completa: al menos un lead con `ctwa_clid` o UTM guardados.

---

## Antes de arrancar la Fase 2

**Cuentas y accesos adicionales:**

| Qué | Para qué | Tiempo |
|---|---|---|
| API key de Anthropic (Claude) | El Router semántico y los agentes conversacionales | 15 min |
| Cuenta Cal.com o Google Calendar API | Disponibilidad y agendamiento del Agente Agendador | 30 min |
| Cuenta Langfuse (o equivalente) | Observabilidad — trazas de cada ejecución de agente | 15 min |
| Plantillas de WhatsApp aprobadas | Mensajes fuera de la ventana de 24h | 2–5 días (crítico) |

La aprobación de plantillas por parte de Meta es el nuevo cuello de botella de esta fase — enviarlas a revisión desde el primer día.

**Requisito de entrada — no arrancar sin esto:** la puerta de salida de la Fase 1 debe estar cumplida. El Router y los agentes se apoyan en datos limpios y en la bandeja funcionando. Construir agentes sobre un pipeline sin probar en producción es automatizar caos, no resolverlo.

---

## Fase 2 — Primeros agentes (4 semanas)

**Meta de salida:** el Router clasifica cada lead automáticamente y el Agente Calificador atiende las conversaciones consultivas hasta dejarlas listas para el vendedor, con handoff limpio a humano cuando corresponde.

### 2.1 — Router: capa de reglas determinísticas · `supabase/functions/router/`
Lee `routing_rules` (ya sembradas en 1.3) ordenadas por prioridad y devuelve el pipeline sin gastar una llamada a un LLM. Rápido y gratis. Resuelve la mayoría de los casos.

> ✅ Escribir "quiero convertir un mp3 a midi" → debe clasificar Pipeline A. Escribir "necesito algo para gestionar las obras de mi constructora" → Pipeline B.

### 2.2 — Router: capa semántica con LLM · fallback
Solo se activa cuando las reglas no resuelven. Usa un modelo pequeño con salida estructurada. Si la confianza baja del umbral, por defecto va a Pipeline B — nunca a A.

```json
{
  "pipeline": "B",
  "confidence": 0.87,
  "senales": ["menciona equipo", "dominio corporativo"],
  "stage_sugerido": "lead_entrante"
}
```

### 2.3 — Escalamiento A → B · reevaluación por turno
El Router se ejecuta en cada mensaje, no solo en el primero. Cuando detecta señales de empresa en una conversación que ya estaba en Pipeline A, cambia el `pipeline_id`, registra la fila en `pipeline_transfers` y cambia el agente que atiende — sin perder el contexto.

> ✅ Caso de prueba — Ana Gómez: pedir el conversor de $15, y en el segundo mensaje decir "es para mi equipo, somos 200 en la constructora". Debe saltar a Pipeline B y quedar la fila en `pipeline_transfers`.

### 2.4 — Agente SDR / Calificador · `supabase/functions/agente-sdr/`
El primer agente conversacional. Aplica BANT en la conversación y llena los campos del deal. El prompt define el rol, las tools definen lo que puede hacer — nunca inventa precios ni promete plazos, esos vienen de la base de datos.

**Tools que expone:**
- `buscar_producto(query)` — lee de `products`, la fuente de verdad
- `actualizar_deal(campos)` — monto estimado, dolor, tamaño de empresa
- `mover_etapa(stage)` — solo hacia "Calificado" cuando BANT está completo
- `escalar_a_humano(motivo)` — corta y avisa al vendedor

### 2.5 — Handoff a humano y takeover · Edge Function + bandeja
Criterios explícitos de corte: cliente molesto, monto por encima del umbral, tema fuera de alcance, o petición directa de hablar con una persona. Al escalar, marca `conversations.tomada_por` y el agente deja de responder — sin excepciones.

### 2.6 — Agente Agendador · `supabase/functions/agente-agendador/`
Se activa solo con leads ya calificados. Consulta disponibilidad (Cal.com o Google Calendar), propone horarios y confirma. Al agendar, mueve el deal a la etapa 03 · Diagnóstico automáticamente.

### 2.7 — Observabilidad de agentes · Langfuse o equivalente
Sin trazas no se depura un agente, se adivina. Cada ejecución debe quedar registrada: qué entró, qué tools llamó, qué salió, cuánto costó.

### 2.8 — Pruebas con conversaciones reales · producción, con supervisión
Arrancar con el agente en modo sugerencia: propone la respuesta pero un humano aprueba antes de enviar. Después de ~50 conversaciones revisadas, soltarlo en automático solo para Pipeline A, donde el riesgo por error es bajo.

### 🚪 Puerta de salida de la Fase 2
- Cada lead nuevo queda clasificado en un pipeline sin intervención humana.
- El caso de escalamiento A→B funciona y queda registrado en `pipeline_transfers`.
- El Calificador llena los campos del deal con datos extraídos de la conversación.
- El handoff corta limpio: cuando un humano toma la conversación, el agente se calla.
- Hay trazas de cada ejecución para poder depurar.

---

## Documentos hermanos mencionados, no presentes todavía en el repo

`catalogo-de-agentes.html`, `paneles-crm-mockups.html`, `pipelines-por-tipo-de-lead.html` — si los vas a traer, avisá y se suman con el mismo criterio.
