"""Chatbot de consola con Claude · v2.0 · 2026-10-16 (agrega tool use, sección 9 de la guía)"""
import json
import urllib.error
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

from catalogo import HERRAMIENTA, consultar_catalogo

# ---------- Configuración ----------
MODELO = "claude-haiku-5-5"
MAX_TOKENS = 1024
MAX_VUELTAS = 5  # tope de llamadas seguidas a herramientas por cada mensaje
SYSTEM_PROMPT = (
    "Eres un asistente que responde en español de Colombia, "
    "de forma clara y breve. Si no sabes algo, dilo. "
    "Para tours, experiencias, precios o disponibilidad en Colombia, consulta el catálogo "
    "con la herramienta y responde solo con lo que devuelva: no inventes tours ni precios."
)
HERRAMIENTAS = [HERRAMIENTA]
FUNCIONES = {"consultar_catalogo": consultar_catalogo}
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

def ejecutar_herramienta(bloque):
    """Corre la función que Claude pidió y arma el tool_result. Claude nunca toca la base."""
    print(f"\n  [consultando {bloque.name} {json.dumps(bloque.input, ensure_ascii=False)}]", flush=True)
    try:
        datos = FUNCIONES[bloque.name](**bloque.input)
        es_error = "error" in datos
    except (urllib.error.URLError, TimeoutError) as e:
        datos, es_error = {"error": f"No se pudo consultar el catálogo: {e}"}, True
    return {
        "type": "tool_result",
        "tool_use_id": bloque.id,
        "content": json.dumps(datos, ensure_ascii=False),
        "is_error": es_error,
    }

def responder(client, historial):
    """Envía el historial, imprime en vivo y resuelve las herramientas que Claude pida.

    Agrega al historial cada turno del asistente y cada tool_result.
    Devuelve (tokens_entrada, tokens_salida) sumando todas las llamadas.
    """
    entrada = salida = 0
    print("Claude: ", end="", flush=True)
    for _ in range(MAX_VUELTAS):
        with client.messages.stream(
            model=MODELO,
            max_tokens=MAX_TOKENS,
            system=SYSTEM_PROMPT,
            tools=HERRAMIENTAS,
            messages=historial,
        ) as stream:
            for pedazo in stream.text_stream:
                print(pedazo, end="", flush=True)
            final = stream.get_final_message()
        entrada += final.usage.input_tokens
        salida += final.usage.output_tokens
        historial.append({"role": "assistant", "content": [b.to_dict() for b in final.content]})

        if final.stop_reason != "tool_use":
            break
        resultados = [ejecutar_herramienta(b) for b in final.content if b.type == "tool_use"]
        historial.append({"role": "user", "content": resultados})
    else:
        print("\n[Se alcanzó el tope de consultas seguidas; pregunta de nuevo más concreto]")
    print()
    if final.stop_reason == "max_tokens":
        print("[Respuesta cortada: sube MAX_TOKENS si necesitas más]")
    return entrada, salida

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
        inicio = len(historial)  # si algo falla, se deshace todo el turno (incluidas herramientas)
        historial.append({"role": "user", "content": texto})
        try:
            entrada, salida = responder(client, historial)
        except AuthenticationError:
            print("\n[Error] API key inválida. Revisa el archivo .env.")
            del historial[inicio:]
            break
        except RateLimitError:
            print("\n[Error] Límite de uso alcanzado. Espera un momento o revisa tu saldo.")
            del historial[inicio:]
            continue
        except APIConnectionError:
            print("\n[Error] Sin conexión con la API. Revisa tu internet.")
            del historial[inicio:]
            continue
        except APIStatusError as e:
            print(f"\n[Error {e.status_code}] {e.message}")
            del historial[inicio:]
            continue

        tokens_entrada += entrada
        tokens_salida += salida

if __name__ == "__main__":
    main()
