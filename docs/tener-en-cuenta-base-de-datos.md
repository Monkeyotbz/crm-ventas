# Tener en cuenta para construir la base de datos

> **Fuente de este documento:** convertido desde [`tener-en-cuenta-base-de-datos.html`](tener-en-cuenta-base-de-datos.html)
> (versión visual original, se conserva como snapshot de referencia — no se edita más, este `.md` es la
> copia de trabajo). Documento del 23 ago 2026, marcado como *"vivo — sin ejecutar, solo referencia"*;
> **actualizado el 24 ago 2026** con el Grupo 18 (ítems 43–48), agregado en una revisión final que cruzó
> los dos documentos de indicadores contra el modelo de datos.
>
> **Relación con los otros documentos de `docs/`:** es un anexo enfocado en un solo ángulo — qué le falta
> al modelo de datos a raíz de las **reglas de mensajería de WhatsApp/Meta** y de un par de indicadores
> internos. Complementa a [`guia-fases-1-2.md`](guia-fases-1-2.md) y [`hoja-de-ruta-construccion.md`](hoja-de-ruta-construccion.md) — misma regla: es referencia para orientarnos, no una lista de columnas a
> crear literalmente tal cual está escrita.
>
> ✅ **Multi-tenant, confirmado (24 ago 2026):** las tablas de acá que asumen `tenants`/`tenant_id`
> (`whatsapp_numbers.tenant_id`, `products.sku` único por tenant, etc.) ya coinciden con la dirección
> real — [`supabase/setup.sql`](../supabase/setup.sql) tiene `tenants` y `tenant_id` en cada tabla de
> negocio desde esa fecha. Lo que **no** está sincronizado todavía son las ~40 tablas/columnas
> específicas listadas más abajo (`message_templates`, `whatsapp_numbers`, `payment_links`,
> `agent_executions`, etc.) — siguen siendo referencia para más adelante, no algo ya implementado.

**48 elementos, en 18 grupos**, cada uno originado en una regla concreta de Meta (o en un indicador que ya se había definido en otro documento). Prioridad: 🔴 **Alta** = bloquea operación hoy · 🟢 **Media** = antes de octubre 2026 · ⚪ **Baja** = se agrega sin dolor después.

---

## Grupo 1 — Por la ventana de 24 horas

**1. 🔴 `conversations.ventana_abierta_hasta`** — `timestamptz`, se actualiza con cada mensaje entrante del cliente. Le dice al agente y al vendedor si pueden responder libre o necesitan plantilla aprobada. Sin esto, cualquiera puede intentar un envío que Meta rechaza, sin saber por qué falló.

**2. 🔴 `conversations.ventana_horas`** — `integer`, default 24. No siempre son 24: un lead de Click-to-WhatsApp Ads tiene 72. Si el sistema asume 24 fijo, cierra la ventana antes de tiempo.

## Grupo 2 — Por las plantillas (templates)

**3. 🔴 `message_templates`** *(tabla nueva)* — nombre, categoría, idioma, estado (pendiente/aprobada/rechazada), cuerpo, variables, ID que le asigna Meta. Es la fuente de verdad de lo que el bot puede enviar fuera de la ventana. Sin ella, el sistema no puede iniciar ninguna conversación por su cuenta.

**4. 🔴 `messages.template_id`** — FK hacia `message_templates`, nula si el mensaje no usó plantilla. Deja registro de qué plantilla se usó, sirve para depurar y calcular costo por plantilla.

**5. 🔴 Validación "solo plantilla para iniciar"** — no es columna, es un constraint/función antes de insertar un mensaje saliente sin ventana abierta y sin `template_id`. Evita que el agente intente iniciar con texto libre. Puesto como regla de base de datos, no como algo que el código "debería recordar".

## Grupo 3 — Por las categorías de mensaje

**6. 🟢 `categoria_mensaje_t` + `messages.categoria`** — enum (marketing / utility / authentication / service). Cada categoría tiene tarifa distinta; sin este campo, ningún reporte de costos puede separar gasto por tipo.

## Grupo 4 — Por los tiers de volumen y el Quality Rating

**7. 🟢 `whatsapp_numbers`** *(tabla nueva)* — un registro por número real: `tenant_id`, `phone_number_id`, `waba_id`, `tier_actual`, `quality_rating`, `throughput_limite`. Con varios tenants hay varios números, cada uno con su propio estado.

**8. ⚪ `quality_rating_history`** *(tabla nueva)* — un registro por cada cambio de calificación, con fecha. Permite al Agente Analista correlacionar una caída de calidad con qué se envió esa semana.

