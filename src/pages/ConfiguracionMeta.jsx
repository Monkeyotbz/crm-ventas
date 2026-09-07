import { useEffect, useState } from "react";
import {
  obtenerConfiguracionMeta,
  obtenerNumeroWhatsapp,
  obtenerCallbackUrlPropia,
  guardarConfiguracionMeta,
} from "../lib/configuracionMeta.js";

// Pantalla de autoservicio del candidato [9a] (docs/DECISIONES.md): cada
// tenant carga SU PROPIA app de Meta, completa e independiente. Solo
// accesible para admin/owner — BarraSuperior no muestra el ícono a un
// 'agent'. Candy + Aero, mismos tokens que la bandeja (src/index.css).
export default function ConfiguracionMeta({ onVolver }) {
  const [config, setConfig] = useState(null); // null = todavía no configurado
  const [numero, setNumero] = useState(null);
  const [callbackUrl, setCallbackUrl] = useState("");
  const [cargando, setCargando] = useState(true);

  const [form, setForm] = useState({
    metaAppId: "",
    appSecret: "",
    verifyToken: "",
    accessToken: "",
    phoneNumberId: "",
    wabaId: "",
    numeroDisplay: "",
  });
  const [estado, setEstado] = useState("idle"); // idle | guardando | guardado | error
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([obtenerConfiguracionMeta(), obtenerNumeroWhatsapp(), obtenerCallbackUrlPropia()])
      .then(([cfg, num, url]) => {
        setConfig(cfg);
        setNumero(num);
        setCallbackUrl(url ?? "");
        if (cfg) setForm((f) => ({ ...f, metaAppId: cfg.meta_app_id }));
        if (num) {
          setForm((f) => ({
            ...f,
            phoneNumberId: num.phone_number_id,
            wabaId: num.waba_id,
            numeroDisplay: num.numero_display ?? "",
          }));
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setCargando(false));
  }, []);

  function actualizar(campo) {
    return (e) => setForm((f) => ({ ...f, [campo]: e.target.value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setEstado("guardando");
    setError("");
    try {
      await guardarConfiguracionMeta(form);
      setEstado("guardado");
      // Los secretos no se vuelven a mostrar — se limpian del formulario,
      // dejando solo lo que no es sensible (meta_app_id, número).
      setForm((f) => ({ ...f, appSecret: "", verifyToken: "", accessToken: "" }));
      setConfig({ meta_app_id: form.metaAppId, activo: true, updated_at: new Date().toISOString() });
    } catch (err) {
      setEstado("error");
      setError(err.message);
    }
  }

  return (
    <div className="min-h-screen candy-fondo flex flex-col">
      <div className="shrink-0 mx-5 mt-3.5 px-5 h-[60px] rounded-full flex items-center justify-between candy-glass font-candy-body">
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={onVolver}
            className="w-9 h-9 rounded-full flex items-center justify-center text-candy-tinta-media hover:bg-white/50"
            title="Volver a la bandeja"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="font-candy-display text-lg font-extrabold text-candy-tinta">Configuración de Meta</div>
        </div>
      </div>

      <div className="flex-1 px-5 pb-10 pt-5 max-w-[640px] w-full mx-auto font-candy-body">
        {cargando && <p className="text-sm text-candy-tinta-tenue">Cargando…</p>}

        {!cargando && (
          <>
            <div className="candy-glass rounded-[20px] p-6 mb-5">
              <p className="text-[13px] text-candy-tinta-media leading-relaxed">
                Cada tenant conecta <strong className="text-candy-tinta">su propia app de Meta</strong> — nada se
                comparte entre empresas distintas. Los datos sensibles (App Secret, tokens) nunca se
                vuelven a mostrar una vez guardados: si necesitás cambiarlos, escribilos de nuevo acá.
              </p>

              {config && (
                <div className="mt-4 pt-4 border-t border-black/5 flex items-center gap-2 text-[13px]">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
                  <span className="text-candy-tinta">
                    Configurado — App ID <code className="text-candy-tinta-media">{config.meta_app_id}</code>
                  </span>
                </div>
              )}
            </div>

            {callbackUrl && (
              <div className="candy-glass rounded-[20px] p-6 mb-5">
                <h2 className="font-candy-display text-[15px] font-extrabold text-candy-tinta mb-2">
                  Callback URL para tu panel de Meta
                </h2>
                <p className="text-[12.5px] text-candy-tinta-media mb-3">
                  Pegá esto en Meta for Developers → tu app → WhatsApp → Configuración → Callback URL.
                  No es un dato secreto.
                </p>
                <code className="block text-[12px] bg-white/60 border border-white/80 rounded-lg px-3 py-2.5 text-candy-tinta break-all">
                  {callbackUrl}
                </code>
              </div>
            )}

            <form onSubmit={handleSubmit} className="candy-glass rounded-[20px] p-6 flex flex-col gap-4">
              <h2 className="font-candy-display text-[15px] font-extrabold text-candy-tinta">
                {config ? "Rotar credenciales" : "Conectar tu app de Meta"}
              </h2>

              <Campo label="Meta App ID" value={form.metaAppId} onChange={actualizar("metaAppId")} required />
              <Campo
                label={config ? "App Secret (dejalo vacío para no cambiarlo)" : "App Secret"}
                value={form.appSecret}
                onChange={actualizar("appSecret")}
                type="password"
                required={!config}
              />
              <Campo
                label="Verify Token (el que vos elijas, se usa también en Meta)"
                value={form.verifyToken}
                onChange={actualizar("verifyToken")}
                type="password"
                required={!config}
              />
              <Campo
                label={config ? "Token de acceso (dejalo vacío para no cambiarlo)" : "Token de acceso (system user)"}
                value={form.accessToken}
                onChange={actualizar("accessToken")}
                type="password"
                required={!config}
              />

              <div className="h-px bg-black/5 my-1" />

              <Campo label="Phone Number ID" value={form.phoneNumberId} onChange={actualizar("phoneNumberId")} required />
              <Campo label="WABA ID" value={form.wabaId} onChange={actualizar("wabaId")} required />
              <Campo
                label="Número para mostrar (opcional)"
                value={form.numeroDisplay}
                onChange={actualizar("numeroDisplay")}
              />

              <button
                type="submit"
                disabled={estado === "guardando"}
                className="mt-2 rounded-full py-3 text-[13px] font-bold text-white disabled:opacity-50"
                style={{ background: "linear-gradient(135deg, #ff5ca8, #b98bff)" }}
              >
                {estado === "guardando" ? "Guardando…" : "Guardar"}
              </button>

              {estado === "guardado" && (
                <p className="text-[13px] text-emerald-600">Guardado. Los secretos no se vuelven a mostrar.</p>
              )}
              {estado === "error" && <p className="text-[13px] text-red-500">{error}</p>}
            </form>
          </>
        )}
      </div>
    </div>
  );
}

function Campo({ label, value, onChange, type = "text", required = false }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11.5px] font-bold text-candy-tinta-media uppercase tracking-wide">{label}</span>
      <input
        type={type}
        value={value}
        onChange={onChange}
        required={required}
        autoComplete="off"
        className="rounded-xl border border-white/70 bg-white/60 px-3.5 py-2.5 text-[13.5px] text-candy-tinta outline-none focus:border-[#ff5ca8]"
      />
    </label>
  );
}
