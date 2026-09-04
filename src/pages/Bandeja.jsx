import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import BarraSuperior from "../components/inbox/BarraSuperior.jsx";
import ListaConversaciones from "../components/inbox/ListaConversaciones.jsx";
import HiloMensajes from "../components/inbox/HiloMensajes.jsx";
import PanelCopiloto from "../components/inbox/PanelCopiloto.jsx";
import { listarConversaciones, suscribirMensajesNuevos } from "../lib/bandeja.js";

// Sprint 1 — bandeja unificada, solo lectura (docs/pendientes.md): se puede
// ver cada conversación con su contacto, su deal y el estado del copiloto,
// pero todavía no se puede responder desde acá — falta la Edge Function de
// envío saliente (WhatsApp Graph API + widget), que es trabajo aparte.
export default function Bandeja() {
  const [filtro, setFiltro] = useState("todos");
  const [seleccionadaId, setSeleccionadaId] = useState(null);
  const queryClient = useQueryClient();

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

  return (
    <div className="min-h-screen candy-fondo flex flex-col">
      <BarraSuperior />

      <div className="flex-1 flex gap-3.5 px-5 pt-3.5 pb-5 min-h-0">
        {isLoading && <p className="m-auto text-sm text-candy-tinta-tenue font-candy-body">Cargando la bandeja…</p>}

        {error && (
          <p className="m-auto text-sm text-red-500 font-candy-body">
            No se pudo cargar la bandeja: {error.message}
          </p>
        )}

        {conversaciones && (
          <>
            <ListaConversaciones
              conversaciones={conversaciones}
              filtro={filtro}
              onFiltro={setFiltro}
              seleccionadaId={seleccionadaId}
              onSeleccionar={setSeleccionadaId}
            />
            <HiloMensajes conversacion={activa} />
            <PanelCopiloto conversacion={activa} />
          </>
        )}
      </div>
    </div>
  );
}
