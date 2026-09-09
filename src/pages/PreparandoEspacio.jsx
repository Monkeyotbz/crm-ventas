import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase.js";
import MarcoAcceso from "../components/MarcoAcceso.jsx";

// Hueco entre "me registré" y "puedo usar la app": el trigger handle_new_user
// (migración 20260909120000) ya creó el tenant y escribió tenant_id en
// app_metadata, pero el token que devolvió signUp se emitió ANTES de eso, así
// que todavía no trae el claim. current_tenant_id() lee null y la bandeja se
// vería vacía.
//
// Con confirmación de correo activada este estado casi no se ve: el token que
// importa es el que se emite al confirmar, y para entonces el trigger ya
// corrió. Sirve sobre todo para el caso de confirmación desactivada, y como
// red si el correo se confirma en otra pestaña.
//
// La cura es pedir un token nuevo. Un reintento y, si igual no aparece, se
// ofrece salir — no se deja a nadie mirando un spinner para siempre.
export default function PreparandoEspacio() {
  const [falló, setFalló] = useState(false);

  useEffect(() => {
    let vivo = true;

    (async () => {
      for (let intento = 0; intento < 3 && vivo; intento++) {
        const { data } = await supabase.auth.refreshSession();
        if (data?.session?.user?.app_metadata?.tenant_id) return; // App.jsx re-renderiza solo
        await new Promise((r) => setTimeout(r, 1500));
      }
      if (vivo) setFalló(true);
    })();

    return () => {
      vivo = false;
    };
  }, []);

  return (
    <MarcoAcceso>
      {!falló ? (
        <div className="text-center">
          <h1 className="font-candy-display text-xl font-extrabold text-candy-tinta">
            Preparando tu espacio…
          </h1>
          <p className="mt-1 text-[12.5px] text-candy-tinta-media">Un segundo.</p>
        </div>
      ) : (
        <div className="text-center">
          <h1 className="font-candy-display text-xl font-extrabold text-candy-tinta">Casi listo</h1>
          <p className="mt-1 text-[12.5px] leading-relaxed text-candy-tinta-media">
            Tu espacio se creó, pero la sesión no terminó de actualizarse. Cerrá sesión y volvé a
            entrar.
          </p>
          <button
            type="button"
            onClick={() => supabase.auth.signOut()}
            className="mt-6 w-full rounded-full px-4 py-3.5 text-[14px] font-bold text-white shadow-[0_10px_24px_rgba(255,92,168,0.32)]"
            style={{ background: "linear-gradient(135deg, #ff5ca8, #b98bff)" }}
          >
            Cerrar sesión
          </button>
        </div>
      )}
    </MarcoAcceso>
  );
}
