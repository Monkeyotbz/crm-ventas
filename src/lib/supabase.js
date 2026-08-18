// Cliente de Supabase del frontend. Usa la clave "anon" (segura para el
// navegador): el aislamiento de datos real lo hacen las políticas RLS del
// esquema (ver supabase/setup.sql), no esta clave.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "";

export const supabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

export const supabase = supabaseConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;
