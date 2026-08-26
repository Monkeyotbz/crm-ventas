# Configurar el Webhook en Meta for Developers

> **Fuente de este documento:** convertido desde [`configurar-webhook-meta.html`](configurar-webhook-meta.html)
> (versión visual original, se conserva como snapshot de referencia — no se edita más, este `.md`
> es la copia de trabajo). Documento del 23 ago 2026.
>
> **Es un mapa de referencia, no una receta a seguir al pie de la letra.** Sirve para tener claro
> qué hace falta y en qué orden aproximado, pero el detalle exacto (nombres de campos del panel de
> Meta, qué falla primero, etc.) se ajusta con lo que encontremos al hacerlo de verdad — misma regla
> que ya aplica a los demás documentos de `docs/`.
>
> **Relación con los otros documentos:** es el detalle ejecutable del Paso 1.5 de
> [`guia-fases-1-2.md`](guia-fases-1-2.md) ("Edge Function de ingesta + normalización") y se
> corresponde con el candidato **[3] Normalización de mensajes por canal + deduplicación de
> contacto** en [`DECISIONES.md`](DECISIONES.md) — hoy **APLAZADO**, con condición de activación
> "proyecto Supabase real creado + arranque del Sprint 1.5". Este documento no cambia esa condición:
> es referencia para cuando llegue ese momento, no una señal para adelantarlo.
>
> ✅ **Corrección aplicada:** el original usaba "acero, ropa y tecnología" como ejemplo — se
> reemplaza acá por el caso real (Hellominus + futuros tenants-cliente), igual que en el resto de
> `docs/`.

## Resumen

Cómo conectar la Edge Function de ingesta con Meta for Developers para que los mensajes de WhatsApp
empiecen a llegar. Es trabajo de dos lados: el backend tiene que estar listo *antes* de entrar a
Meta.

- **Dónde:** developers.facebook.com
- **Quién lo ejecuta:** vos, con la cuenta de Meta Business
- **Tiempo:** 10–15 minutos si el backend ya está desplegado

## Antes de entrar a Meta

Si falta cualquiera de estos cuatro puntos, la verificación del webhook va a fallar apenas se
intente:

1. **App de tipo Business creada** en Meta for Developers, con el producto WhatsApp agregado.
2. **La Edge Function de ingesta ya desplegada**, con una URL pública HTTPS (ej.
   `https://tuproyecto.supabase.co/functions/v1/ingesta-whatsapp`). No sirve una URL local.
3. **Un Verify Token definido por vos** — cualquier cadena de texto que se invente, guardada como
   variable de entorno en la función (ej. `WA_VERIFY_TOKEN`). Meta lo va a pedir en el formulario y
   debe coincidir exacto con lo que la función espera.
4. **El número de teléfono ya registrado** en la Cloud API (el paso de vinculación anterior a este).

## Paso a paso en Meta for Developers

### 1 — Entrar a la app
`developers.facebook.com → Mis apps`. Iniciar sesión con la cuenta de Meta Business vinculada al
número, y seleccionar la app creada al dar de alta WhatsApp.

### 2 — Ir a WhatsApp → Configuración
En el menú lateral de la app, entrar al producto **WhatsApp** y luego a la pestaña **Configuration**.
Ahí vive la sección de Webhooks — no está en la configuración general de la app, es específica del
producto.

### 3 — Editar el Webhook
Sección "Webhook" → botón *Edit*. Aparecen dos campos vacíos: **Callback URL** y **Verify Token**. Es
la primera vez que se configuran si el número es nuevo.

### 4 — Pegar la Callback URL y el Verify Token
La **Callback URL** es la URL pública de la Edge Function. El **Verify Token** es la cadena
inventada en el prerrequisito 3 — debe ser idéntica, carácter por carácter, a la que la función
compara internamente.

> ⚠️ **El error más común acá:** un espacio de más al copiar el token, o usar un token distinto al
> que quedó en la variable de entorno de la función. Meta compara el valor exacto — no hay margen de
> error tipográfico.

### 5 — Verificar y guardar
Botón "Verify and Save". Al hacer clic, Meta le manda a la función una petición `GET` con tres
parámetros, para confirmar que el servidor es real y que el token coincide.

**Lo que Meta envía, y lo que la función debe responder:**

```
// Meta envía (GET):
?hub.mode=subscribe
&hub.verify_token=tu_token_inventado
&hub.challenge=1158201444

// La función debe responder, si el token coincide:
return new Response("1158201444", { status: 200 });
// texto plano, exactamente el valor de hub.challenge — nada más
```

> ✅ **Si todo salió bien:** el campo se pone en verde con la marca de verificado. Si falla, revisar
> primero que la función esté realmente desplegada (no en borrador) y que responda ese GET
> correctamente antes de reintentar.

