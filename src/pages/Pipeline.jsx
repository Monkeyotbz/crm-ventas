import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  obtenerPipelines,
  obtenerTablero,
  moverDeal,
  obtenerHistorial,
  etiquetaActor,
  formatearHoras,
  nivelAlerta,
} from "../lib/pipeline.js";
import { estiloCanal, formatearDinero, formatearHora } from "../lib/canales.js";

// Tablero de oportunidades — la pantalla que faltaba sobre el modelo de datos
// que quedó listo el 10-11 sep (pipeline_stages.tipo, deals.closed_at/
// stage_changed_at, deal_events, mover_deal(), la vista pipeline_tablero).
//
// Drag-and-drop con la API nativa de HTML5, sin librería: el proyecto no trae
// ninguna (ni de gráficos, ni de dnd) y todo se dibuja/maneja a mano, mismo
// criterio que Panel.jsx con sus barras y su sparkline.
export default function Pipeline({ onVolver, onVerConversacion }) {
  const [pipelineId, setPipelineId] = useState(null);
  const [detalle, setDetalle] = useState(null); // deal_id abierto en el panel lateral
  const [pidiendoMotivo, setPidiendoMotivo] = useState(null); // { dealId, stageId } | null
  const [error, setError] = useState(null);
  const queryClient = useQueryClient();

  const { data: pipelines } = useQuery({ queryKey: ["pipelines"], queryFn: obtenerPipelines });

  // Elegir el primer embudo apenas llega la lista, para no arrancar en blanco.
  useEffect(() => {
    if (pipelineId == null && pipelines?.length) setPipelineId(pipelines[0].id);
  }, [pipelines, pipelineId]);

  const {
    data: tablero,
    isLoading,
    error: errorTablero,
  } = useQuery({
    queryKey: ["pipeline-tablero", pipelineId],
    queryFn: () => obtenerTablero(pipelineId),
    enabled: pipelineId != null,
  });

  async function mover(dealId, stageId, motivo) {
    setError(null);
    try {
      await moverDeal(dealId, stageId, motivo);
      queryClient.invalidateQueries({ queryKey: ["pipeline-tablero", pipelineId] });
    } catch (e) {
      setError(e.message);
    }
  }

  // Al soltar sobre una columna: si es de tipo 'perdida', mover_deal exige
  // motivo — se pide con un prompt en vez de dejar que el error crudo llegue
  // a la pantalla. Cualquier otro error (permiso, embudo cruzado) sí se
  // muestra tal cual: el mensaje que devuelve la función ya es legible.
  function soltarEn(columna) {
    return (e) => {
      e.preventDefault();
      const dealId = Number(e.dataTransfer.getData("text/plain"));
      if (!dealId) return;
      if (columna.tipo === "perdida") {
        setPidiendoMotivo({ dealId, stageId: columna.stageId });
      } else {
        mover(dealId, columna.stageId);
      }
    };
  }

  return (
    <div className="min-h-screen candy-fondo flex flex-col">
      <div className="shrink-0 mx-3 sm:mx-5 mt-3 sm:mt-3.5 px-4 sm:px-5 h-[60px] rounded-full flex items-center gap-2.5 candy-glass font-candy-body">
        <button
          type="button"
          onClick={onVolver}
          className="w-9 h-9 rounded-full flex items-center justify-center text-candy-tinta-media hover:bg-white/50 shrink-0"
          title="Volver a la bandeja"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="font-candy-display text-base sm:text-lg font-extrabold text-candy-tinta">Pipeline</div>
      </div>

      <div className="flex-1 px-3 sm:px-5 pb-6 pt-4 sm:pt-5 min-h-0 flex flex-col font-candy-body">
        {/* Selector de embudo: solo si hay más de uno. Un tenant con un único
            embudo (el caso de Turismo Colombia) no gana nada eligiendo entre
            una sola opción. */}
        {pipelines && pipelines.length > 1 && (
          <div className="flex gap-1 bg-white/50 border border-white/80 rounded-full p-1 w-fit mb-4 shrink-0">
            {pipelines.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPipelineId(p.id)}
                className={`px-4 py-2 rounded-full text-[13px] font-bold transition-colors ${
                  pipelineId === p.id ? "text-white" : "text-candy-tinta-media hover:text-candy-tinta"
                }`}
                style={pipelineId === p.id ? { background: "linear-gradient(180deg, #ff8fc0, #ff5ca8)" } : undefined}
              >
                {p.nombre}
              </button>
            ))}
          </div>
        )}

        {tablero && (
          <div className="flex items-center gap-5 mb-4 shrink-0">
            <div>
              <span className="font-candy-display text-lg font-extrabold text-candy-tinta">
                {tablero.resumen.cantidad}
              </span>
              <span className="text-[11px] text-candy-tinta-tenue ml-1.5">abiertas</span>
            </div>
            <div>
              <span className="font-candy-display text-lg font-extrabold text-candy-tinta">
                {formatearDinero(tablero.resumen.valor)}
              </span>
              <span className="text-[11px] text-candy-tinta-tenue ml-1.5">en juego</span>
            </div>
          </div>
        )}

        {error && (
          <p className="text-[12.5px] text-rose-500 mb-3 shrink-0">{error}</p>
        )}
        {errorTablero && (
          <p className="text-sm text-rose-500">No se pudo cargar el pipeline: {errorTablero.message}</p>
        )}
        {isLoading && <p className="text-sm text-candy-tinta-tenue">Cargando el pipeline…</p>}

        {tablero && tablero.columnas.length === 0 && (
          <p className="text-[13px] text-candy-tinta-tenue">Este embudo todavía no tiene etapas.</p>
        )}

        {tablero && tablero.columnas.length > 0 && (
          <div className="flex-1 min-h-0 flex gap-3 overflow-x-auto no-scrollbar pb-2">
            {tablero.columnas.map((columna) => (
              <Columna
                key={columna.stageId}
                columna={columna}
                onSoltar={soltarEn(columna)}
                onAbrir={setDetalle}
              />
            ))}
          </div>
        )}
      </div>

      {pidiendoMotivo && (
        <PromptMotivo
          onCancelar={() => setPidiendoMotivo(null)}
          onConfirmar={(motivo) => {
            mover(pidiendoMotivo.dealId, pidiendoMotivo.stageId, motivo);
            setPidiendoMotivo(null);
          }}
        />
      )}

      {detalle != null && (
        <PanelDetalle
          dealId={detalle}
          tablero={tablero}
          onCerrar={() => setDetalle(null)}
          onVerConversacion={onVerConversacion}
        />
      )}
    </div>
  );
}

