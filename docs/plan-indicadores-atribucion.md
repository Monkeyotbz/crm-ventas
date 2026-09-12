> **Procedencia:** copia de un plan de sesión de Claude Code (12 sep 2026), guardada acá a pedido
> del usuario para que no viva solo en `~/.claude/plans/`. Es un documento de trabajo: refleja las
> decisiones tomadas en esa sesión, no una especificación viva. Si contradice al código, manda el
> código.

# Indicadores de "Origen y atribución del lead" — recortado a lo productivo

## Contexto

Del Grupo 1 de `docs/indicadores-dashboard.md` (15 indicadores) solo 1 estaba construido. El pedido
original era cerrar todos los que se puedan, aunque hoy muestren cero. Al mirar cuáles de verdad
dicen algo con los datos que existen HOY, y cuáles solo lo dirían el día que pase otra cosa que ni
está planeada, el usuario pidió recortar el alcance a los productivos y anotar el resto para "su
momento" — no descartarlos, guardarlos con su nivel de prioridad.

## Se construye AHORA — solo estos 2

| # | Indicador | ¿Qué mide, en simple? | Cómo se calcula |
|---|---|---|---|
| 15 | Origen cruzado con pipeline | Cruza "por dónde llegó" con "qué tipo de venta terminó siendo" (rápida y barata, o grande y consultiva). El canal que trae MÁS gente no es siempre el que trae MÁS dinero. **Cobertura 100% desde el día uno** — usa `deals.fuente`, que existe en cada oportunidad, no depende de que alguien haya capturado un touchpoint. | `deals.fuente` × `pipeline.tipo` |
| 2 | Fuente real (pagado/campaña/referido/directo) | Si tus leads llegan porque pagaste un anuncio, porque alguien los mandó, o porque escribieron por su cuenta. **El número en sí es la noticia**: si sale "95% directo, sin rastro", eso ya dice que la atribución no está capturando casi nada — información accionable. | `ad_id`/`ctwa_clid` → pagado; `utm_source` sin anuncio → campaña; `referrer` solo → referido; sin touchpoint → directo/sin rastro |

Sin migración — se verificó que `contact_touchpoints` ya tiene policy de lectura para el frontend
(tenant + admin o dueño del contacto). Mismo patrón que `panel.js`: agregación en JS.

### `src/lib/panel.js` (editar)

