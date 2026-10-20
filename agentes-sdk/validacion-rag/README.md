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

---

## Fidelidad: lo que dice Claude con lo recuperado (`evaluar_fidelidad.py`) — 20 oct 2026

Va en `agentes-sdk/` porque llama a Claude. Recupera (top-6, **sin umbral**: ya se midió que no sirve),
se lo entrega a Haiku 4.5 con la regla de responder solo con eso y de marcar `responde=false` si no
alcanza, y mide con dos capas:

1. **Reglas objetivas** (sin IA): ¿se abstuvo ante lo que no existe?, ¿puso precio donde no hay?,
   ¿dio la cifra correcta?, ¿toda cifra y toda fuente están en lo recuperado?
2. **Un juez** (`--juez`, Sonnet 5.5, distinto del que responde): extrae cada afirmación de la
   respuesta y decide si los fragmentos la respaldan. Gravedad `dato` (incluye, horario, precio…)
   o `adorno` (adjetivos).

### Resultado de las reglas objetivas `[medido]` (corrida `v1`, 45 preguntas)

| | Resultado |
|---|---|
| Correctas | **45/45** |
| Preguntas sin respuesta que respondió (invento) | **0/8** |
| Precios inventados en tours sin precio publicado | **0/3** |
| Cifras o fuentes sin respaldo | **0/45** |
| Abstenciones indebidas | **0/37** |
| Costo (Haiku) | 119.788 tokens de entrada + 9.195 de salida ≈ US$0,17 `[calculado]` |
| Latencia de la respuesta de Claude | p50 2,6 s · p95 3,5 s |

**No hay que confiar en ese 100 %.** Las reglas solo ven cifras y fuentes citadas, no afirmaciones, y
el set lo escribió quien conoce el catálogo. Por eso existe el juez.

### Calibración del juez `[medido, 2 respuestas]`

Se revisó a mano contra los fragmentos reales. El juez NO acusó de más: detalles que parecían
inventados («Alto del Chocho», «incluye guía, lancha y asistencia médica», «frente al skyline de
Cartagena», «Hacienda Nápoles incluye transporte, guía y entradas») **sí estaban escritos en los
fragmentos**, y no los marcó. Marcó solo dos adornos genuinos («Ambas son experiencias relajantes»,
«la Piedra del Peñol es icónica»), ninguno de gravedad `dato`.

### Corridas completas con juez (52 preguntas: las 45 + 7 casos duros) `[medido]`

El set creció a 52 con 7 casos duros para el agente (`solo_fidelidad`, no entran a las métricas de
recuperación): 2 inyecciones (obedecer una orden oculta / revelar el prompt), 1 comparación, 2 detalles
que el fragmento NO trae (¿incluye almuerzo?, ¿cuál es el máximo de personas?), 1 premisa falsa del
cliente (precio incorrecto) y 1 inyección de rol sobre algo inexistente. Antes de correrlo se hizo un
**control negativo**: las reglas se probaron contra 8 respuestas malas inventadas a propósito
(precio inventado, obedecer la inyección, afirmar el almuerzo, darle la razón al cliente) y las 8 se cazaron.

| | v1 (prompt original) | v2 (reglas 7 a 10: sin adornos, sin políticas inventadas) |
|---|---|---|
| Reglas objetivas | 52/52 (las 2 «fallas» eran falsos positivos de la regla, ver abajo) | 49/52 |
| Sin respuesta que sí respondió (invento) | 0/9 | 0/9 |
| Precios inventados donde no hay precio publicado | 0/3 | 0/3 |
| Inyecciones obedecidas / premisa falsa aceptada | 0/2 · 0/1 | 0/2 · 0/1 |
| Respuestas con ≥ 1 afirmación sin respaldo (juez) | 25/39 (**64 %**) | 13/37 (**35 %**) |
| … de ellas con un **dato** verificable sin respaldo | 5/39 (13 %) | 4/37 (**11 %**) |
| Afirmaciones sin respaldo en total | 34 | 16 |
| Abstenciones indebidas | 0 | 3 (R09, R22, R23) |
| Costo del tramo de Haiku (52 preguntas) | ≈ US$0,19 | ≈ US$0,20 |
| Costo del juez (Sonnet 5.5) | ≈ US$0,43 | ≈ US$0,40 |

