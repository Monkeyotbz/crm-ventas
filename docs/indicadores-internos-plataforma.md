# Indicadores internos de la plataforma

> **Fuente de este documento:** convertido desde [`indicadores-internos-plataforma.html`](indicadores-internos-plataforma.html)
> (versión visual original, se conserva como snapshot de referencia — no se edita más, este `.md` es la
> copia de trabajo). Documento del 23 ago 2026.
>
> **Relación con los otros documentos de `docs/`:** es el origen de los Grupos 14 a 17 de
> [`tener-en-cuenta-base-de-datos.md`](tener-en-cuenta-base-de-datos.md) (rendimiento de agentes, la
> plataforma como producto SaaS, salud técnica, separación de roles cliente/interno) — ahí está el
> mapeo de estos indicadores a columnas/tablas concretas, y el punto 42 de ese documento ya deja
> registrado que el rol de plataforma que este archivo describe **está implementado**, no como el claim
> en `app_metadata` que proponía originalmente, sino como la tabla `platform_admins` — ver
> [`supabase/README.md`](../supabase/README.md). Mismo criterio que el resto: es referencia para
> orientarnos, no una lista a construir literalmente.
>
> ✅ **Corrección sobre el original (24 ago 2026):** donde el documento decía "con 3 tenants activos" —
> ejemplo ilustrativo de una etapa temprana con pocos clientes — hoy el caso real es más chico todavía:
> **Hellominus es el único tenant activo**. No cambia el argumento de fondo (algo es prescindible si hoy
> se resuelve hablando directamente con el cliente), solo la cifra.

**◆ Confidencial — solo rol interno.** Estos indicadores **no se exponen a los clientes del CRM**. Viven
bajo el rol de plataforma (`platform_admins`, ya implementado), separado del rol de usuario cliente que
filtra por `tenant_id` vía RLS.

**Indicadores: 21 · Grupos: 4 · Audiencia: equipo dueño de la plataforma (Hellominus)**

---

## La división — qué ve el cliente y qué vemos nosotros

El cliente compró un CRM para gestionar *su* negocio — negarle visibilidad sobre sus propias ventas sería venderle una caja negra. Pero hay una capa que es de la plataforma, no de él.

| Para el cliente — cada tenant ve solo lo suyo | ◆ Solo interno — dueños de la plataforma |
|---|---|
| Rendimiento de su pipeline: conversión por etapa, forecast, tiempo de ciclo | Rendimiento de los agentes IA: cuánto resuelve el bot solo, dónde falla, costo por conversación |
| Ventas por producto de su propio catálogo | Comparativo entre tenants: quién usa más, quién factura más, quién está en riesgo de irse |
| Origen de sus leads y ROI de sus campañas | Costos de infraestructura y mensajería agregados — lo que cuesta operar la plataforma |
| Análisis de pérdidas: por qué se van sus clientes | Salud técnica: errores, latencia, uptime |

---

## Clasificación por relevancia (vista transversal)

Los mismos 21 indicadores, agrupados por qué tan imprescindibles son **hoy** — con Hellominus como único
tenant activo y sin volumen todavía. El criterio: algo es **imprescindible** si su ausencia lleva a una
mala decisión sin que se note; es **prescindible** si hoy se resuelve hablando directamente con quien
dirige la cuenta.

**🟠 Imprescindibles (7)** — sin esto el sistema opera a ciegas: son deals reales perdidos, riesgo de suspensión del canal, o la base de cualquier decisión de precio.
- **1** · % resuelto por IA sin humano
- **4** · Precisión del Router
- **5** · Escalamientos A→B perdidos
- **11** · Margen real por tenant
- **16** · Costo de mensajería por categoría
- **19** · Quality Rating por número
- **20** · Errores de webhook

**🟢 Importantes (8)** — mejoran decisiones, pero el sistema no se cae sin ellos: son diagnóstico y refinamiento, no alarma.
- **2** · Escalamiento por agente
- **3** · Motivo de escalamiento
- **6** · Turnos promedio hasta resolver
- **7** · Tiempo de primera respuesta
- **8** · Tasa de alucinación
- **10** · MRR por tenant
- **12** · Churn y señales tempranas
- **17** · Costo por conversación cerrada

**⚪ Prescindibles (5)** — no compensan el esfuerzo de construirlos todavía: resuelven problemas de escala que no existen con un solo tenant, o duplican algo que Supabase/Vercel ya dan gratis.
- **13** · Time-to-value
- **14** · Adopción por funcionalidad
- **15** · Expansión de cuenta
- **18** · Consumo de infraestructura
- **21** · Latencia y uptime

