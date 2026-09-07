// Autoservicio de claves de la API de ingesta (candidato [9a], segunda mitad).
// Ver la migración 20260907120000 para el diseño completo.
//
// Igual que configuracionMeta.js: los secretos van en una sola dirección. La
// clave en claro existe UNA vez, en la respuesta de `crear_api_key`, y de ahí
// en más ni la base ni esta capa pueden recuperarla — solo queda su hash.

import { supabase } from "./supabase.js";

/**
 * Claves del propio tenant. RLS ya filtra a "admin del propio tenant", así que
 * no hace falta pasar ningún tenant_id acá. `hash_clave` no se pide: no sirve
 * para nada del lado del navegador.
 */
export async function listarClavesApi() {
  const { data, error } = await supabase
    .from("tenant_api_keys")
    .select("id, nombre, prefijo, activo, ultimo_uso_at, created_at")
    .order("created_at", { ascending: false });

  if (error) throw new Error(`tenant_api_keys: ${error.message}`);
  return data ?? [];
}

/**
 * Crea una clave y devuelve su valor EN CLARO. Es la única vez que se puede
 * leer: quien llame a esto tiene que mostrarla al usuario en ese momento, y
 * dejar claro que no va a volver a estar disponible.
 */
export async function crearClaveApi(nombre) {
  const { data, error } = await supabase.rpc("crear_api_key", { p_nombre: nombre });
  if (error) throw new Error(error.message);
  return data;
}

/** Desactiva una clave. No la borra: queda su rastro para poder auditarla. */
export async function revocarClaveApi(id) {
  const { error } = await supabase.rpc("revocar_api_key", { p_id: id });
  if (error) throw new Error(error.message);
}

/** La URL del endpoint de ingesta. No es secreta. */
export function urlDeIngesta() {
  return `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ingesta-api`;
}
