import { useState } from "react";
import { supabase, supabaseConfigured } from "../lib/supabase.js";

// Modo por defecto: contraseña, no magic link. El link mágico manda un correo
// en CADA login — con el servicio de correo que trae Supabase por defecto
// (pensado para pruebas, no para uso real) eso pega contra un límite muy bajo
// de envíos por hora que no se puede subir desde el panel, solo con SMTP
// propio (ver supabase/functions/envio-whatsapp/README.md para el mismo tipo
// de límite del lado de WhatsApp). Login con contraseña no manda ningún
// correo, así que no depende de eso. El magic link queda como alternativa
// para quien todavía no tiene contraseña seteada.
//
// Sigue en la paleta "night/neon" de Sprint 0 — no se migra a Candy + Aero
// en este cambio, ver src/index.css.
export default function Login() {
  const [modo, setModo] = useState("password"); // password | magic-link
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("idle"); // idle | sending | sent | error
  const [error, setError] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    if (!supabaseConfigured) {
      setStatus("error");
      return;
    }
    setStatus("sending");
    setError("");

    if (modo === "password") {
      const { error: err } = await supabase.auth.signInWithPassword({ email, password });
      if (err) {
        setStatus("error");
        setError(err.message === "Invalid login credentials" ? "Correo o contraseña incorrectos." : err.message);
      } else {
        setStatus("idle"); // el auth-gate de App.jsx cambia de pantalla solo
      }
      return;
    }

    // emailRedirectTo explícito: sin esto, Supabase manda el link de vuelta
    // a lo que tenga guardado como "Site URL" en su panel — que no
    // necesariamente coincide con dónde está corriendo la app ahora mismo
    // (local en un puerto, producción en otro dominio después). Así el link
    // siempre apunta a donde el usuario efectivamente está.
    const { error: err } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    });
    if (err) {
      setStatus("error");
      setError(err.message);
    } else {
      setStatus("sent");
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border border-night-700 bg-night-900 p-8">
        <h1 className="font-display text-2xl font-semibold text-white">CRM Ventas</h1>
        <p className="mt-1 text-sm text-slate-400">Hellominus</p>

        {!supabaseConfigured && (
          <p className="mt-6 rounded-lg border border-neon-violet/30 bg-neon-violet/10 p-3 text-sm text-slate-300">
            Falta configurar <code className="text-neon-violet">VITE_SUPABASE_URL</code> y{" "}
            <code className="text-neon-violet">VITE_SUPABASE_ANON_KEY</code> (ver .env.example).
          </p>
        )}

        <form onSubmit={handleSubmit} className="mt-6 space-y-3">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="tu@correo.com"
            className="w-full rounded-lg border border-night-600 bg-night-800 px-3 py-2 text-sm text-white outline-none focus:border-neon-cyan"
          />
          {modo === "password" && (
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Contraseña"
              className="w-full rounded-lg border border-night-600 bg-night-800 px-3 py-2 text-sm text-white outline-none focus:border-neon-cyan"
            />
          )}
          <button
            type="submit"
            disabled={status === "sending"}
            className="w-full rounded-lg bg-neon-cyan px-3 py-2 text-sm font-medium text-night-950 transition hover:bg-neon-cyan/90 disabled:opacity-50"
          >
            {status === "sending" ? "Un momento..." : modo === "password" ? "Iniciar sesión" : "Enviar link de acceso"}
          </button>
        </form>

        <button
          type="button"
          onClick={() => {
            setModo(modo === "password" ? "magic-link" : "password");
            setStatus("idle");
            setError("");
          }}
          className="mt-3 text-xs text-slate-400 underline decoration-dotted hover:text-slate-300"
        >
          {modo === "password" ? "Prefiero un link por correo" : "Prefiero usar mi contraseña"}
        </button>

        {status === "sent" && (
          <p className="mt-4 text-sm text-neon-emerald">Revisá tu correo para el link de acceso.</p>
        )}
        {status === "error" && (
          <p className="mt-4 text-sm text-red-400">{error || "No se pudo iniciar sesión."}</p>
        )}
      </div>
    </div>
  );
}