function Columna({ columna, onSoltar, onAbrir }) {
  const [sobreVuelo, setSobreVuelo] = useState(false);

  return (
    <div
      className="w-[240px] sm:w-[260px] shrink-0 flex flex-col gap-2 min-h-0"
      onDragOver={(e) => {
        e.preventDefault();
        setSobreVuelo(true);
      }}
      onDragLeave={() => setSobreVuelo(false)}
      onDrop={(e) => {
        setSobreVuelo(false);
        onSoltar(e);
      }}
    >
      <div className="flex items-center gap-2 px-1 shrink-0">
        <span className="w-[3px] h-[15px] rounded-sm shrink-0" style={{ background: columna.color }} />
        <h3 className="text-[12.5px] font-extrabold text-candy-tinta tracking-wide">{columna.nombre}</h3>
        <span className="ml-auto text-[10.5px] font-extrabold text-candy-tinta-tenue">{columna.deals.length}</span>
      </div>

      <div
        className={`flex-1 min-h-[80px] rounded-[16px] p-1.5 flex flex-col gap-2 overflow-y-auto transition-colors ${
          sobreVuelo ? "bg-candy-rosa/10 ring-2 ring-candy-rosa/40" : ""
        }`}
      >
        {columna.deals.length === 0 && (
          <p className="text-[11px] text-candy-tinta-tenue text-center py-4">Nada acá</p>
        )}
        {columna.deals.map((d) => (
          <Tarjeta key={d.deal_id} deal={d} onAbrir={() => onAbrir(d.deal_id)} />
        ))}
      </div>
    </div>
  );
}

