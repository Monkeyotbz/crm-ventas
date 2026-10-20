# Laboratorio RAG (panel local para el ingeniero)

Panel de Streamlit para **experimentar con el RAG sin gastar saldo**: mueve `k` y el umbral de similitud y
mira al instante qué pasa con recall@k, MRR y con las preguntas que no tienen respuesta. También compara las
corridas de fidelidad (prompt v1 contra v2). **No es para el cliente** y no es parte del CRM.

Vive en `scripts/` y no en `agentes-sdk/` porque **no llama a Claude, a Voyage ni a la base**: solo lee las
corridas guardadas en `agentes-sdk/validacion-rag/resultados/`. Los cálculos están en `metricas.py`, sin
Streamlit, para poder reutilizarlos después en un tablero de plataforma.

## Uso (Windows, desde esta carpeta)

```
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
.venv\Scripts\streamlit run app.py
python -m unittest test_metricas -v      # sin red y sin costo
```

No necesita `.env` ni ninguna llave. Gabo lo corre igual desde su copia del repo: cada uno ve lo mismo
porque las corridas están en git.

## Qué se puede y qué no

- **Se puede:** recalcular con un `k` menor o igual al de la corrida (la corrida guardó los 6 mejores) y con
  cualquier umbral. Eso responde «¿cambia algo si traigo 4 en vez de 6?» sin llamar a Voyage.
- **No se puede:** probar otro modelo de embeddings, otro prompt o fragmentos distintos. Eso exige una corrida
  nueva con `scripts/rag/evaluar-recuperacion.mjs` o `agentes-sdk/validacion-rag/evaluar_fidelidad.py`
  (esta última cuesta ≈ US$0,6 con juez), y su resultado aparece aquí en cuanto se guarda.
- **Cuidado al comparar fidelidad:** una sola corrida no sirve para mejoras pequeñas (mismo prompt dio 11 % y
  8 %). Repetir 3 veces o más.

## Cómo accede Gabo, por etapas

1. **Ahora:** local en cada computador. Cero riesgo, nada expuesto.
2. **Compartido en línea:** detrás de Cloudflare Access con solo los dos correos. Esconder un botón en el CRM
   no protege nada: la protección debe estar en el Streamlit.
3. **Si algún día lee datos reales de producción** (`rag_consultas` de otros tenants): **nunca con
   `service_role`**. Por una función SQL de solo lectura que compruebe `is_platform_admin()`, y eso es una
   migración nueva que aplica el usuario.
