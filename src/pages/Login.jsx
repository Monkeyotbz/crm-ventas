import { useState } from "react";
import { supabase, supabaseConfigured } from "../lib/supabase.js";
import MarcoAcceso from "../components/MarcoAcceso.jsx";

// Pantalla de acceso — Candy + Aero (ver src/index.css y design/CandyInbox.dc.html).
// Reemplaza a la versión "night/neon" de Sprint 0, que venía de un template
// genérico y no tenía nada de la identidad de candyCRM.
//
// Tres vistas en un solo componente, sin router: la app todavía es un
// auth-gate (App.jsx) y no un árbol de rutas, así que el modo vive en estado
// local. "entrar" es el default.
//
//   entrar     → email + contraseña. No manda ningún correo.
//   registro   → crea la cuenta Y su espacio de trabajo. El alta del tenant la
//                hace un trigger en la base (migración 20260909120000): acá solo
//                se recoge el nombre del espacio y se llama a signUp.
//   recuperar  → manda el enlace de "restablecer contraseña". El que vuelve por
//                ese enlace lo atiende App.jsx (evento PASSWORD_RECOVERY) →
//                NuevaContrasena.jsx.
//
// Ya no hay magic link: mandaba un correo en cada inicio de sesión y el
// servicio de correo por defecto de Supabase tiene un límite de envíos por
// hora muy bajo que solo se sube con SMTP propio. Contraseña + recuperación
// cubren el mismo caso ("no me acuerdo la clave") sin depender de eso.

const MIN_PASS = 8;

export default function Login() {
  const [vista, setVista] = useState("entrar"); // entrar | registro | recuperar
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [nombreEspacio, setNombreEspacio] = useState("");
  const [estado, setEstado] = useState("idle"); // idle | enviando | confirmar | enlace | error
  const [error, setError] = useState("");

  function cambiarVista(nueva) {
    setVista(nueva);
    setEstado("idle");
    setError("");
    setPassword("");
    setPassword2("");
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!supabaseConfigured) {
      setEstado("error");
      setError("Falta configurar la conexión con Supabase (ver .env.example).");
      return;
    }
    setEstado("enviando");
    setError("");

    try {
      if (vista === "entrar") {
        const { error: err } = await supabase.auth.signInWithPassword({ email, password });
        if (err) throw err;
        setEstado("idle"); // App.jsx cambia de pantalla solo
        return;
      }

      if (vista === "registro") {
        if (nombreEspacio.trim().length < 2) {
          throw new Error("Poné un nombre para tu espacio de trabajo.");
        }
        if (password.length < MIN_PASS) {
          throw new Error(`La contraseña necesita al menos ${MIN_PASS} caracteres.`);
        }
        if (password !== password2) {
          throw new Error("Las dos contraseñas no coinciden.");
        }

        const { data, error: err } = await supabase.auth.signUp({
          email,
          password,
          options: {
            // Lo lee el trigger handle_new_user para nombrar el tenant nuevo.
            data: { nombre_espacio: nombreEspacio.trim() },
            // El correo de confirmación (si está activado en Supabase) vuelve
            // a donde está corriendo la app ahora, no a la "Site URL" fija.
            emailRedirectTo: window.location.origin,
          },
        });
        if (err) throw err;

        // Con confirmación de correo desactivada, signUp ya devuelve sesión —
        // pero el token todavía no trae el tenant_id que el trigger acaba de
        // escribir. App.jsx detecta ese hueco y refresca el token; acá solo
        // hace falta no quedarse en "enviando".
        if (data.session) {
          setEstado("idle");
        } else {
          setEstado("confirmar");
        }
        return;
      }

      // recuperar
      const { error: err } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin,
      });
      if (err) throw err;
      setEstado("enlace");
    } catch (err) {
      setEstado("error");
      setError(traducirError(err));
    }
  }

  const enviando = estado === "enviando";

  return (
    <MarcoAcceso>
      <h1 className="text-center font-candy-display text-xl font-extrabold text-candy-tinta">
        {vista === "entrar" && "Entrá a tu espacio"}
        {vista === "registro" && "Creá tu espacio"}
        {vista === "recuperar" && "Recuperar contraseña"}
      </h1>
      <p className="mt-1 text-center text-[12.5px] leading-relaxed text-candy-tinta-media">
        {vista === "entrar" && "Con tu correo y tu contraseña."}
        {vista === "registro" &&
          "Un espacio nuevo para tu equipo. Vas a quedar como responsable."}
        {vista === "recuperar" && "Te mandamos un enlace para elegir una contraseña nueva."}
      </p>

      {!supabaseConfigured && (
        <p className="mt-5 rounded-2xl border border-candy-violeta/40 bg-candy-violeta/10 p-3 text-[12px] text-candy-tinta">
          Falta configurar <code className="font-mono">VITE_SUPABASE_URL</code> y{" "}
          <code className="font-mono">VITE_SUPABASE_ANON_KEY</code> (ver .env.example).
        </p>
      )}

      <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-3">
        {vista === "registro" && (
          <Campo
            label="Nombre del espacio"
            type="text"
            value={nombreEspacio}
            onChange={setNombreEspacio}
            placeholder="Ej.: Ventas Acme"
            autoComplete="organization"
          />
        )}

        <Campo
          label="Correo"
          type="email"
          value={email}
          onChange={setEmail}
          placeholder="tu@correo.com"
          autoComplete="email"
        />

        {vista !== "recuperar" && (
          <Campo
            label="Contraseña"
            type="password"
            value={password}
            onChange={setPassword}
            placeholder={vista === "registro" ? `Mínimo ${MIN_PASS} caracteres` : "Tu contraseña"}
            autoComplete={vista === "registro" ? "new-password" : "current-password"}
          />
        )}

        {vista === "registro" && (
          <Campo
            label="Repetí la contraseña"
            type="password"
            value={password2}
            onChange={setPassword2}
            placeholder="La misma de arriba"
            autoComplete="new-password"
          />
        )}

        <button
          type="submit"
          disabled={enviando}
          className="mt-2 rounded-full px-4 py-3.5 text-[14px] font-bold text-white shadow-[0_10px_24px_rgba(255,92,168,0.32)] transition-opacity disabled:opacity-50"
          style={{ background: "linear-gradient(135deg, #ff5ca8, #b98bff)" }}
        >
          {enviando
            ? "Un momento…"
            : vista === "entrar"
            ? "Iniciar sesión"
            : vista === "registro"
            ? "Crear espacio"
            : "Enviar enlace"}
        </button>
      </form>

      {estado === "confirmar" && (
        <p className="mt-4 text-[12.5px] font-semibold text-emerald-600">
          Revisá tu correo para confirmar la cuenta. Después entrás con tu contraseña.
        </p>
      )}
      {estado === "enlace" && (
        <p className="mt-4 text-[12.5px] font-semibold text-emerald-600">
          Si ese correo tiene una cuenta, te va a llegar el enlace en unos minutos.
        </p>
      )}
      {estado === "error" && (
        <p className="mt-4 text-[12.5px] font-semibold text-rose-500">{error}</p>
      )}

      <div className="mt-6 flex flex-col items-center gap-2.5 text-[12.5px]">
        {vista === "entrar" && (
          <>
            <Enlace onClick={() => cambiarVista("recuperar")}>Olvidé mi contraseña</Enlace>
            <Enlace onClick={() => cambiarVista("registro")}>
              No tengo cuenta — crear un espacio
            </Enlace>
          </>
        )}
        {vista === "registro" && (
          <Enlace onClick={() => cambiarVista("entrar")}>Ya tengo cuenta — entrar</Enlace>
        )}
        {vista === "recuperar" && (
          <Enlace onClick={() => cambiarVista("entrar")}>Volver a iniciar sesión</Enlace>
        )}
      </div>
    </MarcoAcceso>
  );
}

