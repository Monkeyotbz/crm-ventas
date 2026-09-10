import { useQuery } from "@tanstack/react-query";
import { obtenerMetricasPanel } from "../lib/panel.js";
import { formatearDinero } from "../lib/canales.js";

// Panel del tenant — los números del negocio de ESTA empresa. No es el panel
// de plataforma (cuántos tenants hay, facturación de Candy CRM); ese es otra
// pantalla, para `platform_admins`, y nunca la ve un tenant-cliente.
//
// v1 muestra solo lo que hoy es calculable con datos reales. Lo que falta no se
// dibuja vacío ni se inventa: cerrado/ganado necesita fecha de cierre en
// `deals`, el % resuelto por IA necesita que alguien escriba
// `conversations.resuelta_por`, y el score necesita el agente Analista [7b].
// Cada uno de esos desbloquea un bloque nuevo acá sin rehacer la pantalla.
export default function Panel({ onVolver }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["panel"],
    queryFn: obtenerMetricasPanel,
  });

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
        <div className="font-candy-display text-base sm:text-lg font-extrabold text-candy-tinta">Panel de hoy</div>
      </div>

      <div className="flex-1 px-3 sm:px-5 pb-10 pt-4 sm:pt-5 max-w-[1100px] w-full mx-auto font-candy-body">
        {isLoading && <p className="text-sm text-candy-tinta-tenue">Cargando el panel…</p>}
        {error && <p className="text-sm text-rose-500">No se pudo cargar el panel: {error.message}</p>}

        {data && (
          <div className="flex flex-col gap-4 sm:gap-5">
            <div className="grid gap-3 grid-cols-2 lg:grid-cols-5">
              <Tile valor={data.resumen.convsAbiertas} etiqueta="Conversaciones abiertas" />
              <Tile valor={data.resumen.oportunidades} etiqueta="Oportunidades" />
              <Tile
                valor={data.resumen.contactos}
                etiqueta="Contactos"
                nota={data.resumen.contactosNuevos > 0 ? `+${data.resumen.contactosNuevos} en 30 días` : null}
              />
              <Tile valor={formatearDinero(data.resumen.valorPipeline)} etiqueta="Valor en pipeline" />
              <Tile
                valor={formatearDinero(data.resumen.forecast)}
                etiqueta="Forecast ponderado"
                nota="valor × probabilidad"
              />
            </div>

            <Seccion titulo="Pipeline por etapa">
              {data.pipeline.length === 0 ? (
                <Vacio>Todavía no hay oportunidades en el pipeline.</Vacio>
              ) : (
                <div className="flex flex-col gap-2.5">
                  {data.pipeline.map((e) => (
                    <BarraEtapa key={e.etapa} etapa={e} maximo={Math.max(...data.pipeline.map((x) => x.cantidad))} />
                  ))}
                </div>
              )}
            </Seccion>

            <div className="grid gap-4 sm:gap-5 lg:grid-cols-2">
              <Seccion titulo="Origen de las oportunidades">
                {data.origen.length === 0 ? (
                  <Vacio>Sin oportunidades todavía.</Vacio>
                ) : (
                  <div className="flex flex-col gap-2">
                    {data.origen.map((o) => (
                      <BarraSimple key={o.etiqueta} fila={o} color="#ff5ca8" />
                    ))}
                  </div>
                )}
              </Seccion>

              <Seccion titulo="Conversaciones por canal">
                {data.canales.length === 0 ? (
                  <Vacio>Sin conversaciones todavía.</Vacio>
                ) : (
                  <div className="flex flex-col gap-2">
                    {data.canales.map((c) => (
                      <BarraSimple key={c.etiqueta} fila={c} color="#5b9bff" />
                    ))}
                  </div>
                )}
              </Seccion>
            </div>

            <Seccion titulo="Actividad de los últimos 14 días">
              <Actividad dias={data.actividad} />
            </Seccion>

            <p className="text-[11.5px] text-candy-tinta-tenue leading-relaxed">
              El análisis de IA por conversación (score, sentimiento, interés) todavía no está
              activo: se llena cuando entre en funcionamiento el agente Analista. Las métricas de
              cierre —conversión, ciclo de venta, ingreso ganado— llegan cuando el Kanban registre
              el cierre de cada oportunidad.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function Tile({ valor, etiqueta, nota }) {
  return (
    <div className="candy-glass rounded-[20px] p-4 sm:p-5">
      <div className="font-candy-display text-2xl font-extrabold text-candy-tinta leading-none">{valor}</div>
      <div className="text-[10.5px] font-bold uppercase tracking-wide text-candy-tinta-tenue mt-2 leading-tight">
        {etiqueta}
      </div>
      {nota && <div className="text-[10.5px] text-candy-tinta-media mt-1">{nota}</div>}
    </div>
  );
}

function Seccion({ titulo, children }) {
  return (
    <div className="candy-glass rounded-[20px] p-4 sm:p-5">
      <h2 className="font-candy-display text-[15px] font-extrabold text-candy-tinta mb-3.5">{titulo}</h2>
      {children}
    </div>
  );
}

function Vacio({ children }) {
  return <p className="text-[12.5px] text-candy-tinta-tenue">{children}</p>;
}

// La barra se dimensiona contra la etapa MÁS cargada, no contra el total: con
// pocas oportunidades repartidas, los porcentajes sobre el total quedan todos
// tan cortos que no se distinguen entre sí.
function BarraEtapa({ etapa, maximo }) {
  const ancho = maximo > 0 ? Math.max((etapa.cantidad / maximo) * 100, 6) : 0;
  return (
    <div className="flex items-center gap-3">
      <div className="w-[110px] sm:w-[140px] shrink-0 text-[12.5px] font-bold text-candy-tinta truncate">
        {etapa.etapa}
      </div>
      <div className="flex-1 h-3 rounded-full bg-white/50 border border-white/70 overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${ancho}%`, background: etapa.color }} />
      </div>
      <div className="w-[38px] shrink-0 text-right text-[12.5px] font-bold text-candy-tinta">{etapa.cantidad}</div>
      <div className="w-[60px] shrink-0 text-right text-[11.5px] text-candy-tinta-media">
        {formatearDinero(etapa.valor)}
      </div>
    </div>
  );
}

function BarraSimple({ fila, color }) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-[92px] shrink-0 text-[12.5px] text-candy-tinta truncate">{fila.etiqueta}</div>
      <div className="flex-1 h-2.5 rounded-full bg-white/50 border border-white/70 overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${Math.max(fila.pct, 4)}%`, background: color }} />
      </div>
      <div className="w-[62px] shrink-0 text-right text-[11.5px] text-candy-tinta-media">
        {fila.cantidad} · {fila.pct}%
      </div>
    </div>
  );
}

