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
    load_dotenv(override=True)
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
