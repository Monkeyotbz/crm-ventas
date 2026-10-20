# RAG por tenant — ingesta del catálogo (candidato [10])

Convierte el catálogo turístico en fragmentos de texto, calcula su embedding con **Voyage AI**
(`voyage-3.5`, 1024 dimensiones) y los guarda en `kb_chunks`, para que el Copiloto busque **por
significado** ("algo tranquilo para mi esposo") y no por palabra exacta. Decisión y motivos:
`docs/DECISIONES.md` [10].

**Es un script y no un agente:** llama a una API de embeddings, no a Claude (regla del
`CLAUDE.md` del laboratorio). Corre del lado servidor y escribe con la clave de servicio:
`kb_chunks` solo tiene política de lectura, a propósito.

## Candados — leer antes de correrlo

- **El destino es siempre `demo-pruebas`**, escrito a mano en `ingesta.mjs` (`exigirDestinoDemo`).
  No es parámetro ni variable de entorno: ningún error de tipeo puede escribir en un tenant real.
  El origen (`turismo-colombia`, 32 tours publicados) **solo se lee**.
- Los fragmentos de prueba se borran con el resto del tenant:
  `scripts/demo/limpiar-tenant-demo.sql` (ver `documentación importante/`).
- Las llaves van en `scripts/rag/.env` (gitignored). **Nunca en el chat ni en git.**

## Antes de la primera corrida real

1. Tenant `demo-pruebas` creado (`scripts/demo/sembrar-tenant-demo.sql`).
2. Migración `20260920120000_rag_dimension_1024_y_busqueda.sql` aplicada (columna a 1024).
3. `cp scripts/rag/.env.example scripts/rag/.env` y completar:
   - `VOYAGE_API_KEY` — desde voyageai.com.
   - `SUPABASE_SERVICE_ROLE_KEY` — Supabase → Project Settings → API. Salta RLS: tratarla como contraseña.

## Uso

```
node scripts/rag/ingesta.mjs --dry-run            # arma los fragmentos y los muestra. Sin llaves, sin escribir
node scripts/rag/ingesta.mjs --dry-run --verbose  # los 32 fragmentos completos
node scripts/rag/ingesta.mjs                      # embebe y guarda en demo-pruebas
node --test scripts/rag/fragmentos.test.mjs       # pruebas del armado de fragmentos (sin red)
```

## Parámetros (constantes al inicio de `ingesta.mjs`)

| Parámetro | Valor | Nota |
|---|---|---|
| `MODELO` | `voyage-3.5` | Cambiarlo obliga a recalcular TODOS los vectores |
| `DIMENSION` | `1024` | Debe coincidir con `kb_chunks.embedding` |
| `LOTE` | `64` | Fragmentos por llamada a Voyage |
| `FUENTE` | `catalogo` | Valor de `kb_chunks.fuente` |
| `TENANT_ORIGEN_ID` | `turismo-colombia` | Solo lectura |
| `SLUG_DESTINO` | `demo-pruebas` | Candado: otro valor aborta |
| `PRECIO_POR_MILLON` | `0.06` US$ | **[por verificar]** contra la página de precios de Voyage |

## Cómo se arma un fragmento (`fragmentos.mjs`)

Un tour = un fragmento, escrito como **frase en español**, no como JSON. Regla de oro: **solo se
escribe lo que el registro dice.** Sin precio, el fragmento dice "Sin precio publicado: hay que
consultarlo con el operador"; nunca se omite en silencio ni se inventa, porque un fragmento que calla
un hueco hace que el asistente lo rellene.

## Idempotencia

`origen_id` (el slug del tour) + `tenant_id` + `fuente` identifican cada fragmento, con restricción
única en la base. Cada corrida compara `contenido_hash`:

| Situación | Qué hace |
|---|---|
| Fragmento nuevo | Calcula embedding e inserta |
| Texto cambió | Recalcula y actualiza (**así se reindexa un dato que cambió**) |
| Sin cambios | No llama a Voyage: **cero tokens** |
| El tour ya no existe | Borra su fragmento |

Correrlo dos veces deja el **mismo número de filas** y la segunda corrida no gasta tokens.

## Hallazgo de datos (20 oct 2026) `[medido]`

De los 32 tours publicados de Turismo Colombia, **solo 4 tienen precio** (`price_from`). Los 28
restantes salen como "sin precio publicado". Es un hueco del dato del tenant, no del RAG, pero
importa: el asistente debe decir "consulta el precio con el operador" y no inventarlo. El catálogo
completo suma ≈ 5.100 tokens `[estimado]`, y la meta es < 1.200 por turno.

## Pendiente de este tramo

Recuperación (`match_kb_chunks`), respuesta con citas, set de evaluación y métricas por consulta:
pasos 5 a 13 del traspaso. Ver `docs/DECISIONES.md` [10].
