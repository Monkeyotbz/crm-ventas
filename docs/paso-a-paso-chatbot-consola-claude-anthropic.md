# Paso a paso para la creación del chatbot consola Claude-Anthropic

Guía paso a paso para construir desde cero un chatbot que corre en la terminal, conversa con Claude a través de la API de Anthropic, recuerda la conversación, muestra la respuesta mientras se escribe y lleva la cuenta de tokens y costo. Es el proyecto del Nivel 1 de LLMs del Pensum AI Engineer.

**Novedad en v2.0:** se agregó la sección 9: para qué sirve este chat, qué no hace, cómo se conecta con WhatsApp y el CRM, y cómo Claude consulta el catálogo con una herramienta (tool use).

- Lenguaje: **Python 3.10+**
- SDK: **anthropic**
- Tiempo: **3–5 horas**
- Costo: **centavos de dólar**
- Resultado: **chatbot.py de ~120 líneas**



## 1. Qué vamos a construir

Un programa en Python que abres desde la terminal. Escribes una pregunta, Claude responde en vivo (palabra por palabra) y la conversación continúa recordando lo que se dijo antes. Al final verás cuántos tokens usaste y cuánto costó.

### Así se verá en la terminal

```python
$ python chatbot.py
Chatbot con Claude · escribe /ayuda para ver comandos

Tú: ¿Qué es un ERP en una frase?
Claude: Un ERP es un sistema que integra en una sola plataforma
las áreas de una empresa: contabilidad, compras, inventario y ventas.

Tú: Dame dos ejemplos usados en Colombia
Claude: Siesa y SAP Business One son dos de los más usados...

Tú: /tokens
Entrada: 412 · Salida: 96 · Costo aprox.: US$0.0001

Tú: /salir
Conversación terminada.
```

### Funciones que tendrá

F1**Conversación con memoria**Recuerda los mensajes anteriores dentro de la sesión.

F2**Respuesta en vivo**El texto aparece mientras Claude lo genera (streaming).

F3**Personalidad configurable**Un system prompt define tono, idioma y reglas.

F4**Comandos**`/salir` `/limpiar` `/tokens` `/guardar` `/ayuda`

F5**Control de costos**Cuenta tokens de entrada y salida y estima el costo.

F6**Manejo de errores**No se cae si falla la red, la llave o hay límite de uso.

## 2. Lenguajes y tecnologías

El chatbot se escribe en Python, pero en el proceso tocas otros lenguajes y formatos. Esta tabla dice qué hace cada uno y cuánto necesitas saber.

| Lenguaje / tecnología | Para qué se usa aquí | Nivel necesario |
| --- | --- | --- |
| **Python 3.10+** | Todo el programa: bucle de conversación, llamadas a la API, comandos, archivos. | Variables, listas, diccionarios, funciones, `while`, `try/except` |
| **Terminal** (Bash, zsh o PowerShell) | Crear carpetas, entorno virtual, instalar paquetes y correr el programa. | Unos 8 comandos básicos |
| **JSON** | Formato de los mensajes que se envían a Claude y de las conversaciones guardadas. | Leer objetos y listas |
| **HTTP / REST** | Lo que pasa por debajo: el SDK hace peticiones HTTPS a la API. No lo programas, pero ayuda a entender los errores. | Conceptual: petición, respuesta, código 401/429/500 |
| **.env** | Archivo donde guardas la API key fuera del código. | Una línea `CLAVE=valor` |
| **Git** | Control de versiones y publicación en GitHub. | `init`, `add`, `commit`, `push` |
| **Markdown** | El README que explica tu proyecto. | Títulos, listas y bloques de código |

### Paquetes de Python

OBLIGATORIO**anthropic**SDK oficial. Se encarga de autenticar, enviar mensajes, hacer streaming y lanzar errores claros.

OBLIGATORIO**python-dotenv**Carga la API key desde el archivo `.env` para no escribirla en el código.

## 3. Conceptos clave

Seis ideas que necesitas tener claras antes de escribir código.

3.1**API key**Contraseña que identifica tu cuenta ante la API. Quien la tenga puede gastar tu saldo: nunca se sube a GitHub ni se comparte.

3.2**Tokens**Pedazos de texto en los que el modelo divide lo que lee y escribe (en español, una palabra son 1 o 2 tokens). Se cobra por tokens de entrada y de salida.

3.3**Mensajes y roles**Cada mensaje tiene un rol: `user` (tú) o `assistant` (Claude). Deben alternarse, empezando por `user`.

3.4**Historial**La API no recuerda nada entre llamadas. La "memoria" es tu programa enviando toda la conversación en cada petición. Por eso el costo crece con cada turno.

