# Chatbot de consola con Claude

Chatbot en la terminal con memoria, streaming, comandos y conteo de costo.
Ejercicio del Nivel 1 de LLMs de la Academia, construido dentro del repo de candyCRM
siguiendo [`docs/paso-a-paso-chatbot-consola-claude-anthropic.md`](../../docs/paso-a-paso-chatbot-consola-claude-anthropic.md).

## Requisitos
- Python 3.10+
- Una API key de Anthropic

## Instalación (PowerShell)
```
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
Copy-Item .env.example .env   # y pega tu llave
```

## Uso
```
.venv\Scripts\python hola.py      # comprueba que la llave funciona
.venv\Scripts\python chatbot.py   # el chatbot
```

Comandos: /ayuda, /limpiar, /tokens, /guardar, /salir

## Tool use: consulta del catálogo (sección 9.8–9.10 de la guía)

Desde la v2.0, Claude puede pedir la herramienta `consultar_catalogo` ([`catalogo.py`](catalogo.py)),
que lee los **tours publicados de Turismo Colombia** en Supabase. Pregúntale, por ejemplo,
"¿qué tours tienen en Medellín por menos de 200.000?".

- **Solo lectura, sin secretos:** usa la anon key pública y la policy
  `tours: lectura pública de publicados` — la misma que usa el sitio del tenant sin login. Nunca la
  `service_role`.
- **Claude no toca la base:** pide la herramienta, `chatbot.py` la ejecuta y le devuelve el
  `tool_result`. Si la consulta falla, Claude recibe el error y lo dice en vez de inventar precios.
- **Solo en consola.** Conectar este cerebro a WhatsApp real es el candidato [6] (agentes
  conversacionales) de `docs/DECISIONES.md`, que sigue **APLAZADO**: no se activa desde acá.

La llave vive solo en el `.env` de esta carpeta (ignorado por Git). `load_dotenv(override=True)`
hace que mande sobre cualquier `ANTHROPIC_API_KEY` del entorno o del `.env` de la raíz del CRM.