Nueva consulta en el `Promise.all`: `contact_touchpoints` — `contact_id, ad_id, ctwa_clid,
utm_source, referrer`. Nuevo bloque `atribucion`:
```js
atribucion: {
  cobertura: { conTouchpoint, totalContactos },  // "X de Y contactos con origen registrado"
  clasificacion: [...],       // #2 — pagado / campaña / referido / directo
  origenPorPipeline: [...],   // #15 — fuente × tipo de embudo, cobertura total
}
```
`origenPorPipeline` no necesita `contact_touchpoints` en absoluto — sale de `deals` solo, que ya se
trae en la consulta existente. La sección de cobertura ("X de Y con origen registrado") se muestra
únicamente para `clasificacion` (#2), no para `origenPorPipeline`, que no la necesita.

### `src/pages/Panel.jsx` (editar)

Sección nueva "Origen y atribución del lead", reutilizando `Tile`/`BarraSimple`/`Vacio` tal cual
—sin componentes nuevos—, con el renglón de cobertura arriba solo en el bloque que lo necesita.

## Verificación

1. `npm run build`.
2. Insertar 3-4 `contact_touchpoints` de prueba variados (uno con `ad_id`, uno con `utm_source`,
   uno con `referrer` solo) sobre contactos de Turismo Colombia. Contrastar cada número contra su
   equivalente en SQL, mismo método que en tandas anteriores.
3. Confirmar por API REST (JWT real) que la RLS ya existente de `contact_touchpoints` deja ver las
   filas al frontend.
4. Borrar los touchpoints de prueba al terminar.
5. Verificar en el dev server local con datos parciales (Turismo) y completamente vacíos
   (Hellominus, sin ningún touchpoint).

---

## Candidatos anotados, NO se construyen ahora — con su nivel de prioridad

Criterio propio, pedido explícito el 11 sep: "cuáles piensas que serían productivos... y cuáles no
harían nada, solo dímelo". Quedan documentados para retomar en su momento, en este orden.

### Nivel 2 — infraestructura lista; van a decir algo cuando haya más volumen o campañas reales

No se construyen ahora porque hoy dirían muy poco, no porque falte algo técnico.

| # | Indicador | ¿Qué mide, en simple? | Por qué espera |
|---|---|---|---|
| 3 | Campaña específica | De todos los anuncios que corrés, cuál trajo cada lead. Compara anuncios entre sí. | Solo dice algo el día que haya una campaña de Meta corriendo de verdad (bloqueado por la verificación de empresa de Hellominus). |
| 4 | Referrer | De qué página exacta vino la persona antes de escribir. | Mismo motivo — pocos touchpoints con referrer hoy. |
| — | LTV por contacto (Financieras) | Cuánto deja un cliente en promedio a lo largo de TODA su relación, no solo la primera compra. | Con 1-4 deals reales en todo el sistema, el número existe pero no dice nada todavía — necesita volumen. |

### Nivel 3 — doble dependencia (touchpoint + volumen de ventas cerradas), bajo retorno por ahora

| # | Indicador | ¿Qué mide, en simple? | Por qué espera |
|---|---|---|---|
| 9 | Canal que descubre vs. cierra | Compara por dónde te conocieron vs. por dónde cerraron la compra. Evita cortarle presupuesto a un canal que "siembra" ventas que cierran en otro lado. | Necesita touchpoint Y deal ganado en el mismo contacto — hoy casi no coinciden. |
| 10 | Tiempo del primer toque al contacto | Cuánto pasa entre que te ven por primera vez y te escriben. | Misma dependencia de touchpoints. |
| 12 | Contenido que precede una venta | Qué página vio la gente que SÍ compró. | Necesita varias ventas con touchpoint para ver un patrón — 1 venta no es un patrón. |
| 8 | Toques promedio antes de contactar (versión ligera) | Cuánto "calentamiento" necesita un lead típico. | Reflejaría solo el puñado de leads con touchpoint, no el embudo real. |

### Nivel 4 — mostrarían "sin dato" para siempre, hasta que se construya OTRA cosa que ni está planeada

Estos no son indicadores flojos — `#13` en particular es de los más valiosos del documento
original. El problema es de secuencia: nada en el roadmap actual los va a empezar a llenar.

| # | Indicador | ¿Qué mide, en simple? | Qué haría falta construir antes (no planeado) |
|---|---|---|---|
| 7 | Visitas antes de contactar | Cuántas veces alguien vio el sitio antes de escribir. La gente casi nunca compra a la primera. | Que el widget mande "alguien visitó", con sesión anónima — cero código hoy. |
| 13 | "Cómo nos conociste" (declarado) | Lo que el cliente responde cuando le preguntás cómo llegó — captura referidos y voz a voz que ningún dato técnico ve. | Que el Agente SDR exista y lo pregunte durante la calificación. |
| 14 | Dispositivo y ubicación | Si escriben desde celular o computador, y desde qué ciudad. | Que el widget detecte dispositivo/ubicación — cero código hoy, y ciudad además tiene matiz de privacidad (geolocalización). |

### Ya excluidos antes (sin cambios) — necesitan una decisión de producto, no más código de indicador

| Qué | Por qué |
|---|---|
| #6 — Search Console | Cero representación en el esquema; integración OAuth nueva. |
| #11 — Toques por tipo de producto, Rendimiento por producto, Funnel por producto, Margen | `deals` no tiene NINGUNA columna que lo relacione con `products` — no hay con qué hacer el join. Ligar un deal a un producto es una decisión de producto (¿la elige el vendedor? ¿la infiere el Router?), ligada al futuro Agente SDR y su tool `buscar_producto`. |
| Costo de mensajería | `messages.costo_estimado`/`whatsapp_pricing` existen, pero calcularlo bien exige supuestos de facturación que no puedo verificar. |

---

## Fuera de este plan — próximos temas ya acordados con el usuario (11 sep)

No forman parte de esta tanda. Anotados para que no se pierdan al retomar:

1. **Reorganizar visualmente el Panel de hoy.** El usuario lo ve "un poco desordenado" — con cierre,
   autonomía IA, tiempo por etapa, embudo, motivos de pérdida, pipeline, canales y ahora atribución,
   la pantalla acumuló secciones sin una jerarquía clara entre ellas. Antes de agregar el bloque de
   atribución de este plan (o inmediatamente después), conviene repensar el orden/agrupación para
   que se lea como un panel de indicadores propiamente dicho, no como una lista de bloques en el
   orden en que se fueron construyendo.
2. **Empezar a trabajar en la pasarela de pago.** Próximo tema grande después de lo anterior — sin
   explorar todavía en esta conversación, arranca de cero.

## Orden acordado para la próxima sesión

1. Ejecutar este plan (los 2 indicadores productivos: #15 y #2).
2. Reorganizar visualmente el Panel de hoy.
3. Arrancar la pasarela de pago.