3.5**System prompt**Instrucciones fijas que definen cómo se comporta el asistente: idioma, tono, reglas y límites. Va aparte de los mensajes.

3.6**Streaming**En vez de esperar la respuesta completa, la recibes por partes y la imprimes a medida que llega. Se siente más rápido.

### Modelos disponibles

| Modelo | ID para la API | Entrada / salida (US$ por millón de tokens) | Cuándo usarlo |
| --- | --- | --- | --- |
| **Claude Haiku 5.5** | `claude-haiku-5-5` | desde 0.10 / 0.50 | **Recomendado para este proyecto:** rápido y barato |
| **Claude Sonnet 5.5** | `claude-sonnet-5-5` | 2 / 10 | Mejor calidad para tareas de trabajo |
| **Claude Opus 5.5** | `claude-opus-5-5` | 4 / 20 | Tareas complejas |

Precios a octubre de 2026. Cambian con el tiempo; confírmalos en la página de precios antes de calcular costos para un cliente.

## 4. Cómo fluye un mensaje

Esto pasa cada vez que escribes algo y presionas Enter.

**Tú escribes**`input()` lee la línea

**Historial**se agrega como rol `user`

**SDK**envía system + historial por HTTPS

**Claude**genera la respuesta token a token

**Streaming**se imprime en la terminal

**Guardar**respuesta al historial y suma de tokens

## 5. Construcción paso a paso

Son 16 pasos en 5 fases. Cada fase termina con algo que funciona. No pases a la siguiente sin que la anterior corra bien.

FASE 1

### Preparar el entorno

⏱ 30–45 min

Objetivo: tener Python, un proyecto aislado, el SDK instalado y la API key guardada de forma segura.

#### 1. Instalar Python 3.10 o superior

Descárgalo de python.org. En Windows, marca la casilla "Add Python to PATH" durante la instalación. Luego verifica la versión:

TerminalCopiar

```python
python --version
# en macOS o Linux puede ser:
python3 --version
```

- Ves Python 3.10 o un número mayor

#### 2. Crear la carpeta y el entorno virtual

El entorno virtual (`.venv`) aísla los paquetes de este proyecto del resto de tu computador.

TerminalCopiar

```python
mkdir chatbot-claude
cd chatbot-claude
python -m venv .venv

# Activar en macOS / Linux:
source .venv/bin/activate

# Activar en Windows (PowerShell):
.venv\Scripts\Activate.ps1
```

- La terminal muestra `(.venv)` al inicio de la línea

#### 3. Instalar los paquetes

TerminalCopiar

```python
pip install anthropic python-dotenv
pip freeze > requirements.txt
```

`requirements.txt` deja registradas las versiones, para que cualquiera pueda instalar lo mismo con `pip install -r requirements.txt`.

#### 4. Crear la cuenta y la API key

1. Entra a la Claude Console (platform.claude.com) y crea tu cuenta.
2. Carga un saldo pequeño en **Billing** (5 dólares alcanzan para todo este proyecto).
3. Ve a **API Keys → Create Key**, ponle un nombre como `chatbot-consola`.
4. Copia la llave en ese momento: después no se vuelve a mostrar completa.
5. En **Limits**, configura un límite de gasto mensual bajo.

#### 5. Guardar la llave en .env y protegerla

Crea dos archivos en la carpeta del proyecto:

.envCopiar

```python
ANTHROPIC_API_KEY=sk-ant-pega-aqui-tu-llave
```

.gitignoreCopiar

```python
.env
.venv/
__pycache__/
conversaciones/
```

**Importante:** el `.gitignore` evita que la llave termine en GitHub. Si una llave se publica por error, revócala de inmediato en la Console y crea otra.

FASE 2

### Primera llamada a Claude

⏱ 20–30 min

Objetivo: comprobar que la llave funciona y entender la estructura de una petición y una respuesta.

#### 6. Escribir hola.py

hola.pyCopiar

```python
from anthropic import Anthropic
from dotenv import load_dotenv

load_dotenv()            # lee ANTHROPIC_API_KEY desde .env
client = Anthropic()     # el SDK toma la llave del entorno

respuesta = client.messages.create(
    model="claude-haiku-5-5",
    max_tokens=300,
    messages=[
        {"role": "user", "content": "Hola, preséntate en una frase."}
    ],
)

print(respuesta.content[0].text)
print(respuesta.usage)
```

TerminalCopiar

```python
python hola.py
```

- Ves el saludo de Claude y una línea con `input_tokens` y `output_tokens`

#### 7. Entender las piezas de la petición

