import { CHANNEL_GRADIENTS, CHANNEL_LABELS } from "./channelStyles.js";

export default function MessageThread({ conversation, draft, onDraftChange, onBack, onOpenCopilot }) {
  if (!conversation) {
    return (
      <div className="candy-glass flex h-full w-full items-center justify-center rounded-[20px] text-sm text-[#8478a0]">
        Elegí una conversación de la izquierda.
      </div>
    );
  }

  const gradient = CHANNEL_GRADIENTS[conversation.canal];

  return (
    <div className="candy-glass flex h-full w-full min-h-0 flex-col rounded-[20px]">
      <div
        className="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 py-3 sm:flex-nowrap sm:justify-between sm:px-5"
        style={{ borderBottom: "1px solid rgba(150,120,200,0.15)" }}
      >
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={onBack}
            className="shrink-0 rounded-full px-2 py-1 text-lg text-[#7a6a99] md:hidden"
            aria-label="Volver a la bandeja"
          >
            ←
          </button>
          <div className="min-w-0">
            <p className="truncate font-candy-display text-sm font-bold text-[#3b2a55]">{conversation.contacto}</p>
            <p className="whitespace-nowrap text-[11px] text-[#9b8fb5]">Último mensaje {conversation.hora}</p>
          </div>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2 sm:ml-0">
          <span
            className="rounded-full px-2.5 py-1 text-[11px] font-semibold text-white"
            style={{ background: gradient }}
          >
            {CHANNEL_LABELS[conversation.canal]}
          </span>
          <button
            type="button"
            onClick={onOpenCopilot}
            className="rounded-full px-2.5 py-1 text-[11px] font-semibold text-[#d6367d] lg:hidden"
            style={{ background: "rgba(255,92,168,0.16)" }}
          >
            Copiloto IA
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4 sm:px-5 sm:py-5">
        {conversation.mensajes.map((m, i) => {
          const out = m.dir === "out";
          return (
            <div key={i} className={`flex ${out ? "justify-end" : "justify-start"}`}>
              <div
                className="max-w-[80%] rounded-2xl px-4 py-2.5 text-sm sm:max-w-[65%] lg:max-w-[58%]"
                style={
                  out
                    ? { background: gradient, color: "#fff", borderBottomRightRadius: 4 }
                    : { background: "rgba(255,255,255,0.6)", color: "#3b2a55", borderBottomLeftRadius: 4 }
                }
              >
                {m.texto}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex shrink-0 items-center gap-2 px-4 pb-4 sm:px-5 sm:pb-5">
        <input
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          placeholder="Escribir una respuesta..."
          className="candy-glass min-w-0 flex-1 rounded-full px-4 py-2.5 text-sm text-[#3b2a55] outline-none placeholder:text-[#9b8fb5]"
        />
        <button
          type="button"
          disabled={!draft.trim()}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white disabled:opacity-50"
          style={{ background: gradient }}
          title="Enviar (todavía no conectado a Supabase)"
        >
          ➤
        </button>
      </div>
    </div>
  );
}
