"""Herramienta consultar_catalogo: tours publicados de Turismo Colombia (sección 9.8 de la guía).

Solo lectura. Usa la anon key pública de Supabase y la policy
"tours: lectura pública de publicados", la misma que usa el sitio del tenant sin login.
Nunca usa la service_role key: si la RLS no deja leer algo, esta herramienta tampoco.
"""
import json
import os
import urllib.parse
import urllib.request

LIMITE = 8

HERRAMIENTA = {
    "name": "consultar_catalogo",
    "description": (
        "Consulta los tours publicados del catálogo de Turismo Colombia: nombre, resumen, "
        "ciudad, región, categoría, precio desde, duración, dificultad y cupo. "
        "Úsala siempre que pregunten por tours, experiencias, precios o disponibilidad en "
        "Colombia; nunca inventes un tour ni un precio. Todos los filtros son opcionales; "
        "sin filtros devuelve los destacados primero."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "lugar": {
                "type": "string",
                "description": "Ciudad o región, por ejemplo 'Medellín', 'Cartagena' o 'Antioquia'.",
            },
            "busqueda": {
                "type": "string",
                "description": "Palabra a buscar en el nombre del tour, por ejemplo 'café' o 'Guatapé'.",
            },
            "precio_max": {
                "type": "number",
                "description": "Precio máximo por persona, en la moneda del tour (normalmente COP).",
            },
        },
    },
}


def _texto(campo):
    """Los textos del catálogo son jsonb {es, en}: se devuelve el español."""
    if isinstance(campo, dict):
        return campo.get("es") or campo.get("en")
    return campo


def consultar_catalogo(lugar=None, busqueda=None, precio_max=None):
    url = os.environ.get("SUPABASE_URL")
    clave = os.environ.get("SUPABASE_ANON_KEY")
    if not url or not clave:
        return {"error": "Falta SUPABASE_URL o SUPABASE_ANON_KEY en el .env del chatbot."}

    params = {
        "select": "name,summary,city,region,category,price_from,currency,"
                  "duration_label,difficulty,min_pax,max_pax",
        "status": "eq.published",
        "order": "featured.desc,sort_order.asc.nullslast",
        "limit": str(LIMITE),
    }
    if lugar:
        lugar = lugar.replace(",", " ").replace("(", " ").replace(")", " ").strip()
        params["or"] = f"(city.ilike.*{lugar}*,region.ilike.*{lugar}*)"
    if busqueda:
        params["name->>es"] = f"ilike.*{busqueda}*"
    if precio_max is not None:
        params["price_from"] = f"lte.{precio_max}"

    peticion = urllib.request.Request(
        f"{url}/rest/v1/tours?{urllib.parse.urlencode(params)}",
        headers={"apikey": clave, "Authorization": f"Bearer {clave}"},
    )
    with urllib.request.urlopen(peticion, timeout=15) as respuesta:
        filas = json.load(respuesta)

    return {
        "tours": [
            {
                "nombre": _texto(f["name"]),
                "resumen": _texto(f["summary"]),
                "ciudad": f["city"],
                "region": f["region"],
                "categoria": f["category"],
                "precio_desde": f["price_from"],
                "moneda": f["currency"],
                "duracion": _texto(f["duration_label"]),
                "dificultad": f["difficulty"],
                "cupo": [f["min_pax"], f["max_pax"]],
            }
            for f in filas
        ],
        "nota": f"Máximo {LIMITE} resultados." if len(filas) == LIMITE else None,
    }