| Parámetro | Qué hace |
| --- | --- |
| `model` | Qué modelo responde. |
| `max_tokens` | Tope de tokens de la respuesta. Si se alcanza, la respuesta se corta. |
| `messages` | Lista con la conversación: diccionarios con `role` y `content`. |
| `system` | (Opcional) Instrucciones fijas de comportamiento. Lo usamos en la Fase 3. |
| `respuesta.content[0].text` | El texto que escribió Claude. |
| `respuesta.usage` | Tokens consumidos: base para calcular el costo. |
| `respuesta.stop_reason` | Por qué paró: `end_turn` (terminó) o `max_tokens` (se cortó). |

FASE 3

### Convertirlo en chatbot

⏱ 45–60 min

Objetivo: conversación continua, con memoria, personalidad y respuesta en vivo.

#### 8. Bucle de conversación con historial

Crea `chatbot.py`. El bucle `while True` lee tu mensaje, lo agrega al historial, envía todo el historial y guarda la respuesta.

chatbot.py · versión 1Copiar

```python
from anthropic import Anthropic
from dotenv import load_dotenv

load_dotenv()
client = Anthropic()
historial = []

while True:
    texto = input("\nTú: ").strip()
    if texto == "/salir":
        break
    if not texto:
        continue

    historial.append({"role": "user", "content": texto})

    respuesta = client.messages.create(
        model="claude-haiku-5-5",
        max_tokens=1024,
        messages=historial,
    )
    texto_claude = respuesta.content[0].text
    print(f"Claude: {texto_claude}")

    historial.append({"role": "assistant", "content": texto_claude})
```

- Pregunta tu nombre en un mensaje y en el siguiente pregunta "¿cómo me llamo?": debe recordarlo

#### 9. Agregar el system prompt

Define la personalidad una sola vez y pásala en cada llamada con el parámetro `system`.

chatbot.py · fragmentoCopiar

```python
SYSTEM_PROMPT = (
    "Eres un asistente que responde en español de Colombia, "
    "de forma clara y breve. Si no sabes algo, dilo."
)

respuesta = client.messages.create(
    model="claude-haiku-5-5",
    max_tokens=1024,
    system=SYSTEM_PROMPT,
    messages=historial,
)
```

**Prueba:** cambia el system prompt a "Eres un asesor comercial de una constructora en Medellín" y compara las respuestas.

#### 10. Respuesta en vivo con streaming

Reemplaza `messages.create` por `messages.stream`. El texto se imprime a medida que llega y al final se obtiene el mensaje completo con el uso de tokens.

chatbot.py · fragmentoCopiar

```python
print("Claude: ", end="", flush=True)

with client.messages.stream(
    model="claude-haiku-5-5",
    max_tokens=1024,
    system=SYSTEM_PROMPT,
    messages=historial,
) as stream:
    for pedazo in stream.text_stream:
        print(pedazo, end="", flush=True)
    final = stream.get_final_message()

print()
texto_claude = final.content[0].text
historial.append({"role": "assistant", "content": texto_claude})
```

- El texto aparece poco a poco en vez de todo de golpe

FASE 4

### Hacerlo robusto

⏱ 45–60 min

Objetivo: que no se caiga ante errores, que tenga comandos útiles y que muestre cuánto cuesta.

#### 11. Manejar errores de la API

El SDK lanza errores específicos. Atrápalos para mostrar un mensaje claro y seguir conversando. Si la llamada falla, quita el último mensaje del historial para que los roles sigan alternándose.

| Error | Código | Qué significa |
| --- | --- | --- |
| `AuthenticationError` | 401 | Llave inválida, mal copiada o revocada |
| `RateLimitError` | 429 | Demasiadas peticiones o límite de gasto alcanzado |
| `APIConnectionError` | — | Sin internet o no se pudo conectar |
| `APIStatusError` | 4xx / 5xx | Cualquier otro error de la API (incluye fallas del servidor) |

**Nota:** el SDK ya reintenta automáticamente algunos errores temporales antes de lanzar la excepción.

#### 12. Agregar comandos

| Comando | Acción |
| --- | --- |
| `/ayuda` | Muestra la lista de comandos |
| `/limpiar` | Borra el historial y empieza una conversación nueva |
| `/tokens` | Muestra tokens usados y costo aproximado |
| `/guardar` | Guarda la conversación en un archivo JSON |
| `/salir` | Termina el programa (también Ctrl+C) |

#### 13. Contar tokens y estimar el costo

Después de cada respuesta suma `final.usage.input_tokens` y `final.usage.output_tokens`. El costo es tokens ÷ 1.000.000 × precio.

