import { useState } from "react";
import { supabase } from "../../lib/supabase.js";
import CandyGemLogo from "../CandyGemLogo.jsx";

// Los `onAbrir*` vienen undefined para un rol que no es admin/owner —
// Bandeja.jsx ya resuelve `obtenerMiRol()` antes de pasarlos, así que un
// 'agent' ni siquiera ve el engranaje, no solo le falla si lo toca.
export default function BarraSuperior({ onAbrirConfiguracion, onAbrirClaves }) {
  return (
    // `relative z-50` no es decorativo: `candy-glass` trae `backdrop-filter`, y
    // eso CREA un contexto de apilamiento. Sin un z-index acá, el menú del
    // engranaje queda encerrado en el contexto de esta barra y los paneles de la
    // bandeja —que también son candy-glass y vienen después en el DOM— lo tapan.
    // El síntoma es un menú que "aparece por detrás" en vez de no aparecer.
    <div className="relative z-50 shrink-0 mx-3 sm:mx-5 mt-3 sm:mt-3.5 px-3 sm:px-5 py-2.5 sm:py-0 sm:h-[60px] rounded-2xl sm:rounded-full flex flex-col sm:flex-row gap-2 sm:gap-3 items-stretch sm:items-center justify-between candy-glass font-candy-body">
      {/* En mobile esta fila lleva el logo Y los botones de cuenta (que en
          desktop van del otro lado de la barra): apilar tres filas comería
          demasiado alto de pantalla en un celular. */}
      <div className="flex items-center justify-between gap-2.5 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          {/* Isotipo traído de la rama de Gabriel (merge del 7 sept) — reemplaza
              al degradado cónico genérico que había acá. Es el mismo SVG que
              quedó como favicon en index.html. */}
          <CandyGemLogo size={28} className="shrink-0" />
          <div className="font-candy-display text-base sm:text-lg font-extrabold text-candy-tinta">candyCRM</div>
        </div>
        <div className="sm:hidden">
          <BotonesCuenta onAbrirConfiguracion={onAbrirConfiguracion} onAbrirClaves={onAbrirClaves} />
        </div>
      </div>

      {/* Panel de hoy y Reportes: pantallas de Sprints posteriores, todavía
          no construidas — el único destino real hoy es la bandeja.
          `no-scrollbar` + overflow-x: en mobile las tres pestañas no entran a
          lo ancho, así que scrollean en vez de romper la barra. */}
      <div className="no-scrollbar flex min-w-0 gap-1 overflow-x-auto bg-white/50 border border-white/80 rounded-full p-1">
        <button type="button" className="px-4 py-2 rounded-full text-[13px] font-bold text-white" style={{ background: "linear-gradient(180deg, #ff8fc0, #ff5ca8)" }}>
          Bandeja
        </button>
        <button type="button" disabled className="px-4 py-2 rounded-full text-[13px] font-bold text-candy-tinta-tenue cursor-not-allowed opacity-60">
          Panel de hoy
        </button>
        <button type="button" disabled className="px-4 py-2 rounded-full text-[13px] font-bold text-candy-tinta-tenue cursor-not-allowed opacity-60">
          Reportes
        </button>
      </div>

      <div className="hidden sm:block">
        <BotonesCuenta onAbrirConfiguracion={onAbrirConfiguracion} onAbrirClaves={onAbrirClaves} />
      </div>
    </div>
  );
}

// Extraído para no duplicar el markup: los mismos botones se muestran junto al
// logo en mobile y del otro lado de la barra en desktop.
//
// El engranaje abre un menú y no una pantalla directa porque ya hay dos
// destinos de configuración (Meta y las claves de API), y van a ser más.
function BotonesCuenta({ onAbrirConfiguracion, onAbrirClaves }) {
  const [menuAbierto, setMenuAbierto] = useState(false);
  const hayConfiguracion = onAbrirConfiguracion || onAbrirClaves;

  return (
    <div className="flex items-center gap-2">
      {hayConfiguracion && (
        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuAbierto((v) => !v)}
            className="w-9 h-9 rounded-full flex items-center justify-center text-candy-tinta-media hover:bg-white/50"
            title="Configuración"
            aria-expanded={menuAbierto}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>

          {menuAbierto && (
            <>
              {/* Capa invisible a pantalla completa: cerrar tocando afuera es lo
                  que espera cualquiera de un menú, y en mobile es la única
                  forma cómoda de salir. */}
              <div className="fixed inset-0 z-40" onClick={() => setMenuAbierto(false)} />
              <div className="candy-glass absolute right-0 top-[calc(100%+8px)] z-50 w-52 overflow-hidden rounded-2xl py-1">
                {onAbrirConfiguracion && (
                  <button
                    type="button"
                    onClick={() => { setMenuAbierto(false); onAbrirConfiguracion(); }}
                    className="w-full px-4 py-2.5 text-left text-[13px] font-semibold text-candy-tinta hover:bg-white/60"
                  >
                    Meta y WhatsApp
                  </button>
                )}
                {onAbrirClaves && (
                  <button
                    type="button"
                    onClick={() => { setMenuAbierto(false); onAbrirClaves(); }}
                    className="w-full px-4 py-2.5 text-left text-[13px] font-semibold text-candy-tinta hover:bg-white/60"
                  >
                    Claves de API
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}
      <button
        type="button"
        onClick={() => supabase.auth.signOut()}
        className="w-[34px] h-[34px] rounded-full shrink-0"
        title="Cerrar sesión"
        style={{ background: "linear-gradient(135deg, #5b9bff, #b98bff)", boxShadow: "0 3px 8px rgba(120,90,220,0.35)" }}
      />
    </div>
  );
}
