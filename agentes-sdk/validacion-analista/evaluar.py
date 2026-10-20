"""Banco de pruebas del Agente Analista [7b].

Pasa las conversaciones de conversaciones.json por el MISMO prompt que usa la
Edge Function (lo lee de supabase/functions/analista/index.ts, no de una copia)
y compara lo que responde contra lo esperado. No toca la base de datos.

Uso (desde esta carpeta, con el entorno del chatbot de consola):
    ../chatbot-claude/.venv/Scripts/python evaluar.py --etiqueta base
    ../chatbot-claude/.venv/Scripts/python evaluar.py --etiqueta v2 --solo E03,E04

Va en agentes-sdk/ y no en scripts/ porque llama a Claude (regla del laboratorio).
"""
import argparse
import json
import re
import time
from datetime import datetime
from pathlib import Path

from anthropic import Anthropic
from dotenv import load_dotenv

AQUI = Path(__file__).parent
FUNCION = AQUI.parent.parent / "supabase" / "functions" / "analista" / "index.ts"
RESULTADOS = AQUI / "resultados"

# US$ por millón de tokens. ESTIMADO, igual que en la función: verificar.
PRECIOS = {"claude-haiku-4-5-20251001": (1.0, 5.0), "claude-haiku-5-5": (0.1, 0.5)}

# Copia de TRAMOS y del esquema de la herramienta de index.ts. Si cambian allá,
# cambiar acá: el banco tiene que medir exactamente lo que corre en producción.
TRAMOS = {"decidido": (90, 100), "propuesta": (75, 89), "interes": (50, 74),
          "curiosidad": (25, 49), "sin_intencion": (0, 24)}

HERRAMIENTA = {
    "name": "registrar_analisis",
    "description": "Registra el análisis de la conversación para el vendedor.",
    "input_schema": {
        "type": "object",
        "properties": {
            "tramo": {"type": "string", "enum": list(TRAMOS),
                      "description": "Primero elige el tramo de la escala del score; después el número dentro de él."},
            "score": {"type": "integer", "minimum": 0, "maximum": 100},
            "sentimiento": {"type": "string", "enum": ["positivo", "neutro", "negativo"]},
            "resumen": {"type": "string", "description": "Máximo 2 frases."},
            "sugerencia": {"type": "string"},
            "presupuesto_extraido": {
                "type": ["string", "null"],
                "description": "Solo si el cliente lo dijo textualmente; si no, null.",
            },
            "proxima_accion_sugerida": {"type": "string"},
        },
        "required": ["tramo", "score", "sentimiento", "resumen", "sugerencia",
                     "presupuesto_extraido", "proxima_accion_sugerida"],
    },
}


def leer_prompt():
    """El system prompt tal como está en la función: una sola fuente de verdad."""
    texto = FUNCION.read_text(encoding="utf-8")
    m = re.search(r"const SYSTEM_PROMPT = `(.*?)`;", texto, re.S)
    if not m:
        raise SystemExit(f"No encontré SYSTEM_PROMPT en {FUNCION}")
    return m.group(1)


def armar_contenido(conv):
    """Igual que procesar() en index.ts: contexto + <conversacion> con Cliente/Equipo."""
    hilo = "\n".join(("Cliente: " if d == "in" else "Equipo: ") + t for d, t in conv["mensajes"])
    return conv["contexto"] + "\n<conversacion>\n" + hilo + "\n</conversacion>"


def calificar(conv, r):
    esp = conv["esperado"]
    ok_score = esp["score_min"] <= r["score"] <= esp["score_max"]
    ok_sent = r["sentimiento"] in esp["sentimiento"]
    pres = r.get("presupuesto_extraido")
    if esp["presupuesto"] is None:
        ok_pres = not pres  # si puso algo, lo inventó
    else:
        ok_pres = bool(pres) and esp["presupuesto"].lower() in pres.lower()
    return ok_score, ok_sent, ok_pres


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--etiqueta", default="base")
    p.add_argument("--modelo", default="claude-haiku-4-5-20251001")
    p.add_argument("--solo", default="", help="ids separados por coma")
    args = p.parse_args()

    load_dotenv(AQUI / ".env", override=True)
    client = Anthropic()
    prompt = leer_prompt()
    datos = json.loads((AQUI / "conversaciones.json").read_text(encoding="utf-8"))
    convs = datos["conversaciones"]
    if args.solo:
        ids = set(args.solo.split(","))
        convs = [c for c in convs if c["id"] in ids]

    filas, tin, tout = [], 0, 0
    for c in convs:
        t0 = time.time()
        resp = client.messages.create(
            model=args.modelo, max_tokens=700, system=prompt,
            tools=[HERRAMIENTA], tool_choice={"type": "tool", "name": "registrar_analisis"},
            messages=[{"role": "user", "content": armar_contenido(c)}],
        )
        r = dict(next(b.input for b in resp.content if b.type == "tool_use"))
        # Igual que la función: manda el tramo; el número se lleva a su borde si cae afuera.
        lo, hi = TRAMOS[r["tramo"]]
        r["score_crudo"] = r["score"]
        r["score"] = max(lo, min(hi, round(r["score"])))
        tin += resp.usage.input_tokens
        tout += resp.usage.output_tokens
        ok = calificar(c, r)
        filas.append({"id": c["id"], "grupo": c["grupo"], "titulo": c["titulo"],
                      "esperado": c["esperado"], "obtenido": r,
                      "ok_score": ok[0], "ok_sentimiento": ok[1], "ok_presupuesto": ok[2],
                      "segundos": round(time.time() - t0, 1)})
        marca = "".join("✓" if x else "✗" for x in ok)
        print(f"{c['id']}  {marca}  score {r['score']:>3} [{r['tramo']}] (esperado {c['esperado']['score_min']}-{c['esperado']['score_max']})"
              f"  {r['sentimiento']:<8}  presup: {r.get('presupuesto_extraido')}")

    n = len(filas)
    pin, pout = PRECIOS.get(args.modelo, (0, 0))
    resumen = {
        "etiqueta": args.etiqueta, "modelo": args.modelo, "fecha": datetime.now().isoformat(timespec="seconds"),
        "conversaciones": n,
        "aciertos_score": sum(f["ok_score"] for f in filas),
        "aciertos_sentimiento": sum(f["ok_sentimiento"] for f in filas),
        "aciertos_presupuesto": sum(f["ok_presupuesto"] for f in filas),
        "tokens_entrada": tin, "tokens_salida": tout,
        "costo_usd_estimado": round(tin / 1e6 * pin + tout / 1e6 * pout, 4),
    }
    print(f"\nScore en rango: {resumen['aciertos_score']}/{n} · Sentimiento: {resumen['aciertos_sentimiento']}/{n}"
          f" · Presupuesto: {resumen['aciertos_presupuesto']}/{n} · {tin}→{tout} tokens · ~US${resumen['costo_usd_estimado']}")

    RESULTADOS.mkdir(exist_ok=True)
    salida = RESULTADOS / f"{datetime.now():%Y-%m-%d_%H-%M}_{args.etiqueta}.json"
    salida.write_text(json.dumps({"resumen": resumen, "filas": filas}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Guardado en {salida}")


if __name__ == "__main__":
    main()