FórmulaCopiar

```python
costo = (tokens_entrada / 1_000_000) * PRECIO_ENTRADA \
      + (tokens_salida  / 1_000_000) * PRECIO_SALIDA
```

Fíjate: los tokens de entrada crecen en cada turno porque se reenvía todo el historial. Usa `/limpiar` cuando cambies de tema.

FASE 5

### Terminar y publicar

⏱ 30–45 min

Objetivo: guardar conversaciones, documentar el proyecto y subirlo a GitHub como parte de tu portafolio.

#### 14. Guardar conversaciones en JSON

El comando `/guardar` escribe el historial en `conversaciones/AAAA-MM-DD_HH-MM.json`. Ese formato es el mismo que espera la API, así que luego podrías recargar una conversación.

#### 15. Escribir el README

README.mdCopiar

```python
# Chatbot de consola con Claude

Chatbot en la terminal con memoria, streaming, comandos y conteo de costo.

## Requisitos
- Python 3.10+
- Una API key de Anthropic

## Instalación
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # y pega tu llave

## Uso
python chatbot.py

Comandos: /ayuda, /limpiar, /tokens, /guardar, /salir
```

Crea también `.env.example` con `ANTHROPIC_API_KEY=` vacío, para que otros sepan qué variable configurar.

#### 16. Versionar con Git y subir a GitHub

TerminalCopiar

```python
git init
git add .
git status              # confirma que .env NO aparece
git commit -m "Chatbot de consola con Claude v1.0"
git branch -M main
git remote add origin https://github.com/TU-USUARIO/chatbot-claude.git
git push -u origin main
```

- `.env` no aparece en GitHub
- El README explica cómo correrlo
- Proyecto del Nivel 1 de LLMs completado

## 6. Código final completo

### Estructura de carpetas

```python
chatbot-claude/
├── .venv/              # entorno virtual (no se sube)
├── conversaciones/     # JSON guardados (no se sube)
├── .env                # tu API key (no se sube)
├── .env.example
├── .gitignore
├── chatbot.py
├── hola.py
├── requirements.txt
└── README.md
```

### chatbot.py

chatbot.py · v1.0Copiar

```python
"""Chatbot de consola con Claude · v1.0 · 2026-10-10"""
import json
from datetime import datetime
from pathlib import Path

from anthropic import (
    Anthropic,
    APIConnectionError,
    APIStatusError,
    AuthenticationError,
    RateLimitError,
)
from dotenv import load_dotenv

# ---------- Configuración ----------
MODELO = "claude-haiku-5-5"
MAX_TOKENS = 1024
SYSTEM_PROMPT = (
    "Eres un asistente que responde en español de Colombia, "
    "de forma clara y breve. Si no sabes algo, dilo."
)
# US$ por millón de tokens (verifica en la página de precios)
PRECIO_ENTRADA = 0.10
PRECIO_SALIDA = 0.50
CARPETA = Path("conversaciones")

AYUDA = """Comandos:
  /ayuda    muestra esta lista
  /limpiar  empieza una conversación nueva
  /tokens   tokens usados y costo aproximado
  /guardar  guarda la conversación en JSON
  /salir    termina el programa"""

def costo(entrada, salida):
    return entrada / 1_000_000 * PRECIO_ENTRADA + salida / 1_000_000 * PRECIO_SALIDA

def guardar(historial):
    CARPETA.mkdir(exist_ok=True)
    archivo = CARPETA / f"{datetime.now():%Y-%m-%d_%H-%M}.json"
    archivo.write_text(json.dumps(historial, ensure_ascii=False, indent=2), encoding="utf-8")
    return archivo

def responder(client, historial):
    """Envía el historial, imprime en vivo y devuelve el mensaje final."""
    print("Claude: ", end="", flush=True)
    with client.messages.stream(
        model=MODELO,
        max_tokens=MAX_TOKENS,
        system=SYSTEM_PROMPT,
        messages=historial,
    ) as stream:
        for pedazo in stream.text_stream:
            print(pedazo, end="", flush=True)
        final = stream.get_final_message()
    print()
    if final.stop_reason == "max_tokens":
        print("[Respuesta cortada: sube MAX_TOKENS si necesitas más]")
    return final

def main():
    load_dotenv()
    client = Anthropic()  # lee ANTHROPIC_API_KEY
    historial = []
    tokens_entrada = 0
    tokens_salida = 0

    print("Chatbot con Claude · escribe /ayuda para ver comandos")

    while True:
        try:
            texto = input("\nTú: ").strip()
        except (KeyboardInterrupt, EOFError):
            print("\nConversación terminada.")
            break

        if not texto:
            continue

        # ---------- Comandos ----------
        if texto == "/salir":
            print("Conversación terminada.")
            break
        if texto == "/ayuda":
            print(AYUDA)
            continue
        if texto == "/limpiar":
            historial.clear()
            print("Historial borrado. Nueva conversación.")
            continue
        if texto == "/tokens":
            total = costo(tokens_entrada, tokens_salida)
            print(f"Entrada: {tokens_entrada} · Salida: {tokens_salida} · Costo aprox.: US${total:.4f}")
            continue
        if texto == "/guardar":
            if historial:
                print(f"Guardado en {guardar(historial)}")
            else:
                print("No hay nada que guardar todavía.")
            continue

        # ---------- Conversación ----------
        historial.append({"role": "user", "content": texto})
        try:
            final = responder(client, historial)
        except AuthenticationError:
            print("\n[Error] API key inválida. Revisa el archivo .env.")
            historial.pop()
            break
        except RateLimitError:
            print("\n[Error] Límite de uso alcanzado. Espera un momento o revisa tu saldo.")
            historial.pop()
            continue
        except APIConnectionError:
            print("\n[Error] Sin conexión con la API. Revisa tu internet.")
            historial.pop()
            continue
        except APIStatusError as e:
            print(f"\n[Error {e.status_code}] {e.message}")
            historial.pop()
            continue

        historial.append({"role": "assistant", "content": final.content[0].text})
        tokens_entrada += final.usage.input_tokens
        tokens_salida += final.usage.output_tokens

if __name__ == "__main__":
    main()
```

