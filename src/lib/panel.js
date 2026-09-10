import { supabase } from "./supabase.js";
import { CANALES } from "./canales.js";

// Métricas del panel del tenant — lo que cada empresa-cliente ve sobre SU
// propio negocio. (El panel de plataforma, el del equipo que opera Candy CRM,
// es otra pantalla y no pasa por acá.)
//
// v1 agrega del lado del cliente a propósito, sin vista SQL ni tabla de
// snapshots: el volumen hoy es mínimo y las métricas van a cambiar seguido —
// iterar sobre JS es más barato que sobre migraciones. Cuando un tenant tenga
// miles de filas, esto se muda a una vista `security_invoker` (patrón de
// `inbox_conversaciones`) o a poblar `metrics_snapshots`, que ya existe para eso.
//
// NO se filtra por tenant_id a mano, a diferencia de catalogo.js: estas tablas
// no tienen policy pública, así que la RLS ya alcanza. Y hace algo que conviene
// no romper — un `agent` solo ve sus propios deals y conversaciones
// (`owner_id = auth.uid()`), mientras que un `owner`/`admin` ve los de todo el
// tenant. El panel hereda esa diferencia sin una línea extra.

const DIAS_ACTIVIDAD = 14;
const DIAS_NUEVOS = 30;

/** Etiqueta legible de un canal/fuente; cae al valor crudo si no lo conocemos. */
function etiquetaOrigen(valor) {
  if (!valor) return "Sin dato";
  return CANALES[valor]?.etiqueta ?? valor;
}

function haceDias(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** yyyy-mm-dd local, para agrupar por día sin que el huso corra las fechas. */
function claveDia(fecha) {
  const d = new Date(fecha);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Cuenta por clave y devuelve [{ etiqueta, cantidad, pct }] ordenado desc. */
function distribucion(filas, campo) {
  const total = filas.length;
  if (!total) return [];
  const cuenta = new Map();
  for (const f of filas) {
    const k = f[campo] ?? null;
    cuenta.set(k, (cuenta.get(k) ?? 0) + 1);
  }
  return [...cuenta.entries()]
    .map(([k, cantidad]) => ({
      clave: k,
      etiqueta: etiquetaOrigen(k),
      cantidad,
      pct: Math.round((cantidad / total) * 100),
    }))
    .sort((a, b) => b.cantidad - a.cantidad);
}

const VACIO = {
  resumen: {
    convsAbiertas: 0,
    contactos: 0,
    contactosNuevos: 0,
    oportunidades: 0,
    valorPipeline: 0,
    forecast: 0,
  },
  pipeline: [],
  origen: [],
  canales: [],
  actividad: [],
  hayDatos: false,
};

export async function obtenerMetricasPanel() {
  const { data: sesion } = await supabase.auth.getSession();
  if (!sesion?.session?.user?.app_metadata?.tenant_id) return VACIO;

  const desdeActividad = haceDias(DIAS_ACTIVIDAD).toISOString();
  const desdeNuevos = haceDias(DIAS_NUEVOS).toISOString();

  const [deals, etapas, conversaciones, contactos, mensajes] = await Promise.all([
    supabase.from("deals").select("id, valor_estimado, probabilidad, fuente, stage_id, created_at"),
    supabase.from("pipeline_stages").select("id, nombre, orden, color"),
    supabase.from("conversations").select("id, canal, estado, created_at"),
    supabase.from("contacts").select("id, origen, created_at"),
    // `messages` no tiene tenant_id: su RLS cuelga de conversations, y por eso
    // esta consulta ya viene aislada sin filtro explícito.
    supabase.from("messages").select("id, direccion, created_at").gte("created_at", desdeActividad),
  ]);

  for (const [nombre, res] of [
    ["deals", deals],
    ["pipeline_stages", etapas],
    ["conversations", conversaciones],
    ["contacts", contactos],
    ["messages", mensajes],
  ]) {
    if (res.error) throw new Error(`${nombre}: ${res.error.message}`);
  }

  const filasDeals = deals.data ?? [];
  const filasConvs = conversaciones.data ?? [];
  const filasContactos = contactos.data ?? [];
  const filasMensajes = mensajes.data ?? [];

  // --- Resumen ---
  const valorPipeline = filasDeals.reduce((s, d) => s + Number(d.valor_estimado ?? 0), 0);
  // Forecast ponderado: cada oportunidad vale su monto por su probabilidad de
  // cierre. Sin probabilidad cargada suma 0, no el monto entero — preferimos
  // quedarnos cortos antes que inflar una previsión.
  const forecast = filasDeals.reduce(
    (s, d) => s + (Number(d.valor_estimado ?? 0) * Number(d.probabilidad ?? 0)) / 100,
    0,
  );

  const resumen = {
    convsAbiertas: filasConvs.filter((c) => c.estado === "abierta").length,
    contactos: filasContactos.length,
    contactosNuevos: filasContactos.filter((c) => c.created_at >= desdeNuevos).length,
    oportunidades: filasDeals.length,
    valorPipeline,
    forecast,
  };

  // --- Pipeline por etapa ---
  // Se listan solo las etapas que tienen al menos un deal: un tenant nuevo
  // arranca con 7 etapas vacías y mostrarlas todas en cero es puro ruido.
  const porEtapa = new Map();
  for (const d of filasDeals) {
    const actual = porEtapa.get(d.stage_id) ?? { cantidad: 0, valor: 0 };
    actual.cantidad += 1;
    actual.valor += Number(d.valor_estimado ?? 0);
    porEtapa.set(d.stage_id, actual);
  }
  const etapasPorId = new Map((etapas.data ?? []).map((e) => [e.id, e]));
  const pipeline = [...porEtapa.entries()]
    .map(([stageId, v]) => {
      const e = etapasPorId.get(stageId);
      return {
        etapa: e?.nombre ?? "Sin etapa",
        color: e?.color ?? "#9b8fb5",
        orden: e?.orden ?? 999,
        cantidad: v.cantidad,
        valor: v.valor,
      };
    })
    .sort((a, b) => a.orden - b.orden);

  // --- Actividad de los últimos días ---
  const porDia = new Map();
  for (let i = DIAS_ACTIVIDAD - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    porDia.set(claveDia(d), { dia: claveDia(d), entrantes: 0, salientes: 0 });
  }
  for (const m of filasMensajes) {
    const fila = porDia.get(claveDia(m.created_at));
    if (!fila) continue; // fuera de la ventana por diferencia de huso
    if (m.direccion === "out") fila.salientes += 1;
    else fila.entrantes += 1;
  }

  return {
    resumen,
    pipeline,
    origen: distribucion(filasDeals, "fuente"),
    canales: distribucion(filasConvs, "canal"),
    actividad: [...porDia.values()],
    hayDatos: filasDeals.length + filasConvs.length + filasContactos.length > 0,
  };
}