// Sparkline dibujada a mano: el proyecto no tiene librería de gráficos y todo
// el SVG es inline. `vectorEffect="non-scaling-stroke"` deja estirar el viewBox
// a lo ancho del contenedor sin que el trazo se deforme con él.
function Actividad({ dias }) {
  const total = dias.reduce((s, d) => s + d.entrantes + d.salientes, 0);
  if (total === 0) {
    return <Vacio>Sin mensajes en los últimos 14 días.</Vacio>;
  }

  const ANCHO = 280;
  const ALTO = 60;
  const pico = Math.max(...dias.flatMap((d) => [d.entrantes, d.salientes]), 1);
  const puntos = (campo) =>
    dias
      .map((d, i) => {
        const x = dias.length > 1 ? (i / (dias.length - 1)) * ANCHO : ANCHO / 2;
        const y = ALTO - (d[campo] / pico) * (ALTO - 4) - 2;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");

  const entrantes = dias.reduce((s, d) => s + d.entrantes, 0);
  const salientes = dias.reduce((s, d) => s + d.salientes, 0);

  return (
    <div className="flex flex-col gap-3">
      <svg viewBox={`0 0 ${ANCHO} ${ALTO}`} preserveAspectRatio="none" className="w-full h-[60px]">
        <polyline
          points={puntos("entrantes")}
          fill="none"
          stroke="#5b9bff"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        <polyline
          points={puntos("salientes")}
          fill="none"
          stroke="#ff5ca8"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="flex items-center gap-4 text-[11.5px]">
        <span className="flex items-center gap-1.5 text-candy-tinta-media">
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: "#5b9bff" }} />
          {entrantes} recibidos
        </span>
        <span className="flex items-center gap-1.5 text-candy-tinta-media">
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: "#ff5ca8" }} />
          {salientes} enviados
        </span>
      </div>
    </div>
  );
}