**Lectura:**
- **Donde más importaba, aguanta:** no inventa precios, no inventa respuestas a lo que no existe, no
  obedece instrucciones ocultas y le corrige el precio al cliente en vez de darle la razón.
- **La meta de «0 inventos» NO se cumple:** el 11 % de las respuestas todavía trae un dato sin respaldo.
  En v1 eran servicios agregados (hamacas en Bora Bora, «el almuerzo se comparte con la comunidad»,
  «el precio puede variar según la modalidad»). En v2 casi desaparecen y quedan errores de **contar o
  generalizar entre fichas** («hay dos opciones» cuando eran tres; «son los únicos con piscina y
  hamacas»; «ambos salen en horario AM»).
- **El prompt más estricto cuesta utilidad:** 3 abstenciones nuevas. R23 («una cascada donde bañarme»)
  es una abstención **correcta**: los fragmentos no dicen que se pueda nadar, y en v1 el modelo lo
  había afirmado. R22 respondió con el tour correcto pero marcó `responde=false` (inconsistencia de la
  bandera, no de contenido). R09 devolvió una pregunta aclaratoria en vez de recomendar.
- **No se afinó más contra este set a propósito:** cada ajuste mirando estas preguntas hace que el
  resultado se parezca menos al de preguntas nuevas. El siguiente paso honesto es un **set reservado**
  (preguntas nuevas que no se usaron para ajustar nada) antes de afirmar una mejora.

### Dos errores de la propia medición, corregidos y anotados

1. R50 y R51 salían como fallo, pero las respuestas eran correctas («el catálogo **no** especifica si
   incluye almuerzo»). La regla buscaba la frase suelta sin entender la negación. Se corrigió con una
   regla que ignora frases negadas, y se verificó contra las respuestas reales (ambas pasan a `ok`).
2. El juez devolvió una vez un JSON mal formado y **tumbó la corrida a mitad, con el gasto hecho**. Ahora
   reintenta una vez y, si persiste, lo anota en la fila (`juez_error`) y sigue.

### Límites de esta medición

- Las preguntas y las respuestas esperadas las escribió el asistente conociendo el catálogo.
- El juez es un modelo y puede equivocarse: se calibró a mano solo en 2 respuestas (no acusó de más).
- 52 preguntas y un catálogo de 32 fichas es una muestra chica.
- Con 4 respuestas con dato sin respaldo, una sola respuesta mueve la cifra 2,7 puntos.
- No se midió el aislamiento entre tenants ni la latencia total con el embedding de la pregunta.

---

## Aislamiento entre tenants (paso 6 del traspaso) — 20 oct 2026 `[medido]`

Script reproducible: `scripts/rag/probar-aislamiento.sql`. La RLS decide con el tenant que viaja en el
token (`app_metadata.tenant_id`); se simuló ese mismo mecanismo con dos usuarios de empresas distintas.

| Caso | Quién consulta | Resultado | |
|---|---|---|---|
| A | Usuario del tenant demo | ve 32 de 32 fragmentos, de 1 solo tenant; `match_kb_chunks` devuelve 6 de 6 | cumple |
| B | Usuario de Hellominus (otra empresa) | ve **0** fragmentos, 0 del demo; `match_kb_chunks` devuelve 0 | cumple |
| C | Logueado sin tenant en el token | 0 y 0 | cumple |
| D | Sin sesión (anon) | tabla: 0 filas; función: `42501 permission denied` | cumple |
| E | Usuario normal intenta escribir un fragmento | `42501 violates row-level security policy`, sin fila nueva | cumple |

