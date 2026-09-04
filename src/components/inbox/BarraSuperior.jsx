import { supabase } from "../../lib/supabase.js";

export default function BarraSuperior() {
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
