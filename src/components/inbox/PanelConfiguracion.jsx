import { useEffect, useState } from "react";
import { obtenerConfiguracionMeta } from "../../lib/configuracionMeta.js";
import { listarClavesApi } from "../../lib/clavesApi.js";

// "Hub" de configuración — propuesta B del canvas (7 sept 2026): el engranaje
// abre esto, no un menú de texto plano. Agrupa por sección para que sumar la
// próxima opción (Equipo, Facturación, lo que sea) no vuelva esto una lista
// larga sin jerarquía.
//
// Deliberadamente NO navega directo a los formularios: cada tarjeta abre la
// pantalla completa que ya existe (ConfiguracionMeta / ClavesApi). Este panel
// es solo el punto de entrada — por eso puede convivir con el resto de la
// bandeja sin duplicar nada de esa lógica acá.
export default function PanelConfiguracion({ onCerrar, onAbrirMeta, onAbrirClaves }) {
  const [meta, setMeta] = useState(undefined); // undefined = cargando, null = sin configurar
  const [claves, setClaves] = useState(undefined);

  useEffect(() => {
    obtenerConfiguracionMeta().then(setMeta).catch(() => setMeta(null));
    listarClavesApi().then(setClaves).catch(() => setClaves([]));
  }, []);

  const clavesActivas = claves?.filter((c) => c.activo).length ?? null;

  return (
    // Mismo mecanismo que el panel flotante del Copiloto (overlay + slide-in
    // desde la derecha) — a propósito: es un patrón que ya existe en esta
    // bandeja, no uno nuevo que aprender. z-[60] queda por encima de la barra
    // superior (z-50, ver BarraSuperior.jsx) y del Copiloto (z-50): los tres
    // paneles nunca conviven a la vez, así que no hace falta que compitan por
    // altura — alcanza con que Configuración gane si los dos se piden juntos.
    <div className="fixed inset-0 z-[60] flex justify-end">
      <div className="absolute inset-0 bg-candy-tinta/30" onClick={onCerrar} />
      <div className="relative flex h-full w-full max-w-[380px] flex-col p-3">
        <div className="candy-glass flex-1 rounded-[24px] p-5 sm:p-6 flex flex-col gap-5 overflow-y-auto font-candy-body">
          <div className="flex items-center justify-between shrink-0">
            <h2 className="font-candy-display text-lg font-extrabold text-candy-tinta">Configuración</h2>
            <button
              type="button"
              onClick={onCerrar}
              className="w-8 h-8 rounded-full flex items-center justify-center text-candy-tinta-media hover:bg-black/5"
              aria-label="Cerrar"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          <Seccion titulo="Canales y credenciales">
            <Tarjeta
              onClick={onAbrirMeta}
              icono={
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
                </svg>
              }
              fondo="linear-gradient(135deg, #25D366, #128C7E)"
              titulo="Meta y WhatsApp"
              descripcion="App, credenciales y número conectado"
              estado={meta === undefined ? "Cargando…" : meta?.activo ? "Conectado" : "Sin configurar"}
              estadoOk={Boolean(meta?.activo)}
            />
            <Tarjeta
              onClick={onAbrirClaves}
              icono={
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="7.5" cy="15.5" r="4.5" />
                  <path d="m10.5 12.5 8-8M15.5 7.5l2.5 2.5M18.5 4.5 21 7" />
                </svg>
              }
              fondo="linear-gradient(135deg, #5b9bff, #b98bff)"
              titulo="Claves de API"
              descripcion="Conectá tu propio sistema para enviar leads"
              estado={
                clavesActivas === null
                  ? "Cargando…"
                  : clavesActivas === 0
                  ? "Sin claves"
                  : `${clavesActivas} clave${clavesActivas === 1 ? "" : "s"} activa${clavesActivas === 1 ? "" : "s"}`
              }
              estadoOk={Boolean(clavesActivas)}
            />
          </Seccion>

          <Seccion titulo="Cuenta">
            <Tarjeta
              icono={
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
              }
              fondo="#9b8fb5"
              titulo="Equipo"
              descripcion="Vendedores, roles y permisos"
              pronto
            />
            <Tarjeta
              icono={
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="5" width="20" height="14" rx="2" />
                  <path d="M2 10h20" />
                </svg>
              }
              fondo="#9b8fb5"
              titulo="Facturación"
              descripcion="Plan, uso y método de pago"
              pronto
            />
          </Seccion>
        </div>
      </div>
    </div>
  );
}

function Seccion({ titulo, children }) {
  return (
    <div className="shrink-0">
      <p className="text-[10.5px] font-extrabold uppercase tracking-wide text-candy-tinta-tenue mb-2">{titulo}</p>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  );
}

function Tarjeta({ onClick, icono, fondo, titulo, descripcion, estado, estadoOk, pronto = false }) {
  const deshabilitada = pronto || !onClick;
  return (
    <button
      type="button"
      onClick={deshabilitada ? undefined : onClick}
      disabled={deshabilitada}
      className={`w-full flex items-center gap-3 p-3.5 rounded-2xl border text-left font-candy-body transition-colors ${
        deshabilitada
          ? "opacity-55 cursor-not-allowed border-white/70 bg-white/40"
          : "border-white/70 bg-white/55 hover:bg-white/85 hover:border-white hover:shadow-[0_6px_16px_rgba(120,60,200,0.1)]"
      }`}
    >
      <div className="w-[42px] h-[42px] rounded-[13px] shrink-0 flex items-center justify-center" style={{ background: fondo }}>
        {icono}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[13.5px] font-bold text-candy-tinta">{titulo}</div>
        <div className="text-[11.5px] text-candy-tinta-media leading-snug mt-0.5">{descripcion}</div>
        {estado && (
          <div className={`text-[10.5px] font-bold mt-1.5 flex items-center gap-1.5 ${estadoOk ? "text-emerald-600" : "text-candy-tinta-media"}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${estadoOk ? "bg-emerald-500" : "bg-candy-tinta-tenue"}`} />
            {estado}
          </div>
        )}
      </div>
      {pronto ? (
        <span className="text-[9.5px] font-extrabold text-candy-tinta-media bg-black/5 rounded-full px-2 py-1 shrink-0">Pronto</span>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="text-candy-tinta-tenue shrink-0">
          <path d="m9 6 6 6-6 6" />
        </svg>
      )}
    </button>
  );
}
