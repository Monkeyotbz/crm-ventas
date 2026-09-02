# Corregir errores — hallazgos de la auditoría de código

Auditoría hecha el **2 sept 2026** por el agente `revisor-frontend-backend` sobre el código
escrito hasta esa fecha: la Edge Function de ingesta de WhatsApp, el validador multi-tenant, el
guardrail de credenciales y la migración de FK compuestas.

**26 hallazgos: 6 bloqueantes, 10 importantes, 10 menores.**

## Dónde está la versión viva

**https://claude.ai/code/artifact/ebad3847-445b-4c1a-84a9-0e6bf3dd5a79**

Esa es la que hay que usar para trabajar: tiene el checklist funcionando, y cada tilde queda
guardada para todos los que abran el link. [`corregir-errores.html`](corregir-errores.html) en esta
carpeta es **el código fuente de esa página**, no una copia viva — si lo abrís como archivo local
se ve igual pero en modo solo lectura (los checkboxes salen deshabilitados a propósito, porque
fuera del visor no hay dónde guardar).

Es decir: **el estado de qué está corregido vive en el artifact, no en este repo.** El `.html` de
acá sirve para versionar el contenido y para poder reconstruir la página si el artifact se pierde.

## Los 6 bloqueantes, en el orden sugerido para atacarlos

| # | Qué | Dónde |
|---|---|---|
| **H1** | `on delete set null` sin lista de columnas rompe el borrado de conversaciones y contactos. **Está en producción.** Único hallazgo **verificado ejecutando** contra la base: `DELETE FROM conversations` falla hoy con `23502` | `20260829205609_...sql:25-26, 32-33, 39-40` |
| **H2** | El `try` envuelve el `for` entero: un mensaje que falla mata los siguientes del lote, y como ya se respondió 200, Meta no reintenta | `ingesta-whatsapp/index.ts:301-320` |
| **H3** | Carrera en `contactoDe`: dos webhooks concurrentes dejan un contacto duplicado y huérfano | `ingesta-whatsapp/index.ts:131-171` |
| **H4** | Carrera en `conversacionDe`: sin `unique (tenant_id, contact_id, canal) where estado='abierta'`, dos conversaciones abiertas rompen la idempotencia | `ingesta-whatsapp/index.ts:174-204` |
| **H5** | El validador no ve `messages.template_id → message_templates`. **Hay un cruce entre tenants abierto hoy** | `scripts/validar-multitenant.sql:55-83` |
| **H6** | El validador evalúa RLS por tabla y no por policy: una `using (true)` entre policies buenas pasa limpia | `scripts/validar-multitenant.sql:101-113` |

El detalle de los 26 (con el porqué y el arreglo propuesto de cada uno) está en la página.

## Qué NO se revisó

- El **frontend**: no hay componentes de producción todavía sobre Candy + Aero, así que no había
  sobre qué aplicar los criterios de UI.
- Las **policies de RLS una por una** — justamente lo que H6 impide verificar con el validador
  actual, así que la afirmación "no hay ninguna policy con `USING (true)`" **no se puede hacer**.
- **No se corrió el validador contra la base** en esta auditoría: H5 y H12 salieron de leer las
  migraciones, no de ejecutar.

## Nota sobre la confianza de cada hallazgo

**Solo H1 está verificado con una prueba ejecutada** (se creó una conversación de prueba, se
intentó borrarla, falló con el error exacto, y se revirtió todo). Los otros 25 salen de lectura de
código — son sólidos, pero conviene confirmarlos antes de dar por buena una corrección grande,
sobre todo H3 y H4, que dependen de condiciones de concurrencia difíciles de reproducir a mano.
