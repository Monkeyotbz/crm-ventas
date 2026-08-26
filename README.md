# CRM de ventas — Hellominus (codename `crm-ventas`)

CRM multicanal (Kanban de oportunidades, bandeja unificada de conversaciones y panel copiloto con IA), construido sobre Supabase + n8n + React. **Multi-tenant desde el esquema de base de datos**: Hellominus es el primer tenant, pero el mismo CRM está pensado para venderse como producto a otras empresas — ver [supabase/README.md](supabase/README.md). Repo y deploy **separados** de [hellominus.com](../../README.md), sincronizados vía n8n.

> Nombre de marca y dominio `.com` todavía sin definir — se usa el codename `crm-ventas` para carpeta, repo y `package.json`. Renombrar después es un `git mv` + buscar/reemplazar, no bloquea nada de lo de abajo.

## Arquitectura

```
┌────────────────────┐        ┌──────────────────────────┐
│  hellominus.com     │        │  Canales externos          │
│  api/chat.js        │        │  WhatsApp Cloud API         │
│  tabla `leads`      │        │  Instagram, Meta Ads, Stripe│
│  (Supabase propio)  │        └──────────────┬───────────┘
└─────────┬───────────┘                       │
          │ Database Webhook (insert)         │ Webhooks nativos de cada plataforma
          ▼                                   ▼
        ┌─────────────────────────────────────────┐
        │                   n8n                     │
        │  normaliza payloads, reintentos, errores  │
        └───────────────────┬───────────────────────┘
                             ▼
              ┌───────────────────────────────┐
              │   Supabase del CRM (propio)     │
              │   contacts / conversations /    │
              │   messages / deals / quotes /   │
              │   payments / embeddings         │
              └───────────────┬───────────────┘
                               │ Supabase JS (auth + Realtime + queries)
                               ▼
              ┌───────────────────────────────┐
              │  Frontend CRM (React + Vite)   │
              │  Kanban · Bandeja unificada ·  │
              │  Panel copiloto IA             │
              └───────────────────────────────┘
```

Supabase del CRM y Supabase de hellominus.com son **proyectos distintos**: no comparten base de datos, se sincronizan por webhooks a través de n8n. Detalle del esquema y RLS en [supabase/README.md](supabase/README.md).

## Sprints

0. **Scaffold** (este commit) — repo, esquema completo (todas las tablas, aunque varios canales todavía no tengan flujo de n8n implementado), RLS, `.env.example`.
1. Auth (magic link) + Kanban funcional con deals creados a mano.
2. Flujo n8n #1: leads del chat web de hellominus.com → CRM + bandeja unificada (ese único canal).
3. Edge Function de IA (lead score, sentimiento, presupuesto) + panel copiloto con RAG del catálogo/FAQ.
4. Canal WhatsApp real (Cloud API) dentro de la bandeja.
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