**🔴 Caso aparte (1)** — no encaja limpio en ninguna categoría: valioso en teoría, pero mejor absorbido dentro de otro indicador que como panel propio.
- **9** · Costo de tokens — mejor fusionarlo dentro del costo total por conversación (17), no como indicador independiente.

---

## Grupo 1 — Rendimiento de los agentes IA

Sin estos indicadores no se pueden mejorar los agentes — se adivina. Son los que convierten "el bot anda raro" en un problema concreto y localizable.

**1. 🟠 % resuelto por IA sin intervención humana**
- *Qué te dice:* qué proporción de conversaciones cierra el agente solo, sin que un humano tenga que entrar.
- *Para qué sirve:* es la métrica que justifica todo el proyecto. Si no sube con el tiempo, los agentes no están aprendiendo ni mejorando — y el ahorro prometido no existe.

**2. 🟢 Tasa de escalamiento a humano, por agente**
- *Qué te dice:* cuál agente escala más y cuál menos — el SDR puede escalar 36% mientras el Bot de Catálogo solo 9%.
- *Para qué sirve:* localiza dónde está el cuello de botella. Un agente que escala demasiado necesita mejores tools o mejor prompt, no más conversaciones.

**3. 🟢 Motivo de escalamiento**
- *Qué te dice:* por qué se escaló — cliente molesto, monto alto, tema fuera de alcance, petición directa.
- *Para qué sirve:* distingue el escalamiento sano (monto alto, correcto por diseño) del escalamiento por falla (el agente no supo responder). Solo el segundo hay que arreglarlo.

**4. 🟠 Precisión del Router**
- *Qué te dice:* cuántas clasificaciones de pipeline tuvieron que corregirse manualmente después.
- *Para qué sirve:* el Router es la pieza más crítica del sistema — si clasifica mal, todo lo que sigue está mal. Las correcciones manuales son la señal de qué reglas ajustar en `routing_rules`.

**5. 🟠 Escalamientos A→B detectados vs. perdidos**
- *Qué te dice:* cuántos leads corporativos disfrazados de compra pequeña detectó el Router — y cuántos se descubrieron tarde, revisando manualmente.
- *Para qué sirve:* es el caso que más dinero deja sobre la mesa. Cada escalamiento perdido es un deal de miles de dólares que se atendió como uno de quince.

**6. 🟢 Turnos promedio hasta resolver**
- *Qué te dice:* cuántos mensajes necesita cada agente para cerrar o calificar.
- *Para qué sirve:* a partir del 1 de octubre de 2026 cada mensaje cuesta dinero. Reducir turnos deja de ser elegancia de diseño y pasa a ser margen directo.

**7. 🟢 Tiempo de primera respuesta**
- *Qué te dice:* cuánto tarda el sistema en responder el primer mensaje de un lead.
- *Para qué sirve:* es el argumento de venta más concreto del CRM frente a un competidor. Si se degrada, hay un problema de infraestructura antes que de agentes.

**8. 🟢 Tasa de alucinación o respuesta corregida**
- *Qué te dice:* cuántas veces un humano tuvo que corregir o desmentir algo que dijo el agente.
- *Para qué sirve:* es el indicador de riesgo reputacional. Un agente que inventa precios o promete plazos es peor que no tener agente — este número debe tender a cero antes de soltar el bot en automático.

**9. 🔴 Costo de tokens por conversación y por agente**
- *Qué te dice:* cuánto cuesta en LLM cada conversación, desglosado por agente.
- *Para qué sirve:* detecta agentes con prompts inflados o que arrastran demasiado contexto. Es una de las dos palancas de costo variable del negocio, junto con la mensajería.

## Grupo 2 — Ventas de la plataforma: el CRM como producto

Acá el "cliente" no es el lead: es la empresa que compra el CRM. Estos indicadores miden el negocio de vender el CRM, no las ventas que el CRM gestiona.

**10. 🟢 Ingreso recurrente por tenant (MRR)**
- *Qué te dice:* cuánto factura cada cuenta al mes y cuánto suma el total.
- *Para qué sirve:* es la línea base del negocio de plataforma. Sin esto no hay forma de saber si el CRM como producto está creciendo o solo acumulando trabajo.

**11. 🟠 Margen real por tenant**
- *Qué te dice:* lo que factura cada cuenta menos lo que cuesta atenderla (mensajería + tokens + infraestructura).
- *Para qué sirve:* revela al cliente que parece rentable y no lo es — uno que paga poco pero genera un volumen enorme de conversaciones puede estar costando más de lo que deja.

