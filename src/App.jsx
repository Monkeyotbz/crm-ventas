import { useEffect, useState } from "react";
import { supabase, supabaseConfigured } from "./lib/supabase.js";
import Login from "./pages/Login.jsx";
import NuevaContrasena from "./pages/NuevaContrasena.jsx";
import PreparandoEspacio from "./pages/PreparandoEspacio.jsx";
import Bandeja from "./pages/Bandeja.jsx";

// Auth-gate. Sin sesión → Login; con sesión → la bandeja unificada. Dos
// desvíos sobre eso:
//
//   PASSWORD_RECOVERY  el enlace de "restablecer contraseña" abre sesión y
//                      dispara este evento. Sin interceptarlo, la persona caería
//                      directo en la bandeja sin poder cambiar la clave. Se la
//                      manda a NuevaContrasena hasta que termine.
//
//   sin tenant_id      recién registrado: el trigger ya creó el espacio pero el
//                      token todavía no trae el claim (ver PreparandoEspacio).
export default function App() {
  const [sesion, setSesion] = useState(undefined); // undefined = todavía cargando
  const [recuperando, setRecuperando] = useState(false);

  useEffect(() => {
    if (!supabaseConfigured) {
      setSesion(null);
      return;
    }

    supabase.auth.getSession().then(({ data }) => setSesion(data.session));

    const { data: suscripcion } = supabase.auth.onAuthStateChange((evento, nuevaSesion) => {
      if (evento === "PASSWORD_RECOVERY") setRecuperando(true);
      setSesion(nuevaSesion);
    });

    return () => suscripcion.subscription.unsubscribe();
  }, []);

  if (!supabaseConfigured) return <Login />;
  if (sesion === undefined) return null; // evita el parpadeo login→bandeja mientras carga

  if (recuperando) {
    return <NuevaContrasena onListo={() => setRecuperando(false)} />;
  }
  if (!sesion) return <Login />;

  // El tenant_id viaja en app_metadata del JWT (nunca en user_metadata, que el
  // usuario sí podría editar). Si no está, la sesión es de alguien que se acaba
  // de registrar y todavía no tiene el token nuevo.
  if (!sesion.user?.app_metadata?.tenant_id) {
    return <PreparandoEspacio />;
  }

  return <Bandeja />;
}