## 7. Errores comunes y solución

| Lo que ves | Causa probable | Solución |
| --- | --- | --- |
| `ModuleNotFoundError: No module named 'anthropic'` | El entorno virtual no está activo o no instalaste el paquete | Activa `.venv` y corre `pip install anthropic python-dotenv` |
| `'python' no se reconoce como comando` | Python no está en el PATH (Windows) | Reinstala marcando "Add Python to PATH" o usa `py` |
| Error de autenticación (401) | Llave mal copiada, con espacios o revocada | Revisa `.env`, sin comillas ni espacios; crea otra llave si es necesario |
| Error 429 o de saldo | Sin créditos o límite de gasto alcanzado | Revisa Billing y Limits en la Console |
| Error 400 sobre roles | Dos mensajes seguidos con el mismo rol en el historial | Asegúrate de quitar el mensaje del usuario cuando falla una llamada (`historial.pop()`) |
| Error 404 del modelo | ID de modelo mal escrito o retirado | Copia el ID exacto de la página de modelos |
| La respuesta se corta | `max_tokens` muy bajo | Sube `MAX_TOKENS` |
| En PowerShell no deja activar el entorno | Política de ejecución de scripts | `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` |

## 8. Siguientes pasos y fuentes

Con el chatbot funcionando, estas mejoras te llevan al Nivel 2 de LLMs y Agentes del pensum:

8.1**Tool use**Darle herramientas: consultar el clima, calcular o leer un archivo. Es el primer paso hacia un agente.

8.2**Salidas estructuradas**Pedir JSON validado con Pydantic, por ejemplo para extraer datos de una factura.

8.3**Leer documentos**Enviar un PDF y conversar sobre él; luego pasar a RAG con varios documentos.

8.4**Prompt caching**Cachear el system prompt largo para reducir costo y latencia.

8.5**Interfaz web**Llevar el mismo chatbot a una página con Streamlit o a una API con FastAPI.

8.6**WhatsApp**Conectarlo a WhatsApp Business: base del asistente de preventa inmobiliaria (caso R1.1).

### Fuentes oficiales

- SDK de Python: `platform.claude.com/docs/en/cli-sdks-libraries/sdks/python`
- Modelos y precios: `platform.claude.com/docs/en/models/overview`
- Documentación general: `platform.claude.com/docs`

## 9. Para qué sirve este chat y cómo se conecta con WhatsApp y el CRM

Esta sección responde cuatro preguntas: qué es realmente el chat de consola, qué puedes hacer con él, qué **no** hace, y cómo se conecta después con WhatsApp y un CRM de ventas.

### 9.1 Qué es realmente el chat de consola

El chat de consola tiene tres piezas. Entenderlas por separado es lo que permite reutilizarlo después en WhatsApp.