**12. 🟢 Churn y señales tempranas de abandono**
- *Qué te dice:* cuántas cuentas se van, y cuáles muestran señales antes — caída de uso, menos logins, deals sin mover.
- *Para qué sirve:* recuperar una cuenta antes de que se vaya es mucho más barato que conseguir una nueva. Las señales dan margen de reacción de semanas.

**13. ⚪ Tiempo hasta el primer valor (time-to-value)**
- *Qué te dice:* cuánto tarda una cuenta nueva desde que firma hasta que cierra su primer deal en el sistema.
- *Para qué sirve:* es el mejor predictor de retención. Una cuenta que tarda meses en ver resultados es una cuenta que se va a ir — y señala dónde arreglar el onboarding.

**14. ⚪ Adopción por funcionalidad**
- *Qué te dice:* qué partes del CRM se usan de verdad y cuáles nadie abre.
- *Para qué sirve:* orienta el roadmap con datos en vez de intuición — una función que nadie usa no necesita mejoras, necesita entenderse o eliminarse.

**15. ⚪ Expansión de cuenta**
- *Qué te dice:* cuántos tenants suben de plan, agregan usuarios o piden módulos nuevos.
- *Para qué sirve:* el crecimiento más barato viene de clientes que ya están adentro. Este indicador dice si el producto tiene camino de crecimiento propio o si cada peso nuevo exige un cliente nuevo.

## Grupo 3 — Costos operativos de la plataforma

Las dos palancas de costo variable del negocio — mensajería y modelos — más la infraestructura. Es lo que determina si el precio del CRM tiene sentido.

**16. 🟠 Costo de mensajería por tenant y por categoría**
- *Qué te dice:* cuánto se gasta en WhatsApp por cuenta, separado en marketing, utility, authentication y service.
- *Para qué sirve:* con el cambio del 1 de octubre de 2026, responder deja de ser gratis. Este indicador es el que va a decidir si el modelo de precios actual aguanta o hay que ajustarlo.

**17. 🟢 Costo total por conversación cerrada**
- *Qué te dice:* mensajería + tokens sumados, dividido entre las conversaciones que terminaron en venta.
- *Para qué sirve:* es la métrica que responde si vender un gadget de $15 con 8 mensajes de bot sigue siendo negocio. Aplica directo a la unidad económica del Pipeline A.

**18. ⚪ Consumo de infraestructura por tenant**
- *Qué te dice:* filas en base de datos, storage de multimedia, invocaciones de Edge Functions por cuenta.
- *Para qué sirve:* detecta el "vecino ruidoso" antes de que afecte a los demás — el escenario que en algún momento justificaría separar ese tenant a infraestructura dedicada.

## Grupo 4 — Salud técnica y de cuentas

Lo que avisa antes de que un problema llegue al cliente. Son indicadores de prevención, no de análisis.

**19. 🟠 Quality Rating y tier por número de WhatsApp**
- *Qué te dice:* el estado de calidad de cada número conectado y qué tan cerca está de su límite diario.
- *Para qué sirve:* si la calidad de un número cae, Meta puede suspenderlo — y ese tenant se queda sin canal. Es un indicador de riesgo operativo directo, no de análisis.

**20. 🟠 Errores de webhook y mensajes fallidos**
- *Qué te dice:* cuántos mensajes no se entregaron o no se procesaron, y por qué.
- *Para qué sirve:* un mensaje perdido es un lead perdido que nadie reclama, porque nadie sabe que existió. Es el error más silencioso y más caro del sistema.

**21. ⚪ Latencia del sistema y uptime**
- *Qué te dice:* cuánto tarda el Router en decidir, cuánto tarda la ingesta, y cuánto tiempo estuvo caído el sistema.
- *Para qué sirve:* Meta degrada números que responden lento a sus webhooks. La latencia no es solo experiencia de usuario: puede costar el canal completo.

---

## ◆ Lo que nunca debe exponerse al cliente

- **Costos de operación de su cuenta** — le revela tu margen. Ningún proveedor de SaaS expone eso.
- **Comparativo con otros tenants** — es información competitiva de terceros que no le corresponde.
- **Señales internas de churn** — decirle a un cliente que el sistema lo marcó como "en riesgo de irse" produce justo el efecto contrario.
- **Métricas de tokens y modelos** — es detalle de implementación, no valor para él.
