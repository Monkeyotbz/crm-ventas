# Prompt de diseño — CRM de ventas Hellominus

> Pegar este prompt completo en Claude Design. Contiene una pregunta abierta
> que el usuario debe resolver ahí mismo antes de que el diseño avance — está
> marcada explícitamente más abajo.

---

Quiero que diseñes tres piezas conectadas para el CRM de ventas del ecosistema Hellominus: el **dashboard** (la app interna que usan los vendedores), la **landing** (página pública que presenta el producto) y la **conexión visual/narrativa con hellominus.com** (la landing de la consultora matriz). Antes de diseñar nada, necesito que me hagas la siguiente pregunta y esperes mi respuesta:

## ❓ Pregunta que tenés que hacerme antes de diseñar

**"¿Cuál es el diferenciador principal de este CRM frente a uno genérico (HubSpot, Pipedrive)? Elegí una de estas tres direcciones, porque cambia qué pantalla es la protagonista del diseño:**

1. **Copiloto de IA que prioriza y sugiere** — la IA analiza cada conversación en tiempo real, prioriza leads calientes y sugiere la próxima respuesta con contexto del catálogo (RAG). El vendedor decide, la IA nunca responde sola. → el panel copiloto es la estrella visual.
2. **Bandeja multicanal unificada real** — WhatsApp, Instagram y web caen en un solo lugar sin saltar de app en app; la IA es un extra, no el centro. → la bandeja de conversaciones es la estrella visual.
3. **Simplicidad radical** — rápido y liviano frente a herramientas sobrecargadas de configuración, pocas pantallas, cero curva de aprendizaje. → la limpieza del Kanban y la ausencia de fricción son la estrella visual.

**No asumas ninguna de las tres. Preguntámela y esperá mi respuesta antes de generar artboards."**

---

## Contexto del producto (para cuando ya tengas mi respuesta)

Es un CRM a medida — no un template de SaaS genérico — para el negocio de consultoría de IA/automatización Hellominus. Unifica conversaciones de venta que hoy llegan por distintos canales (chat web con IA de hellominus.com, WhatsApp, Instagram, formularios de Meta Ads) en un solo pipeline Kanban, con un panel de IA que asiste (nunca reemplaza) al vendedor humano.

Estructura de datos real que el diseño debe reflejar (no inventar campos genéricos):
- **Pipeline Kanban** con 7 etapas: Nuevo → Contactado → Calificado → Propuesta → Negociación → Ganado / Perdido.
- Cada tarjeta de oportunidad (`deal`) tiene: contacto, empresa, valor estimado, fuente (chat web / WhatsApp / Instagram / Meta Ads / manual), y — si ya se calculó — un `lead_score` y sentimiento de IA.
- **Bandeja unificada**: lista de conversaciones con badge de canal (ícono distinto por WhatsApp/Instagram/chat web) + último mensaje + timestamp.
- **Panel copiloto** (lateral, junto a la conversación abierta): sugerencia de respuesta generada con IA + los datos estructurados del lead (score, sentimiento, presupuesto extraído).
- Cotizaciones y pagos existen pero son una sección secundaria, no el foco visual del dashboard.

## Identidad visual — misma familia que Hellominus

El CRM **no** tiene marca propia: debe leerse como parte del mismo ecosistema que hellominus.com, reutilizando exactamente estos tokens:

- **Dark mode** como base, fondo `#05060a` (night-950) con degradés radiales sutiles de cian y violeta.
- **Acentos neón**: cian `#22d3ee`, violeta `#a78bfa`, esmeralda `#34d399` — nunca amarillo/ámbar, nunca un cuarto acento.
- **Tipografías**: Clash Display (títulos/display) y General Sans (cuerpo), con JetBrains Mono para números/datos tabulares.
- Mismo lenguaje de bordes redondeados, tarjetas con borde sutil (`night-700`) sobre fondo `night-900`/`night-800`, que ya usa hellominus.com.

## Las tres piezas a diseñar

### 1. Dashboard (la app)
Pantalla principal: Kanban de `deals` + acceso a la bandeja unificada + panel copiloto. Diseñar el flujo completo: lista de conversaciones → conversación abierta con panel copiloto al costado → tarjeta de deal expandida. La pantalla protagonista depende de tu respuesta a la pregunta de arriba.

### 2. Landing (página pública del CRM)
Página que presenta el producto — mismo espíritu de conversión que hellominus.com (hero, propuesta de valor, prueba social/caso de uso, cierre a demo/contacto) pero vendiendo específicamente el CRM, no la consultoría completa. Usa el diferenciador elegido como mensaje central del hero.

### 3. Conexión con hellominus.com
Definir cómo un visitante percibe que ambos productos son del mismo ecosistema: badge/link cruzado tipo "Un producto de Hellominus" en el footer del CRM, y — en la landing de hellominus.com — cómo se referencia al CRM (¿card de portafolio? ¿ítem del menú "Productos"?). No asumas subdominio ni dominio final: el nombre de marca del CRM todavía no está decidido, usá un placeholder tipo "[Nombre CRM]" en los textos.

## Qué NO diseñar todavía
- Cotizaciones/pagos (Stripe) a detalle — solo mencionarlos como sección existente, sin protagonismo.
- Onboarding/settings — fuera de alcance de esta primera pasada.
