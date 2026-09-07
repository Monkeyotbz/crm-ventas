import { useEffect, useState } from "react";
import { listarClavesApi, crearClaveApi, revocarClaveApi, urlDeIngesta } from "../lib/clavesApi.js";

// Pantalla de autoservicio de claves de la API de ingesta (candidato [9a]).
// Es la que hace viable el "carril masivo" de venta (ver CLAUDE.md): un tenant
// que compró candyCRM sin acompañamiento conecta su sistema desde acá, sin que
// nadie de Hellominus tenga que tocar SQL por él.
//
// Solo admin/owner — BarraSuperior no muestra la entrada a un 'agent'.
export default function ClavesApi({ onVolver }) {
  const [claves, setClaves] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [nombre, setNombre] = useState("");
  const [creando, setCreando] = useState(false);

  // La clave recién creada, en claro. Vive solo en este estado y solo hasta que
  // se recargue la pantalla: no se guarda en ningún lado ni se puede recuperar.
  const [claveNueva, setClaveNueva] = useState(null);
  const [copiada, setCopiada] = useState(false);

  async function recargar() {
    try {
      setClaves(await listarClavesApi());
      setError("");
    } catch (err) {
      setError(err.message);
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    recargar();
  }, []);

  async function crear(e) {
    e.preventDefault();
    setCreando(true);
    setError("");
    try {
      setClaveNueva(await crearClaveApi(nombre));
      setNombre("");
      setCopiada(false);
      await recargar();
    } catch (err) {
      setError(err.message);
    } finally {
      setCreando(false);
    }
  }

  async function revocar(id, nombreClave) {
    if (!confirm(`¿Revocar "${nombreClave}"? El sistema que la esté usando va a dejar de poder enviar leads inmediatamente.`)) return;
    try {
      await revocarClaveApi(id);
      await recargar();
    } catch (err) {
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
        <div className="font-candy-display text-base sm:text-lg font-extrabold text-candy-tinta">Claves de API</div>
      </div>

      <div className="flex-1 px-3 sm:px-5 pb-10 pt-4 sm:pt-5 max-w-[720px] w-full mx-auto font-candy-body">
        <div className="candy-glass rounded-[20px] p-5 sm:p-6 mb-4">
          <p className="text-[13px] text-candy-tinta-media leading-relaxed">
            Con una clave de API, el sistema de tu empresa (tu formulario web, tu ERP, tu tienda)
            puede <strong className="text-candy-tinta">enviar leads directo a candyCRM</strong>. Cada
            lead entra como contacto, y si trae una consulta se abre la conversación y se clasifica sola.
          </p>
          <div className="mt-4 pt-4 border-t border-black/5">
            <p className="text-[11.5px] font-bold text-candy-tinta-media uppercase tracking-wide mb-2">
              Enviá los leads a esta dirección
            </p>
            <code className="block text-[12px] bg-white/60 border border-white/80 rounded-lg px-3 py-2.5 text-candy-tinta break-all">
              POST {urlDeIngesta()}
            </code>
            <p className="text-[12px] text-candy-tinta-media mt-2 leading-relaxed">
              Con la cabecera <code className="text-candy-tinta">Authorization: Bearer TU_CLAVE</code> y un
              cuerpo JSON con al menos uno de <code className="text-candy-tinta">email</code>,{" "}
              <code className="text-candy-tinta">telefono</code> o <code className="text-candy-tinta">external_id</code>.
              Opcionales: <code className="text-candy-tinta">nombre</code>, <code className="text-candy-tinta">empresa</code>,{" "}
              <code className="text-candy-tinta">mensaje</code> y los <code className="text-candy-tinta">utm_*</code>.
            </p>
          </div>
        </div>

        {/* La clave recién creada. Se muestra a pantalla completa del bloque y con
            aviso fuerte, porque es literalmente la única vez que existe. */}
        {claveNueva && (
          <div className="rounded-[20px] p-5 sm:p-6 mb-4 border-2" style={{ borderColor: "#ff5ca8", background: "rgba(255,255,255,0.75)" }}>
            <h2 className="font-candy-display text-[15px] font-extrabold text-candy-tinta mb-1">
              Copiala ahora — no se vuelve a mostrar
            </h2>
            <p className="text-[12.5px] text-candy-tinta-media mb-3">
              candyCRM guarda solo un resumen cifrado de esta clave. Si la perdés, no hay forma de
              recuperarla: hay que crear una nueva.
            </p>
            <code className="block text-[12.5px] bg-white border border-white/80 rounded-lg px-3 py-3 text-candy-tinta break-all select-all">
              {claveNueva}
            </code>
            <div className="flex gap-2 mt-3">
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard?.writeText(claveNueva).then(() => setCopiada(true), () => {});
                }}
                className="rounded-full px-4 py-2 text-[12.5px] font-bold text-white"
                style={{ background: "linear-gradient(135deg, #ff5ca8, #b98bff)" }}
              >
                {copiada ? "Copiada ✓" : "Copiar"}
              </button>
              <button
                type="button"
                onClick={() => setClaveNueva(null)}
                className="rounded-full px-4 py-2 text-[12.5px] font-bold text-candy-tinta-media hover:bg-white/60"
              >
                Ya la guardé
              </button>
            </div>
          </div>
        )}

        <form onSubmit={crear} className="candy-glass rounded-[20px] p-5 sm:p-6 mb-4 flex flex-col gap-3">
          <h2 className="font-candy-display text-[15px] font-extrabold text-candy-tinta">Crear una clave</h2>
          <label className="flex flex-col gap-1.5">
            <span className="text-[11.5px] font-bold text-candy-tinta-media uppercase tracking-wide">
              ¿Para qué sistema es?
            </span>
            <input
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              required
              placeholder="Ej.: Formulario del sitio web"
              className="rounded-xl border border-white/70 bg-white/60 px-3.5 py-2.5 text-[13.5px] text-candy-tinta outline-none focus:border-[#ff5ca8]"
            />
            <span className="text-[11.5px] text-candy-tinta-tenue">
              Solo para que puedas distinguirlas después. Conviene una clave por sistema: si una se
              filtra, se revoca sin afectar a los demás.
            </span>
          </label>
          <button
            type="submit"
            disabled={creando}
            className="self-start rounded-full px-5 py-2.5 text-[13px] font-bold text-white disabled:opacity-50"
            style={{ background: "linear-gradient(135deg, #ff5ca8, #b98bff)" }}
          >
            {creando ? "Creando…" : "Crear clave"}
          </button>
        </form>

        <div className="candy-glass rounded-[20px] p-5 sm:p-6">
          <h2 className="font-candy-display text-[15px] font-extrabold text-candy-tinta mb-3">Tus claves</h2>

          {cargando && <p className="text-sm text-candy-tinta-tenue">Cargando…</p>}
          {!cargando && claves.length === 0 && (
            <p className="text-[13px] text-candy-tinta-tenue">Todavía no creaste ninguna.</p>
          )}

          <div className="flex flex-col gap-2">
            {claves.map((c) => (
              <div key={c.id} className="flex items-center gap-3 flex-wrap bg-white/50 border border-white/70 rounded-xl px-3.5 py-3">
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-bold text-candy-tinta truncate">
                    {c.nombre}
                    {!c.activo && <span className="ml-2 text-[11px] font-bold text-red-500">revocada</span>}
                  </div>
                  <div className="text-[11.5px] text-candy-tinta-media font-mono mt-0.5">{c.prefijo}…</div>
                  <div className="text-[11px] text-candy-tinta-tenue mt-0.5">
                    {c.ultimo_uso_at
                      ? `Último uso: ${new Date(c.ultimo_uso_at).toLocaleString("es")}`
                      : "Nunca se usó"}
                  </div>
                </div>
                {c.activo && (
                  <button
                    type="button"
                    onClick={() => revocar(c.id, c.nombre)}
                    className="shrink-0 rounded-full px-3.5 py-1.5 text-[12px] font-bold text-red-500 border border-red-200 hover:bg-red-50"
                  >
                    Revocar
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        {error && <p className="text-[13px] text-red-500 mt-3">{error}</p>}
      </div>
    </div>
  );
}
