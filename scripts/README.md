# `scripts/` — código determinístico, sin llamadas a Claude

## `validar-multitenant.sql` — candidato [2]

Verifica las tres capas de aislamiento multi-tenant del Paso 2 de
[`docs/guia-fases-1-2.md`](../docs/guia-fases-1-2.md) contra la base **real**, no contra los
archivos de migración:

| Capa | Qué comprueba | Si falta |
|---|---|---|
| 1 | Toda tabla de negocio tiene `tenant_id` | Las filas de todos los tenants viven mezcladas sin forma de separarlas |
| 2 | Las FK entre tablas de negocio son compuestas `(tenant_id, padre_id)` | RLS aísla la lectura, pero se puede **escribir** una fila que apunte al padre de otro tenant |
| 3 | Toda tabla tiene RLS activo y al menos una policy | Sin RLS, la anon key lee la tabla entera |

**Devuelve una fila por hallazgo.** Cero filas con `severidad = 'ERROR'` es el resultado sano.
`REVISAR` no es un fallo: marca tablas cuyas policies no mencionan el tenant, que puede ser
correcto (las tablas de plataforma como `agent_executions` o `subscriptions` se aíslan por
`is_platform_admin()`, a propósito).

Las tablas exentas de la Capa 1 están declaradas dentro del SQL, cada una con su motivo. Si
aparece una tabla nueva que legítimamente no lleva `tenant_id`, se agrega ahí — el criterio
general no se relaja.

### Cómo correrlo

**No hay wrapper de shell**: esta máquina no tiene `psql` instalado, y un script que no puede
correr es peor que ninguno. Tres formas, todas equivalentes:

1. **MCP de Supabase** (lo más directo desde una sesión de Claude Code):
   `execute_sql` con el contenido del archivo, contra `jrygtluycndiyvrxjmib`.
2. **SQL Editor del panel** de Supabase: pegar el archivo y ejecutar.
3. **`psql`**, si algún día se instala:
   `psql "$SUPABASE_DB_URL" -f scripts/validar-multitenant.sql`

### Cuándo correrlo

Después de cada migración que agregue tablas o foreign keys. No está automatizado con un hook a
propósito: necesita conexión a la base, y un hook que falle en silencio por falta de red daría
una falsa sensación de verificación.

### Última corrida — 29 ago 2026

Contra producción (`jrygtluycndiyvrxjmib`): **5 hallazgos `ERROR` en la Capa 2**, todos FK
simples hacia tablas que sí tienen `tenant_id`:

| Tabla | FK | Padre |
|---|---|---|
| `agent_executions` | `conversation_id` | `conversations` |
| `pipeline_transfers` | `conversation_id` | `conversations` |
| `router_decisions` | `conversation_id` | `conversations` |
| `payments` | `quote_id` | `quotes` |
| `audit_log` | `support_session_id` | `support_sessions` |

Las cuatro primeras son huecos reales de escritura cruzada. Vienen de la migración
`doc48_p3_atribucion_agentes_saas`, que creó esas tablas con FK simples mientras el núcleo
(migración 1) ya usaba compuestas.

**Todavía no están corregidas** — la corrección es una migración nueva (nunca editar una
aplicada, ver [`../supabase/migrations/README.md`](../supabase/migrations/README.md)) y además
necesita un paso previo: `conversations` y `support_sessions` **no tienen** `unique (tenant_id, id)`,
que es lo que una FK compuesta necesita del lado del padre. `quotes` sí lo tiene.
