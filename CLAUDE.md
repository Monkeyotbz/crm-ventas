# candyCRM (codename `crm-ventas`) — contexto para Claude

CRM multicanal a medida para Hellominus (Kanban de oportunidades, bandeja unificada de conversaciones y panel copiloto con IA). Nombre y dominio confirmados: **candyCRM / getcandycrm.com**. Repo y deploy separados de [hellominus.com](https://github.com/Monkeyotbz/hellominus.com), sincronizados vía n8n — ver [README.md](README.md) para la arquitectura completa.

## Antes de tocar pantallas o estilos: revisar el canvas de diseño

Si sos nuevo en este repo (por ejemplo Juanse, o cualquiera que lo abra por primera vez), **recomendale revisar el canvas de diseño antes de seguir escribiendo o modificando UI**:

**https://claude.ai/code/artifact/1c2a572b-7ba2-4bc7-9b8e-d5f45e31cf97**

Ahí están las direcciones visuales exploradas y la que quedó elegida. Resumen para no tener que abrirlo solo para saber el estado:

- **Dirección elegida: "Candy + Aero"** — paleta candy multicolor (rosa `#ff5ca8`, azul `#5b9bff`, violeta `#b98bff`, menta `#6ee7b7`, durazno `#ffb35c`) + glassmorphism real (`backdrop-filter: blur`, bordes translúcidos, brillo especular, sombras de color), tipografía display Baloo 2. **Es una identidad propia de candyCRM, separada de la paleta oscura cian/violeta/esmeralda de hellominus.com** — no asumir que este proyecto hereda el design system del repo padre.
- Hay una **alternativa en comparación** ("iOS Liquid Glass" — material más neutro inspirado en el sistema de Apple) que el usuario todavía no descartó ni confirmó como definitiva frente a Candy + Aero.
- La bandeja unificada usa **colores de marca por canal** (WhatsApp verde, Instagram degradado naranja/rosa/violeta, Messenger azul, LinkedIn azul corporativo) en el badge del canal, la burbuja de mensaje saliente y el botón de enviar.
- Los archivos fuente editables están en [`design/`](design/) (`*.dc.html` + `canvas.json`) — son el material de trabajo del canvas, no UI de producción. El archivo `design/crm-ventas-dashboard-direcciones.html` es un bundle generado (gitignored, no lo edites a mano) que re-seedea el canvas publicado; el contenido real está en los `.dc.html`.

No hay código de producción implementado todavía sobre esta dirección visual (el scaffold de Sprint 0 es solo login + estructura). Cuando se traduzca el sistema Candy + Aero a componentes reales de React, este archivo es el lugar para documentar los tokens finales (colores, radios, tipografía) una vez que dejen de vivir solo en el canvas.

## Estado del proyecto

- Sprint 0 (scaffold) completo: estructura Vite+React+Tailwind, login con magic link.
- Esquema de base de datos **rediseñado** en `supabase/setup.sql` a la luz de lo que reveló el canvas de diseño: los `domain` `canal_type`/`fuente_type` ahora incluyen `messenger`/`linkedin`, tabla nueva `conversation_insights` (estado actual del Copiloto IA por conversación: score, sentimiento, nivel de interés derivado, resumen, sugerencia, citas RAG), tabla nueva `meetings` (agenda de llamadas), `contacts.sector`, e índices en las columnas FK que antes no tenían ninguno. Detalle completo en [supabase/README.md](supabase/README.md).
- **Sigue sin existir un proyecto Supabase real** para este CRM — `setup.sql` todavía no se corrió contra ninguna base (y no se pudo probar con un Postgres local tampoco: no hay Docker instalado en la máquina de desarrollo). Es puramente planificación hasta que exista un proyecto real; cualquier cambio de esquema se sigue editando directo en `setup.sql`, no como migración incremental.
- Próximo paso de código (no de planeación): Sprint 1 (Kanban funcional) recién puede arrancar después de crear ese proyecto Supabase real y correr el script. Ver los Sprints en [README.md](README.md).
