# Supabase del CRM de ventas

Proyecto Supabase **propio del CRM** — no es el mismo proyecto que usa hellominus.com (tabla `leads`) ni el de KAIROS (`agents/linkedin-agent`). La sincronización entre el `leads` de hellominus.com y este CRM se hace vía n8n (Flujo 1, ver README de la raíz), no compartiendo base de datos.

## El proyecto real existe, y el esquema se cambia por migraciones

**Creado el 25 ago 2026:** proyecto `crm-ventas`, ref `jrygtluycndiyvrxjmib`, región `us-east-1`.

**`setup.sql` ya no existe.** Se convirtió en la primera migración
([`migrations/20260825115320_setup_multitenant_completo.sql`](migrations/20260825115320_setup_multitenant_completo.sql))
y se borró como archivo suelto, para que no quede la tentación de correrlo.

El motivo del cambio es concreto: con datos reales de clientes adentro no se puede borrar la base
y volver a correr un script para agregar una columna. Hace falta poder aplicar solo lo nuevo, y eso
solo lo hacen las migraciones.

**La regla que va con esto:** una migración ya aplicada **nunca se edita** — ni siquiera sus
comentarios. Si hay un error, se corrige con una migración nueva encima. Detalle en
[`migrations/README.md`](migrations/README.md).

Para leer el esquema de un vistazo sin abrir 8 archivos: [`schema-referencia.md`](schema-referencia.md)
— generado automáticamente, no ejecutable, no es fuente de verdad.

Migraciones aplicadas, en orden:

| # | Migración | Qué hizo |
|---|---|---|
| 1 | `setup_multitenant_completo` | El antiguo `setup.sql`: 19 tablas, RLS, multi-tenant, sesiones de soporte |
| 2 | `hardening_search_path_y_extension_schema` | `search_path` fijo en las 8 funciones; `vector` movido a schema `extensions` |
| 3 | `mover_funciones_internas_a_schema_private` | Las 8 funciones internas movidas a schema `private` — dejan de estar expuestas como endpoints RPC públicos |
| 4 | `doc48_p1_pipelines_y_productos` | Tabla `pipelines`, `products`, `deal_items`, versionado de `quotes` |
| 5 | `doc48_p2_whatsapp_meta` | Ventana de 24h, `message_templates`, `whatsapp_numbers`, opt-in, costos, idempotencia |
| 6 | `doc48_p3_atribucion_agentes_saas` | `contact_touchpoints`, `agent_executions`, `router_decisions`, `pipeline_transfers`, `payment_links`, métricas SaaS |
| 7 | `doc48_p4_rls_tablas_nuevas` | RLS en las 17 tablas nuevas |
| 8 | `doc48_p5_auditoria_soporte_tablas_nuevas` | Auditoría de soporte extendida a las tablas nuevas con datos de tenant |
| 9 | `fk_compuestas_pendientes_atribucion` | Composición de 5 FK que habían quedado simples (`agent_executions`, `pipeline_transfers`, `router_decisions` → `conversations`; `payments` → `quotes`; `audit_log` → `support_sessions`), detectado por `scripts/validar-multitenant.sql` |

Estado verificado: **36 tablas, todas con RLS activo**, 0 advertencias del linter de seguridad de Supabase. Datos sembrados: 1 tenant (Hellominus), 1 pipeline, 7 etapas, 5 sectores, 1 usuario `owner`.

### Las funciones viven en `private`, no en `public`

`is_admin()`, `is_platform_admin()`, `current_tenant_id()`, `active_support_session_id()`, `set_updated_at()`, `audit_deal_stage_change()`, `audit_support_write()` y `validar_plantilla_para_iniciar()` están en el schema `private`. Motivo: en `public` quedaban publicadas por PostgREST como `/rest/v1/rpc/<nombre>`, invocables con la anon key. Revocar `EXECUTE` no servía (las policies de RLS necesitan poder llamarlas), así que se movieron a un schema que PostgREST no expone.

