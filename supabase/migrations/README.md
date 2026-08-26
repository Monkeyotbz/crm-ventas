# Migraciones — la fuente de verdad del esquema

Cada archivo de esta carpeta es un cambio ya **aplicado a la base de produccion**. En conjunto
reconstruyen el esquema desde cero, en orden de timestamp.

## La regla que no se rompe

> **Nunca editar una migracion ya aplicada.**

Si una migracion tiene un error, se corrige con **una migracion nueva encima** — nunca tocando la
vieja. El motivo es concreto: la base de produccion ya ejecuto ese archivo tal como estaba. Si se
lo edita, el historial deja de reconstruir la base correctamente y las migraciones dejan de servir
para lo unico que sirven.

Esto aplica **tambien a los comentarios**. Es tentador arreglar un comentario desactualizado, pero
en cuanto se acepta "editar un poquito" la regla deja de ser una regla.

### Caso concreto que ya existe acá

`20260825115320_setup_multitenant_completo.sql` arranca con un comentario que dice *"Ejecutar en
el SQL Editor de un proyecto Supabase NUEVO"*. Eso era cierto cuando el archivo se llamaba
`setup.sql` y no habia base real. **Hoy es engañoso y aun asi no se corrige**, justamente por la
regla de arriba. Este README es la aclaracion.

## Por que migraciones y no un `setup.sql` re-ejecutable

Mientras no habia base real, editar un unico archivo y volver a correrlo entero funcionaba. Con
datos reales de clientes adentro eso deja de ser posible: no se puede borrar la base y recrearla
para agregar una columna. Hace falta poder decir "aplica solo lo nuevo", y eso solo lo hacen las
migraciones.

## Como agregar una migracion

Via MCP de Supabase (lo que se uso hasta ahora):

```
apply_migration(project_id, name: "descripcion_en_snake_case", query: "<SQL>")
```

Supabase le asigna el timestamp. **Despues hay que guardar el archivo en esta carpeta** con el
nombre exacto `<version>_<name>.sql` que quedo registrado — si no, la base y el repo se separan.
Verificar con `list_migrations`.

Via CLI:

```bash
npx supabase migration new descripcion_en_snake_case
npx supabase db push
```

## Cosas a tener en cuenta al escribir una

- **Calificar las funciones internas**: `private.current_tenant_id()`, no `current_tenant_id()`.
  Viven en el schema `private` y ese schema no esta en el `search_path` al crear una policy.
- **RLS en toda tabla nueva.** Una tabla sin policy queda abierta a cualquiera con la anon key.
  El chequeo esta al final de `scripts/generar-schema-referencia.sql`.
- **FK compuestas `(tenant_id, padre_id)`** hacia la tabla padre, no FK simples. Es lo que impide
  escribir una fila que cruce tenants; RLS por si solo no lo evita.
- **`unique (tenant_id, id)`** en toda tabla que vaya a ser padre de una FK compuesta.
- Correr `get_advisors(type: "security")` despues de aplicar. Deberia dar 0 hallazgos.

## Estado actual

8 migraciones, todas aplicadas. La foto legible del resultado esta en
[`../schema-referencia.md`](../schema-referencia.md) — es referencia, no fuente de verdad.
