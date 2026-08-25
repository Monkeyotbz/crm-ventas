# Indicadores para el Dashboard

> **Fuente de este documento:** convertido desde [`indicadores-dashboard.html`](indicadores-dashboard.html)
> (versión visual original, se conserva como snapshot de referencia — no se edita más, este `.md` es la
> copia de trabajo). Documento del 23 ago 2026, marcado como *"vivo — se sigue alimentando por grupo"*.
>
> **Relación con los otros documentos de `docs/`:** es el origen del Grupo 13 ("Por origen y atribución
> multi-touch") de [`tener-en-cuenta-base-de-datos.md`](tener-en-cuenta-base-de-datos.md) — ahí está el
> mapeo de estos indicadores a columnas/tablas concretas. Mismo criterio que el resto: es referencia
> para orientarnos, no una lista a construir literalmente en el orden en que aparece.

Indicadores que alimentarían el panel analítico del CRM que ve **el cliente** (cada tenant, lo suyo — a
diferencia de [`indicadores-internos-plataforma.md`](indicadores-internos-plataforma.md), que es
confidencial y no se le expone). Organizados por grupo; cada uno con qué te diría al mirarlo y para qué
serviría esa lectura en una decisión real.

**Grupos definidos: 1 · Indicadores en este grupo: 15** — el documento original deja explícito que es
parcial, con más grupos ya discutidos y pendientes de agregar (ver el final).

---

## Grupo 1 — Origen y atribución del lead

De dónde viene cada lead, por qué ruta llegó, y cuántos toques tomó antes de escribir. Es la capa que le dice al negocio dónde está sembrando y dónde está cosechando.

**1. Canal de entrada**
- *Qué te dice:* por dónde llegó — WhatsApp, widget web, Instagram, email.
- *Para qué sirve:* dónde poner esfuerzo operativo y cuál canal está creciendo o muriendo.

**2. Fuente / source**
- *Qué te dice:* si vino de anuncio pagado, orgánico, referido, outbound o evento.
- *Para qué sirve:* separa lo que compras de lo que ganas — la base para saber cuánto de tu demanda depende de pagar publicidad.

**3. Campaña específica (`campaign_id`, `ad_id`)**
- *Qué te dice:* qué anuncio exacto lo trajo.
- *Para qué sirve:* calcular ROI real por campaña y apagar las que no cierran ventas, aunque traigan muchos leads.

**4. Referrer (URL de origen)**
- *Qué te dice:* de qué sitio venía exactamente — un foro, un directorio, un blog ajeno, LinkedIn.
- *Para qué sirve:* distingue "llegó de un foro de constructores" de "llegó de un comparador de software" — dos audiencias con intención muy distinta que hoy se agrupan como "orgánico".

**5. Landing page de entrada**
- *Qué te dice:* por qué página del sitio entró.
- *Para qué sirve:* revela la intención inicial — quien aterriza en "/erp-construccion" viene decidido; quien entra por el blog está explorando.

**6. Búsquedas que traen tráfico (Search Console)**
- *Qué te dice:* qué términos usó la gente para encontrarte.
- *Para qué sirve:* muestra qué problema está buscando resolver tu mercado, y qué contenido te falta escribir.

**7. Visitas antes de contactar**
- *Qué te dice:* si escribió en la primera visita o volvió cuatro veces antes.
- *Para qué sirve:* muestra el ciclo real de decisión, casi siempre más largo de lo que se asume, y ayuda a no descartar leads "fríos" prematuramente.

**8. Ruta completa de toques (multi-touch)**
- *Qué te dice:* la secuencia de interacciones antes de contactar — vio un anuncio → buscó en Google → leyó un artículo → escribió.
- *Para qué sirve:* muestra cómo se construye realmente una decisión, en vez de darle todo el crédito al último clic.

**9. Canal que descubre vs. canal que cierra**
- *Qué te dice:* cuál trae gente nueva y cuál convierte.
- *Para qué sirve:* casi nunca son el mismo. Confundirlos lleva a recortarle presupuesto justo al canal que está sembrando todo el pipeline.

**10. Tiempo desde el primer toque hasta el contacto**
- *Qué te dice:* cuánto pasa entre que te descubren y que te escriben.
- *Para qué sirve:* dimensiona el ciclo real de tu mercado y ayuda a saber cuánto tiempo debe seguir corriendo una campaña antes de juzgarla.

**11. Toques promedio antes de comprar, por tipo de producto**
- *Qué te dice:* cuántas interacciones necesita cerrar cada tipo de venta.
- *Para qué sirve:* el conversor probablemente cierra en uno; el ERP en seis. Dimensiona el esfuerzo comercial real de cada línea de producto.

**12. Contenido que precede una venta**
- *Qué te dice:* qué artículo o página visitó quien terminó comprando.
- *Para qué sirve:* separa el contenido que genera ingresos del que solo genera tráfico.

**13. "¿Cómo nos conociste?" (declarado por el cliente)**
- *Qué te dice:* respuesta que el Agente SDR pregunta durante la calificación.
- *Para qué sirve:* es la única forma de capturar referidos, voz a voz y eventos — canales sin rastro digital que suelen traer los mejores clientes.

**14. Dispositivo y ubicación aproximada**
- *Qué te dice:* móvil o escritorio, y ciudad de origen.
- *Para qué sirve:* el dispositivo cambia el comportamiento de compra; la ciudad revela concentraciones geográficas que pueden orientar dónde vender o hacer presencia.

**15. Origen cruzado con pipeline (A vs. B)**
- *Qué te dice:* qué canales traen compradores de gadgets y cuáles traen leads consultivos.
- *Para qué sirve:* evita optimizar todo hacia volumen barato cuando el dinero real está en el canal que trae menos leads pero más grandes.

---

## Próximo grupo — pendiente de definir

Grupos que ya se discutieron y están listos para agregarse cuando se indique:
- Rendimiento por producto (ventas, ticket promedio, conversión, abandono)
- Financieras (ingreso, margen, LTV, costo de mensajería)
- Funnel y pipeline por producto
- Comparativo multi-tenant
