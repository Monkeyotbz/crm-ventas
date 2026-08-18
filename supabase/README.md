# Supabase del CRM de ventas

Proyecto Supabase **propio del CRM** — no es el mismo proyecto que usa hellominus.com (tabla `leads`) ni el de KAIROS (`agents/linkedin-agent`). La sincronización entre el `leads` de hellominus.com y este CRM se hace vía n8n (Flujo 1, ver README de la raíz), no compartiendo base de datos.

## Configuración (una sola vez)

### 1. Crear el proyecto

1. [supabase.com](https://supabase.com) → **New project** → nombralo algo como `crm-ventas`.
2. Guardá la contraseña de la base que pide crear.

### 2. Habilitar `pgvector` y crear el esquema

En el **SQL Editor** del proyecto, pegá y corré [setup.sql](setup.sql) completo. Crea:
- Todas las tablas (contactos, conversaciones, mensajes, pipeline de deals, cotizaciones, pagos, actividades, auditoría, embeddings de RAG).
- RLS activo en todas las tablas de negocio (dueño del registro o rol admin/owner en `team_members`).
- Realtime activado en `messages` y `deals`.
- Las 7 etapas iniciales del Kanban.

### 3. Alta del primer usuario (vos)

1. **Authentication → Users → Add user** (o simplemente hacé login con magic link desde la app una vez desplegada — Supabase crea el usuario solo).
2. Insertá tu fila en `team_members` con rol `owner`:
   ```sql
   insert into team_members (user_id, rol) values ('<tu-user-id>', 'owner');
   ```

### 4. Credenciales

En **Project Settings → API**:
- `Project URL` → `VITE_SUPABASE_URL`
- `anon` `public` key → `VITE_SUPABASE_ANON_KEY`

Ambas son seguras para el frontend (por eso llevan prefijo `VITE_`): el aislamiento real de datos lo hacen las políticas RLS, no el secreto de la clave. Ver `.env.example` en la raíz del repo.

### 5. Database Webhooks → n8n (a partir del Sprint 2)

En **Database → Webhooks**, crear uno sobre `insert` en `deals` y otro sobre `update` de `stage_id`, apuntando al endpoint de n8n correspondiente (Flujo 1). No requiere código: es la feature nativa de Supabase (basada en `pg_net`).
