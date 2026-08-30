# `ingesta-whatsapp` — webhook de WhatsApp Cloud API

Recibe los webhooks de Meta y los normaliza contra el esquema del CRM. Corresponde al
candidato **[3]** de [`docs/DECISIONES.md`](../../../docs/DECISIONES.md) y al Paso 1.5 de
[`docs/guia-fases-1-2.md`](../../../docs/guia-fases-1-2.md).

## Qué hace, en orden

| # | Etapa | Detalle |
|---|---|---|
| 1 | `GET` de verificación | Responde `hub.challenge` si `hub.verify_token` coincide con `WA_VERIFY_TOKEN` |
| 2 | Firma | HMAC-SHA256 del cuerpo crudo contra `META_APP_SECRET`, comparación de tiempo constante. Sin firma válida → 401 y no se escribe nada |
| 3 | Respuesta | 200 inmediato. El trabajo va en `EdgeRuntime.waitUntil` — Meta reintenta si tardás más de 5 s |
| 4 | Tenant | `metadata.phone_number_id` → `whatsapp_numbers.tenant_id`. Es el único punto donde el webhook sabe de quién es el mensaje |
| 5 | Contacto | Dedup por `contact_channels (tenant_id, 'whatsapp', telefono)`, **no** por `contacts.telefono` |
| 6 | Conversación | Reusa la `abierta` de ese contacto en WhatsApp, o crea una |
| 7 | Mensaje | `upsert` con `onConflict: conversation_id,externo_id` → un reintento de Meta no duplica |
| 8 | Ventana | `ventana_abierta_hasta = timestamp del mensaje + ventana_horas` |
| 9 | Fallos | Van a `webhook_errors` con el payload, sin tumbar el resto del lote |

## Antes de desplegar: sembrar el número

La función falla con `phone_number_id ... no está registrado` hasta que exista la fila.
Los tres datos salen de Meta for Developers (ver
[`docs/configurar-webhook-meta.md`](../../../docs/configurar-webhook-meta.md)):

```sql
insert into whatsapp_numbers (tenant_id, phone_number_id, waba_id, numero_display, activo)
select id, '<PHONE_NUMBER_ID>', '<WABA_ID>', '<+57...>', true
from tenants where slug = 'hellominus';
```

> El tenant también necesita un `team_members` con `rol = 'owner'`: `contacts.owner_id` y
> `conversations.owner_id` son NOT NULL y un webhook no tiene usuario logueado, así que la
> ingesta le asigna las filas nuevas a ese owner. Ya está sembrado para Hellominus.

## Desplegar

```bash
# 1. Secrets (NO van en .env del repo — se guardan en Supabase)
npx supabase secrets set WA_VERIFY_TOKEN='<inventado por vos, cualquier string largo>'
npx supabase secrets set META_APP_SECRET='<Configuración de la app → Básico → Clave secreta>'

# 2. Desplegar. --no-verify-jwt es obligatorio: Meta no manda Authorization,
#    la autenticación de este endpoint es la firma X-Hub-Signature-256.
npx supabase functions deploy ingesta-whatsapp --no-verify-jwt
```

`SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` los inyecta Supabase solo — no hay que setearlos.

La URL pública queda en:

```
https://jrygtluycndiyvrxjmib.supabase.co/functions/v1/ingesta-whatsapp
```

## Registrar en Meta

Recién **después** de que la función esté desplegada y respondiendo, en Meta for Developers →
WhatsApp → Configuración → Webhooks:

- **Callback URL:** la URL de arriba
- **Verify Token:** el mismo string de `WA_VERIFY_TOKEN`
- **Campos suscritos:** `messages` (incluye `statuses`)

Meta dispara un `GET` al guardar. Si el token no coincide, responde 403 y Meta muestra el error.

## Probar sin Meta

```bash
# Verificación (debería devolver "prueba123")
curl "https://jrygtluycndiyvrxjmib.supabase.co/functions/v1/ingesta-whatsapp?hub.mode=subscribe&hub.verify_token=<TU_TOKEN>&hub.challenge=prueba123"

# POST sin firma (debería devolver 401)
curl -X POST "https://jrygtluycndiyvrxjmib.supabase.co/functions/v1/ingesta-whatsapp" \
  -H 'Content-Type: application/json' -d '{}'
```

Para un POST **con** firma válida hay que calcular el HMAC del cuerpo con el App Secret. Lo más
simple es mandarse un mensaje real al número desde otro WhatsApp y mirar los logs:

```bash
npx supabase functions logs ingesta-whatsapp
```

## Límites conocidos, a propósito

- **No maneja `message_template_status_update`** ni otros campos de webhook que no sean
  `messages`. Si se suscriben más campos en Meta, hay que extender `procesar()`.
- **No descarga los adjuntos.** Una imagen queda como `[image]` en `contenido` con el payload
  completo en `payload_raw` — bajar el media requiere una llamada aparte a la Graph API con el
  token del número, que es trabajo del Sprint siguiente.
- **`guardarEstado` busca por `externo_id` sin `conversation_id`.** El índice único es parcial y
  compuesto; para los acuses alcanza porque el id de mensaje de Meta es único global, pero es una
  búsqueda sin índice dedicado. Si se vuelve lenta, agregar índice en una migración nueva.
