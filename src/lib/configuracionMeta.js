// Autoservicio de credenciales de Meta por tenant (candidato [9a],
// docs/DECISIONES.md). Ver la migración 20260906000001 para el diseño
// completo: los secretos nunca pasan por acá en texto plano hacia atrás —
// esto solo los MANDA (guardarConfiguracionMeta), nunca los pide de vuelta.

import { supabase } from "./supabase.js";

/**
 * Rol del usuario logueado en su propio tenant. RLS de `team_members` ya
 * deja ver la propia fila sin importar el rol — no hace falta filtrar por
 * tenant_id acá, current_tenant_id() lo hace del lado de la base.
 */
export async function obtenerMiRol() {
  const { data: sesion } = await supabase.auth.getSession();
  const userId = sesion?.session?.user?.id;
  if (!userId) return null;

  const { data, error } = await supabase
    .from("team_members")
    .select("rol")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error(`team_members: ${error.message}`);
  return data?.rol ?? null;
}

/**
 * Estado actual de la configuración de Meta de este tenant — solo metadata
 * (meta_app_id, si está activo), nunca los secretos. RLS ya filtra a "admin
 * del propio tenant"; si no hay fila, significa que todavía no configuró
 * nada, no es un error.
 */
export async function obtenerConfiguracionMeta() {
  const { data, error } = await supabase
    .from("tenant_meta_credentials")
    .select("meta_app_id, activo, updated_at")
    .maybeSingle();

  if (error) throw new Error(`tenant_meta_credentials: ${error.message}`);
  return data ?? null;
}

/** El número de WhatsApp de este tenant, si ya se configuró uno. */
export async function obtenerNumeroWhatsapp() {
  const { data, error } = await supabase
    .from("whatsapp_numbers")
    .select("phone_number_id, waba_id, numero_display, activo")
    .maybeSingle();

  if (error) throw new Error(`whatsapp_numbers: ${error.message}`);
  return data ?? null;
}

/**
 * Guarda (o rota) las credenciales de Meta y el número de WhatsApp de este
 * tenant, en una sola llamada atómica del lado de la base — ver
 * guardar_credenciales_meta en la migración. Nunca vuelve a mostrar estos
 * valores después de guardados.
 */
export async function guardarConfiguracionMeta({
  metaAppId,
  appSecret,
  verifyToken,
  accessToken,
  phoneNumberId,
  wabaId,
  numeroDisplay,
}) {
  const { error } = await supabase.rpc("guardar_credenciales_meta", {
    p_meta_app_id: metaAppId,
    p_app_secret: appSecret,
    p_verify_token: verifyToken,
    p_access_token: accessToken,
    p_phone_number_id: phoneNumberId,
    p_waba_id: wabaId,
    p_numero_display: numeroDisplay,
  });

  if (error) throw new Error(error.message);
}

/** La Callback URL que este tenant tiene que pegar en SU propio panel de Meta. */
export async function obtenerCallbackUrlPropia() {
  const { data: sesion } = await supabase.auth.getSession();
  const tenantId = sesion?.session?.user?.app_metadata?.tenant_id;
  if (!tenantId) return null;

  const base = import.meta.env.VITE_SUPABASE_URL;
  return `${base}/functions/v1/ingesta-whatsapp/${tenantId}`;
}
