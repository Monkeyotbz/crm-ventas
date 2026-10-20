import { supabase } from "./supabase.js";

// ¿Quien tiene la sesión abierta es administrador de PLATAFORMA (el equipo de Hellominus que opera
// el SaaS)? No es un rol de tenant: `admin`/`owner` de un cliente NO lo son.
//
// `is_platform_admin()` vive en el schema `private`, así que el navegador no puede llamarla. Pero la
// policy de `platform_admins` solo deja leer filas a un admin de plataforma: si la consulta devuelve
// una fila, lo es; si vuelve vacía —que es lo que ve cualquier otro— no lo es. No requiere migración.
//
// Esto decide solo si se MUESTRA un enlace. No es seguridad: lo que hay detrás del enlace
// (el laboratorio RAG) tiene que protegerse por su cuenta, porque esconder un botón no cierra nada.
export async function esAdminPlataforma() {
  const { data, error } = await supabase.from("platform_admins").select("user_id").limit(1);
  if (error) return false;
  return (data?.length ?? 0) > 0;
}

// Dirección del laboratorio RAG (Streamlit). Sin esta variable el enlace no aparece, así que pasar de
// local (http://localhost:8501) a una dirección en línea es cambiar una variable de entorno.
export const URL_LABORATORIO_RAG = import.meta.env.VITE_LABORATORIO_RAG_URL || "";