## Grupo 5 — Por el límite compartido de portafolio

**9. ⚪ `whatsapp_numbers.business_portfolio_id`** — agrupa qué números comparten el mismo límite de mensajería en Meta. En multi-tenant, uno puede consumirle capacidad de envío al otro sin notarse hasta que fallan los mensajes.

## Grupo 6 — Por la verificación de negocio y "un número, una WABA"

**10. ⚪ `tenants.meta_business_verificado` / `verified_at`** — booleano + fecha. Muestra tenant por tenant cuál ya está verificado sin ir a revisar Business Manager a mano.

**11. 🟢 `whatsapp_numbers.waba_id` (único)** — constraint de unicidad. Impide (o detecta al instante) que un número quede mal vinculado a dos cuentas WABA.

## Grupo 7 — Por el consentimiento (opt-in)

**12. 🔴 `contacts.opt_in_at` / `opt_in_source` / `opt_out_at`** — cuándo dio consentimiento, de dónde vino, cuándo (si aplica) lo retiró. Es la regla que más rápido tumba el Quality Rating si no se respeta. El Router y los agentes deben poder verificar consentimiento vigente antes de escribirle a alguien.

## Grupo 8 — Por los costos y el cambio de octubre 2026

**13. 🟢 `messages.costo_estimado` / `moneda_costo` / `entregado`** — numeric, texto, booleano. `entregado` importa porque Meta cobra al entregar, no al enviar. Desde el 1 de octubre de 2026 cada respuesta de un agente tiene costo — sin estos campos no se puede atribuir la factura de Meta a ninguna conversación/campaña/producto.

**14. 🟢 `whatsapp_pricing`** *(tabla nueva)* — `pais`, `categoria`, `tarifa`, `vigente_desde`. Permite calcular el costo en el momento del envío, no adivinarlo después. Meta actualiza tarifas hasta 4 veces al año — tenerlo en tabla (no en código) permite ajustarlo sin redeployar, mismo principio que `routing_rules`.

## Grupo 9 — Por la distinción entre producto de catálogo y a medida

*(Origen: Hello Minus / Hello My — dos tipos de producto)*

**15. 🔴 `products.tipo_venta`** — enum `catalogo` | `a_medida`. Le dice al Router y al Bot de Catálogo si un producto se vende solo o necesita humano.

**16. 🔴 `products.pipeline_default_id`** — referencia al pipeline que le corresponde por defecto a cada producto. El Router no necesita razonar: la decisión vive en el dato.

**17. 🔴 `products.requiere_cotizacion`** — booleano, verdadero para todo producto a medida. Evita que el bot intente enviar un link de pago de algo sin precio fijo.

**18. 🟢 `products.precio_desde` / `precio_hasta`** — rango orientativo interno, solo para productos a medida. Permite al Agente SDR estimar el monto del deal sin comprometer un precio con el cliente.

**22. 🔴 `products.entregable_tipo` + `entregable_config`** — un tipo (archivo, licencia, acceso a plataforma) y un `jsonb` de configuración por producto. Sin esto, la entrega automática del Pipeline A tendría que estar hardcodeada producto por producto.

## Grupo 10 — Por el registro de ventas y pagos en Pipeline A

*(Origen: gadgets que el bot cobra y entrega solo)*

**19. 🟢 `deal_items`** *(tabla nueva)* — tabla intermedia entre `deals` y `products`: qué productos y en qué cantidad componen cada deal. Hoy `deals` solo tiene un `monto` suelto.

**20. 🔴 `payment_links`** *(tabla nueva)* — cada link de pago generado: monto, estado, fecha de expiración, ID en la pasarela. Permite que el Agente de Recuperación sepa a quién recordarle y detecte abandono a las 24 horas.

**21. 🔴 `payments`** *(tabla nueva)* — el pago confirmado que llega por webhook de la pasarela. Dispara el movimiento a "Pagado" en Pipeline A y alimenta el ingreso real para el ROI por campaña.

## Grupo 11 — Por las cotizaciones en Pipeline B

**23. 🟢 `quotes`** *(tabla nueva)* — cada versión de propuesta enviada, con su alcance y monto — versionada. La etapa de Negociación implica ajustes; sin versionado se pierde el rastro de qué se ofreció originalmente.

## Grupo 12 — Por el catálogo multi-tenant y su disponibilidad

**24. 🔴 `products.sku` único por `tenant_id`** — el constraint de unicidad debe combinarse con `tenant_id`, no ser global. Dos tenants pueden querer el mismo SKU "BASICO" en catálogos independientes.