function Tarjeta({ deal, onAbrir }) {
  const canal = estiloCanal(deal.fuente);
  const nivel = nivelAlerta(deal.horas_en_etapa, deal.etapa_horas_alerta);

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", String(deal.deal_id));
        e.dataTransfer.effectAllowed = "move";
      }}
      onClick={onAbrir}
      className="candy-glass rounded-[14px] p-3 flex flex-col gap-2 cursor-grab active:cursor-grabbing hover:shadow-[0_6px_16px_rgba(120,60,200,0.12)] transition-shadow"
    >
      <div className="text-[12.5px] font-bold text-candy-tinta leading-snug line-clamp-2">{deal.titulo}</div>
      <div className="flex items-center gap-1.5 flex-wrap">
        <span
          className="text-[9px] font-extrabold text-white rounded-full px-2 py-0.5"
          style={{ background: canal.gradiente }}
        >
          {canal.etiqueta}
        </span>
        {deal.valor_estimado != null && (
          <span className="text-[11px] font-bold text-candy-tinta ml-auto">
            {formatearDinero(Number(deal.valor_estimado))}
          </span>
        )}
      </div>
      {nivel !== "normal" && (
        <span
          className={`text-[9.5px] font-bold rounded-full px-2 py-0.5 w-fit ${
            nivel === "frio" ? "bg-rose-500/15 text-rose-600" : "bg-candy-durazno/20 text-amber-700"
          }`}
        >
          {formatearHoras(deal.horas_en_etapa)} sin moverse
        </span>
      )}
    </div>
  );
}

// Prompt inline mínimo — el proyecto no trae librería de modales, así que se
// dibuja igual que el resto: un overlay + una tarjeta candy-glass.
function PromptMotivo({ onCancelar, onConfirmar }) {
  const [motivo, setMotivo] = useState("");

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-candy-tinta/30" onClick={onCancelar} />
      <div className="candy-glass relative w-full max-w-[380px] rounded-[20px] p-5 flex flex-col gap-3 font-candy-body">
        <h3 className="font-candy-display text-[15px] font-extrabold text-candy-tinta">
          ¿Por qué se pierde esta oportunidad?
        </h3>
        <textarea
          autoFocus
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          placeholder="Ej: se fue con la competencia, presupuesto insuficiente…"
          rows={3}
          className="w-full rounded-xl border border-white/80 bg-white/70 p-3 text-[12.5px] text-candy-tinta placeholder:text-candy-tinta-tenue resize-none outline-none focus:ring-2 focus:ring-candy-rosa/40"
        />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancelar}
            className="px-4 py-2 rounded-full text-[12.5px] font-bold text-candy-tinta-media hover:bg-black/5"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={!motivo.trim()}
            onClick={() => onConfirmar(motivo.trim())}
            className="px-4 py-2 rounded-full text-[12.5px] font-bold text-white disabled:opacity-40"
            style={{ background: "linear-gradient(180deg, #ff8fc0, #ff5ca8)" }}
          >
            Confirmar
          </button>
        </div>
      </div>
    </div>
  );
}

