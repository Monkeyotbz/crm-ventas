"""Cálculos del laboratorio RAG: puros, sin Streamlit, sin red, sin llamadas a Claude.

Viven aparte de app.py para poder probarlos (test_metricas.py) y para que el día que haga falta en el
CRM (un tablero de plataforma) se puedan reutilizar sin arrastrar la interfaz.
"""
import json
import re
from pathlib import Path

CARPETA_RESULTADOS = Path(__file__).resolve().parents[2] / "agentes-sdk" / "validacion-rag" / "resultados"
RE_TOP = re.compile(r"^(?P<slug>\S+) (?P<sim>-?\d+(?:\.\d+)?)$")


def listar_corridas(carpeta=CARPETA_RESULTADOS):
    """Devuelve [(tipo, nombre_archivo, contenido)] ordenado de la más vieja a la más nueva."""
    salida = []
    for ruta in sorted(Path(carpeta).glob("*.json")):
        m = re.match(r"^[\d-]+_(recuperacion|fidelidad)_", ruta.name)
        if not m:
            continue
        salida.append((m.group(1), ruta.name, json.loads(ruta.read_text(encoding="utf-8"))))
    return salida


def parsear_top(top):
    """['slug 0.63', ...] -> [(slug, 0.63), ...] conservando el orden."""
    salida = []
    for texto in top:
        m = RE_TOP.match(texto.strip())
        if m:
            salida.append((m["slug"], float(m["sim"])))
    return salida


def recalcular_recuperacion(filas, k, umbral=None):
    """Recall@k, MRR y abstención hipotética con otro k (<= los que guardó la corrida) y otro umbral.

    Solo cuentan las preguntas con respuesta esperada para recall y MRR. `umbral` descarta los
    resultados cuya similitud queda debajo: simula un `min_similitud` sin volver a llamar a Voyage.
    La abstención hipotética es el % de preguntas SIN respuesta que el umbral rechazaría del todo,
    contra el % de preguntas CON respuesta que rechazaría por error.
    """
    con = [f for f in filas if not f.get("sin_respuesta") and f.get("esperados")]
    sin = [f for f in filas if f.get("sin_respuesta")]
    aciertos, rr = 0, 0.0
    for f in con:
        vistos = [(s, v) for s, v in parsear_top(f["top"])[:k] if umbral is None or v >= umbral]
        pos = next((i + 1 for i, (s, _) in enumerate(vistos) if s in f["esperados"]), None)
        if pos:
            aciertos += 1
            rr += 1.0 / pos

    def rechazada(f):
        return umbral is not None and not any(v >= umbral for _, v in parsear_top(f["top"])[:k])

    return {
        "n_con_respuesta": len(con),
        "n_sin_respuesta": len(sin),
        "recall": aciertos / len(con) if con else None,
        "mrr": rr / len(con) if con else None,
        "sin_respuesta_rechazadas": sum(rechazada(f) for f in sin) / len(sin) if sin else None,
        "con_respuesta_rechazadas_por_error": sum(rechazada(f) for f in con) / len(con) if con else None,
    }


def barrido_umbral(filas, k, umbrales):
    return [{"umbral": u, **recalcular_recuperacion(filas, k, u)} for u in umbrales]


def resumen_fidelidad(corrida):
    """Una fila comparable por corrida de fidelidad. Las corridas sin juez no tienen sin_respaldo."""
    filas = corrida["filas"]
    juzgadas = [f for f in filas if "sin_respaldo" in f and not f.get("juez_error")]
    respondidas = [f for f in juzgadas if f.get("responde")]

    def con_dato(f):
        return any((a.get("gravedad") == "dato") for a in f["sin_respaldo"] if isinstance(a, dict))

    return {
        "etiqueta": corrida["etiqueta"],
        "modelo": corrida["modelo"],
        "reglas_ok": f"{corrida['correctas']}/{corrida['total']}",
        "juzgadas": len(juzgadas),
        "respondidas": len(respondidas),
        "con_algun_sin_respaldo": sum(1 for f in respondidas if f["sin_respaldo"]),
        "con_dato_sin_respaldo": sum(1 for f in respondidas if con_dato(f)),
        "abstenciones": sum(1 for f in juzgadas if not f.get("responde")),
        "costo_usd": corrida.get("costo_usd_estimado"),
    }
