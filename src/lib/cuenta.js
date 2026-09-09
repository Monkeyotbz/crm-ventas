import { supabase } from "./supabase.js";

// Mini-administración de la propia cuenta. Los datos personales (nombre,
// teléfono, cargo) viven en `user_metadata` — el usuario SÍ lo puede editar
// desde el cliente, a diferencia de `app_metadata` (que lleva el tenant_id y
// nunca se toca desde acá). El rol y el nombre del espacio son de solo
// lectura: salen de team_members y tenants, con sus RLS.

export async function obtenerPerfil() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const [miembro, tenant] = await Promise.all([
    supabase.from("team_members").select("rol").eq("user_id", user.id).maybeSingle(),
    supabase.from("tenants").select("nombre").maybeSingle(), // RLS: devuelve solo el propio
  ]);
  if (miembro.error) throw new Error(`team_members: ${miembro.error.message}`);

  const md = user.user_metadata ?? {};
  return {
    email: user.email ?? "",
    rol: miembro.data?.rol ?? null,
    espacio: tenant.data?.nombre ?? null,
    nombre: md.nombre ?? "",
    telefono: md.telefono ?? "",
    cargo: md.cargo ?? "",
  };
}

/** Guarda los datos personales editables en user_metadata. */
export async function guardarPerfil({ nombre, telefono, cargo }) {
  const limpio = (v) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
  const { error } = await supabase.auth.updateUser({
    data: { nombre: limpio(nombre), telefono: limpio(telefono), cargo: limpio(cargo) },
  });
  if (error) throw new Error(error.message);
}

export function cerrarSesion() {
  return supabase.auth.signOut();
}

/** Iniciales para el botón de cuenta de la barra superior. */
export function iniciales({ nombre, email } = {}) {
  const base = (nombre || email || "").trim();
  if (!base) return "?";
  const partes = base.split(/[\s@.]+/).filter(Boolean);
  return (partes[0]?.[0] ?? "") + (partes[1]?.[0] ?? "");
}