### 6 — Suscribirse a los campos del webhook
Verificar la URL no basta — hay que decirle a Meta **qué tipo de eventos** mandar a esa URL. Aparece
una lista de campos; el mínimo indispensable es `messages`.

**Campos relevantes para este proyecto:**
- `messages` — obligatorio. Sin esto, ningún mensaje entrante llega, aunque la URL esté verificada.
- `message_template_status_update` — útil para saber cuándo Meta aprueba o rechaza una plantilla,
  sin revisar manualmente.
- `account_update` — avisa cambios en el estado de la cuenta (por ejemplo, restricciones).

### 7 — Confirmar la suscripción del número (WABA)
El webhook vive a nivel de la **app**, pero el número de teléfono tiene que estar suscrito a esa app
para que sus mensajes disparen el webhook. En cuentas nuevas suele quedar automático, pero si se
migró un número o se usó un flujo distinto, conviene confirmarlo explícitamente.

## Qué más tener en cuenta

Cosas que no aparecen en el formulario de Meta, pero que determinan si el webhook sigue funcionando
bien con el tiempo.

**Responder rápido, siempre.** La función debe devolver **200 OK en menos de 5 segundos**. Si se
procesa todo (guardar en base, correr el Router, generar respuesta) dentro del mismo webhook, hay
riesgo de que Meta declare timeout. La forma correcta: guardar el mensaje crudo de inmediato,
responder `200`, y procesar el resto de forma asíncrona.

**Verificar la firma de cada petición.** Cualquiera que descubra la URL podría mandar payloads
falsos si no se valida su origen. Meta firma cada petición con un header `X-Hub-Signature-256`,
calculado con el **App Secret**. La función debe recalcular esa firma y compararla antes de confiar
en el contenido.

**Idempotencia — Meta reenvía si no se confirma a tiempo.** Si la función tarda o falla, Meta
reintenta el mismo mensaje más de una vez. El índice único sobre `messages.externo_id` (ya
contemplado en el modelo de datos, vía `payload_raw`/dedupe) es lo que evita que el mismo mensaje se
guarde duplicado. **Nota (25 ago 2026): ya resuelto.** Cuando se
escribió este documento, `messages` no tenía `externo_id`. Hoy sí: la columna existe con un índice
único parcial sobre `(conversation_id, externo_id)`, aplicado en la migración
`20260825120848_doc48_p2_whatsapp_meta` y verificado contra la base — un segundo insert con el
mismo `externo_id` es rechazado.

**Un webhook, varios números (multi-tenant).** Meta permite un solo webhook por app. Si varios
tenants-cliente comparten la misma app de Meta, todos sus mensajes llegan al mismo endpoint — la
función tiene que leer el `phone_number_id` que viene en cada payload para saber a qué `tenant_id`
pertenece (mapeo número → tenant, ya anticipado en `docs/guia-fases-1-2.md`).

**Usar la herramienta de prueba antes de escribir código real.** En la misma sección de Webhooks,
Meta tiene un botón para **enviar un payload de prueba** a la URL sin necesidad de un mensaje real de
WhatsApp. Sirve para probar el parseo de la función antes de depender de que alguien escriba de
verdad.

**Dónde ver los fallos.** Si Meta no logra entregar un evento, queda registrado en la misma sección
de configuración del webhook, con el código de error. Revisarlo ahí es más rápido que adivinar desde
los logs de Supabase.

## Errores comunes

| Síntoma | Causa probable | Solución |
|---|---|---|
| "The URL couldn't be validated" | La función no está desplegada, responde con error, o el Verify Token no coincide exacto. | Probar la URL directo con `curl` simulando el GET de Meta antes de reintentar desde el panel. |
| Webhook verificado, pero no llegan mensajes | No se completó el Paso 6 (suscripción al campo `messages`), o el número no está vinculado a esta WABA. | Revisar "Webhook fields" y confirmar que `messages` tiene el toggle activado. |
| Meta desactivó el webhook solo | Demasiados fallos o timeouts consecutivos al entregar eventos. | Revisar el log de errores en la sección de Webhooks y confirmar que la función responde en menos de 5 segundos. |
| Mensajes duplicados en la base | Falta el índice único sobre `externo_id`, o Meta reintentó por timeout. | Confirmar el índice de idempotencia y revisar el tiempo de respuesta de la función. |

## Checklist final — el webhook está listo cuando...

- [ ] El campo de Callback URL aparece **verificado** en verde.
- [ ] El campo `messages` está **suscrito** en Webhook fields.
- [ ] Un mensaje de prueba enviado desde un celular real **aparece en la tabla `messages`** de Supabase.
- [ ] Un segundo mensaje del mismo número **no crea un contacto duplicado**.
- [ ] La función responde en **menos de 5 segundos**, confirmado revisando los logs.
