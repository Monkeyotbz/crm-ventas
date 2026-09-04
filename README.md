# CRM de ventas — Hellominus (codename `crm-ventas`)

CRM multicanal (Kanban de oportunidades, bandeja unificada de conversaciones y panel copiloto con IA), construido sobre Supabase + React. **Multi-tenant desde el esquema de base de datos**: Hellominus es el primer tenant, pero el mismo CRM está pensado para venderse como producto a otras empresas — ver [supabase/README.md](supabase/README.md). Repo y deploy **separados** de [hellominus.com](../../README.md). n8n está en el plan para los canales que todavía no tienen Edge Function propia (ver la arquitectura más abajo) — hoy no tiene cuenta creada, y los canales que sí están construidos (WhatsApp, el widget de chat) no pasan por él.

> Nombre de marca y dominio `.com` todavía sin definir — se usa el codename `crm-ventas` para carpeta, repo y `package.json`. Renombrar después es un `git mv` + buscar/reemplazar, no bloquea nada de lo de abajo.

## Arquitectura

```
┌────────────────────┐   ┌──────────────────┐   ┌───────────────────────┐
│ WhatsApp Cloud API │   │ widget de chat    │   │ Instagram, Meta Ads,   │
│                     │   │ (embebido en      │   │ Messenger, Stripe      │
│                     │   │ hellominus.com)   │   │ — todavía sin Edge     │
│                     │   │                   │   │ Function propia        │
└──────────┬──────────┘   └─────────┬─────────┘   └───────────┬───────────┘
           │ webhook de Meta         │ POST directo              │ (futuro: n8n
           ▼                         ▼                            │  normaliza y
┌─────────────────────┐   ┌─────────────────────┐                 │  llama a una
│ ingesta-whatsapp     │   │ ingesta-widget-chat │                 │  Edge Function,
│ (Edge Function)      │   │ (Edge Function)      │                 │  nunca escribe
└──────────┬───────────┘   └──────────┬──────────┘                 │  directo — ver
           │                          │                             │  docs/DECISIONES)
           └────────────┬─────────────┘                             │
                         ▼                                          │
              ┌───────────────────────────────┐ ◄────────────────────┘
              │   Supabase del CRM (propio)     │
              │   contacts / conversations /    │
              │   messages / deals / quotes /   │
              │   payments / embeddings         │
              └───────────────┬───────────────┘
                    │ trigger pg_net           │ Supabase JS (auth + Realtime)
                    ▼                           ▼
              ┌──────────┐          ┌───────────────────────────────┐
              │  router   │          │  Frontend CRM (React + Vite)   │
              │  (Router) │          │  Kanban · Bandeja unificada ·  │
              └──────────┘           │  Panel copiloto IA (sin construir)
                                      └───────────────────────────────┘
```

**Esto reemplaza el diagrama original centrado en n8n** (ago 2026): en la práctica, cada canal que
tiene su propia Edge Function entra **directo**, sin n8n en el medio — así quedaron WhatsApp y el
widget de chat. n8n sigue siendo el plan para los canales que NO tienen Edge Function propia
(Instagram, Messenger, Meta Ads) y para *despachar* una vez que el Router ya clasificó, nunca para
escribir directo en la base ni para guardar memoria de conversación — el porqué de esa decisión
está en [docs/DECISIONES.md](docs/DECISIONES.md).

Supabase del CRM y Supabase de hellominus.com son **proyectos distintos**: no comparten base de
datos. Detalle del esquema y RLS en [supabase/README.md](supabase/README.md).

## Sprints

0. **Scaffold** (hecho) — repo, esquema completo, RLS, `.env.example`.
1. Auth (magic link, hecho) + Kanban funcional con deals creados a mano — **sin construir**.
2. Canal de chat web: `supabase/functions/ingesta-widget-chat/` + `widget/candy-chat-widget.js`
   **construidos y probados de punta a punta** (contacto anónimo → identificado por email,
   idempotencia, Router disparado automático). Falta embeberlo en hellominus.com de verdad — hoy
   solo corre contra [`widget/prueba.html`](widget/prueba.html), un doble local del sitio.
3. Edge Function de IA (lead score, sentimiento, presupuesto) + panel copiloto con RAG del
   catálogo/FAQ — sin construir. El Router (`supabase/functions/router/`) ya cubre la clasificación
   inicial del lead, que es un pedazo de este paso.
4. Canal WhatsApp real (Cloud API) — **construido y funcionando con mensajes reales**, ver
   [docs/corregir-errores.md](docs/corregir-errores.md). Falta la bandeja donde verlo (Sprint 1).
5. Instagram + Meta Ads (Lead Ads).
6. Cotizaciones + pagos (Stripe) + dashboard de métricas.
7. Hardening de roles/RLS multi-agente.

## Desarrollo local

```bash
npm install
cp .env.example .env   # completar VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY
npm run dev
```

Sin las variables de Supabase configuradas, la pantalla de login se muestra igual pero avisa que falta configuración (no rompe).

## Pendientes (pasos manuales, no automatizables desde acá)

- ~~Crear el proyecto Supabase del CRM~~ — **hecho el 25 ago 2026** (`crm-ventas`, us-east-1). El esquema se aplica por migraciones, ver [supabase/README.md](supabase/README.md).
- Elegir nombre de marca/dominio final.
- Crear cuenta/proyecto de n8n (Cloud o self-host) cuando se llegue al Sprint 2.
- Crear el repo remoto en GitHub y hacer el push inicial.