function PanelDetalle({ dealId, tablero, onCerrar, onVerConversacion }) {
  const deal = useMemo(
    () => tablero?.columnas.flatMap((c) => c.deals).find((d) => d.deal_id === dealId) ?? null,
    [tablero, dealId],
  );

  const { data: historial, isLoading } = useQuery({
    queryKey: ["deal-historial", dealId],
    queryFn: () => obtenerHistorial(dealId),
  });

  useEffect(() => {
    const onEsc = (e) => e.key === "Escape" && onCerrar();
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [onCerrar]);

  if (!deal) return null;

  return (
    <div className="fixed inset-0 z-[60] flex justify-end">
      <div className="absolute inset-0 bg-candy-tinta/30" onClick={onCerrar} />
      <div className="relative flex h-full w-full max-w-[400px] flex-col p-3">
        <div className="candy-glass flex-1 rounded-[24px] p-5 sm:p-6 flex flex-col gap-4 overflow-y-auto font-candy-body">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="font-candy-display text-lg font-extrabold text-candy-tinta leading-snug">
                {deal.titulo}
              </h2>
              {deal.contacto_empresa && (
                <p className="text-[12px] text-candy-tinta-media mt-0.5">{deal.contacto_empresa}</p>
              )}
            </div>
            <button
              type="button"
              onClick={onCerrar}
              className="w-8 h-8 rounded-full flex items-center justify-center text-candy-tinta-media hover:bg-black/5 shrink-0"
              aria-label="Cerrar"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 border-t border-black/5 pt-4">
            <div>
              <dt className="text-[10.5px] font-bold uppercase tracking-wide text-candy-tinta-tenue">Valor</dt>
              <dd className="text-[13px] text-candy-tinta font-bold">
                {deal.valor_estimado != null ? formatearDinero(Number(deal.valor_estimado)) : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-[10.5px] font-bold uppercase tracking-wide text-candy-tinta-tenue">Etapa</dt>
              <dd className="text-[13px] text-candy-tinta">{deal.etapa_nombre}</dd>
            </div>
            <div>
              <dt className="text-[10.5px] font-bold uppercase tracking-wide text-candy-tinta-tenue">Origen</dt>
              <dd className="text-[13px] text-candy-tinta">{estiloCanal(deal.fuente).etiqueta}</dd>
            </div>
            <div>
              <dt className="text-[10.5px] font-bold uppercase tracking-wide text-candy-tinta-tenue">Creada</dt>
              <dd className="text-[13px] text-candy-tinta">{formatearHora(deal.created_at)}</dd>
            </div>
          </dl>

          {deal.conversation_id != null && onVerConversacion && (
            <button
              type="button"
              onClick={() => onVerConversacion(deal.conversation_id)}
              className="w-fit text-[12.5px] font-bold text-candy-azul underline decoration-dotted underline-offset-2"
            >
              Ver conversación →
            </button>
          )}

          <div className="border-t border-black/5 pt-4">
            <p className="text-[10.5px] font-bold uppercase tracking-wide text-candy-tinta-tenue mb-2.5">
              Historial
            </p>
            {isLoading && <p className="text-[12px] text-candy-tinta-tenue">Cargando…</p>}
            {historial && <LineaDeTiempo eventos={historial} />}
          </div>
        </div>
      </div>
    </div>
  );
}

function LineaDeTiempo({ eventos }) {
  if (eventos.length === 0) {
    return <p className="text-[12px] text-candy-tinta-tenue">Sin movimientos todavía.</p>;
  }
  return (
    <ul className="flex flex-col gap-3">
      {eventos.map((e) => (
        <li key={e.id} className="flex gap-2.5">
          <span className="w-1.5 h-1.5 rounded-full bg-candy-rosa mt-1.5 shrink-0" />
          <div className="min-w-0">
            <p className="text-[12.5px] text-candy-tinta">
              {e.deEtapa ? (
                <>
                  <b>{e.deEtapa}</b> → <b>{e.aEtapa}</b>
                </>
              ) : (
                <>
                  Creada en <b>{e.aEtapa}</b>
                </>
              )}
            </p>
            <p className="text-[11px] text-candy-tinta-tenue">
              {formatearHora(e.createdAt)} · movido por {etiquetaActor(e.actor)}
              {e.motivo && <> — {e.motivo}</>}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}
