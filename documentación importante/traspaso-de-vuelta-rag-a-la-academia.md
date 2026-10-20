# Traspaso de vuelta: RAG en CRM VENTAS → Academia RAG · Búsqueda semántica

Devolución del traspaso `CRM-VENTAS-RAG.md` (§9). Fecha: 20 oct 2026. Rama `juanse-candycrm-ventas` (también en `main`).
Contexto completo y narrado: [`contexto-construccion-sistema-rag-crm-ventas.html`](contexto-construccion-sistema-rag-crm-ventas.html).

Etiquetas: `[medido]` `[calculado]` `[estimado]` `[por verificar]`.

## 1. Pasos hechos y su evidencia

| Paso | Estado | Evidencia |
|---|---|---|
| 1 Modelo y dimensión (Voyage `voyage-3.5`, 1024) | hecho | `08e4358`, entrada [10] en `docs/DECISIONES.md` |
| 2 Migración de dimensión | hecho (aplicada por el usuario) | `supabase/migrations/20260920120000_*` |
| 3 Fragmentos en lenguaje natural | hecho | `430a035`, 11 pruebas |
| 4 Embeddings idempotentes, solo `demo-pruebas` | hecho | `430a035` |
| 5 `match_kb_chunks` sin `tenant_id` | hecho | migración `20260920120000` |
| 6 Aislamiento entre tenants | parcial | `1ba0b22`; falta login real y varios tenants |
| 7 Recuperar con últimos 3–5 mensajes | parcial | probado en el set; falta con `messages` reales |
| 8 Responder solo con lo recuperado y citar | parcial | solo en consola; falta `citas_rag` y pantalla/agente |
| 9 Set de preguntas | hecho (52) | `8404252`, `c4f6715` |
| 10 Métricas | parcial | `8404252`, `6e27045`, `c4f6715`; fidelidad no cumple la meta |
| 11 Registro por consulta | hecho | `7b5caf6`, migración `20260921120000`, 54 filas |
| 12 Reindexar al cambiar un dato | parcial | idempotente por hash; falta disparador |
| 13 Pruebas y README | parcial | README y 11 pruebas; faltan pruebas de ingesta/recuperación sin costo |

Documentación en el `CLAUDE.md` del CRM: `86e0ea5`.

## 2. Cifras

| Cifra | Valor | Etiqueta |
|---|---|---|
| Ingesta: 32 fragmentos, tokens 1.ª corrida / 2.ª | 6.784 / 0 | [medido] |
| recall@1 / @3 / @6 (45 preguntas, k=6) | 97,3 % / 97,3 % / 100 % | [medido] |
| MRR | 0,98 | [medido] |
| Contexto por turno (media / p95) | 963 / 1.063 tokens | [estimado] (chars/4) |
| Latencia de búsqueda p50 / p95 (Node, desde PC del usuario) | 204 / 249 ms | [medido] |
| Similitud top con respuesta: mín/mediana/máx | 0,33 / 0,56 / 0,74 | [medido] |
| Similitud top sin respuesta: mín/mediana/máx | 0,37 / 0,47 / 0,60 | [medido] |
| Respuestas con algún detalle sin respaldo: v1 / v2 c1 / v2 c2 | 64 % / 35 % / 22 % | [medido] |
| Respuestas con un **dato** sin respaldo: v1 / v2 c1 / v2 c2 | 13 % / 11 % / 8 % | [medido] |
| Inventos a preguntas sin respuesta; precios inventados; inyecciones obedecidas | 0/9; 0/3; 0/2 | [medido] |
| Aislamiento (casos A–E) | 5/5 cumplen | [medido] |
| HNSW + RLS con muchos tenants | sin observar | [por verificar] |

## 3. Qué falló o se decidió distinto, y por qué

- **Meta «0 inventos» NO se cumple** (8–11 % con un dato sin respaldo). Los restantes son errores de contar o generalizar entre fichas.
- **El umbral de similitud no decide el «no lo sé»**: los rangos se traslapan (0,60 sin respuesta vs. mín 0,33 con respuesta). Lo decide el modelo leyendo lo recuperado. El parámetro `min_similitud` existe pero no se usa para eso.
- **Una corrida no basta**: el mismo prompt dio 11 % y 8 %. La mejora v1→v2 es real; v2c1 vs v2c2 es ruido.
- **Reglas simples daban 45/45 (espejismo)**; se añadió un juez (Sonnet 5.5) distinto del que responde (Haiku 4.5).
- **Flujo de entrega**: el traspaso suponía PR del dueño; aquí se empujó directo a la rama y luego a `main`, por decisión del usuario.
- `demo-pruebas` no existía: se creó. Su siembra falló 3 veces por reglas de la base sin leer.
- **Se agotaron los créditos de Anthropic** a mitad de la medición (saldo compartido con el Router y el Analista de producción). Lección: revisar saldo antes de correr.
- Voyage sin método de pago: 3 peticiones/min y 10K tokens/min; se agruparon las consultas en una petición.
- No se afinó el prompt contra el mismo set; falta un set reservado.
- Hallazgos de diseño: búsqueda híbrida para preguntas con filtro (R26); `responde=false` mezcla «tema ausente» y «dato faltante» (prompt v3, por probar); 28 de 32 tours sin precio publicado (hueco del dato, no del RAG).

## 4. Tokens y costo por corrida de evaluación

| Corrida | Tokens Voyage | Costo | Etiqueta |
|---|---|---|---|
| Ingesta (1.ª) | 6.784 | ≈ US$0,0004 | [calculado] |
| Recuperación (45 preguntas) | 421 | ≈ US$0,00003 | [calculado] |
| Fidelidad, tramo Haiku (52 preguntas) | — | ≈ US$0,19–0,20 | [calculado] |
| Fidelidad, juez Sonnet 5.5 (52 preguntas) | — | ≈ US$0,40–0,43 | [calculado] |
| Corrida completa con juez | — | ≈ US$0,6 | [calculado] |
| Costo por respuesta en producción (Haiku + embedding) | — | ≈ US$0,004 | [calculado] |
| Total de la medición (4 corridas completas + parciales) | — | ≈ US$2–3 | [estimado] |

Precios por token tomados de una tabla en el código; [por verificar] contra las páginas oficiales. Latencia de respuesta de Claude p50 ≈ 2,5 s, p95 ≈ 3,5 s [medido].

## 5. Pendiente

Set reservado + ≥3 corridas repetidas; prompt v3 y búsqueda híbrida; login real con dos empresas y prueba con varios tenants; decidir consola vs. Edge Function (el `CLAUDE.md` debe decir por qué); pantalla «Pregúntale al catálogo»; reindexación automática; tablero sobre `rag_metricas_diarias`; limpiar `demo-pruebas` al terminar.