**25. ⚪ `products.disponible_desde` / `disponible_hasta`** — dos columnas de fecha junto al `activo` que ya existe. Productos de temporada sin tener que desactivarlos a mano.

## Grupo 13 — Por origen y atribución multi-touch

*(Origen: indicadores-dashboard.html · Grupo 1 — documento no presente en este repo)*

**26. 🔴 `contact_touchpoints`** *(tabla nueva)* — un registro por cada interacción del contacto antes de escribir: fecha, canal, campaña. Habilita la ruta multi-touch — hoy solo se guarda un `source` que colapsa la historia y le da todo el crédito al último toque.

**27. 🔴 `contact_touchpoints.referrer` / `landing_page`** — URL de origen exacta y página de entrada, por cada toque. Sin esto, un lead de un foro y uno de un comparador se ven idénticos como "orgánico".

**28. 🔴 `contact_touchpoints.dispositivo` / `ciudad`** — móvil o escritorio, ubicación aproximada. El dispositivo cambia el comportamiento de compra; la ciudad revela concentraciones geográficas.

**29. 🔴 `contacts.como_nos_conocio`** — enum controlado, respuesta declarada durante la calificación. Única forma de capturar referidos, voz a voz y eventos — canales sin rastro digital que suelen traer los mejores clientes. Lo pregunta el Agente SDR.

**30. 🔴 `contacts.visitas_antes_contacto`** — contador entero, materializado a partir de `contact_touchpoints`. Revela el ciclo real de decisión, casi siempre más largo de lo asumido.

## Grupo 14 — Por rendimiento de agentes

*(Origen: indicadores-internos-plataforma.html · Grupo 1 — documento no presente en este repo)*

**31. 🔴 `agent_executions`** *(tabla nueva)* — una fila por cada ejecución de agente: qué agente, qué conversación, tokens consumidos, latencia, resultado. Base de la mitad de los indicadores internos (% resuelto por IA, turnos hasta resolver, tiempo de primera respuesta, costo por conversación). Hoy no existe nada equivalente.

**32. 🔴 `agent_executions.escalado` + `motivo_escalamiento`** — booleano y enum (monto alto, cliente molesto, fuera de alcance, no supo responder). Distingue escalamiento sano de escalamiento por falla — solo el segundo es un problema a corregir.

**33. 🟢 `agent_executions.tokens_entrada` / `tokens_salida` / `costo_tokens`** — consumo y costo estimado por ejecución. Detecta agentes con prompts inflados. Se recomendó fusionarlo con el costo total por conversación en vez de panel independiente.

**34. 🔴 `router_decisions`** *(tabla nueva)* — qué decidió el Router, con qué confianza, por qué regla, si fue corregido después. Única forma de medir la precisión del Router — la pieza más upstream del sistema.

**35. 🟢 `messages.corregido_por_humano` + `motivo_correccion`** — booleano y texto, marcados desde la bandeja cuando un vendedor corrige al agente. Mide la tasa de alucinación. Requiere además un botón en el frontend, no es solo una columna.

## Grupo 15 — Por la plataforma como producto (SaaS)

*(Origen: indicadores-internos-plataforma.html · Grupo 2)*

**36. 🟢 `subscriptions`** *(tabla nueva)* — plan, precio, estado, fecha de renovación por tenant. Alimenta MRR y detección de expansión de cuenta. Hoy `tenants` solo tiene nombre y slug.

**37. ⚪ `tenants.onboarding_completado_at` + `primer_deal_cerrado_at`** — dos timestamps. Alimenta time-to-value. Con pocos tenants conocidos hoy se sabe por conversación directa — cobra sentido cuando el onboarding deje de acompañarse personalmente.

**38. ⚪ `feature_usage`** *(tabla nueva)* — qué funcionalidad usó qué tenant y cuándo. Con pocos tenants y producto nuevo van a usar casi todo — cobra sentido cuando haya funciones viejas compitiendo con nuevas.

**39. 🟢 `tenants.ultimo_login_at` + `deals_movidos_ultimos_30d`** — timestamp de último acceso y contador de actividad reciente. Señales tempranas de churn — dan margen de reacción de semanas.

## Grupo 16 — Por salud técnica

*(Origen: indicadores-internos-plataforma.html · Grupo 4)*

**40. 🔴 `webhook_errors`** *(tabla nueva)* — errores de entrega o procesamiento de webhooks, con su causa. Un mensaje perdido es un lead perdido que nadie reclama — el fallo más silencioso y más caro del sistema.

