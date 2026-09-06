import { formatMoney, scoreStyle, sentimentStyle } from "./channelStyles.js";

export default function CopilotPanel({ conversation, suggestionUsed, onUseSuggestion }) {
  if (!conversation) {
    return <div className="candy-glass h-full w-full rounded-[20px]" />;
  }

  const sc = scoreStyle(conversation.score);
  const sn = sentimentStyle(conversation.sentimiento);

  return (
    <div className="candy-glass flex h-full w-full min-h-0 flex-col gap-3.5 overflow-y-auto rounded-[20px] p-4.5">
      <div className="flex items-center gap-2">
        <span
          className="h-3 w-3 rounded-full"
          style={{ background: "conic-gradient(from 0deg, #ff5ca8, #ffb35c, #6ee7b7, #5b9bff, #b98bff, #ff5ca8)" }}
        />
        <span className="font-candy-display text-sm font-extrabold text-[#3b2a55]">Copiloto IA</span>
      </div>

      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-[#9b8fb5]">Empresa</p>
        <p className="text-[13px] font-semibold text-[#3b2a55]">{conversation.empresa}</p>
      </div>

      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-[#9b8fb5]">Valor estimado</p>
        <p className="text-[13px] font-semibold text-[#3b2a55]">{formatMoney(conversation.valor)}</p>
      </div>

      <div>
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[#9b8fb5]">Score IA / Sentimiento</p>
        <div className="flex gap-1.5">
          <span className="rounded-full px-2.5 py-1 font-mono text-[12px] font-semibold" style={sc}>
            {conversation.score}
          </span>
          <span className="rounded-full px-2.5 py-1 text-[12px] font-semibold capitalize" style={sn}>
            {conversation.sentimiento}
          </span>
        </div>
      </div>

      <div
        className="rounded-2xl p-3"
        style={{ background: "linear-gradient(160deg, rgba(255,220,240,0.55), rgba(230,235,255,0.5))" }}
      >
        <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: "#d6367d" }}>
          Sugerencia del Copiloto
        </p>
        <p className="mt-1 text-[12.5px] leading-snug text-[#3b2a55]">{conversation.sugerencia}</p>
        <button
          type="button"
          onClick={onUseSuggestion}
          disabled={suggestionUsed}
          className="mt-2.5 w-full rounded-full py-1.5 text-[12px] font-bold text-white transition"
          style={
            suggestionUsed
              ? { background: "rgba(255,255,255,0.7)", color: "#d6367d" }
              : { background: "linear-gradient(180deg, #ff8fc0 0%, #ff5ca8 55%, #e0397f 100%)" }
          }
        >
          {suggestionUsed ? "Sugerencia usada" : "Usar sugerencia"}
        </button>
      </div>
    </div>
  );
}
