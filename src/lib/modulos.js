import { supabase } from "./supabase.js";

// Módulos de candyCRM activados para el tenant de la sesión — ver la migración
// 20260910120000. Con esto el frontend decide qué se le OFRECE a cada tenant:
// un tenant sin 'catalogo' no ve esa pestaña.
//
// No es seguridad: el aislamiento de datos ya lo dan la RLS y los filtros por
// tenant. Esto es solo la navegación.
export async function obtenerModulos() {
  // RLS de `tenants` devuelve solo la fila del propio tenant.
  const { data, error } = await supabase.from("tenants").select("modulos").maybeSingle();
  if (error) throw new Error(`tenants.modulos: ${error.message}`);
  // 'crm' es el núcleo — si por algún motivo no vino nada, se asume el mínimo.
  return data?.modulos?.length ? data.modulos : ["crm"];
}