**41. 🔴 `whatsapp_numbers.tier_actual` + `quality_rating` + histórico** — ya listado en 7 y 8, confirmado tras revisar indicadores internos. Si la calidad cae, Meta puede suspender el número y el tenant se queda sin canal.

## Grupo 17 — Por separación de roles cliente / interno

*(Origen: indicadores-internos-plataforma.html · confidencialidad)*

**42. ✅ Rol `admin_plataforma`** — **ya implementado (24 ago 2026)**, con una variante respecto de lo que proponía este punto: en vez de un claim en `app_metadata`, es la tabla `platform_admins` + la función `is_platform_admin()`. El motivo del cambio: un claim en el JWT sigue vigente hasta que el token expira, y revocar el rol más privilegiado del sistema tiene que cortar el acceso en la consulta siguiente. Además resuelve el soporte multi-tenant (un admin de plataforma se para sobre otro tenant con el header `X-Acting-Tenant`). Ver [`supabase/README.md`](../supabase/README.md).

## Grupo 18 — Huecos detectados al cruzar indicadores contra el modelo

*(Origen: revisión final de ambos archivos de indicadores)*

**43. 🔴 `conversations.resuelta_por` + `resuelta_at`** — quién cerró la conversación (agente IA o humano) y cuándo. El indicador imprescindible "% resuelto por IA sin intervención humana" no se puede calcular sin esto. `agent_executions` registra ejecuciones sueltas, pero nadie marca si la **conversación completa** terminó resuelta y por quién — es la métrica que justifica todo el proyecto.

**44. 🔴 `pipeline_transfers.detectado_por` + `detectado_tarde`** — si el salto A→B lo detectó el Router automáticamente o un humano al revisar, y si se descubrió tarde. Hoy solo se guarda que el salto ocurrió. Sin distinguir detección automática de hallazgo tardío, solo se pueden contar los aciertos y nunca las fallas — que son justamente el dinero perdido: un deal de miles atendido como uno de quince.

**45. 🟢 `conversations.primera_respuesta_at`** — timestamp materializado del primer mensaje saliente de cada conversación. Es derivable de `messages`, pero recalcularlo en cada carga del dashboard sobre millones de filas es caro. Materializarlo cuesta una columna y ahorra el cálculo repetido.

**46. 🔴 `metrics_snapshots`** *(tabla nueva)* — agregado diario por tenant: conversaciones, resueltas, costo, deals cerrados. Ningún dashboard sirve sin series de tiempo — "¿el % resuelto por IA está subiendo o bajando?" no se responde con el dato de hoy. Es la diferencia entre un panel que carga en un segundo y uno que se vuelve inusable a los seis meses.

**47. ⚪ `search_console_data`** *(tabla nueva)* — importación de datos de Google Search Console: consultas, página de destino, impresiones, clics. Alimenta el indicador de búsquedas que traen tráfico. Es dato externo de Google, no una carencia del modelo propio — se puede dejar para después sin bloquear nada.

**48. 🟢 `products.costo`** — costo unitario o de producción de cada producto, junto al precio de venta que ya existe. Sin costo registrado, el dashboard muestra ingreso pero nunca margen real por producto — y el indicador interno de margen por tenant queda incompleto por la misma razón.

---

## Resumen por prioridad

| Prioridad | Elementos | Por qué |
|---|---|---|
| 🔴 **Alta** | 1, 2, 3, 4, 5, 12, 15, 16, 17, 20, 21, 22, 24, 26, 27, 28, 29, 30, 31, 32, 34, 40, 41, 42, 43, 44, 46 | Bloquean la operación hoy, protegen la cuenta de una suspensión, o son la barrera real de separación cliente/interno. |
| 🟢 **Media** | 6, 7, 11, 13, 14, 18, 19, 23, 33, 35, 36, 39, 45, 48 | Necesarios antes del cambio de cobro del 1 de octubre de 2026, o alimentan indicadores clasificados como importantes. |
| ⚪ **Baja** | 8, 9, 10, 25, 37, 38, 47 | Se agregan sin dolor después — alimentan indicadores que hoy se resuelven hablando directamente con Hellominus (el único tenant real por ahora), o dependen de servicios externos. |

---

## Documentos hermanos mencionados, no presentes todavía en el repo

`indicadores-dashboard.html`, `indicadores-internos-plataforma.html` — origen de varios de los grupos de arriba (13 a 17). Si los vas a traer, avisá y se suman con el mismo criterio.
