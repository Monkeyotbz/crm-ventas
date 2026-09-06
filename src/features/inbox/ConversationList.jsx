import { CHANNEL_FLAT_COLORS, CHANNEL_GRADIENTS, CHANNEL_LABELS } from "./channelStyles.js";

const FILTERS = ["todos", "whatsapp", "instagram", "messenger", "linkedin", "chat_web"];

function initials(nombre) {
  return nombre
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export default function ConversationList({ conversations, selectedId, onSelect, filter, onFilterChange }) {
  const visibles = filter === "todos" ? conversations : conversations.filter((c) => c.canal === filter);

  return (
    <div className="candy-glass flex h-full w-full min-h-0 flex-col rounded-[20px] p-4">
      <h1 className="font-candy-display text-base font-extrabold text-[#3b2a55]">Bandeja unificada</h1>

      <div className="mt-3 flex flex-wrap gap-[5px]">
        {FILTERS.map((f) => {
          const active = f === filter;
          return (
            <button
              key={f}
              type="button"
              onClick={() => onFilterChange(f)}
              className="rounded-full px-2.5 py-[5px] text-[10.5px] font-bold transition"
              style={
                active
                  ? { background: CHANNEL_FLAT_COLORS[f], color: "#fff" }
                  : { background: "rgba(255,255,255,0.6)", color: "#7a6a99" }
              }
            >
              {CHANNEL_LABELS[f]}
            </button>
          );
        })}
      </div>

      <div className="mt-3 min-h-0 flex-1 space-y-1.5 overflow-y-auto">
        {visibles.map((c) => {
          const selected = c.id === selectedId;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => onSelect(c.id)}
              className="flex w-full items-center gap-2.5 rounded-2xl p-2.5 text-left transition"
              style={
                selected
                  ? { background: "rgba(255,255,255,0.65)", border: "1px solid rgba(255,255,255,0.9)", boxShadow: "0 6px 16px rgba(120,60,200,0.1)" }
                  : { border: "1px solid transparent" }
              }
            >
              <span className="relative shrink-0">
                <span
                  className="flex h-[34px] w-[34px] items-center justify-center rounded-full font-candy-display text-[11px] font-bold text-white"
                  style={{ background: CHANNEL_GRADIENTS[c.canal] }}
                >
                  {initials(c.contacto)}
                </span>
                <span
                  className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full"
                  style={{ background: CHANNEL_FLAT_COLORS[c.canal], border: "2px solid #fdf3ff" }}
                />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-[13px] font-semibold text-[#3b2a55]">{c.contacto}</span>
                  <span className="shrink-0 font-mono text-[10px] text-[#9b8fb5]">{c.hora}</span>
                </span>
                <span className="block truncate text-[12px] text-[#8478a0]">{c.preview}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
