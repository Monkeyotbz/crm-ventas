import { useQuery } from "@tanstack/react-query";
import { obtenerMetricasPanel, formatearDuracion } from "../lib/panel.js";
import { formatearDinero } from "../lib/canales.js";

// Panel del tenant — los números del negocio de ESTA empresa. No es el panel
// de plataforma (cuántos tenants hay, facturación de Candy CRM); ese es otra
// pantalla, para `platform_admins`, y nunca la ve un tenant-cliente.
//
// v2 (11 sep): se agregaron los bloques de cierre (conversión, ciclo de venta,
// ingreso ganado), autonomía de la IA, tiempo por etapa, embudo de caída y
// motivos de pérdida. Los cinco dependían de `deals.closed_at`,
// `pipeline_stages.tipo` y `deal_events`, que recién existen desde esta semana.
//
// Los bloques aparecen vacíos mientras nadie mueva oportunidades por el tablero,
// y eso es a propósito: cada sección distingue "todavía no hay historial" de
// "hay historial y el número es cero". Confundir esas dos cosas es la forma más
// fácil de que un panel mienta.
//
// Lo que sigue faltando y NO se dibuja: el score/sentimiento por conversación
// (necesita el agente Analista [7b], APLAZADO) y el % resuelto por IA (nadie
// escribe `conversations.resuelta_por` todavía).
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

            {/* Cierre. Estas cuatro eran imposibles de calcular hasta el 11 sep
                — necesitaban closed_at y pipeline_stages.tipo. La ventana es de
                90 días para que un ciclo de venta largo entre completo. */}
            <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
              <Tile
                valor={data.cierre.tasaConversion == null ? "—" : `${data.cierre.tasaConversion}%`}
                etiqueta="Tasa de cierre"
                nota={
                  data.cierre.ganadas + data.cierre.perdidas > 0
                    ? `${data.cierre.ganadas} ganadas · ${data.cierre.perdidas} perdidas`
                    : "sin cierres en 90 días"
                }
              />
              <Tile
                valor={formatearDuracion(data.cierre.horasCicloPromedio)}
                etiqueta="Ciclo de venta"
                nota="promedio de lo ganado"
              />
              <Tile valor={formatearDinero(data.cierre.ingresoGanado)} etiqueta="Ingreso ganado" nota="últimos 90 días" />
              <Tile
                valor={data.cierre.estancadas}
                etiqueta="Sin moverse"
                nota="pasaron su umbral de alerta"
              />
            </div>

            <Seccion titulo="Cuánto cierra la IA sin ayuda">
              {!data.hayHistorial ? (
                <Vacio>
                  Todavía no hay movimientos registrados. Este número aparece en cuanto empieces a
                  mover oportunidades por el tablero del Pipeline.
                </Vacio>
              ) : (
                <div className="flex flex-col gap-3">
                  <div className="flex items-baseline gap-2">
                    <span className="font-candy-display text-2xl font-extrabold text-candy-tinta">
                      {data.autonomiaIA.cierresTotales
                        ? `${Math.round((data.autonomiaIA.cierresBot / data.autonomiaIA.cierresTotales) * 100)}%`
                        : "—"}
                    </span>
                    <span className="text-[12px] text-candy-tinta-media">
                      de los cierres los hizo el bot
                      {data.autonomiaIA.cierresTotales > 0 && (
                        <> ({data.autonomiaIA.cierresBot} de {data.autonomiaIA.cierresTotales})</>
                      )}
                    </span>
                  </div>
                  <div className="flex flex-col gap-2">
                    <BarraSimple
                      fila={{
                        etiqueta: "Bot",
                        cantidad: data.autonomiaIA.movimientosBot,
                        pct: porcentaje(data.autonomiaIA.movimientosBot, data.autonomiaIA.movimientosBot + data.autonomiaIA.movimientosHumano),
                      }}
                      color="#6ee7b7"
                    />
                    <BarraSimple
                      fila={{
                        etiqueta: "Personas",
                        cantidad: data.autonomiaIA.movimientosHumano,
                        pct: porcentaje(data.autonomiaIA.movimientosHumano, data.autonomiaIA.movimientosBot + data.autonomiaIA.movimientosHumano),
                      }}
                      color="#b98bff"
                    />
                  </div>
                  <p className="text-[11px] text-candy-tinta-tenue">
                    Movimientos de etapa por quién los hizo. El bot no puede atribuirse un
                    movimiento hecho por una persona: el actor lo decide la base, no quien llama.
                  </p>
                </div>
              )}
            </Seccion>

            <div className="grid gap-4 sm:gap-5 lg:grid-cols-2">
              <Seccion titulo="Dónde se atasca el proceso">
                {data.tiempoPorEtapa.length === 0 ? (
                  <Vacio>Sin movimientos suficientes para medir tiempos todavía.</Vacio>
                ) : (
                  <div className="flex flex-col gap-2.5">
                    {data.tiempoPorEtapa.map((t) => (
                      <div key={t.etapa} className="flex items-center gap-3">
                        <span className="w-[3px] h-[15px] rounded-sm shrink-0" style={{ background: t.color }} />
                        <span className="text-[12.5px] text-candy-tinta truncate flex-1">{t.etapa}</span>
                        <span className="text-[12.5px] font-bold text-candy-tinta">
                          {formatearDuracion(t.horasPromedio)}
                        </span>
                        <span className="text-[10.5px] text-candy-tinta-tenue w-[52px] text-right">
                          {t.muestras} {t.muestras === 1 ? "paso" : "pasos"}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </Seccion>

              <Seccion titulo="Por qué se pierden">
                {data.motivosPerdida.length === 0 ? (
                  <Vacio>Ninguna oportunidad perdida todavía.</Vacio>
                ) : (
                  <div className="flex flex-col gap-2">
                    {data.motivosPerdida.map((m) => (
                      <BarraSimple key={m.motivo} fila={{ etiqueta: m.motivo, cantidad: m.cantidad, pct: m.pct }} color="#f87171" />
                    ))}
                  </div>
                )}
              </Seccion>
            </div>

            <Seccion titulo="Embudo: de cada etapa, cuántas siguieron">
              {data.embudo.length === 0 ? (
                <Vacio>
                  El embudo se arma con el historial de movimientos. Aparece en cuanto las
                  oportunidades empiecen a recorrer etapas.
                </Vacio>
              ) : (
                <div className="flex flex-col gap-2.5">
                  {data.embudo.map((f) => (
                    <div key={f.etapa} className="flex items-center gap-3">
                      <div className="w-[110px] sm:w-[140px] shrink-0 text-[12.5px] font-bold text-candy-tinta truncate">
                        {f.etapa}
                      </div>
                      <div className="flex-1 h-3 rounded-full bg-white/50 border border-white/70 overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${Math.max(f.pctSiguio ?? 100, 4)}%`, background: f.color }}
                        />
                      </div>
                      <div className="w-[42px] shrink-0 text-right text-[12.5px] font-bold text-candy-tinta">
                        {f.llegaron}
                      </div>
                      <div className="w-[62px] shrink-0 text-right text-[11.5px] text-candy-tinta-media">
                        {f.pctSiguio == null ? "última" : `${f.pctSiguio}% siguió`}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Seccion>

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

            {/* Origen y atribución del lead — Grupo 1 de
                docs/indicadores-dashboard.md. Los dos indicadores de acá tienen
                niveles de confianza distintos, y por eso solo uno lleva el
                renglón de cobertura: ver el comentario en panel.js. */}
            <div className="grid gap-4 sm:gap-5 lg:grid-cols-2">
              <Seccion titulo="De dónde vienen los leads">
                {data.atribucion.clasificacion.length === 0 ? (
                  <Vacio>Sin contactos todavía.</Vacio>
                ) : (
                  <div className="flex flex-col gap-3">
                    <div className="flex flex-col gap-2">
                      {data.atribucion.clasificacion.map((f) => (
                        <BarraSimple
                          key={f.clave}
                          fila={f}
                          color={COLOR_FUENTE[f.clave] ?? "#9b8fb5"}
                        />
                      ))}
                    </div>
                    {/* La cobertura va SIEMPRE con este bloque: sin ella,
                        "2 referidos" se lee como "solo 2 personas nos
                        visitaron" en vez de "solo 2 tienen el dato". */}
                    <p className="text-[11px] text-candy-tinta-tenue leading-relaxed">
                      {data.atribucion.cobertura.conTouchpoint} de{" "}
                      {data.atribucion.cobertura.totalContactos} contactos tienen origen
                      registrado.
                      {data.atribucion.cobertura.conTouchpoint === 0 && (
                        <>
                          {" "}
                          Todo cae en "directo / sin rastro" porque nadie tiene un toque
                          guardado todavía — no porque hayan llegado solos.
                        </>
                      )}
                    </p>
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

            {/* #15 — Cobertura 100%: sale de `deals.fuente`, que existe en cada
                oportunidad. A diferencia del bloque de arriba, acá lo que se lee
                es verdad completa, sin salvedades. */}
            <Seccion titulo="Qué canal trae las ventas grandes">
              {data.atribucion.origenPorPipeline.length === 0 ? (
                <Vacio>Sin oportunidades todavía.</Vacio>
              ) : (
                <div className="flex flex-col gap-2.5">
                  {data.atribucion.origenPorPipeline.map((f) => (
                    <div key={`${f.fuente}-${f.tipoEmbudo}`} className="flex items-center gap-3">
                      <span className="w-[86px] shrink-0 text-[12.5px] font-bold text-candy-tinta truncate">
                        {f.fuente}
                      </span>
                      <span className="text-[10px] font-extrabold rounded-full px-2 py-0.5 bg-candy-tinta/8 text-candy-tinta-media shrink-0">
                        {f.tipoEmbudo}
                      </span>
                      <div className="flex-1 h-2.5 rounded-full bg-white/50 border border-white/70 overflow-hidden min-w-[30px]">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${Math.max(f.pct, 4)}%`, background: "#b98bff" }}
                        />
                      </div>
                      <span className="w-[34px] shrink-0 text-right text-[12.5px] font-bold text-candy-tinta">
                        {f.cantidad}
                      </span>
                      <span className="w-[62px] shrink-0 text-right text-[11.5px] text-candy-tinta-media">
                        {formatearDinero(f.valor)}
                      </span>
                    </div>
                  ))}
                  <p className="text-[11px] text-candy-tinta-tenue leading-relaxed">
                    El canal que trae más leads no es siempre el que trae más dinero — por eso la
                    columna de la derecha importa más que la del medio.
                  </p>
                </div>
              )}
            </Seccion>

            <Seccion titulo="Actividad de los últimos 14 días">
              <Actividad dias={data.actividad} />
            </Seccion>

            <p className="text-[11.5px] text-candy-tinta-tenue leading-relaxed">
              Los bloques de cierre, embudo y tiempos se calculan desde el historial de
              movimientos: se llenan a medida que las oportunidades recorran etapas en el Pipeline.
              Lo que todavía no está activo es el análisis de IA por conversación (score,
              sentimiento, interés), que llega con el agente Analista, y el porcentaje de
              conversaciones resueltas por IA, que necesita que los agentes conversacionales
              marquen cuándo resolvieron una.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// Un color por tipo de origen, con intención: el pagado en rosa (es plata que
// sale), la campaña en azul, el referido en menta (llegó gratis), y el
// "sin rastro" en gris — no es una categoría real, es la ausencia de dato.
const COLOR_FUENTE = {
  pagado: "#ff5ca8",
  campana: "#5b9bff",
  referido: "#6ee7b7",
  directo: "#9b8fb5",
};

/** Porcentaje entero, 0 si el total es 0 — evita NaN en las barras. */
function porcentaje(parte, total) {
  return total ? Math.round((parte / total) * 100) : 0;
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
