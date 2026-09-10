import { supabase } from "./supabase.js";

// Vista de solo lectura del catálogo turístico (destinos, hospedajes, tours —
// ver la migración 20260904120000). La escritura tiene RLS de admin/owner; acá
// solo se lee. Los textos son jsonb { es, en } y el MVP llena solo "es".

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "";

/** Texto de un campo i18n { es, en }. */
export function txt(campo) {
  if (!campo || typeof campo !== "object") return typeof campo === "string" ? campo : "";
  return campo.es || campo.en || "";
}

/** URL pública de una imagen del bucket `catalog` (el bucket es público). */
export function urlImagen(storagePath) {
  if (!storagePath) return null;
  return `${SUPABASE_URL}/storage/v1/object/public/catalog/${storagePath}`;
}

const TIPOS = {
  destinos: {
    tabla: "destinations",
    select:
      "id,slug,status,featured,sort_order,name,region,country,tagline,description," +
      "destination_images(storage_path,is_cover,sort_order)",
  },
  hospedajes: {
    tabla: "accommodations",
    select:
      "id,slug,status,featured,sort_order,type,name,summary,description,city,region,country," +
      "price_from,currency,max_guests,bedrooms,beds,bathrooms,location_note," +
      "external_booking_url,external_platform," +
      "accommodation_images(storage_path,is_cover,sort_order)," +
      "accommodation_features(features(slug,kind,icon,label))",
  },
  tours: {
    tabla: "tours",
    select:
      "id,slug,status,featured,sort_order,category,name,summary,description,city,region," +
      "price_from,currency,duration_label,duration_hours,schedule_label,difficulty,min_pax,max_pax," +
      "tour_images(storage_path,is_cover,sort_order)," +
      "tour_features(features(slug,kind,icon,label))",
  },
};

export const TIPOS_CATALOGO = [
  { clave: "destinos", etiqueta: "Destinos" },
  { clave: "hospedajes", etiqueta: "Hospedajes" },
  { clave: "tours", etiqueta: "Tours" },
];

export async function listarCatalogo(tipo) {
  const cfg = TIPOS[tipo];
  if (!cfg) throw new Error(`tipo de catálogo desconocido: ${tipo}`);

  // Filtro por tenant EXPLÍCITO, no confiando solo en RLS. Estas tablas tienen
  // dos policies de SELECT que Postgres combina con OR: una por
  // `current_tenant_id()` y otra pública por `status = 'published'` (para que el
  // sitio público del tenant —ej. turismocolombia.fit— lea su catálogo sin
  // login). Sin este `.eq`, esta pantalla —que es la administración interna, no
  // el sitio público— mostraría los ítems publicados de CUALQUIER tenant.
  const { data: sesion } = await supabase.auth.getSession();
  const tenantId = sesion?.session?.user?.app_metadata?.tenant_id;
  if (!tenantId) return [];

  const { data, error } = await supabase
    .from(cfg.tabla)
    .select(cfg.select)
    .eq("tenant_id", tenantId)
    .order("sort_order", { ascending: true, nullsFirst: false })
    .order("id", { ascending: true });

  if (error) throw new Error(`${cfg.tabla}: ${error.message}`);
  return (data ?? []).map(normalizar);
}

// Aplana la forma que devuelve PostgREST (nombres de relación distintos por
// tabla) a algo uniforme: `imagenes` ordenadas (portada primero) y `features`.
function normalizar(row) {
  const imgs = row.destination_images || row.accommodation_images || row.tour_images || [];
  const imagenes = [...imgs].sort(
    (a, b) => Number(b.is_cover) - Number(a.is_cover) || (a.sort_order ?? 0) - (b.sort_order ?? 0),
  );
  const feats = (row.accommodation_features || row.tour_features || [])
    .map((f) => f.features)
    .filter(Boolean);

  return {
    ...row,
    nombre: txt(row.name),
    imagenes,
    features: feats,
    portada: imagenes[0]?.storage_path ?? null,
  };
}

/** Precio "desde" formateado, o null si no hay. */
export function precioDesde(row) {
  if (row.price_from == null) return null;
  const n = Number(row.price_from);
  const fmt = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 });
  return `${row.currency || ""} ${fmt.format(n)}`.trim();
}

export const ETIQUETA_ESTADO = {
  published: "Publicado",
  draft: "Borrador",
  archived: "Archivado",
};
