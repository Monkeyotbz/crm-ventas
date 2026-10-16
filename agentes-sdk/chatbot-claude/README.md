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

La llave vive solo en el `.env` de esta carpeta (ignorado por Git). `load_dotenv(override=True)`
hace que mande sobre cualquier `ANTHROPIC_API_KEY` del entorno o del `.env` de la raíz del CRM.
