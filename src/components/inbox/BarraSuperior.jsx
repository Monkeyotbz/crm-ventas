import { supabase } from "../../lib/supabase.js";

// `onAbrirConfiguracion` viene undefined para un rol que no es admin/owner —
// Bandeja.jsx ya resuelve `obtenerMiRol()` antes de pasarlo, así que un
// 'agent' ni siquiera ve el ícono, no solo le falla si lo toca.
export default function BarraSuperior({ onAbrirConfiguracion }) {
  return (
    <div className="shrink-0 mx-5 mt-3.5 px-5 h-[60px] rounded-full flex items-center justify-between candy-glass font-candy-body">
      <div className="flex items-center gap-2.5">
        <div
          className="w-[30px] h-[30px] rounded-full shrink-0"
          style={{
            background: "conic-gradient(from 200deg, #ff5ca8, #ffb35c, #6ee7b7, #5b9bff, #b98bff, #ff5ca8)",
            boxShadow: "0 3px 10px rgba(180,90,220,0.35)",
          }}
        />
        <div className="font-candy-display text-lg font-extrabold text-candy-tinta">candyCRM</div>
      </div>

      {/* Panel de hoy y Reportes: pantallas de Sprints posteriores, todavía
          no construidas — el único destino real hoy es la bandeja. */}
      <div className="flex gap-1 bg-white/50 border border-white/80 rounded-full p-1">
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

      <div className="flex items-center gap-2">
        {onAbrirConfiguracion && (
          <button
            type="button"
            onClick={onAbrirConfiguracion}
            className="w-9 h-9 rounded-full flex items-center justify-center text-candy-tinta-media hover:bg-white/50"
            title="Configuración de Meta"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        )}
        <button
          type="button"
          onClick={() => supabase.auth.signOut()}
          className="w-[34px] h-[34px] rounded-full shrink-0"
          title="Cerrar sesión"
          style={{ background: "linear-gradient(135deg, #5b9bff, #b98bff)", boxShadow: "0 3px 8px rgba(120,90,220,0.35)" }}
        />
      </div>
    </div>
  );
}
