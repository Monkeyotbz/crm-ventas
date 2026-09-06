// Tokens de color por canal, tomados 1:1 de design/CandyInbox.dc.html
// (el mock de Claude Design). No reusar los de design/ChannelIcon.dc.html o
// design/ScoreBadge.dc.html: quedaron con la paleta neon oscura vieja y ya
// no son consistentes con la dirección "Candy + Aero" elegida.

export const CHANNEL_GRADIENTS = {
  chat_web: "linear-gradient(135deg, #5b9bff, #b98bff)",
  whatsapp: "linear-gradient(135deg, #25D366, #128C7E)",
  instagram: "linear-gradient(135deg, #f58529, #dd2a7b, #8134af)",
  messenger: "linear-gradient(135deg, #00c6ff, #0072ff)",
  linkedin: "linear-gradient(135deg, #0A66C2, #004182)",
};

export const CHANNEL_FLAT_COLORS = {
  todos: "#7a6a99",
  chat_web: "#5b9bff",
  whatsapp: "#25D366",
  instagram: "#dd2a7b",
  messenger: "#0072ff",
  linkedin: "#0A66C2",
};

export const CHANNEL_LABELS = {
  todos: "Todos",
  chat_web: "Chat web",
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  messenger: "Messenger",
  linkedin: "LinkedIn",
};

export function scoreStyle(score) {
  if (score >= 75) return { color: "#e0397f", background: "rgba(255,92,168,0.16)" };
  if (score >= 50) return { color: "#3f7fe0", background: "rgba(91,155,255,0.16)" };
  return { color: "#7a6a99", background: "rgba(150,120,200,0.14)" };
}

export function sentimentStyle(sentimiento) {
  if (sentimiento === "positivo") return { color: "#d6367d", background: "rgba(255,92,168,0.16)" };
  if (sentimiento === "neutro") return { color: "#3f7fe0", background: "rgba(91,155,255,0.16)" };
  return { color: "#7a6a99", background: "rgba(150,120,200,0.16)" };
}

export function formatMoney(n) {
  if (n === null || n === undefined) return "—";
  return "$" + (n / 1e6).toFixed(1).replace(".0", "") + "M";
}