| Pieza | Qué hace | En el código | ¿Se reutiliza en WhatsApp? |
| --- | --- | --- | --- |
| **La puerta** | Recibe lo que escribe la persona y muestra la respuesta. | `input()` y `print()` | **No.** Se cambia por WhatsApp. |
| **El cerebro** | Guarda el historial, aplica el system prompt, llama a Claude, cuenta tokens. | `historial`, `SYSTEM_PROMPT`, `responder()` | **Sí.** Es lo que construyes y afinas aquí. |
| **Claude** | Genera el texto de la respuesta. | `client.messages.stream(...)` | **Sí.** Es la misma API. |

**Quien responde es Claude, no la consola.** La consola es solo una pantalla de entrada y salida para probar el cerebro sin depender de nada más.

### 9.2 Cuál es el objetivo de construirlo

El objetivo no es tener un chatbot de terminal para clientes. Es construir y afinar el cerebro en el entorno más simple posible, antes de conectarlo a canales más complejos.

9.2.1**Probar system prompts**Cambias una línea (tono, reglas, rol) y ves el efecto al instante. Ejemplo: de "asesor comercial de una constructora" a "soporte de un ERP".

9.2.2**Entender la memoria**Ver con tus propios ojos que la API no recuerda nada y que tú reenvías el historial. Es la base de cualquier conversación por WhatsApp.

9.2.3**Medir costos**Con `/tokens` calculas cuánto cuesta una conversación típica y puedes cotizar por volumen a un cliente.

9.2.4**Demos en vivo**En una reunión abres la consola y muestras cómo respondería el bot, incluso con los documentos del cliente (cuando agregues RAG).

9.2.5**Asistente interno**Una herramienta para ti y Gabo: redactar propuestas, resumir correos, explicar errores de código.

9.2.6**Cimiento del Nivel 2 y 3**Sobre este mismo código se agregan RAG (documentos), herramientas (consultar el ERP) y finalmente WhatsApp.

### 9.3 Lo que este chat NO hace por sí solo

| No hace | Por qué | Qué lo resuelve |
| --- | --- | --- |
| Recibir mensajes de WhatsApp | Un programa de consola no está escuchando internet. | Un servidor web (FastAPI) con un *webhook* |
| Conectarse al CRM | No sabe qué es un lead, un deal ni una etapa de ventas. | Código que llame a la API del CRM |
| Recordar a cada cliente | Su historial vive en una lista en memoria y se pierde al cerrar. | Base de datos con un historial por número de teléfono (Supabase) |
| Funcionar solo, 24/7 | Corre mientras tengas la terminal abierta. | Un servidor desplegado en la nube |

### 9.4 La lógica: cómo se conecta con WhatsApp

El cerebro no "le pasa información a WhatsApp" por iniciativa propia: **reacciona a lo que llega**. Hay dos formas de que arranque una conversación, y en ambas el ciclo es el mismo: alguien escribe, el cerebro genera una respuesta con Claude, se envía por WhatsApp, y cuando la persona contesta, el ciclo vuelve a empezar.

FLUJO A · EL CLIENTE ESCRIBE PRIMERO (el caso más común)

**Cliente**escribe por WhatsApp: "Hola, ¿tienen apartamentos de 2 alcobas?"

**Meta**recibe el mensaje y lo envía a tu servidor (webhook)

**Cerebro**carga el historial de ese número desde la base de datos

**Claude**genera la respuesta con system prompt + historial (+ RAG)

**WhatsApp**tu servidor envía la respuesta al cliente

**CRM**se guarda el mensaje y se actualiza el lead

FLUJO B · EL BOT ESCRIBE PRIMERO (seguimiento de leads)

**CRM**detecta un lead sin respuesta hace 2 días

**Cerebro**pide a Claude redactar un mensaje de seguimiento

**WhatsApp**envía el mensaje al cliente

**Cliente**responde por WhatsApp

**Cerebro**recibe la respuesta, la suma al historial y pide a Claude la siguiente respuesta

**Se repite**hasta que cierre, agende visita o pase a un asesor humano

**Ojo con la dirección del flujo.** La consola no le entrega nada a WhatsApp, y WhatsApp tampoco "devuelve" la respuesta a la consola. En producción la consola desaparece: el servidor ejecuta el mismo cerebro cada vez que llega un mensaje. Además, WhatsApp Business solo permite escribir primero (fuera de la ventana de conversación activa) con plantillas de mensaje aprobadas previamente por Meta, así que el Flujo B requiere ese paso.

### 9.5 Ejemplo del ciclo completo

