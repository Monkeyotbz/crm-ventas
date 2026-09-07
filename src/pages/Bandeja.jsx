import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import BarraSuperior from "../components/inbox/BarraSuperior.jsx";
import ListaConversaciones from "../components/inbox/ListaConversaciones.jsx";
import HiloMensajes from "../components/inbox/HiloMensajes.jsx";
import PanelCopiloto from "../components/inbox/PanelCopiloto.jsx";
import PanelConfiguracion from "../components/inbox/PanelConfiguracion.jsx";
import ConfiguracionMeta from "./ConfiguracionMeta.jsx";
import ClavesApi from "./ClavesApi.jsx";
import { listarConversaciones, suscribirMensajesNuevos } from "../lib/bandeja.js";
import { obtenerMiRol } from "../lib/configuracionMeta.js";

// Sprint 1 — bandeja unificada. El envío saliente ya está conectado para
// WhatsApp (ver HiloMensajes); los demás canales siguen en solo lectura.
//
// Layout responsive portado de la rama de Gabriel (merge del 7 sept), sobre
// estos componentes y no los suyos: los tres breakpoints son los del diseño
// de referencia, y lo que cambia entre ellos es SOLO qué paneles se ven, no
// de dónde salen los datos.
//   <768px  (mobile): un panel a la vez — lista o hilo, con botón de volver;
//                     el copiloto sale como panel flotante.
//   768-1023 (tablet): lista + hilo lado a lado; el copiloto sigue flotante
//                     porque las tres columnas de ancho fijo no entran.
//   ≥1024px (desktop): las tres columnas fijas, que es el diseño original.
export default function Bandeja() {
  const [filtro, setFiltro] = useState("todos");
  const [seleccionadaId, setSeleccionadaId] = useState(null);
  const [pagina, setPagina] = useState("bandeja"); // "bandeja" | "configuracion-meta" | "claves-api"
  const [rol, setRol] = useState(null);
  const [vistaMobile, setVistaMobile] = useState("lista"); // "lista" | "hilo" — solo <768px
  const [copilotoAbierto, setCopilotoAbierto] = useState(false); // panel flotante <1024px
  const [menuConfigAbierto, setMenuConfigAbierto] = useState(false); // hub del engranaje
  const queryClient = useQueryClient();

  // Solo admin/owner ven el ícono de Configuración de Meta (candidato [9a]) —
  // un 'agent' ni siquiera lo ve, no solo le falla si lo toca.
  useEffect(() => {
    obtenerMiRol().then(setRol).catch(() => setRol(null));
  }, []);

  const { data: conversaciones, isLoading, error } = useQuery({
    queryKey: ["conversaciones"],
    queryFn: listarConversaciones,
  });

  // Mensaje nuevo en cualquier conversación del tenant → refresca la lista
  // (nuevo preview/orden) y, si es la que se está mirando, el hilo también.
  // RLS de Realtime ya filtra por tenant con el mismo JWT de la sesión.
  useEffect(() => {
    const desuscribir = suscribirMensajesNuevos((mensaje) => {
      queryClient.invalidateQueries({ queryKey: ["conversaciones"] });
      queryClient.invalidateQueries({ queryKey: ["mensajes", mensaje.conversation_id] });
    });
    return desuscribir;
  }, [queryClient]);

  // Si no hay ninguna seleccionada todavía, elegir la primera de la lista
  // apenas llega — así la pantalla no arranca vacía a la derecha.
  useEffect(() => {
    if (seleccionadaId == null && conversaciones?.length) {
      setSeleccionadaId(conversaciones[0].conversation_id);
    }
  }, [conversaciones, seleccionadaId]);

  const activa = conversaciones?.find((c) => c.conversation_id === seleccionadaId) ?? null;
  const esAdmin = rol === "owner" || rol === "admin";

  if (pagina === "configuracion-meta") {
    return <ConfiguracionMeta onVolver={() => setPagina("bandeja")} />;
  }
  if (pagina === "claves-api") {
    return <ClavesApi onVolver={() => setPagina("bandeja")} />;
  }

  // En mobile, elegir una conversación es "entrar" a ella: la lista y el hilo
  // comparten la misma pantalla. En tablet/desktop este cambio de estado no se
  // nota, porque los dos paneles se ven al mismo tiempo igual.
  function seleccionar(id) {
    setSeleccionadaId(id);
    setVistaMobile("hilo");
  }

  // Copiloto y Configuración son los dos paneles flotantes de esta pantalla —
  // nunca conviven: abrir uno cierra el otro. Sin esto, el engranaje tocado
  // con el Copiloto ya abierto dejaría los dos overlays superpuestos peleando
  // por el mismo espacio a la derecha.
  function abrirCopiloto() {
    setMenuConfigAbierto(false);
    setCopilotoAbierto(true);
  }
  function abrirConfig() {
    setCopilotoAbierto(false);
    setMenuConfigAbierto(true);
  }

  return (
    <div className="h-dvh candy-fondo flex flex-col overflow-hidden">
      <BarraSuperior onAbrirConfiguracion={esAdmin ? abrirConfig : undefined} />

      <div className="flex-1 flex gap-3 sm:gap-3.5 px-3 sm:px-5 pt-3 sm:pt-3.5 pb-3 sm:pb-5 min-h-0">
        {isLoading && <p className="m-auto text-sm text-candy-tinta-tenue font-candy-body">Cargando la bandeja…</p>}

        {error && (
          <p className="m-auto text-sm text-red-500 font-candy-body">
            No se pudo cargar la bandeja: {error.message}
          </p>
        )}

        {conversaciones && (
          <>
            <div
              className={`${vistaMobile === "lista" ? "flex" : "hidden"} min-h-0 w-full flex-col md:flex md:w-[280px] md:shrink-0 lg:w-[336px]`}
            >
              <ListaConversaciones
                conversaciones={conversaciones}
                filtro={filtro}
                onFiltro={setFiltro}
                seleccionadaId={seleccionadaId}
                onSeleccionar={seleccionar}
              />
            </div>

            <div className={`${vistaMobile === "hilo" ? "flex" : "hidden"} min-h-0 w-full flex-1 flex-col md:flex`}>
              <HiloMensajes
                conversacion={activa}
                onVolver={() => setVistaMobile("lista")}
                onAbrirCopiloto={abrirCopiloto}
              />
            </div>

            <div className="hidden min-h-0 lg:flex lg:w-[280px] lg:shrink-0 lg:flex-col">
              <PanelCopiloto conversacion={activa} />
            </div>
          </>
        )}
      </div>

      {/* Copiloto flotante: es el mismo componente y los mismos datos que la
          tercera columna de desktop — abajo de 1024px no entra al lado del
          hilo, así que se muestra encima en vez de recortarlo. */}
      {copilotoAbierto && (
        <div className="fixed inset-0 z-50 flex justify-end lg:hidden">
          <div className="absolute inset-0 bg-candy-tinta/30" onClick={() => setCopilotoAbierto(false)} />
          <div className="relative flex h-full w-full max-w-[340px] flex-col gap-2 p-3">
            <button
              type="button"
              onClick={() => setCopilotoAbierto(false)}
              className="candy-glass self-end rounded-full px-3 py-1 text-xs font-bold text-candy-tinta-media"
            >
              Cerrar ✕
            </button>
            <div className="min-h-0 flex-1">
              <PanelCopiloto conversacion={activa} />
            </div>
          </div>
        </div>
      )}

      {menuConfigAbierto && (
        <PanelConfiguracion
          onCerrar={() => setMenuConfigAbierto(false)}
          onAbrirMeta={() => setPagina("configuracion-meta")}
          onAbrirClaves={() => setPagina("claves-api")}
        />
      )}
    </div>
  );
}
