import { useQuery } from "@tanstack/react-query";
import { estiloCanal, formatearHora } from "../../lib/canales.js";
import { listarMensajes } from "../../lib/bandeja.js";

export default function HiloMensajes({ conversacion }) {
  const { data: mensajes, isLoading } = useQuery({
    queryKey: ["mensajes", conversacion?.conversation_id],
    queryFn: () => listarMensajes(conversacion.conversation_id),
    enabled: Boolean(conversacion),
  });

  if (!conversacion) {
    return (
      <div className="flex-1 min-w-0 candy-glass rounded-[20px] flex items-center justify-center font-candy-body">
        <p className="text-sm text-candy-tinta-tenue">Elegí una conversación de la izquierda para verla acá.</p>
      </div>
    );
  }

  const chs = estiloCanal(conversacion.canal);

  return (
    <div className="flex-1 min-w-0 candy-glass rounded-[20px] flex flex-col overflow-hidden font-candy-body">
      <div className="shrink-0 px-[22px] py-4 flex items-center justify-between border-b border-[rgba(150,120,200,0.15)]">
        <div>
          <div className="font-candy-display text-[15px] font-extrabold text-candy-tinta">
            {conversacion.contacto_nombre}
            {conversacion.contacto_empresa ? ` · ${conversacion.contacto_empresa}` : ""}
          </div>
          <div className="text-[11.5px] text-candy-tinta-media mt-0.5">
            Último mensaje {formatearHora(conversacion.ultimo_mensaje_at)}
          </div>
        </div>
        <div
          className="inline-flex items-center gap-1.5 text-[11px] font-extrabold px-3 py-1.5 rounded-full text-white shrink-0"
          style={{ background: chs.gradiente }}
        >
          {chs.etiqueta}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-[22px] flex flex-col gap-3">
        {isLoading && <p className="text-xs text-candy-tinta-tenue">Cargando mensajes…</p>}
        {mensajes?.map((m) => (
          <div key={m.id} className={`flex ${m.direccion === "out" ? "justify-end" : ""}`}>
            <div
              className={`max-w-[58%] px-[15px] py-[11px] rounded-2xl text-[13px] leading-[1.45] ${
                m.direccion === "out" ? "text-white rounded-br-[4px] shadow-[0_6px_16px_rgba(0,0,0,0.12)]" : "rounded-bl-[4px] border"
              }`}
              style={
                m.direccion === "out"
                  ? { background: chs.gradiente }
                  : { background: "rgba(255,255,255,0.6)", borderColor: "rgba(255,255,255,0.85)", color: "#3b2a55" }
              }
            >
              {m.contenido}
            </div>
          </div>
        ))}
      </div>

      {/* Enviar no está disponible todavía: falta la Edge Function de salida
          (Graph API de WhatsApp, ventana de 24h/plantillas) — ver docs/pendientes.md.
          El campo queda visible porque el diseño lo prevé, pero deshabilitado
          para no prometer algo que todavía no hace nada. */}
      <div className="shrink-0 px-[22px] pb-5 pt-3.5">
        <div className="flex gap-2.5 items-center">
          <div className="flex-1 candy-glass rounded-full px-4 py-3 text-[12.5px] text-candy-tinta-tenue cursor-not-allowed">
            Responder llega pronto — todavía no se puede enviar desde acá
          </div>
          <button
            type="button"
            disabled
            title="Enviar todavía no está disponible"
            className="w-10 h-10 rounded-full shrink-0 flex items-center justify-center text-white opacity-40 cursor-not-allowed"
            style={{ background: chs.gradiente }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m22 2-7 20-4-9-9-4Z" />
              <path d="M22 2 11 13" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
