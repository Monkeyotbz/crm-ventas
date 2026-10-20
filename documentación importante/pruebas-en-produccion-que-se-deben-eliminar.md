# Pruebas en producción que se deben eliminar

> ## ⏰ RECORDATORIO — SE DEBE BORRAR
> **Todo lo que se crea en producción solo para probar se borra.** Este documento se revisa
> **dos veces por semana (lunes y jueves)** y la fecha de la última limpieza va en la tabla de abajo.
> Si la última limpieza fue hace **más de 4 días** y hay datos de prueba vivos, hay que borrarlos
> o decidir por qué se quedan.

**Última revisión:** 2026-10-20 · **Última limpieza:** — (el tenant `demo-pruebas` se creó el 2026-10-20 y está vivo: hay que borrarlo cuando termine de usarse)

## La regla: las pruebas siempre quedan aisladas

El CRM es multi-tenant: cada empresa vive aislada por reglas de seguridad (RLS). Aprovechamos eso:

1. **Nunca se crean datos de prueba en el tenant real** (`hellominus`) **ni en el de un cliente**.
   Mezclarlos infla el Panel de hoy (conversaciones, valor en pipeline, forecast), gasta tokens de verdad
   y hace imposible saber después cuál registro era falso.
2. Toda prueba va en **un tenant aparte, con slug `demo-pruebas`**, que existe solo para eso.
3. Todo lo que se cree ahí cuelga de ese tenant, así que **se borra completo en un solo paso**
   (ver *Cómo se borra*).
4. Si una prueba necesita tocar datos reales (por ejemplo, llamar a la función del Analista sobre una
   conversación real), se anota abajo, en *Rastros en el tenant real*, con la razón de por qué se queda
   o cómo se limpia.

## Por qué importa en este CRM en concreto

Un mensaje entrante insertado en la base **dispara solo** al Router (crea contactos y oportunidades) y al
Analista (llama a Haiku, ~US$0,003 por análisis). Nada sale por WhatsApp (eso solo lo hace la función de
envío saliente), pero sí se ensucian las métricas y se gasta dinero.
Por eso el script de siembra **apaga esos dos triggers dentro de su transacción** y carga los análisis ya
hechos, en vez de dejar que corran.

## Registro de lo que existe ahora

| Qué | Dónde | Creado | Cómo se borra | Estado |
|---|---|---|---|---|
| Tenant `demo-pruebas` con 60 conversaciones, 60 contactos y 124 mensajes de ejemplo | Supabase `crm-ventas`, tenant `demo-pruebas` | 2026-10-20 | `scripts/demo/limpiar-tenant-demo.sql` | ✅ creado y verificado |
| Usuario de prueba del tenant demo | Supabase Auth | 2026-10-20 | Panel de Supabase → Authentication → Users → borrar | ✅ creado; su tenant se renombra a `demo-pruebas` al sembrar |
| Fragmentos del RAG en `kb_chunks` del tenant `demo-pruebas` (hasta 32 de catálogo) | Supabase `crm-ventas` | *(pendiente de crear)* | Se borran solos con el tenant: `scripts/demo/limpiar-tenant-demo.sql` recorre toda tabla con `tenant_id`, incluida `kb_chunks` | ⏳ por crear |

### Rastros en el tenant real (decididos, no se borran)

| Qué | Por qué se queda |
|---|---|
| Fila de `analista_ejecuciones` del 19 oct 2026 (prueba manual de la función sobre la conversación real de JSC) | Es el registro del costo real de un análisis real. No es un dato falso |
| `conversation_insights` de esa misma conversación (score 35, neutro) | Es el análisis verdadero que muestra el panel Copiloto. La conversación es real |
| Secreto `analista_secret` en Vault y `ANALISTA_SECRET` en la función | Es configuración, no una prueba |

## Ojo: crear un usuario crea un tenant solo

En este CRM, al dar de alta un usuario en Supabase Auth el trigger `on_auth_user_created` le crea
**automáticamente un tenant nuevo** (con el usuario de dueño y un embudo de 7 etapas). Por eso
`sembrar-tenant-demo.sql` **no crea** otro tenant: **adopta** el que Supabase ya le dio al usuario de
prueba y lo renombra a `demo-pruebas`. Tiene candados: se niega si el tenant es real (`hellominus`,
`turismo-colombia`), si ya tiene contactos o conversaciones, o si tiene otros miembros.

Consecuencia al limpiar: al borrar el usuario de prueba desde Authentication, **no queda ningún tenant
huérfano**, porque ese tenant es el propio `demo-pruebas`, que el script de limpieza ya borró.
Si algún día se crea un usuario de prueba y NO se siembra, quedará un tenant automático vacío
(`<correo>-<hash>`): hay que borrarlo también.

## Cómo se borra

1. Abrir el SQL Editor de Supabase (proyecto `crm-ventas`) y correr
   [`scripts/demo/limpiar-tenant-demo.sql`](../scripts/demo/limpiar-tenant-demo.sql).
   Borra **solo** lo que cuelga del tenant con slug `demo-pruebas`; no toca ningún otro tenant.
2. Borrar el usuario de prueba desde Authentication → Users, y comprobar en `select slug from tenants`
   que no quedó ningún tenant raro (solo `hellominus`, `turismo-colombia` y los reales).
3. Verificar que no quedó nada (debe devolver **0** en todas las columnas):

```sql
select
  (select count(*) from tenants where slug = 'demo-pruebas') as tenants_demo,
  (select count(*) from conversations c join tenants t on t.id = c.tenant_id where t.slug = 'demo-pruebas') as conversaciones_demo,
  (select count(*) from team_members m join tenants t on t.id = m.tenant_id where t.slug = 'demo-pruebas') as miembros_demo,
  (select count(*) from kb_chunks k join tenants t on t.id = k.tenant_id where t.slug = 'demo-pruebas') as fragmentos_rag_demo;
```

4. Anotar la fecha en **Última limpieza**, arriba, y mover la fila de la tabla a *Historial*.

## Historial de limpiezas

| Fecha | Qué se borró | Verificado |
|---|---|---|
| — | — | — |

## Cómo se recuerda

- **Esta regla vive en el `CLAUDE.md` del proyecto:** al abrir cualquier sesión, Claude debe mirar la
  fecha de **Última limpieza** y avisar si pasaron más de 4 días con datos de prueba vivos.
- **Recordatorio programado en la sesión** (lunes y jueves): solo dura mientras la sesión de Claude Code
  esté abierta y expira a los 7 días. **No es confiable por sí solo**, por eso existe la regla de arriba.
- Opción más firme, si se quiere: una tarea del Programador de Windows que muestre una notificación los
  lunes y jueves. No está creada; hay que decidirla.