**Consecuencia práctica:** al escribir una policy nueva hay que calificarlas — `private.current_tenant_id()`, no `current_tenant_id()`. Sin el prefijo, la creación de la policy falla porque `private` no está en el `search_path`.

## Multi-tenant

Un solo proyecto Supabase, un solo esquema — pero los datos de cada empresa cliente (cada **tenant**, tabla `tenants`) quedan completamente aislados entre sí por RLS. **Hellominus es el primer tenant** (usa el CRM para su propio pipeline de ventas), y ese mismo esquema es el que se vende como producto a otras empresas más adelante — no es un caso hipotético, es el modelo de negocio real de este CRM.

El aislamiento lo hace la base de datos, no el código: toda tabla de negocio tiene `tenant_id`, y cada política de RLS lo compara contra `current_tenant_id()` (que lee `tenant_id` del `app_metadata` del JWT del usuario). El frontend nunca filtra por tenant a mano — `supabase.from('deals').select('*')` ya devuelve solo lo del tenant del usuario logueado, aunque alguien se olvide de un `where`.

Además de RLS, las relaciones entre tablas usan **foreign keys compuestas** `(tenant_id, <padre>_id)`: un deal no puede caer en una etapa del Kanban de otro tenant, ni un contacto tener un sector de otro tenant. Sin eso, RLS aísla la lectura pero nada impide escribir una fila cruzada — para eso cada tabla padre lleva un `unique (tenant_id, id)` que parece redundante con su PK y no lo es.

### Administración de plataforma (soporte multi-tenant)

El equipo de Hellominus opera el SaaS, no solo su propio CRM: da soporte sobre el CRM de los tenants-cliente. Eso **no** se resuelve dándole membresías extra en `team_members` (cada persona pertenece a un solo tenant, a propósito), sino con la tabla `platform_admins`:

- `is_platform_admin()` mira esa tabla. Es tabla y no un claim en el JWT porque revocar el rol más privilegiado del sistema tiene que cortar el acceso en la consulta siguiente, no cuando expire el token.
- `is_admin()` devuelve verdadero para un admin de plataforma sobre cualquier tenant, así que las políticas de todas las tablas quedan escritas igual que en single-tenant.
- Para **pararse sobre otro tenant** al dar soporte no alcanza con el rol: hay que abrir una **sesión de soporte** y mandar el header `X-Acting-Tenant: <uuid del tenant>`. Ver abajo.

Alta y baja de admins de plataforma van por `service_role` (SQL Editor o backend), nunca desde la app: un admin de plataforma no puede sumar a otro ni quitarse el rol solo.

```sql
insert into platform_admins (user_id, nota) values ('<user-id>', 'Soporte Hellominus');
-- revocar:
delete from platform_admins where user_id = '<user-id>';
```

### Sesiones de soporte — cómo se audita el acceso cruzado

Postgres no dispara triggers en `SELECT`, así que **es imposible registrar fila por fila qué leyó** alguien dentro de un tenant ajeno. En vez de fingir esa auditoría, el problema está invertido: para acceder hay que **declarar el acceso primero**, y el rastro es la condición para entrar, no un efecto secundario que se pueda olvidar de escribir.

```sql
-- 1. Abrir la sesión (el motivo es obligatorio, mínimo 10 caracteres)
insert into support_sessions (admin_user_id, tenant_id, motivo)
values (auth.uid(), '<uuid-del-tenant>', 'Ticket #412: no le cargan los deals en el Kanban')
returning id, expira_at;

-- 2. Con la sesión abierta, las consultas al CRM de ese tenant llevan el header:
--    X-Acting-Tenant: <uuid-del-tenant>

-- 3. Cerrar al terminar (o dejar que venza sola a los 60 minutos)
update support_sessions set cerrada_at = now() where id = '<id-de-la-sesion>';
```

Lo que esto garantiza:

- **Sin sesión activa, el header no hace nada.** Un admin de plataforma que no abrió sesión es, a todos los efectos, un usuario común de su propio tenant. Falsificar el header es inútil.
- **Vence sola** (60 min por defecto): el acceso no queda abierto para siempre porque alguien se olvidó de cerrarlo.
- **La sesión es inmutable salvo su cierre** — un trigger impide reescribir motivo o fechas después de los hechos, y no hay política de `delete`: el rastro no se borra desde la aplicación.
- **El tenant auditado ve las sesiones sobre sus datos.** Los `owner`/`admin` de un tenant pueden leer quién entró, cuándo y con qué motivo declarado. Un registro de acceso que el auditado no puede leer no es transparencia.
- **Las escrituras quedan con detalle completo.** El trigger `audit_support_write` graba en `audit_log` la fila antes y después (`fila_anterior`/`fila_nueva`) de todo `insert`/`update`/`delete` hecho durante un soporte, con su `support_session_id`. La actividad normal del tenant sobre sus propios datos no se audita ahí (otro volumen, otro propósito).

Para reconstruir qué pasó en un soporte:

```sql
select ss.motivo, ss.inicio_at, a.tabla, a.operacion, a.fila_anterior, a.fila_nueva
from support_sessions ss
join audit_log a on a.support_session_id = ss.id
where ss.tenant_id = '<uuid-del-tenant>'
order by a.created_at;
```

> Límite conocido, por diseño de Postgres: **las lecturas siguen sin quedar registradas una por una**. Lo que queda registrado es la sesión — quién, qué tenant, cuándo, por qué y por cuánto tiempo. Para lecturas eso es lo máximo que se puede garantizar desde la base de datos; ir más fino requeriría registrar desde la capa de aplicación cada consulta, que es evitable por cualquiera que use la API directo.

### `sectors` — verticales configurables por tenant

Antes `contacts.sector` era un `check` con los rubros de Hellominus (`construccion`, `derecho`, `ventas`, `cobranza`, `otro`). Eso no sirve para un tenant que venda a otro rubro, y cambiarlo obligaba a tocar el esquema. Ahora es la tabla `sectors` (por tenant) y `contacts.sector_id`; los cinco valores originales quedan sembrados para Hellominus con los mismos `slug`, así que el mapeo con `leads.sector` de hellominus.com se mantiene.

## Levantar el esquema en un proyecto nuevo

Solo hace falta para un proyecto **nuevo** (un staging, por ejemplo). El de producción ya está
creado y con las 8 migraciones aplicadas.

### 1. Crear el proyecto