```python
[Cliente · WhatsApp]  Hola, vi el proyecto Torre Laureles. ¿Cuánto cuesta el tipo B?
        ↓ webhook
[Servidor]  historial del número +57 3xx... → vacío (primer mensaje)
[Cerebro]   busca en documentos (RAG) → ficha del tipo B
[Claude]    "¡Hola! El apartamento tipo B tiene 68 m² y 2 alcobas, desde
             $XXX millones [ficha_torre_laureles.pdf]. ¿Quieres agendar una visita?"
        ↓
[Cliente · WhatsApp]  Sí, ¿el sábado?
        ↓ webhook
[Servidor]  historial del número → ya tiene los dos mensajes anteriores
[Claude]    entiende que "el sábado" es la visita al tipo B
[CRM]       lead: etapa "Visita solicitada" · interés: tipo B · Torre Laureles
```

Fíjate en la lógica del historial: en el segundo mensaje el cliente solo escribió "Sí, ¿el sábado?". Claude lo entiende porque el servidor le reenvía toda la conversación anterior. Es exactamente el mismo mecanismo de `historial` que ya construiste en la consola.

### 9.6 Qué se reutiliza y qué se agrega

| Elemento | En la consola (Nivel 1) | En WhatsApp + CRM (producción) |
| --- | --- | --- |
| Entrada | `input()` | Webhook de Meta → FastAPI |
| Salida | `print()` | API de WhatsApp Business (enviar mensaje) |
| Historial | Lista `historial` en memoria | Tabla en Supabase, un historial por teléfono |
| System prompt | Constante en `chatbot.py` | **El mismo** (aquí lo afinas) |
| Llamada a Claude | `messages.stream` | **La misma** (sin streaming visible, se envía el texto completo) |
| Documentos | No tiene | RAG con pgvector (Nivel 2) |
| CRM | No tiene | Guardar mensajes, crear lead, cambiar etapa |
| Control de costo | `/tokens` | Registro de tokens por cliente y por mes |
| Errores | Mensaje en pantalla | Reintentos, alertas y mensaje de respaldo al cliente |

### 9.7 Ruta sugerida de construcción

| Cuándo (sugerido) | Nivel | Qué construyes | Resultado |
| --- | --- | --- | --- |
| Octubre 2026 | Nivel 1 | Chat de consola (esta guía) | Cerebro básico con memoria, system prompt y costos |
| Octubre 2026 | Nivel 2 | RAG con documentos reales de un cliente | Respuestas con datos verificables y citas |
| Noviembre 2026 | Nivel 3 | FastAPI + WhatsApp + Supabase + CRM | Piloto con un cliente real, en un horario limitado |
| Diciembre 2026 | Ajuste | Medir conversaciones, costos y errores; ajustar el system prompt | Versión estable para ofrecer a más clientes |

Las fechas son una sugerencia de ritmo, no un compromiso: dependen del tiempo que le dediques y de lo rápido que Meta apruebe la cuenta de WhatsApp Business.

### 9.8 Tool use: cuando Claude consulta el catálogo

Un **tool** (herramienta) es una función de tu código que Claude puede pedir que se ejecute. Sirve para datos vivos y estructurados: el catálogo de unidades, precios y disponibilidad que vende el agente. La respuesta final se redacta **después** de consultar el catálogo, no antes.

FLUJO C · CLAUDE CONSULTA EL CATÁLOGO ANTES DE RESPONDER

**Cliente**"¿Hay tipo B disponible en Torre Laureles?"

**Claude**decide que necesita datos y pide usar `consultar_catalogo`

**Tu código**ejecuta la consulta en Supabase o en el ERP

**Resultado**se devuelve a Claude (`tool_result`)

**Claude**redacta la respuesta con los datos reales

**WhatsApp + CRM**se envía y se guarda el interés del lead

**Claude no toca el catálogo ni el ERP.** Solo pide usar la herramienta; tu código la ejecuta y le devuelve el resultado. Esa separación te da control: puedes limitar la herramienta a solo lectura y decidir qué datos expone.

### 9.9 RAG vs. herramienta

|  | RAG (Nivel 2) | Tool use |
| --- | --- | --- |
| **Qué consulta** | Texto de documentos | Datos estructurados en vivo |
| **Ejemplo** | Reglamento de PH, ficha técnica | Precio y disponibilidad del tipo B hoy |
| **Dónde vive** | Base vectorial | Base de datos, catálogo o ERP |
| **Quién decide consultar** | Tu código, siempre, en cada pregunta | Claude, solo cuando lo necesita |

En un asistente de preventa se usan juntos: RAG para explicar el proyecto y la herramienta para confirmar qué hay disponible y a qué precio.

### 9.10 Cómo se ve en código

chatbot.py · fragmento (idea)Copiar

