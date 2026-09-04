# `envio-whatsapp` — responder desde la bandeja

Manda un mensaje saliente de WhatsApp y lo guarda en `messages`. La llama el frontend logueado
(`src/components/inbox/HiloMensajes.jsx`) — es la mitad "enviar" de la bandeja unificada
(Sprint 1); la mitad "recibir" es [`ingesta-whatsapp`](../ingesta-whatsapp/).

## Distinta de las otras dos Edge Functions del proyecto

`ingesta-whatsapp` es un webhook público (lo llama Meta) y `router` lo llama un trigger con un
secreto compartido — las dos corren con `service_role` porque nadie logueado está del otro lado.
**Esta corre con el JWT de quien la invoca**, reenviado en el header `Authorization`. Consecuencia
directa: la lectura de la conversación y la escritura del mensaje pasan por las mismas RLS que
protegen todo lo demás — no hace falta reimplementar "¿esta conversación es de este vendedor?",
si no lo es, la consulta no devuelve nada.

## El secret — ya cargado (4 sept 2026)

```bash
supabase secrets set WHATSAPP_ACCESS_TOKEN=<token>
```

**`WHATSAPP_ACCESS_TOKEN` ya está seteado** — system user `candycrmenvios`, sin expiración, con el
permiso `whatsapp_business_messaging` sobre "Test WhatsApp Business Account". Sin él, la función
respondía `503` con un mensaje claro en vez de fallar oscuro; ya no debería pasar. Es un token
**distinto** de `WA_VERIFY_TOKEN`/`META_APP_SECRET` (esos son para *recibir*, no para enviar):

1. [Meta for Developers](https://developers.facebook.com) → tu Business Portfolio → **Business
   Settings → Users → System Users**.
2. Creá un system user (o usá uno existente) con acceso a la app "CRM Ventas - Hello Minus".
3. **Generate Token** → permiso `whatsapp_business_messaging` → sin fecha de expiración (o la más
   larga disponible).
4. Ese token es el que va en el secret de arriba.

## La regla de la ventana de 24 h

| Estado | Qué se puede mandar |
|---|---|
| Ventana abierta (`conversations.ventana_abierta_hasta > now()`) | Texto libre |
| Ventana cerrada | Solo una plantilla **aprobada** por Meta (`message_templates.estado = 'aprobada'`) |

`private.validar_plantilla_para_iniciar()` ya hace cumplir esto a nivel de base (es lo que
corrigió H5 de la auditoría) — esta función solo evita el viaje a Meta cuando ya se sabe que va a
fallar, y devuelve un `409` con `ventana_cerrada: true` en vez de un error crudo de Postgres.

**El camino de plantilla existe en el código pero no se probó contra la API real todavía:**
`message_templates` está vacía — nadie sometió ninguna a revisión de Meta. Someter una plantilla
es un proceso aparte (Meta for Developers → WhatsApp → Message Templates), no algo que se resuelva
desde acá.

## Body esperado

```json
{ "conversation_id": 4, "contenido": "texto libre" }
```
o, con la ventana cerrada:
```json
{ "conversation_id": 4, "template_id": 7 }
```

## Qué guarda

`externo_id` = el `wamid` que devuelve Meta — **a propósito**, así el mensaje queda enganchado al
mismo flujo de `guardarEstado()` de `ingesta-whatsapp`, que ya actualiza `entregado`/`entregado_at`
cuando llega el webhook de status. No hace falta duplicar ese tracking acá.

## Desplegar

```bash
npx supabase functions deploy envio-whatsapp
```

Sin `--no-verify-jwt`, a propósito: el gateway de Supabase tiene que rechazar una llamada sin JWT
válido antes de que el código corra. `ingesta-whatsapp` y `router` sí llevan ese flag porque nadie
logueado los invoca — esta función es la excepción de las tres.

## Verificado / sin verificar

- Rechazo por ventana cerrada sin plantilla: **verificado**, no necesita a Meta para probarse.
- El envío real contra la Graph API: **sin verificar todavía**, aunque el secret ya está cargado
  (4 sept). Dos cosas tienen que darse antes de poder probarlo de punta a punta:
  1. Que la ventana de 24h esté abierta — el único contacto real (JSC) la tiene cerrada desde el
     3 sept; se reabre sola si escribe de nuevo por WhatsApp.
  2. `whatsapp_numbers` apunta al **número de prueba de Meta**, no a uno real. Los números de
     prueba solo pueden mandar mensajes a destinatarios agregados a mano en Meta for Developers →
     WhatsApp → API Setup → lista de números de prueba (máx. 5). Si el envío falla con algo como
     `(#100) Invalid parameter` aun con la ventana abierta, es probable que sea esto — hay que
     confirmar que el teléfono de JSC esté en esa lista.
- La prueba de punta a punta real (login real, no la sesión falseada de Playwright) queda
  pendiente de hacer junto con el usuario.
