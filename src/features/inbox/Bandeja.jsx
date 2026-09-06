import { useMemo, useState } from "react";
import ConversationList from "./ConversationList.jsx";
import MessageThread from "./MessageThread.jsx";
import CopilotPanel from "./CopilotPanel.jsx";
import { mockConversations } from "./mockConversations.js";
import CandyGemLogo from "../../components/CandyGemLogo.jsx";
import { useAuth } from "../../contexts/AuthContext.jsx";

const NAV_TABS = ["Bandeja", "Panel de hoy", "Reportes"];

// Breakpoints: <768px (mobile) muestra una sola vista a la vez (lista o
// hilo, con botón "volver") y el Copiloto como panel flotante; 768-1023px
// (tablet) muestra lista+hilo lado a lado y el Copiloto también flotante
// (no entran las 3 columnas de ancho fijo); ≥1024px (desktop, el diseño de
// referencia) muestra las 3 columnas fijas.
export default function Bandeja() {
  const [filter, setFilter] = useState("todos");
  const [selectedId, setSelectedId] = useState(mockConversations[2].id); // Camila Ortiz, como en el mock de referencia
  const [activeTab, setActiveTab] = useState("Bandeja");
  const [draft, setDraft] = useState("");
  const [usedSuggestionFor, setUsedSuggestionFor] = useState(null);
  const [mobileView, setMobileView] = useState("list"); // list | thread (solo aplica <768px)
  const [copilotOpen, setCopilotOpen] = useState(false); // panel flotante <1024px
  const [menuOpen, setMenuOpen] = useState(false);
  const { signOut } = useAuth();

  const conversation = useMemo(
    () => mockConversations.find((c) => c.id === selectedId) ?? null,
    [selectedId],
  );

  function selectConversation(id) {
    setSelectedId(id);
    setDraft("");
    setMobileView("thread");
  }

  function useSuggestion() {
    if (!conversation) return;
    setDraft(conversation.sugerencia);
    setUsedSuggestionFor(conversation.id);
  }

  return (
    <div className="candy-bg flex h-dvh flex-col overflow-hidden font-candy-body text-[#2b1f3d]">
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-3 sm:gap-3.5 sm:p-5">
        <div className="candy-glass flex shrink-0 flex-col gap-2 rounded-2xl px-4 py-3 sm:h-[60px] sm:flex-row sm:items-center sm:justify-between sm:rounded-full sm:px-5 sm:py-0">
          <div className="flex shrink-0 items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <CandyGemLogo size={26} />
              <span className="font-candy-display text-base font-extrabold text-[#3b2a55] sm:text-lg">candyCRM</span>
              <span className="hidden text-xs text-[#9b7fc9] lg:inline">getcandycrm.com</span>
            </div>
            <span
              className="h-8 w-8 shrink-0 rounded-full sm:hidden"
              style={{ background: "linear-gradient(135deg, #5b9bff, #b98bff)" }}
            />
          </div>

          <div className="no-scrollbar flex min-w-0 gap-1 overflow-x-auto">
            {NAV_TABS.map((tab) => {
              const active = tab === activeTab;
              return (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  className="shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold transition sm:px-4 sm:py-2 sm:text-sm"
                  style={
                    active
                      ? { background: "linear-gradient(180deg, #ff8fc0, #ff5ca8)", color: "#fff", boxShadow: "0 3px 10px rgba(255,92,168,0.4)" }
                      : { color: "#7a6a99" }
                  }
                >
                  {tab}
                </button>
              );
            })}
          </div>

          <div className="relative hidden shrink-0 items-center gap-3 sm:flex">
            <input
              placeholder="Buscar..."
              className="candy-glass w-36 rounded-full px-3.5 py-1.5 text-sm text-[#3b2a55] outline-none placeholder:text-[#9b8fb5] lg:w-48"
            />
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              className="h-8 w-8 shrink-0 rounded-full"
              style={{ background: "linear-gradient(135deg, #5b9bff, #b98bff)" }}
              aria-label="Cuenta"
            />
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                <div className="candy-glass absolute right-0 top-[calc(100%+8px)] z-50 w-40 overflow-hidden rounded-2xl py-1">
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      signOut();
                    }}
                    className="w-full px-4 py-2 text-left text-sm font-medium text-[#3b2a55] hover:bg-white/60"
                  >
                    Cerrar sesión
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {activeTab === "Bandeja" ? (
          <div className="flex min-h-0 flex-1 gap-3 sm:gap-3.5">
            <div className={`${mobileView === "list" ? "flex" : "hidden"} min-h-0 w-full flex-col md:flex md:w-[280px] lg:w-[336px]`}>
              <ConversationList
                conversations={mockConversations}
                selectedId={selectedId}
                onSelect={selectConversation}
                filter={filter}
                onFilterChange={setFilter}
              />
            </div>

            <div className={`${mobileView === "thread" ? "flex" : "hidden"} min-h-0 w-full flex-1 flex-col md:flex`}>
              <MessageThread
                conversation={conversation}
                draft={draft}
                onDraftChange={setDraft}
                onBack={() => setMobileView("list")}
                onOpenCopilot={() => setCopilotOpen(true)}
              />
            </div>

            <div className="hidden min-h-0 lg:flex lg:w-[280px] lg:shrink-0 lg:flex-col">
              <CopilotPanel
                conversation={conversation}
                suggestionUsed={usedSuggestionFor === selectedId}
                onUseSuggestion={useSuggestion}
              />
            </div>
          </div>
        ) : (
          <div className="candy-glass flex flex-1 items-center justify-center rounded-[20px] text-sm text-[#8478a0]">
            "{activeTab}" todavía no está implementado — arrancamos por la Bandeja.
          </div>
        )}
      </div>

      {copilotOpen && (
        <div className="fixed inset-0 z-50 flex justify-end lg:hidden">
          <div className="absolute inset-0 bg-[#2b1f3d]/30" onClick={() => setCopilotOpen(false)} />
          <div className="relative flex h-full w-full max-w-[340px] flex-col gap-2 p-3">
            <button
              type="button"
              onClick={() => setCopilotOpen(false)}
              className="candy-glass self-end rounded-full px-3 py-1 text-xs font-semibold text-[#7a6a99]"
            >
              Cerrar ✕
            </button>
            <div className="min-h-0 flex-1">
              <CopilotPanel
                conversation={conversation}
                suggestionUsed={usedSuggestionFor === selectedId}
                onUseSuggestion={useSuggestion}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
