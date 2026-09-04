import { useEffect, useState } from "react";
import { supabase, supabaseConfigured } from "./lib/supabase.js";
import Login from "./pages/Login.jsx";
import Bandeja from "./pages/Bandeja.jsx";

// Sprint 1: se agrega el auth-gate que Sprint 0 no necesitaba (solo existía
// el login). Sin sesión → Login; con sesión → la bandeja unificada.
export default function App() {
  const [sesion, setSesion] = useState(undefined); // undefined = todavía cargando

  useEffect(() => {
    if (!supabaseConfigured) {
      setSesion(null);
      return;
    }

    supabase.auth.getSession().then(({ data }) => setSesion(data.session));

    const { data: suscripcion } = supabase.auth.onAuthStateChange((_evento, nuevaSesion) => {
      setSesion(nuevaSesion);
    });

    return () => suscripcion.subscription.unsubscribe();
  }, []);

  if (!supabaseConfigured) return <Login />;
  if (sesion === undefined) return null; // evita el parpadeo login→bandeja mientras carga
  return sesion ? <Bandeja /> : <Login />;
}
