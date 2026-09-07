#!/usr/bin/env node
/**
 * Importa el catálogo turístico (destinos, hospedajes, tours) al módulo
 * nuevo del esquema (ver supabase/migrations/20260904120000_catalogo_turistico_*.sql),
 * bajo el tenant "Turismo Colombia".
 *
 * Fuente: catalog/catalog.json y public/ del repo hermano turismocolombia-website
 * (rutas relativas — asume ambos repos clonados lado a lado en projects/, como en
 * este workspace; se pueden override con las env vars de abajo).
 *
 * Usa la service_role key (bypassa RLS): requerido para crear el tenant y para
 * escribir sin que exista todavía un usuario admin logueado.
 *
 *   node scripts/importar-catalogo-turismo.mjs
 *
 * Idempotente: upsert por (tenant_id, slug) en destinations/accommodations/tours/
 * features; las tablas de imágenes y de features asociadas se reemplazan enteras
 * por tenant/padre en cada corrida (mismo criterio que catalog/build-sql.mjs en
 * turismocolombia-website).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');

function loadEnv(path) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return;
  }
  for (const line of text.split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}
loadEnv(join(repoRoot, '.env'));

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Faltan VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (ver .env).');
  process.exit(1);
}

const CATALOG_JSON = process.env.CATALOG_JSON_PATH || join(repoRoot, '..', 'turismocolombia-website', 'catalog', 'catalog.json');
const PUBLIC_DIR = process.env.CATALOG_PUBLIC_DIR || join(repoRoot, '..', 'turismocolombia-website', 'public');
const BUCKET = process.env.CATALOG_BUCKET || 'catalog';
const TENANT_SLUG = 'turismo-colombia';
const TENANT_NOMBRE = 'Turismo Colombia';
// Prefijo del bucket: el bucket es único para todo candyCRM (no hay Storage por
// tenant), así que el aislamiento entre tenants-cliente lo da este prefijo, no RLS.
const STORAGE_PREFIX = TENANT_SLUG;

const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const catalog = JSON.parse(readFileSync(CATALOG_JSON, 'utf8'));

async function ensureTenant() {
  const { data: existing, error: selErr } = await sb.from('tenants').select('id').eq('slug', TENANT_SLUG).maybeSingle();
  if (selErr) throw new Error(`tenants (select): ${selErr.message}`);
  if (existing) return existing.id;
  const { data, error } = await sb.from('tenants').insert({ nombre: TENANT_NOMBRE, slug: TENANT_SLUG }).select('id').single();
  if (error) throw new Error(`tenants (insert): ${error.message}`);
  return data.id;
}

async function upsertEntities(table, tenantId, items, mapRow) {
  if (!items.length) return new Map();
  const rows = items.map((it) => ({ tenant_id: tenantId, ...mapRow(it) }));
  const { data, error } = await sb.from(table).upsert(rows, { onConflict: 'tenant_id,slug' }).select('id, slug');
  if (error) throw new Error(`${table} (upsert): ${error.message}`);
  return new Map(data.map((r) => [r.slug, r.id]));
}

async function replaceImages(table, fkColumn, tenantId, idBySlug, items) {
  const parentIds = [...idBySlug.values()];
  if (parentIds.length) {
    const { error } = await sb.from(table).delete().in(fkColumn, parentIds);
    if (error) throw new Error(`${table} (delete): ${error.message}`);
  }
  const rows = [];
  for (const it of items) {
    const parentId = idBySlug.get(it.slug);
    if (parentId == null) continue;
    for (const im of it.images ?? []) {
      rows.push({
        tenant_id: tenantId,
        [fkColumn]: parentId,
        storage_path: `${STORAGE_PREFIX}/${im.storage_path}`,
        is_cover: !!im.is_cover,
        sort_order: im.sort_order ?? 0,
        alt: im.alt ?? null,
      });
    }
  }
  if (rows.length) {
    const { error } = await sb.from(table).insert(rows);
    if (error) throw new Error(`${table} (insert): ${error.message}`);
  }
  return rows.length;
}

async function replaceFeatureLinks(table, fkColumn, tenantId, idBySlug, items, featureIdBySlug) {
  const parentIds = [...idBySlug.values()];
  if (parentIds.length) {
    const { error } = await sb.from(table).delete().in(fkColumn, parentIds);
    if (error) throw new Error(`${table} (delete): ${error.message}`);
  }
  const rows = [];
  for (const it of items) {
    const parentId = idBySlug.get(it.slug);
    if (parentId == null) continue;
    for (const slug of it.feature_slugs ?? []) {
      const featureId = featureIdBySlug.get(slug);
      if (featureId == null) {
        console.warn(`  feature desconocida "${slug}" en ${it.slug} — saltada`);
        continue;
      }
      rows.push({ tenant_id: tenantId, [fkColumn]: parentId, feature_id: featureId });
    }
  }
  if (rows.length) {
    const { error } = await sb.from(table).insert(rows);
    if (error) throw new Error(`${table} (insert): ${error.message}`);
  }
  return rows.length;
}

const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

async function ensureBucket() {
  const { data: buckets, error } = await sb.storage.listBuckets();
  if (error) throw new Error(`storage.listBuckets: ${error.message}`);
  if (buckets.some((b) => b.name === BUCKET)) return;
  const { error: createErr } = await sb.storage.createBucket(BUCKET, { public: true });
  if (createErr) throw new Error(`storage.createBucket: ${createErr.message}`);
  console.log(`Bucket "${BUCKET}" creado (público).`);
}

async function uploadImages(items) {
  let ok = 0;
  let fail = 0;
  for (const it of items) {
    for (const im of it.images ?? []) {
      const localPath = join(PUBLIC_DIR, im.source);
      let buf;
      try {
        buf = readFileSync(localPath);
      } catch {
        console.warn(`  SKIP (no existe en disco): ${im.source}`);
        fail++;
        continue;
      }
      const dest = `${STORAGE_PREFIX}/${im.storage_path}`;
      const { error } = await sb.storage.from(BUCKET).upload(dest, buf, {
        contentType: MIME[extname(dest).toLowerCase()] ?? 'application/octet-stream',
        upsert: true,
      });
      if (error) {
        console.error(`  ERROR ${dest}: ${error.message}`);
        fail++;
      } else {
        ok++;
      }
    }
  }
  return { ok, fail };
}

async function main() {
  console.log(`Catálogo: ${CATALOG_JSON}`);
  console.log(`Imágenes: ${PUBLIC_DIR}`);

  const tenantId = await ensureTenant();
  console.log(`Tenant "${TENANT_NOMBRE}" (${TENANT_SLUG}): ${tenantId}`);

  const featureIdBySlug = await upsertEntities('features', tenantId, catalog.features, (f) => ({
    slug: f.slug,
    kind: f.kind,
    icon: f.icon ?? null,
    sort_order: f.sort_order ?? null,
    label: f.label,
  }));
  console.log(`features: ${featureIdBySlug.size}`);

  const destIdBySlug = await upsertEntities('destinations', tenantId, catalog.destinations, (d) => ({
    slug: d.slug,
    status: d.status,
    featured: !!d.featured,
    sort_order: d.sort_order ?? null,
    name: d.name,
    region: d.region ?? null,
    country: d.country ?? null,
    tagline: d.tagline ?? null,
    description: d.description ?? null,
    hero_image_path: d.hero_image_path ?? null,
  }));
  console.log(`destinations: ${destIdBySlug.size}`);
  const destImgCount = await replaceImages('destination_images', 'destination_id', tenantId, destIdBySlug, catalog.destinations);
  console.log(`  destination_images: ${destImgCount}`);

  const accIdBySlug = await upsertEntities('accommodations', tenantId, catalog.accommodations, (a) => ({
    slug: a.slug,
    type: a.type,
    status: a.status,
    featured: !!a.featured,
    sort_order: a.sort_order ?? null,
    name: a.name,
    summary: a.summary ?? null,
    description: a.description ?? null,
    city: a.city ?? null,
    region: a.region ?? null,
    country: a.country ?? null,
    destination_id: destIdBySlug.get(a.destination_slug) ?? null,
    price_from: a.price_from ?? null,
    currency: a.currency ?? 'COP',
    max_guests: a.max_guests ?? null,
    bedrooms: a.bedrooms ?? null,
    beds: a.beds ?? null,
    bathrooms: a.bathrooms ?? null,
    location_note: a.location_note ?? null,
    external_booking_url: a.external_booking_url ?? null,
    external_platform: a.external_platform ?? null,
  }));
  console.log(`accommodations: ${accIdBySlug.size}`);
  const accImgCount = await replaceImages('accommodation_images', 'accommodation_id', tenantId, accIdBySlug, catalog.accommodations);
  console.log(`  accommodation_images: ${accImgCount}`);
  const accFeatCount = await replaceFeatureLinks('accommodation_features', 'accommodation_id', tenantId, accIdBySlug, catalog.accommodations, featureIdBySlug);
  console.log(`  accommodation_features: ${accFeatCount}`);

  const tourIdBySlug = await upsertEntities('tours', tenantId, catalog.tours, (t) => ({
    slug: t.slug,
    status: t.status,
    featured: !!t.featured,
    sort_order: t.sort_order ?? null,
    category: t.category ?? null,
    name: t.name,
    summary: t.summary ?? null,
    description: t.description ?? null,
    city: t.city ?? null,
    region: t.region ?? null,
    destination_id: destIdBySlug.get(t.destination_slug) ?? null,
    price_from: t.price_from ?? null,
    currency: t.currency ?? 'COP',
    duration_label: t.duration_label ?? null,
    duration_hours: t.duration_hours ?? null,
    schedule_label: t.schedule_label ?? null,
    difficulty: t.difficulty ?? null,
    min_pax: t.min_pax ?? null,
    max_pax: t.max_pax ?? null,
  }));
  console.log(`tours: ${tourIdBySlug.size}`);
  const tourImgCount = await replaceImages('tour_images', 'tour_id', tenantId, tourIdBySlug, catalog.tours);
  console.log(`  tour_images: ${tourImgCount}`);
  const tourFeatCount = await replaceFeatureLinks('tour_features', 'tour_id', tenantId, tourIdBySlug, catalog.tours, featureIdBySlug);
  console.log(`  tour_features: ${tourFeatCount}`);

  await ensureBucket();
  console.log('Subiendo imágenes a Storage…');
  const allItems = [...catalog.destinations, ...catalog.accommodations, ...catalog.tours];
  const { ok, fail } = await uploadImages(allItems);
  console.log(`Imágenes: ${ok} subidas, ${fail} con problema.`);

  console.log('Listo.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
