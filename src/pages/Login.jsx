import { useState } from "react";
import { supabase, supabaseConfigured } from "../lib/supabase.js";

// Sin cambios de Sprint 0 — se movió tal cual desde App.jsx al separar el
// auth-gate para la bandeja (Sprint 1). Sigue en la paleta "night/neon",
// a propósito: no se migra a Candy + Aero en este cambio, ver src/index.css.
export default function Login() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("idle"); // idle | sending | sent | error

  async function handleSubmit(e) {
    e.preventDefault();
    if (!supabaseConfigured) {
      setStatus("error");
      return;
    }
    setStatus("sending");
    const { error } = await supabase.auth.signInWithOtp({ email });
    setStatus(error ? "error" : "sent");
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
          <button
            type="submit"
            disabled={status === "sending"}
            className="w-full rounded-lg bg-neon-cyan px-3 py-2 text-sm font-medium text-night-950 transition hover:bg-neon-cyan/90 disabled:opacity-50"
          >
            {status === "sending" ? "Enviando..." : "Enviar link de acceso"}
          </button>
        </form>

        {status === "sent" && (
          <p className="mt-4 text-sm text-neon-emerald">Revisá tu correo para el link de acceso.</p>
        )}
        {status === "error" && (
          <p className="mt-4 text-sm text-red-400">No se pudo enviar el link. Revisá la configuración.</p>
        )}
      </div>
    </div>
  );
}
