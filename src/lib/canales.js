// Estilo por canal — mismo mapeo que design/CandyInbox.dc.html, con colores
// de marca de cada plataforma (WhatsApp verde, Instagram degradado, etc.),
// no los de Candy + Aero: el badge del canal necesita ser reconocible como
// "esto es WhatsApp" de un vistazo, no combinar con la paleta del CRM.

export const CANALES = {
  whatsapp: {
    etiqueta: "WhatsApp",
    gradiente: "linear-gradient(135deg, #25D366, #128C7E)",
  },
  instagram: {
    etiqueta: "Instagram",
    gradiente: "linear-gradient(135deg, #f58529, #dd2a7b, #8134af)",
  },
  messenger: {
    etiqueta: "Messenger",
    gradiente: "linear-gradient(135deg, #00c6ff, #0072ff)",
  },
  linkedin: {
    etiqueta: "LinkedIn",
    gradiente: "linear-gradient(135deg, #0A66C2, #004182)",
  },
  chat_web: {
    etiqueta: "Chat web",
    gradiente: "linear-gradient(135deg, #5b9bff, #b98bff)",
  },
};

const CANAL_DEFECTO = { etiqueta: "Canal", gradiente: "linear-gradient(135deg, #9b8fb5, #8478a0)" };

export function estiloCanal(canal) {
  return CANALES[canal] ?? CANAL_DEFECTO;
}

export function iniciales(nombre) {
  if (!nombre) return "?";
  return nombre
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();
}

export function formatearDinero(valor) {
  if (valor == null) return "—";
  if (valor >= 1_000_000) return "$" + (valor / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (valor >= 1_000) return "$" + (valor / 1_000).toFixed(0) + "k";
  return "$" + valor;
}

const SENTIMIENTOS = {
  positivo: { etiqueta: "Positivo", fg: "#d6367d", bg: "rgba(255,92,168,0.16)" },
  neutro: { etiqueta: "Neutro", fg: "#3f7fe0", bg: "rgba(91,155,255,0.16)" },
  negativo: { etiqueta: "Negativo", fg: "#7a6a99", bg: "rgba(150,120,200,0.16)" },
};

export function estiloSentimiento(sentimiento) {
  return SENTIMIENTOS[sentimiento] ?? null;
}

export function estiloScore(score) {
  if (score == null) return { fg: "#7a6a99", bg: "rgba(150,120,200,0.14)" };
  if (score >= 75) return { fg: "#e0397f", bg: "rgba(255,92,168,0.16)" };
  if (score >= 50) return { fg: "#3f7fe0", bg: "rgba(91,155,255,0.16)" };
  return { fg: "#7a6a99", bg: "rgba(150,120,200,0.14)" };
}

/** Formatea una hora relativa simple: "10:24" si es hoy, "vie" si esta semana, fecha corta si no. */
export function formatearHora(iso) {
  if (!iso) return "";
  const fecha = new Date(iso);
  const ahora = new Date();
  const mismoDia = fecha.toDateString() === ahora.toDateString();
  if (mismoDia) {
    return fecha.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });
  }
  const diffDias = Math.floor((ahora - fecha) / (1000 * 60 * 60 * 24));
  if (diffDias < 7) {
    return fecha.toLocaleDateString("es-CO", { weekday: "short" }).replace(".", "");
  }
  return fecha.toLocaleDateString("es-CO", { day: "2-digit", month: "short" });
}