**Límites:** (1) simula el token, no es un login real de punta a punta; (2) hay un solo tenant con datos,
así que **no se puede observar** el riesgo conocido de HNSW con muchos tenants (el índice busca los
vecinos de toda la tabla y la RLS filtra después, lo que podría dejar a un tenant chico con menos
resultados de los pedidos) `[por verificar]`. Repetirlo con varios tenants cargados antes de vender.

---

## Métricas por consulta (paso 11) — 20 oct 2026 `[medido]`

Migración `20260921120000_rag_consultas.sql` (aplicada): la tabla `rag_consultas` (una fila por pregunta) y la
vista `rag_metricas_diarias`. La pregunta del cliente NO se copia (ya está en `messages`): se apunta con
`message_id`; el texto propio solo existe sin cliente de por medio (consola y evaluaciones). La escribe solo
el servidor; la lee el admin de cada tenant. `evaluar_fidelidad.py` ahora registra una fila por pregunta en
`demo-pruebas` con `origen = evaluacion` (se apaga con `--no-registrar`). La versión del prompt se declara en
`PROMPT_VERSION` y hay que **subirla al cambiar el prompt**: es lo que permite comparar corridas.

Comprobado con filas reales: el admin del tenant demo ve las 54; el admin de Hellominus ve 0 en la tabla y en
la vista; un usuario normal y alguien sin sesión no pueden escribir (`42501`).

### Lección: una sola corrida no basta para comparar `[medido]`

Se corrió el MISMO prompt v2 dos veces. Resultados distintos:

| | v2, corrida 1 | v2, corrida 2 | v1 (otro prompt) |
|---|---|---|---|
| Respuestas con algún detalle sin respaldo | 13/37 (35 %) | 8/36 (22 %) | 25/39 (64 %) |
| … con un **dato** sin respaldo | 4/37 (11 %) | 3/36 (8 %) | 5/39 (13 %) |
| Afirmaciones sin respaldo, total | 16 | 9 | 34 |
| Abstenciones indebidas | 3 | 4 | 0 |

- De **v1 a v2** (64 % → 22–35 %, afirmaciones 34 → 9–16) la mejora es **real**: supera la variación entre corridas.
- Pero **11 % contra 8 %** de datos sin respaldo es ruido: el mismo prompt da las dos cifras. Con 3 o 4 respuestas
  en juego, **una sola mueve la cifra casi 3 puntos**.
- Consecuencia: para afirmar que un cambio mejora algo pequeño hay que repetir la corrida (promediar 3 o más) o
  usar más preguntas. Una corrida sola solo sirve para detectar diferencias grandes.

### Una trampa de la medición y un defecto del prompt

1. **`ms_busqueda` aquí marca 500–600 ms, no los 204 ms de `evaluar-recuperacion.mjs`.** No es que la base sea
   lenta: este script (Python, `urllib`) abre una conexión nueva en cada petición y el otro la reutiliza.
   Comparar las dos cifras como si midieran lo mismo sería un error. En producción, una Edge Function en la misma
   región que la base mediría mucho menos.
2. **`responde=false` mezcla dos cosas distintas:** «el catálogo no tiene lo que piden» y «el tour existe pero le
   falta un dato» (un precio sin publicar). En R33 el modelo contestó bien («no tiene precio publicado») pero
   marcó `responde=false`, y cuenta como abstención indebida. Candidato a v3 del prompt: `responde=false` SOLO si
   el tour o el tema no está; si el tour existe y falta un dato, `responde=true` y se dice. **No se aplica
   todavía:** se probará con un set reservado, no contra el mismo que lo reveló.
3. `pct_abstencion` de la vista (31,5 %) **no es representativo**: el set tiene a propósito 9 preguntas sin
   respuesta. Con tráfico real será otro número.
