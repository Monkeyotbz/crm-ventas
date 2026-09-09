import { useState } from "react";
import { supabase } from "../lib/supabase.js";
import MarcoAcceso from "../components/MarcoAcceso.jsx";

// Pantalla de "elegí una contraseña nueva". La muestra App.jsx cuando Supabase
// dispara el evento PASSWORD_RECOVERY — eso pasa cuando alguien vuelve por el
// enlace del correo de recuperación. Para entonces ya hay sesión abierta (el
// enlace la crea), así que updateUser alcanza para setear la clave nueva.

const MIN_PASS = 8;

export default function NuevaContrasena({ onListo }) {
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [estado, setEstado] = useState("idle"); // idle | enviando | ok | error
  const [error, setError] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");

    if (password.length < MIN_PASS) {
      setError(`La contraseña necesita al menos ${MIN_PASS} caracteres.`);
      return;
    }
    if (password !== password2) {
      setError("Las dos contraseñas no coinciden.");
      return;
    }

    setEstado("enviando");
    const { error: err } = await supabase.auth.updateUser({ password });
    if (err) {
      setEstado("error");
      setError(err.message || "No se pudo actualizar la contraseña.");
      return;
    }
    setEstado("ok");
  }

  if (estado === "ok") {
    return (
      <MarcoAcceso>
        <h1 className="text-center font-candy-display text-xl font-extrabold text-candy-tinta">Listo</h1>
        <p className="mt-1 text-center text-[12.5px] leading-relaxed text-candy-tinta-media">
          Tu contraseña quedó actualizada.
        </p>
        <button
          type="button"
          onClick={onListo}
          className="mt-6 w-full rounded-full px-4 py-3.5 text-[14px] font-bold text-white shadow-[0_10px_24px_rgba(255,92,168,0.32)]"
          style={{ background: "linear-gradient(135deg, #ff5ca8, #b98bff)" }}
        >
          Entrar
        </button>
      </MarcoAcceso>
    );
  }

  return (
    <MarcoAcceso>
      <h1 className="text-center font-candy-display text-xl font-extrabold text-candy-tinta">
        Elegí una contraseña nueva
      </h1>
      <p className="mt-1 text-center text-[12.5px] leading-relaxed text-candy-tinta-media">
        La vas a usar la próxima vez que entres.
      </p>

      <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-3">
        <Campo
          label="Contraseña nueva"
          value={password}
          onChange={setPassword}
          placeholder={`Mínimo ${MIN_PASS} caracteres`}
        />
        <Campo
          label="Repetí la contraseña"
          value={password2}
          onChange={setPassword2}
          placeholder="La misma de arriba"
        />
        <button
          type="submit"
          disabled={estado === "enviando"}
          className="mt-2 rounded-full px-4 py-3.5 text-[14px] font-bold text-white shadow-[0_10px_24px_rgba(255,92,168,0.32)] transition-opacity disabled:opacity-50"
          style={{ background: "linear-gradient(135deg, #ff5ca8, #b98bff)" }}
        >
          {estado === "enviando" ? "Un momento…" : "Guardar contraseña"}
        </button>
      </form>

      {error && <p className="mt-4 text-[12.5px] font-semibold text-rose-500">{error}</p>}
    </MarcoAcceso>
  );
}

function Campo({ label, value, onChange, placeholder }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="pl-1 text-[11px] font-bold uppercase tracking-wide text-candy-tinta-media">
        {label}
      </span>
      <input
        type="password"
        required
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="new-password"
        className="rounded-2xl border border-candy-tinta/10 bg-candy-tinta/[0.04] px-4 py-3 text-[13.5px] text-candy-tinta outline-none transition-colors placeholder:text-candy-tinta-tenue focus:border-candy-rosa focus:bg-white"
      />
    </label>
  );
}
