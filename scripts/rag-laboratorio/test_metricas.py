"""Pruebas de metricas.py: sin red y sin costo. Correr: python -m unittest test_metricas -v"""
import unittest

import metricas as m


def fila(top, esperados, sin_respuesta=False):
    return {"top": top, "esperados": esperados, "sin_respuesta": sin_respuesta}


class Recalculo(unittest.TestCase):
    def test_parsea_el_top(self):
        self.assertEqual(m.parsear_top(["a-b 0.63", "c 0.5"]), [("a-b", 0.63), ("c", 0.5)])

    def test_recall_y_mrr_con_k(self):
        filas = [fila(["x 0.9", "a 0.8"], ["a"]), fila(["a 0.9", "x 0.8"], ["a"])]
        k1 = m.recalcular_recuperacion(filas, 1)
        k2 = m.recalcular_recuperacion(filas, 2)
        self.assertEqual(k1["recall"], 0.5)
        self.assertEqual(k2["recall"], 1.0)
        self.assertAlmostEqual(k2["mrr"], 0.75)  # (1/2 + 1) / 2

    def test_umbral_rechaza_con_y_sin_respuesta(self):
        filas = [fila(["a 0.35"], ["a"]), fila(["z 0.60"], [], sin_respuesta=True)]
        r = m.recalcular_recuperacion(filas, 1, umbral=0.5)
        self.assertEqual(r["recall"], 0.0)                         # el acierto de 0.35 se perdió
        self.assertEqual(r["con_respuesta_rechazadas_por_error"], 1.0)
        self.assertEqual(r["sin_respuesta_rechazadas"], 0.0)       # el «sin respuesta» llega a 0.60

    def test_sin_umbral_no_rechaza_nada(self):
        r = m.recalcular_recuperacion([fila(["z 0.1"], [], True)], 1)
        self.assertEqual(r["sin_respuesta_rechazadas"], 0.0)


class ContraLoMedido(unittest.TestCase):
    """Las corridas guardadas deben reproducir las cifras que ya están en el README."""

    def test_recuperacion_guardada(self):
        corrida = [c for t, _, c in m.listar_corridas() if t == "recuperacion"][-1]
        r = m.recalcular_recuperacion(corrida["filas"], corrida["k"])
        self.assertAlmostEqual(r["mrr"], corrida["metricas"]["mrr"], places=3)
        self.assertAlmostEqual(r["recall"], corrida["metricas"]["recallK"], places=3)

    def test_fidelidad_v2_repeticion(self):
        corrida = next(c for _, n, c in m.listar_corridas() if "v2-repeticion" in n)
        r = m.resumen_fidelidad(corrida)
        self.assertEqual((r["respondidas"], r["con_algun_sin_respaldo"], r["con_dato_sin_respaldo"]), (36, 8, 3))


if __name__ == "__main__":
    unittest.main()
