import { CANALES, estiloCanal, formatearHora, iniciales } from "../../lib/canales.js";

const FILTROS = [{ id: "todos", etiqueta: "Todos" }, ...Object.entries(CANALES).map(([id, c]) => ({ id, etiqueta: c.etiqueta }))];

export default function ListaConversaciones({ conversaciones, filtro, onFiltro, seleccionadaId, onSeleccionar }) {
  const visibles = conversaciones.filter((c) => filtro === "todos" || c.canal === filtro);

  return (
    <div className="w-[336px] shrink-0 candy-glass rounded-[20px] flex flex-col overflow-hidden font-candy-body">
      <div className="p-4 pb-2.5 shrink-0">
        <h1 className="font-candy-display text-base font-extrabold text-candy-tinta mb-2.5">Bandeja unificada</h1>
        <div className="flex flex-wrap gap-1.5">
          {FILTROS.map((f) => {
            const activo = filtro === f.id;
            const color = f.id === "todos" ? "#7a6a99" : estiloCanal(f.id).gradiente;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => onFiltro(f.id)}
                className="rounded-full px-2.5 py-1 text-[10.5px] font-bold border transition-colors"
                style={
                  activo
                    ? { background: color, borderColor: "rgba(255,255,255,0.9)", color: "#fff", boxShadow: "0 3px 8px rgba(0,0,0,0.12)" }
                    : { background: "rgba(255,255,255,0.5)", borderColor: "rgba(255,255,255,0.8)", color: "#7a6a99" }
                }
              >
                {f.etiqueta}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2.5 pb-2.5 flex flex-col gap-1.5">
        {visibles.length === 0 && (
          <p className="text-center text-xs text-candy-tinta-tenue py-8 px-3">
            {filtro === "todos" ? "Todavía no llegó ninguna conversación." : "Nada en este canal todavía."}
          </p>
        )}
        {visibles.map((c) => {
          const chs = estiloCanal(c.canal);
          const seleccionada = c.conversation_id === seleccionadaId;
          return (
            <div
              key={c.conversation_id}
              onClick={() => onSeleccionar(c.conversation_id)}
              className="flex gap-2.5 p-2.5 rounded-[14px] cursor-pointer items-start border"
              style={
                seleccionada
                  ? { background: "rgba(255,255,255,0.65)", borderColor: "rgba(255,255,255,0.9)", boxShadow: "0 6px 18px rgba(120,60,200,0.14)" }
                  : { borderColor: "transparent" }
              }
            >
              <div
                className="w-[34px] h-[34px] rounded-full shrink-0 flex items-center justify-center font-candy-display text-xs font-bold text-white relative"
                style={{ background: chs.gradiente }}
              >
                {iniciales(c.contacto_nombre)}
                <div
                  className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2"
                  style={{ background: chs.gradiente, borderColor: "#fdf3ff" }}
                />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex justify-between items-baseline gap-2">
                  <div className="text-[12.5px] font-bold text-candy-tinta truncate">{c.contacto_nombre}</div>
                  <div className="text-[10px] text-candy-tinta-tenue font-mono shrink-0">{formatearHora(c.ultimo_mensaje_at)}</div>
                </div>
                <div className="text-[11.5px] text-candy-tinta-media truncate mt-0.5">
                  {c.ultimo_mensaje_direccion === "out" && <span className="text-candy-tinta-tenue">Vos: </span>}
                  {c.ultimo_mensaje_contenido ?? "—"}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