```python
HERRAMIENTAS = [{
    "name": "consultar_catalogo",
    "description": "Consulta unidades disponibles, áreas y precios de un proyecto inmobiliario.",
    "input_schema": {
        "type": "object",
        "properties": {
            "proyecto": {"type": "string"},
            "tipo": {"type": "string"},
        },
        "required": ["proyecto"],
    },
}]

respuesta = client.messages.create(
    model="claude-haiku-5-5", max_tokens=1024,
    system=SYSTEM_PROMPT, tools=HERRAMIENTAS, messages=historial,
)

if respuesta.stop_reason == "tool_use":
    bloque = next(b for b in respuesta.content if b.type == "tool_use")
    datos = consultar_catalogo(**bloque.input)   # tu función: Supabase, ERP, etc.

    historial.append({"role": "assistant", "content": respuesta.content})
    historial.append({"role": "user", "content": [
        {"type": "tool_result", "tool_use_id": bloque.id,
         "content": json.dumps(datos, ensure_ascii=False)}
    ]})
    # Se llama a Claude otra vez con el historial: ahora redacta la respuesta final
```

Es una versión resumida para entender la lógica. La guía del Nivel 2 de agentes lo construye completo, con varias herramientas y manejo de errores.

Chatbot de consola con Claude · v2.0 · 2026-10-10 · Proyecto del Nivel 1 de LLMs del Pensum AI Engineer

## Evidencia de ejecución — Nivel 1 de LLMs

Ejercicio construido y verificado el **16 oct 2026** dentro del repo de candyCRM (`crm-ventas`).

| Qué | Dónde |
| --- | --- |
| Commit | [`ffd5048` — Chatbot de consola con Claude para CRM ventas](https://github.com/Monkeyotbz/crm-ventas/commit/ffd50485237cc651f1c4e2ffa76ce2247e431f49) |
| Rama | `juanse-candycrm-ventas` |
| Código | [`agentes-sdk/chatbot-claude/`](../agentes-sdk/chatbot-claude/) |

Verificado con llamadas reales a la API (modelo `claude-haiku-5-5`): `hola.py` responde y reporta tokens; `chatbot.py` recuerda el contexto (dijo "Te llamas Ana" tras presentarse), `/tokens` calcula el costo, `/guardar` escribe el JSON en `conversaciones/` y `/salir` cierra. `.env`, `.venv` y `conversaciones/` están ignorados por Git: la llave no se sube.

## Evidencia de ejecución — Sección 9 (tool use)

Construido y verificado el **16 oct 2026**.

| Qué | Dónde |
| --- | --- |
| Commit | [`1b3d6a0` — Tool use en el chatbot de consola: consulta del catálogo de turismo (sección 9)](https://github.com/Monkeyotbz/crm-ventas/commit/1b3d6a06e3511e495884815b8488c2244ad2e99c) |
| Rama | `juanse-candycrm-ventas`, después `main` |
| Código | [`catalogo.py`](../agentes-sdk/chatbot-claude/catalogo.py) y [`chatbot.py`](../agentes-sdk/chatbot-claude/chatbot.py) v2.0 |

Cómo se aplicó cada parte de la sección en candyCRM:

- **9.8–9.10 (tool use) — construido.** `consultar_catalogo` lee los tours publicados de Turismo
  Colombia en Supabase, solo lectura, con la anon key pública y la policy
  `tours: lectura pública de publicados` (nunca la `service_role`). Claude pide la herramienta;
  `chatbot.py` la ejecuta y le devuelve el `tool_result`.
- **9.4–9.6 (WhatsApp + historial + CRM) — ya existía, no se rehízo.** La guía propone FastAPI;
  candyCRM ya lo resuelve con Edge Functions de Supabase (`ingesta-whatsapp`, `envio-whatsapp`,
  Router, tablas `conversations`/`messages`).
- **Conectar este cerebro a WhatsApp real — no se hizo a propósito.** Es el candidato [6]
  (agentes conversacionales) de `docs/DECISIONES.md`, que sigue APLAZADO.

Verificado con llamadas reales (`claude-haiku-5-5`, US$0.0017 la conversación de prueba):

- "¿Qué tours tienen en Medellín?" → consultó con `lugar: Medellín` y listó los 7 tours reales.
- "¿Y cuánto cuesta el de la Comuna 13?" → respondió COP 80.000 **sin volver a consultar**
  (lo tenía en el historial).
- "¿Cuánto cuesta el de Guatapé?" → consultó con `busqueda: Guatapé` y dijo que no tiene precio
  publicado, sin inventarlo.
- Con la base caída, la consulta falló, Claude recibió el error y lo dijo en vez de inventar datos.

Hallazgo: casi ningún tour publicado tiene `price_from`. No es un bug del chatbot; es un dato que
el tenant Turismo Colombia tiene que completar.