1. [supabase.com](https://supabase.com) → **New project**.
2. Guardá la contraseña de la base que pide crear — hace falta para `supabase db push` y para
   `supabase db dump`, y no se puede recuperar después (solo resetear).

### 2. Aplicar las migraciones

**No** hay un script suelto que correr: el esquema son los archivos de
[`migrations/`](migrations/), en orden de timestamp.

```bash
npx supabase link --project-ref <ref-del-proyecto-nuevo>
npx supabase db push
```

Si no se quiere usar el CLI, se pueden pegar los 8 archivos en el SQL Editor **en orden de
nombre** — el orden importa: la migración 4 crea tablas que la 7 necesita para su RLS.

Lo que queda al terminar:

- 36 tablas, **todas con RLS activo**, y FK compuestas hacia cada tabla padre.
- Las funciones internas en el schema `private` (no expuestas por PostgREST).
- 7 `domain` compartidos, para no repetir listas de valores en cada columna que las usa.
- Realtime en `messages`, `deals` y `conversation_insights`.
- Sembrado: el tenant Hellominus, su pipeline con 7 etapas, y 5 sectores.

Verificar con `get_advisors(type: "security")` — debería dar 0 hallazgos — y con el chequeo de
tablas sin RLS que está al final de
[`../scripts/generar-schema-referencia.sql`](../scripts/generar-schema-referencia.sql).

#### `conversation_insights` — estado actual del Copiloto IA

Tabla 1:1 con `conversations` (PK = `conversation_id`): guarda el score, sentimiento, nivel de interés (columna generada, derivada del score), resumen de la conversación, sugerencia de respuesta, presupuesto extraído y hasta 5 citas RAG (`citas_rag`, snapshot en jsonb) que hoy alimentan el panel "Copiloto IA" del canvas de diseño. La Edge Function del Sprint 3 la actualiza con `insert ... on conflict (conversation_id) do update ...` cada vez que analiza un mensaje nuevo — **no reemplaza** a `messages.lead_score`/`messages.sentimiento`, que siguen siendo el historial por mensaje. Para el dashboard (contacto → su conversación más reciente → insights) hay una vista de conveniencia, `contact_latest_insight`.

#### `meetings` — agenda de llamadas con un contacto

Reuniones programadas (hora de inicio + duración en minutos), separadas de `activities` porque esta última modela recordatorios con un solo vencimiento, no un horario. Ancla en `contact_id` (con `deal_id` opcional). El destacado de "reunión en curso" en la UI no se guarda: se calcula comparando `inicio_at`/`duracion_minutos` contra la hora actual.

#### Mapeo de sync (Sprint 2, todavía sin implementar): `leads` de hellominus.com → CRM

Cuando se conecte el Flujo 1 de n8n (insert en `leads` de hellominus.com → CRM):
- `leads.sector` → `contacts.sector_id`, **ya no es copia directa**: hay que resolver el slug contra `sectors` del tenant (`select id from sectors where tenant_id = ? and slug = ?`). Los slugs sembrados para Hellominus son los mismos valores que traía `leads.sector`, así que el mapeo es 1:1 — pero si el slug no existe, `sector_id` queda nulo en vez de romper el insert.
- `leads.resumen` → `conversation_insights.resumen`, como valor semilla al crear la conversación. El resto de `conversation_insights` (`score`, `sentimiento`, `sugerencia`, `presupuesto_extraido`, `proxima_accion_sugerida`, `citas_rag`) queda en su default hasta que la Edge Function del Sprint 3 los sobreescriba en el mismo upsert.
- `leads.transcripcion` (array de `{role, content}`) → una fila en `messages` por cada turno.
- El `id`/`estado` del lead original en hellominus.com se guarda en `messages.payload_raw` (ya existe para esto) — no hace falta una columna nueva.
- Pendiente de diseñar cuando se implemente ese flujo: nada protege hoy contra un webhook reintentado insertando el mismo lead dos veces (idempotencia).

### 3. Alta del primer usuario (vos)

1. **Authentication → Users → Add user** (o simplemente hacé login con magic link desde la app una vez desplegada — Supabase crea el usuario solo).
2. **Asignale el tenant en `app_metadata`** — paso obligatorio y distinto de `user_metadata`: `current_tenant_id()` lee de ahí, y a diferencia de `user_metadata`, el usuario no lo puede editar desde el cliente. Solo se puede hacer con la `service_role` key (Dashboard → el propio usuario → *Edit → App Metadata*, o vía API):
   ```js
   await supabase.auth.admin.updateUserById('<tu-user-id>', {
     app_metadata: { tenant_id: '<uuid-del-tenant-hellominus>' } // sale de select id from tenants where slug = 'hellominus'
   });
   ```
3. Insertá tu fila en `team_members` con rol `owner`, en el mismo tenant:
   ```sql
   insert into team_members (user_id, tenant_id, rol)
   select '<tu-user-id>', id, 'owner' from tenants where slug = 'hellominus';
   ```

### 4. Credenciales

En **Project Settings → API**:
- `Project URL` → `VITE_SUPABASE_URL`
- `anon` `public` key → `VITE_SUPABASE_ANON_KEY`

Ambas son seguras para el frontend (por eso llevan prefijo `VITE_`): el aislamiento real de datos lo hacen las políticas RLS, no el secreto de la clave. Ver `.env.example` en la raíz del repo.

### 5. Database Webhooks → n8n (a partir del Sprint 2)

En **Database → Webhooks**, crear uno sobre `insert` en `deals` y otro sobre `update` de `stage_id`, apuntando al endpoint de n8n correspondiente (Flujo 1). No requiere código: es la feature nativa de Supabase (basada en `pg_net`).
