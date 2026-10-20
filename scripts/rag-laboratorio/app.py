"""Laboratorio RAG de candyCRM — panel LOCAL para el ingeniero (no es para el cliente).

Lee las corridas guardadas en agentes-sdk/validacion-rag/resultados/ y recalcula, sin gastar un token,
qué pasaría con otro k o con otro umbral. No llama a Claude, a Voyage ni a la base: por eso vive en
scripts/ y no en agentes-sdk/. Correr:  streamlit run app.py
"""
import pandas as pd
import streamlit as st

import metricas as m

st.set_page_config(page_title="Laboratorio RAG · candyCRM", layout="wide")
st.title("Laboratorio RAG · candyCRM")
st.caption("Solo para el ingeniero. Lee corridas guardadas: nada de lo que muevas aquí gasta saldo ni toca producción.")

corridas = m.listar_corridas()
recup = [(n, c) for t, n, c in corridas if t == "recuperacion"]
fidel = [(n, c) for t, n, c in corridas if t == "fidelidad"]

tab_rec, tab_fid, tab_preg = st.tabs(["Recuperación", "Fidelidad", "Pregunta por pregunta"])

with tab_rec:
    if not recup:
        st.warning("No hay corridas de recuperación en resultados/.")
    else:
        nombre = st.selectbox("Corrida", [n for n, _ in recup], index=len(recup) - 1)
        corrida = dict(recup)[nombre]
        k_max = int(corrida["k"])
        c1, c2 = st.columns(2)
        k = c1.slider("k (fragmentos que se traen)", 1, k_max, k_max)
        umbral = c2.slider("Umbral de similitud (0 = sin umbral)", 0.0, 0.8, 0.0, 0.01)
        r = m.recalcular_recuperacion(corrida["filas"], k, umbral or None)

        a, b, c, d = st.columns(4)
        a.metric("Recall@k", f"{r['recall']:.1%}")
        b.metric("MRR", f"{r['mrr']:.3f}")
        c.metric("Con respuesta rechazadas por error", f"{r['con_respuesta_rechazadas_por_error']:.1%}")
        d.metric("Sin respuesta rechazadas (bien)", f"{r['sin_respuesta_rechazadas']:.1%}")
        st.caption(
            f"{r['n_con_respuesta']} preguntas con respuesta y {r['n_sin_respuesta']} sin respuesta. "
            "Un buen umbral subiría la última cifra sin subir la penúltima: en esta corrida no lo hace."
        )

        st.subheader("Barrido de umbral")
        tabla = pd.DataFrame(m.barrido_umbral(corrida["filas"], k, [round(x, 2) for x in [i / 100 for i in range(0, 80, 5)]]))
        st.line_chart(
            tabla.set_index("umbral")[["recall", "con_respuesta_rechazadas_por_error", "sin_respuesta_rechazadas"]],
        )
        st.caption("Las dos curvas de rechazo se separan poco: el umbral no distingue «no hay respuesta» de «pregunta vaga».")

        st.subheader("Medido por la corrida (tal cual lo guardó el evaluador)")
        st.json(corrida["metricas"])

with tab_fid:
    resumenes = [m.resumen_fidelidad(c) | {"archivo": n} for n, c in fidel]
    df = pd.DataFrame(resumenes)
    df["% con algún detalle sin respaldo"] = (df["con_algun_sin_respaldo"] / df["respondidas"].where(df["respondidas"] > 0)).map(
        lambda x: None if pd.isna(x) else f"{x:.0%}"
    )
    df["% con un DATO sin respaldo"] = (df["con_dato_sin_respaldo"] / df["respondidas"].where(df["respondidas"] > 0)).map(
        lambda x: None if pd.isna(x) else f"{x:.0%}"
    )
    st.dataframe(df.drop(columns=["modelo"]), width="stretch", hide_index=True)
    st.caption(
        "Corridas sin juez (juzgadas = 0) solo tienen las reglas objetivas. Las «abstenciones» incluyen las correctas: "
        "9 preguntas no tienen respuesta en el catálogo y lo correcto es abstenerse. "
        "La meta de 0 inventos NO se cumple; y v2 repetido muestra que una sola corrida no basta para comparar."
    )

with tab_preg:
    if recup:
        nombre = st.selectbox("Corrida de recuperación", [n for n, _ in recup], index=len(recup) - 1, key="pp")
        filas = pd.DataFrame(dict(recup)[nombre]["filas"])
        solo_malas = st.checkbox("Solo donde el tour esperado no quedó primero", value=True)
        vista = filas[filas["rango"].fillna(99) > 1] if solo_malas and "rango" in filas else filas
        st.dataframe(vista[["id", "tipo", "pregunta", "rango", "sim_top1", "esperados", "top"]], width="stretch", hide_index=True)
