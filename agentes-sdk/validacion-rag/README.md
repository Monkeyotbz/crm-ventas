# Validación del RAG (candidato [10]) — pasos 9 y 10 del traspaso

Mismo patrón que `agentes-sdk/validacion-analista/`: un set de preguntas con la respuesta esperada
y un script que lo mide. **Las preguntas son inventadas; los tours esperados salen del catálogo real**
de Turismo Colombia (32 tours publicados el 20 oct 2026), y se validó que todos existen.

## El set (`preguntas.json`): 45 preguntas

| Tipo | n | Qué prueba |
|---|---|---|
| `explicita` | 8 | Nombra el lugar o el tour |
| `vaga` | 15 | Pide por significado, sin palabras del catálogo («algo tranquilo para mi esposo») |
| `filtro` | 4 | Una condición: dificultad, duración, ciudad, horario |
| `precio_con_dato` | 3 | El tour tiene precio publicado |
| `precio_sin_dato` | 3 | El tour existe pero NO tiene precio (la respuesta correcta es «consulta al operador») |
| `sin_respuesta` | 8 | No existe en el catálogo (Tokio, Torre Eiffel…): lo correcto es «no lo sé» |
| `contexto` | 4 | La pregunta sola es ambigua; se entiende con los mensajes previos |

Cualquiera de los `esperados` cuenta como acierto. **Limitación honesta:** el criterio y las preguntas
los escribió el asistente conociendo el catálogo, lo que tiende a favorecer al sistema. El usuario
puede auditarlos (igual que las bandas del banco del Analista).

## Cómo medir

```
node scripts/rag/evaluar-recuperacion.mjs --etiqueta base
```

Sin llamar a Claude: Voyage + Postgres. Todas las preguntas viajan en **una** petición a Voyage
(sin tarjeta la cuenta limita a 3 peticiones y 10.000 tokens por minuto). Guarda el detalle en
`resultados/`. La **fidelidad** (que Claude no invente al responder con lo recuperado) es otra
medición, todavía sin construir: llama a Claude, así que irá en esta carpeta.

## Primera medición (20 oct 2026, `resultados/…_recuperacion_base.json`) `[medido]`

| Métrica | Resultado | Meta de la guía | |
|---|---|---|---|
| recall@1 | 97,3 % | — | |
| recall@3 | 97,3 % | ≥ 95 % | cumple |
| recall@6 | 100 % | ≥ 95 % | cumple |
| MRR | 0,98 | ≥ 0,8 | cumple |
| Tokens de contexto por turno (top-6) | media 963 · p95 1.063 | < 1.200 | cumple `[estimado]` |
| Latencia de `match_kb_chunks` | p50 204 ms · p95 249 ms | p95 < 300 ms | cumple, **medido desde el PC del usuario, con la red a Supabase** |
| Fidelidad | — | 0 inventos | **por medir** |

**Lo que NO es tan bueno como parece:** el catálogo tiene solo 32 fichas, así que traer 6 ya es el 19 %
del total; el recall@6 de 100 % pesa menos que el recall@1 de 97 %. Con un catálogo de cientos de
fichas habrá que volver a medir. Además, la latencia de arriba no incluye el embedding de la pregunta
en producción (una llamada a Voyage por consulta): **por medir**.

### El único fallo (R26) y qué enseña

«Una excursión de día completo saliendo de Medellín» no llegó al top-3 (puesto 5): trajo cosas de
Medellín (Parque Arví, city tour) en vez de Guatapé y Hacienda Nápoles. **La búsqueda semántica pura
es débil con condiciones** («día completo», «saliendo de»): es el caso para la **búsqueda híbrida** del
traspaso (§6): filtro exacto + orden por similitud. Los 4 tipos `filtro` son los más flojos
(recall@1 75 %).

### El «no lo sé» no se puede decidir con un umbral `[medido]`

| | mín | mediana | máx |
|---|---|---|---|
| Similitud del mejor resultado, preguntas **con** respuesta | 0,33 | 0,56 | 0,74 |
| Similitud del mejor resultado, preguntas **sin** respuesta | 0,37 | 0,47 | **0,60** |

Los rangos se **traslapan**: una pregunta sin respuesta llegó a 0,60, más que la mitad de las preguntas
válidas. El «mejor umbral» posible fue 0,30, que equivale a **aceptar todo** (exactitud 82 % = el
porcentaje de preguntas que sí tienen respuesta): ningún corte lo mejora. Con solo 8 preguntas sin
respuesta es una muestra chica, pero la dirección es clara.

**Consecuencia para el paso 8:** decidir si lo recuperado responde la pregunta tiene que hacerlo
**quien lo lee** (Claude, con una instrucción explícita de decir «no lo sé»), o un reranker. Un
`min_similitud` solo no alcanza. Esa es la medición de fidelidad que falta.