function Campo({ label, type, value, onChange, placeholder, autoComplete }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="pl-1 text-[11px] font-bold uppercase tracking-wide text-candy-tinta-media">
        {label}
      </span>
      <input
        type={type}
        required
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        className="rounded-2xl border border-candy-tinta/10 bg-candy-tinta/[0.04] px-4 py-3 text-[13.5px] text-candy-tinta outline-none transition-colors placeholder:text-candy-tinta-tenue focus:border-candy-rosa focus:bg-white"
      />
    </label>
  );
}

function Enlace({ onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="font-semibold text-candy-tinta-media underline decoration-dotted underline-offset-2 hover:text-candy-tinta"
    >
      {children}
    </button>
  );
}

// Los mensajes de GoTrue vienen en inglés y algunos son crípticos. Se traducen
// los tres o cuatro que un usuario real se va a encontrar; el resto pasa tal
// cual, que es mejor que un genérico "algo falló".
function traducirError(err) {
  const msg = err?.message || "";
  if (msg === "Invalid login credentials") return "Correo o contraseña incorrectos.";
  if (msg.includes("Email not confirmed")) return "Todavía no confirmaste tu correo. Revisá la bandeja.";
  if (msg.includes("User already registered")) return "Ese correo ya tiene una cuenta. Probá iniciar sesión.";
  if (msg.includes("should be at least")) return `La contraseña necesita al menos ${MIN_PASS} caracteres.`;
  if (msg.toLowerCase().includes("rate limit")) return "Demasiados intentos seguidos. Esperá un momento.";
  return msg || "No se pudo completar la operación.";
}
