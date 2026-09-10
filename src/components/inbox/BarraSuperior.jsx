import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase.js";
import { iniciales } from "../../lib/cuenta.js";
import CandyLollipopLogo from "../CandyLollipopLogo.jsx";

// `onAbrirConfiguracion` viene undefined para un rol que no es admin/owner —
// Bandeja.jsx ya resuelve `obtenerMiRol()` antes de pasarlo, así que un
// 'agent' ni siquiera ve el engranaje, no solo le falla si lo toca.
//
// El botón de cuenta abre "Mi cuenta" (datos personales + cerrar sesión), ya
// no cierra sesión de un toque. La barra solo se ve en la bandeja: las otras
// pantallas (catálogo, mi cuenta, configuración) traen su propio encabezado.
// `onIrACatalogo` viene undefined para un tenant sin el módulo "catalogo" — la
// pestaña ni se muestra en ese caso, no solo se deshabilita.
export default function BarraSuperior({ onAbrirConfiguracion, onIrACatalogo, onAbrirMiCuenta }) {
  const [inicial, setInicial] = useState("");

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const u = data?.user;
      setInicial(iniciales({ nombre: u?.user_metadata?.nombre, email: u?.email }).toUpperCase());
    });
  }, []);

  return (
    <div className="shrink-0 mx-3 sm:mx-5 mt-3 sm:mt-3.5 px-3 sm:px-5 py-2.5 sm:py-0 sm:h-[60px] rounded-2xl sm:rounded-full flex flex-col sm:flex-row gap-2 sm:gap-3 items-stretch sm:items-center justify-between candy-glass font-candy-body">
      {/* En mobile esta fila lleva el logo Y los botones de cuenta (que en
          desktop van del otro lado de la barra): apilar tres filas comería
          demasiado alto de pantalla en un celular. */}
      <div className="flex items-center justify-between gap-2.5 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <CandyLollipopLogo size={30} className="shrink-0" />
          <div className="font-candy-display text-base sm:text-lg font-extrabold text-candy-tinta">Candy CRM</div>
        </div>
        <div className="sm:hidden">
          <BotonesCuenta
            onAbrirConfiguracion={onAbrirConfiguracion}
            onAbrirMiCuenta={onAbrirMiCuenta}
            inicial={inicial}
          />
        </div>
      </div>

      {/* Panel de hoy y Reportes: pantallas de Sprints posteriores, todavía sin
          construir. `no-scrollbar` + overflow-x: en mobile las pestañas no
          entran a lo ancho, así que scrollean en vez de romper la barra. */}
      <div className="no-scrollbar flex min-w-0 gap-1 overflow-x-auto bg-white/50 border border-white/80 rounded-full p-1">
        <button type="button" className="px-4 py-2 rounded-full text-[13px] font-bold text-white shrink-0" style={{ background: "linear-gradient(180deg, #ff8fc0, #ff5ca8)" }}>
          Bandeja
        </button>
        {/* "Catálogo" solo para tenants con ese módulo activo (Bandeja.jsx pasa
            onIrACatalogo undefined si no lo tienen — ver tenants.modulos,
            migración 20260910120000). Un CRM de ventas que no vende turismo no
            tiene por qué ver esta pestaña. */}
        {onIrACatalogo && (
          <button
            type="button"
            onClick={onIrACatalogo}
            className="px-4 py-2 rounded-full text-[13px] font-bold text-candy-tinta-media hover:text-candy-tinta shrink-0"
          >
            Catálogo
          </button>
        )}
        <button type="button" disabled className="px-4 py-2 rounded-full text-[13px] font-bold text-candy-tinta-tenue cursor-not-allowed opacity-60 shrink-0">
          Panel de hoy
        </button>
        <button type="button" disabled className="px-4 py-2 rounded-full text-[13px] font-bold text-candy-tinta-tenue cursor-not-allowed opacity-60 shrink-0">
          Reportes
        </button>
      </div>

      <div className="hidden sm:block">
        <BotonesCuenta
          onAbrirConfiguracion={onAbrirConfiguracion}
          onAbrirMiCuenta={onAbrirMiCuenta}
          inicial={inicial}
        />
      </div>
    </div>
  );
}

function BotonesCuenta({ onAbrirConfiguracion, onAbrirMiCuenta, inicial }) {
  return (
    <div className="flex items-center gap-2">
      {onAbrirConfiguracion && (
        <button
          type="button"
          onClick={onAbrirConfiguracion}
          className="w-9 h-9 rounded-full flex items-center justify-center text-candy-tinta-media hover:bg-white/50"
          title="Configuración"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      )}
      <button
        type="button"
        onClick={onAbrirMiCuenta}
        className="w-[34px] h-[34px] rounded-full shrink-0 flex items-center justify-center text-white text-[12px] font-extrabold font-candy-display"
        title="Mi cuenta"
        style={{ background: "linear-gradient(135deg, #5b9bff, #b98bff)", boxShadow: "0 3px 8px rgba(120,90,220,0.35)" }}
      >
        {inicial}
      </button>
    </div>
  );
}
