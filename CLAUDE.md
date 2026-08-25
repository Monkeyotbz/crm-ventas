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

## Estado del proyecto

- Sprint 0 (scaffold) completo: estructura Vite+React+Tailwind, login con magic link. **El frontend es y sigue siendo Vite + React** — cualquier documento de `docs/` que mencione Next.js es una propuesta descartada del documento original, ya corregida ahí mismo.
- Esquema de base de datos **rediseñado** en `supabase/setup.sql` a la luz de lo que reveló el canvas de diseño: los `domain` `canal_type`/`fuente_type` ahora incluyen `messenger`/`linkedin`, tabla nueva `conversation_insights` (estado actual del Copiloto IA por conversación: score, sentimiento, nivel de interés derivado, resumen, sugerencia, citas RAG), tabla nueva `meetings` (agenda de llamadas), `contacts.sector`, e índices en las columnas FK que antes no tenían ninguno. Detalle completo en [supabase/README.md](supabase/README.md).
- **Multi-tenant (24 ago 2026):** `setup.sql` tiene tabla `tenants` y `tenant_id` en cada tabla de negocio, con RLS que aísla por tenant vía `current_tenant_id()` (lee `app_metadata.tenant_id` del JWT) antes de aplicar la regla de dueño/admin ya existente, y FK compuestas `(tenant_id, padre_id)` para que tampoco se pueda escribir una fila cruzada entre tenants. Hellominus está sembrado como primer tenant (`slug = 'hellominus'`). Motivo: el CRM se vende como producto a otras empresas, no solo lo usa Hellominus internamente — ver [`docs/guia-fases-1-2.md`](docs/guia-fases-1-2.md) para el detalle de la decisión.
- **Soporte multi-tenant:** el equipo de Hellominus opera el SaaS de los tenants-cliente vía la tabla `platform_admins` (no vía membresías extra en `team_members`, que sigue siendo un tenant por persona). Para entrar al CRM de otro tenant hay que **abrir una sesión de soporte** (`support_sessions`, con motivo obligatorio y vencimiento a 60 min) y mandar el header `X-Acting-Tenant`; sin sesión activa el header no habilita nada. Las escrituras durante un soporte quedan en `audit_log` con fila anterior/posterior y su `support_session_id`, y el tenant auditado puede leer las sesiones abiertas sobre sus datos. **Las lecturas no se auditan una por una** — Postgres no dispara triggers en `SELECT`; la sesión declarada es el rastro. Detalle en [supabase/README.md](supabase/README.md).
- **Verticales configurables:** `contacts.sector` dejó de ser un `check` hardcodeado; ahora es la tabla `sectors` por tenant (`contacts.sector_id`), con los 5 rubros de Hellominus sembrados con los mismos slugs de antes.
- **Sigue sin existir un proyecto Supabase real** para este CRM — `setup.sql` todavía no se corrió contra ninguna base (y no se pudo probar con un Postgres local tampoco: no hay Docker instalado en la máquina de desarrollo). Es puramente planificación hasta que exista un proyecto real; cualquier cambio de esquema se sigue editando directo en `setup.sql`, no como migración incremental.
- Próximo paso de código (no de planeación): Sprint 1 (Kanban funcional) recién puede arrancar después de crear ese proyecto Supabase real y correr el script. Ver los Sprints en [README.md](README.md).
- `docs/` tiene cinco documentos de planeación traídos el 24 ago 2026 — son guías orientativas, no órdenes literales a seguir. Cada uno en HTML (snapshot original) + Markdown (copia de trabajo, la que se edita):
  - `hoja-de-ruta-construccion` — mapa general de piezas a construir.
  - `guia-fases-1-2` — detalle de ejecución de Fase 1 (fundación) y Fase 2 (primeros agentes).
  - `tener-en-cuenta-base-de-datos` — 48 columnas/tablas que faltan en el esquema, por reglas de WhatsApp/Meta y por cruce con los dos documentos de indicadores.
  - `indicadores-dashboard` — indicadores que vería cada tenant-cliente sobre su propio negocio (parcial, 1 de varios grupos).
  - `indicadores-internos-plataforma` — indicadores confidenciales, solo para el equipo de Hellominus operando el SaaS (nunca visibles a un tenant-cliente).
