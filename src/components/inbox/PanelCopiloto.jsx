import { estiloScore, estiloSentimiento, formatearDinero } from "../../lib/canales.js";

export default function PanelCopiloto({ conversacion }) {
  if (!conversacion) {
    return <div className="w-[280px] shrink-0 candy-glass rounded-[20px]" />;
  }

  const score = estiloScore(conversacion.score);
  const sentimiento = estiloSentimiento(conversacion.sentimiento);

  return (
    <div className="w-[280px] shrink-0 candy-glass rounded-[20px] p-[18px] flex flex-col gap-3.5 overflow-y-auto font-candy-body">
      <div className="flex items-center gap-2 font-candy-display text-[13px] font-extrabold text-candy-tinta">
        <div
          className="w-4 h-4 rounded-full shrink-0"
          style={{ background: "conic-gradient(from 0deg, #ff5ca8, #ffb35c, #6ee7b7, #5b9bff, #b98bff, #ff5ca8)" }}
        />
        Copiloto IA
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-wide text-candy-tinta-media font-bold mb-1">Empresa</div>
        <div className="text-[13px] text-candy-tinta font-semibold">{conversacion.contacto_empresa ?? "Sin dato"}</div>
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-wide text-candy-tinta-media font-bold mb-1">Etapa</div>
        <div className="text-[13px] text-candy-tinta font-semibold">
          {conversacion.etapa_nombre ?? "Sin deal todavía"}
          {conversacion.pipeline_nombre && <span className="text-candy-tinta-tenue font-normal"> · {conversacion.pipeline_nombre}</span>}
        </div>
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-wide text-candy-tinta-media font-bold mb-1">Valor estimado</div>
        <div className="text-[13px] text-candy-tinta font-semibold">{formatearDinero(conversacion.valor_estimado)}</div>
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-wide text-candy-tinta-media font-bold mb-1">Score IA / Sentimiento</div>
        {conversacion.score == null && conversacion.sentimiento == null ? (
          <p className="text-[12px] text-candy-tinta-tenue leading-snug">
            Todavía no analizó esta conversación ningún agente de IA.
          </p>
        ) : (
          <div className="flex items-center gap-2.5">
            <div className="font-mono text-[13px] font-bold px-2.5 py-1 rounded-[10px]" style={{ color: score.fg, background: score.bg }}>
              {conversacion.score ?? "—"}
            </div>
            {sentimiento && (
              <div className="text-[11px] font-bold px-2.5 py-1 rounded-full" style={{ background: sentimiento.bg, color: sentimiento.fg }}>
                {sentimiento.etiqueta}
              </div>
            )}
          </div>
        )}
      </div>

      <div
        className="rounded-[14px] p-[13px] border"
        style={{
          borderColor: "rgba(255,255,255,0.85)",
          background: "linear-gradient(160deg, rgba(255,220,240,0.55), rgba(230,235,255,0.5))",
          boxShadow: "0 8px 20px rgba(160,90,220,0.14), inset 0 1px 0 rgba(255,255,255,0.9)",
        }}
      >
        <div className="text-[10px] font-extrabold uppercase tracking-wide mb-1.5" style={{ color: "#d6367d" }}>
          Sugerencia del copiloto
        </div>
        <p className="text-xs leading-relaxed text-candy-tinta">
          {conversacion.sugerencia ?? "Sin sugerencia todavía — hace falta el agente Analista, que sigue sin construirse."}
        </p>
      </div>
    </div>
  );
}
