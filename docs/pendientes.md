# Pendientes — candyCRM (estado general del proyecto)

Armado el **4 sept 2026**, a pedido explícito: un panorama completo de qué falta, no solo del
widget de chat recién construido. Es un documento distinto de `docs/corregir-errores.md` — ese es
la auditoría de calidad de código; este es "qué queda por hacer" en todo el proyecto.

## Dónde está la versión viva

**https://claude.ai/code/artifact/825091f7-7555-45e0-9b87-c9223c0a8ed9**

Igual que `corregir-errores`: el `.html` de esta carpeta es la fuente de esa página, no una copia
viva — el checklist se tilda en el Artifact, no acá.

## Los ítems accionables (con checkbox en la página viva)

### Frontend — Sprint 1 (el cuello de botella real)
Hay tres canales de ingesta funcionando (WhatsApp, el widget de chat, el Router clasificando) y
**ningún lugar del frontend para ver lo que entra** — el CRM sigue siendo solo el login de
Sprint 0.

- Construir el Kanban de oportunidades (deals arrastrables entre etapas)
- Construir la bandeja unificada (inbox) para ver y responder WhatsApp/widget
- Panel copiloto IA (lee `conversation_insights`) — depende de que existan los dos anteriores

### Widget de chat web
Construido y probado el 4 sept 2026 (ver `docs/DECISIONES.md` y la memoria de esa sesión). Falta:

- Embeberlo en el sitio real de hellominus.com (hoy corre en GitHub Pages con un doble local,
  `widget/prueba.html`)
- Límite de velocidad en `ingesta-widget-chat` — brecha de seguridad conocida, documentada en el
  código, no un descuido
- (Menor, deliberadamente aplazado) merge manual de contactos cuando alguien identifica un email
  que ya pertenece a otro contacto — es una limitación documentada a propósito, no un bug

### WhatsApp / Meta — producción real
- Registrar un número real de WhatsApp (hoy solo está el número de prueba de Meta)
- Confirmar si terminó la verificación de negocio de Meta ("Paso 3" de
  `docs/configurar-webhook-meta.md`)
- Reemplazar la URL de Política de Privacidad en Meta for Developers cuando exista
  `getcandycrm.com` — hoy apunta a un Artifact temporal (ver `CLAUDE.md`)

### n8n
Sigue sin cuenta creada. Antes de construir el primer flujo:

- Crear la cuenta de n8n (Cloud o self-host)
- Resolver el mapeo canal → tenant para Instagram/Messenger/Meta Ads — es el bloqueante real,
  sin esto no se puede construir bien ni el primer flujo (ver la memoria
  `crm-ventas-n8n-donde-entra`)
- Construir la Edge Function de ingesta genérica para esos canales

### Equipo y accesos
- Conseguir el correo de Gabriel e invitarlo a Supabase con rol `Developer`
- Agregarlo como colaborador de GitHub con permiso `Write`
- Decidir qué hacer con el proyecto Supabase `crm-ventas-staging` (hoy pausado/INACTIVE) — borrarlo
  o dejarlo así

### Dominio
- Desplegar `getcandycrm.com` — bloquea el ítem de la política de privacidad de arriba

## Referencia — no se tilda acá, tiene su propio dueño de estado

### Calidad de código (auditoría del 2 sept)
Los 6 bloqueantes (H1-H6) están corregidos. Quedan **10 importantes y 10 menores** sin tocar —
detalle completo, con checkboxes propios, en
[`docs/corregir-errores.md`](corregir-errores.md) / su Artifact. No se duplica acá para no tener
dos lugares que puedan quedar desincronizados.

### Candidatos de agentes sin construir ([6a]-[7c])
Todos `APLAZADO` en `docs/DECISIONES.md`, con condición de activación "Fase 1 cerrada" (bandeja
funcionando) — coincide con el ítem de Frontend de arriba. `[6d]` (Agendador) necesita además una
cuenta de Cal.com/Google Calendar conectada. `[7c]` (Agente de Recuperación) tenía como condición
extra que `payment_links` existiera en el esquema — **ya existe, verificado contra la base el
4 sept** — la entrada de DECISIONES.md quedó desactualizada en ese punto; el cambio de estado en sí
sigue siendo decisión del usuario, no de este documento.

El estado de estos 7 candidatos se cambia únicamente en `docs/DECISIONES.md`, nunca acá.
