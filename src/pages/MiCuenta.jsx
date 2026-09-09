import { useEffect, useState } from "react";
import { obtenerPerfil, guardarPerfil, cerrarSesion } from "../lib/cuenta.js";

// Mini-administración de la cuenta: ver quién soy (email, rol, espacio),
// editar mis datos personales (nombre, teléfono, cargo) y cerrar sesión.
// La foto de perfil queda para más adelante (no hay bucket todavía).
// Candy + Aero, mismo shell que ConfiguracionMeta / ClavesApi.
const ROL_ETIQUETA = { owner: "Responsable", admin: "Administrador", agent: "Vendedor" };

export default function MiCuenta({ onVolver }) {
  const [perfil, setPerfil] = useState(null);
  const [form, setForm] = useState({ nombre: "", telefono: "", cargo: "" });
  const [cargando, setCargando] = useState(true);
  const [estado, setEstado] = useState("idle"); // idle | guardando | guardado | error
  const [error, setError] = useState("");

  useEffect(() => {
    obtenerPerfil()
      .then((p) => {
        setPerfil(p);
        if (p) setForm({ nombre: p.nombre, telefono: p.telefono, cargo: p.cargo });
      })
      .catch((err) => setError(err.message))
      .finally(() => setCargando(false));
  }, []);

  const cambio = (campo) => (e) => {
    setForm((f) => ({ ...f, [campo]: e.target.value }));
    setEstado("idle");
  };

  async function handleSubmit(e) {
    e.preventDefault();
    setEstado("guardando");
    setError("");
    try {
      await guardarPerfil(form);
      setPerfil((p) => ({ ...p, ...form }));
      setEstado("guardado");
    } catch (err) {
      setEstado("error");
      setError(err.message);
    }
  }

  return (
    <div className="min-h-screen candy-fondo flex flex-col">
      <div className="shrink-0 mx-3 sm:mx-5 mt-3 sm:mt-3.5 px-4 sm:px-5 h-[60px] rounded-full flex items-center gap-2.5 candy-glass font-candy-body">
        <button
          type="button"
          onClick={onVolver}
          className="w-9 h-9 rounded-full flex items-center justify-center text-candy-tinta-media hover:bg-white/50 shrink-0"
          title="Volver a la bandeja"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="font-candy-display text-base sm:text-lg font-extrabold text-candy-tinta">Mi cuenta</div>
      </div>

      <div className="flex-1 px-3 sm:px-5 pb-10 pt-4 sm:pt-5 max-w-[640px] w-full mx-auto font-candy-body">
        {cargando && <p className="text-sm text-candy-tinta-tenue">Cargando…</p>}

        {!cargando && perfil && (
          <>
            {/* Identidad (solo lectura). */}
            <div className="candy-glass rounded-[20px] p-5 sm:p-6 mb-4 flex items-center gap-4">
              <div
                className="w-14 h-14 rounded-2xl shrink-0 flex items-center justify-center text-white font-candy-display text-lg font-extrabold"
                style={{ background: "linear-gradient(135deg, #ff5ca8, #b98bff)" }}
              >
                {(form.nombre || perfil.email).trim().charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <div className="text-[15px] font-bold text-candy-tinta truncate">
                  {form.nombre || "Sin nombre"}
                </div>
                <div className="text-[12.5px] text-candy-tinta-media truncate">{perfil.email}</div>
                <div className="text-[11.5px] text-candy-tinta-tenue mt-0.5">
                  {ROL_ETIQUETA[perfil.rol] ?? perfil.rol ?? "—"}
                  {perfil.espacio ? ` · ${perfil.espacio}` : ""}
                </div>
              </div>
            </div>

            {/* Datos personales (editables). */}
            <form onSubmit={handleSubmit} className="candy-glass rounded-[20px] p-5 sm:p-6 mb-4 flex flex-col gap-4">
              <h2 className="font-candy-display text-[15px] font-extrabold text-candy-tinta">Datos personales</h2>

              <Campo label="Nombre" value={form.nombre} onChange={cambio("nombre")} placeholder="Cómo te ven tus compañeros" />
              <Campo label="Teléfono" type="tel" value={form.telefono} onChange={cambio("telefono")} placeholder="+57 300 000 0000" />
              <Campo label="Cargo" value={form.cargo} onChange={cambio("cargo")} placeholder="Ej.: Coordinadora de reservas" />

              <div className="flex items-center gap-3 pt-1">
                <button
                  type="submit"
                  disabled={estado === "guardando"}
                  className="rounded-full px-5 py-2.5 text-[13px] font-bold text-white disabled:opacity-50"
                  style={{ background: "linear-gradient(135deg, #ff5ca8, #b98bff)" }}
                >
                  {estado === "guardando" ? "Guardando…" : "Guardar cambios"}
                </button>
                {estado === "guardado" && (
                  <span className="text-[12.5px] font-semibold text-emerald-600">Guardado ✓</span>
                )}
              </div>
              {estado === "error" && <p className="text-[12.5px] font-semibold text-rose-500">{error}</p>}
            </form>

            <button
              type="button"
              onClick={() => cerrarSesion()}
              className="w-full rounded-full px-4 py-3 text-[13px] font-bold text-rose-500 border border-rose-200 bg-white/50 hover:bg-rose-50"
            >
              Cerrar sesión
            </button>
          </>
        )}

        {!cargando && !perfil && (
          <p className="text-[13px] text-rose-500">{error || "No se pudo cargar la cuenta."}</p>
        )}
      </div>
    </div>
  );
}

function Campo({ label, type = "text", value, onChange, placeholder }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="pl-1 text-[11px] font-bold uppercase tracking-wide text-candy-tinta-media">{label}</span>
      <input
        type={type}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className="rounded-2xl border border-candy-tinta/10 bg-candy-tinta/[0.04] px-4 py-3 text-[13.5px] text-candy-tinta outline-none transition-colors placeholder:text-candy-tinta-tenue focus:border-candy-rosa focus:bg-white"
      />
    </label>
  );
}
