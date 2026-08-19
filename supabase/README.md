# Supabase del CRM de ventas

Proyecto Supabase **propio del CRM** — no es el mismo proyecto que usa hellominus.com (tabla `leads`) ni el de KAIROS (`agents/linkedin-agent`). La sincronización entre el `leads` de hellominus.com y este CRM se hace vía n8n (Flujo 1, ver README de la raíz), no compartiendo base de datos.

## Configuración (una sola vez)

### 1. Crear el proyecto

1. [supabase.com](https://supabase.com) → **New project** → nombralo algo como `crm-ventas`.
2. Guardá la contraseña de la base que pide crear.

### 2. Habilitar `pgvector` y crear el esquema

En el **SQL Editor** del proyecto, pegá y corré [setup.sql](setup.sql) completo. Crea:
- Todas las tablas (contactos, canales de contacto, conversaciones, mensajes, insights de IA por conversación, pipeline de deals, cotizaciones, pagos, actividades, reuniones agendadas, auditoría, embeddings de RAG).
- Tres `domain` compartidos (`canal_type`, `fuente_type`, `sentimiento_type`) para no repetir la lista de canales/sentimientos en cada columna que los usa.
- RLS activo en todas las tablas de negocio (dueño del registro o rol admin/owner en `team_members`).
- Realtime activado en `messages`, `deals` y `conversation_insights`.
- Índices en todas las columnas FK que se consultan en el día a día (antes no tenían ninguno).
- Las 7 etapas iniciales del Kanban.

#### `conversation_insights` — estado actual del Copiloto IA

Tabla 1:1 con `conversations` (PK = `conversation_id`): guarda el score, sentimiento, nivel de interés (columna generada, derivada del score), resumen de la conversación, sugerencia de respuesta, presupuesto extraído y hasta 5 citas RAG (`citas_rag`, snapshot en jsonb) que hoy alimentan el panel "Copiloto IA" del canvas de diseño. La Edge Function del Sprint 3 la actualiza con `insert ... on conflict (conversation_id) do update ...` cada vez que analiza un mensaje nuevo — **no reemplaza** a `messages.lead_score`/`messages.sentimiento`, que siguen siendo el historial por mensaje. Para el dashboard (contacto → su conversación más reciente → insights) hay una vista de conveniencia, `contact_latest_insight`.

#### `meetings` — agenda de llamadas con un contacto

Reuniones programadas (hora de inicio + duración en minutos), separadas de `activities` porque esta última modela recordatorios con un solo vencimiento, no un horario. Ancla en `contact_id` (con `deal_id` opcional). El destacado de "reunión en curso" en la UI no se guarda: se calcula comparando `inicio_at`/`duracion_minutos` contra la hora actual.

#### Mapeo de sync (Sprint 2, todavía sin implementar): `leads` de hellominus.com → CRM

Cuando se conecte el Flujo 1 de n8n (insert en `leads` de hellominus.com → CRM):
- `leads.sector` → `contacts.sector`, copia directa (mismo set de valores).
- `leads.resumen` → `conversation_insights.resumen`, como valor semilla al crear la conversación. El resto de `conversation_insights` (`score`, `sentimiento`, `sugerencia`, `presupuesto_extraido`, `proxima_accion_sugerida`, `citas_rag`) queda en su default hasta que la Edge Function del Sprint 3 los sobreescriba en el mismo upsert.
- `leads.transcripcion` (array de `{role, content}`) → una fila en `messages` por cada turno.
- El `id`/`estado` del lead original en hellominus.com se guarda en `messages.payload_raw` (ya existe para esto) — no hace falta una columna nueva.
- Pendiente de diseñar cuando se implemente ese flujo: nada protege hoy contra un webhook reintentado insertando el mismo lead dos veces (idempotencia).

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
