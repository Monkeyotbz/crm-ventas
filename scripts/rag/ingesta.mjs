#!/usr/bin/env node
/**
 * Ingesta del catálogo turístico a `kb_chunks` para el RAG (candidato [10] de docs/DECISIONES.md).
 *
 *   node scripts/rag/ingesta.mjs --dry-run      # arma los fragmentos y los muestra. SIN llaves, SIN escribir
 *   node scripts/rag/ingesta.mjs                # embebe y guarda en el tenant demo-pruebas
 *
 * Determinístico: llama a la API de embeddings de Voyage AI, NO a Claude. Por eso es un script y
 * no un agente (regla del CLAUDE.md del laboratorio). Corre del lado servidor: escribe con la
 * clave de servicio, que salta RLS, y `kb_chunks` solo tiene política de LECTURA a propósito.
 *
 * Qué hace:
 *   1. Lee los tours publicados del tenant ORIGEN (turismo-colombia) — solo lectura, con la clave
 *      pública: son datos que el sitio del tenant ya muestra sin login.
 *   2. Convierte cada uno en un fragmento de texto (fragmentos.mjs).
 *   3. Calcula el embedding SOLO de los fragmentos nuevos o cambiados.
 *   4. Guarda en el tenant DESTINO, que SOLO puede ser `demo-pruebas` (ver el candado abajo).
 *   5. Borra del destino los fragmentos cuyo tour ya no existe.
 *
 * Idempotente: correrlo dos veces deja el mismo número de filas, y la segunda no gasta tokens.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { armarFragmentoTour, texto } from './fragmentos.mjs';

const aqui = dirname(fileURLToPath(import.meta.url));
const raiz = join(aqui, '..', '..');

// ---------------------------------------------------------------------------------------------
// Configuración
// ---------------------------------------------------------------------------------------------
const MODELO = 'voyage-3.5';
const DIMENSION = 1024; // tiene que coincidir con kb_chunks.embedding (migración 20260920120000)
const LOTE = 64; // fragmentos por llamada a Voyage (el máximo de la API es 1000 entradas / 120k tokens)
const FUENTE = 'catalogo';
// US$ por millón de tokens. [por verificar] contra la página de precios de Voyage antes de cotizar.
const PRECIO_POR_MILLON = 0.06;

// ORIGEN = de dónde se leen los datos. DESTINO = dónde se escribe. No son lo mismo y nunca se
// mezclan: leer del tenant real es inofensivo; escribir en él, no.
const TENANT_ORIGEN_ID = 'b91fa55b-593c-4537-a156-dbb7221ffb46'; // turismo-colombia (real)
const SLUG_DESTINO = 'demo-pruebas';

/**
 * CANDADO. El destino está escrito a mano y no es un parámetro: ninguna bandera, variable de
 * entorno ni error de tipeo puede hacer que esto escriba en un tenant real. Para indexar un
 * tenant de verdad, hay que cambiar el código a propósito y revisarlo.
 * Ver: documentación importante/pruebas-en-produccion-que-se-deben-eliminar.md
 */
function exigirDestinoDemo(slug) {
  if (slug !== 'demo-pruebas') throw new Error(`Destino "${slug}" no permitido: solo demo-pruebas.`);
}

function cargarEnv(ruta) {
  let t;
  try { t = readFileSync(ruta, 'utf8'); } catch { return; }
  for (const linea of t.split('\n')) {
    const m = linea.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}
cargarEnv(join(aqui, '.env')); // llaves de ESTA ingesta (gitignored)
cargarEnv(join(raiz, '.env')); // URL y llave pública del proyecto

const dryRun = process.argv.includes('--dry-run');
const verbose = process.argv.includes('--verbose');

function falta(msg) { console.error('✗ ' + msg); process.exit(1); }

// ---------------------------------------------------------------------------------------------
// Lectura del catálogo (solo lectura, clave pública)
// ---------------------------------------------------------------------------------------------
async function leerCatalogo(db) {
  const { data: tours, error } = await db.from('tours').select('*')
    .eq('tenant_id', TENANT_ORIGEN_ID).eq('status', 'published').order('slug');
  if (error) throw new Error('tours: ' + error.message);

  const { data: destinos } = await db.from('destinations').select('id, name')
    .eq('tenant_id', TENANT_ORIGEN_ID).eq('status', 'published');
  const destinoPorId = new Map((destinos ?? []).map((d) => [d.id, d]));

  // Inclusiones ("incluye almuerzo"): si la tabla no es legible con la clave pública, se sigue sin
  // ellas y se avisa. Nunca se inventan.
  const incluyePorTour = new Map();
  const { data: enlaces, error: errEnl } = await db.from('tour_features')
    .select('tour_id, feature_id').eq('tenant_id', TENANT_ORIGEN_ID);
  const { data: feats, error: errFeat } = await db.from('features')
    .select('id, kind, label').eq('tenant_id', TENANT_ORIGEN_ID);
  let sinInclusiones = Boolean(errEnl || errFeat);
  if (!sinInclusiones) {
    const etiqueta = new Map((feats ?? []).filter((f) => f.kind === 'inclusion').map((f) => [f.id, texto(f.label)]));
    for (const e of enlaces ?? []) {
      const l = etiqueta.get(e.feature_id);
      if (l) incluyePorTour.set(e.tour_id, [...(incluyePorTour.get(e.tour_id) ?? []), l]);
    }
  }
  return { tours: tours ?? [], destinoPorId, incluyePorTour, sinInclusiones };
}

// ---------------------------------------------------------------------------------------------
// Voyage AI
// ---------------------------------------------------------------------------------------------
async function embeber(textos, llave) {
  const res = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${llave}`, 'content-type': 'application/json' },
    body: JSON.stringify({ input: textos, model: MODELO, input_type: 'document', output_dimension: DIMENSION }),
  });
  if (!res.ok) throw new Error(`Voyage ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = await res.json();
  const vectores = json.data.map((d) => d.embedding);
  for (const v of vectores) {
    if (v.length !== DIMENSION) throw new Error(`Voyage devolvió ${v.length} dimensiones, se esperaban ${DIMENSION}.`);
  }
  return { vectores, tokens: json.usage?.total_tokens ?? 0 };
}

// ---------------------------------------------------------------------------------------------
// Principal
// ---------------------------------------------------------------------------------------------
async function main() {
  exigirDestinoDemo(SLUG_DESTINO);

  const url = process.env.VITE_SUPABASE_URL;
  const anon = process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anon) falta('Faltan VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY en el .env de la raíz.');
  const lector = createClient(url, anon, { auth: { persistSession: false } });

  const cat = await leerCatalogo(lector);
  if (!cat.tours.length) falta('No se leyó ningún tour publicado del tenant origen.');
  if (cat.sinInclusiones) console.warn('! No se pudieron leer las inclusiones (features): los fragmentos salen sin "Incluye".');

  const fragmentos = cat.tours.map((t) => armarFragmentoTour(t, {
    destino: cat.destinoPorId.get(t.destination_id) ?? null,
    incluye: cat.incluyePorTour.get(t.id) ?? [],
  }));

  const caracteres = fragmentos.reduce((s, f) => s + f.contenido.length, 0);
  const conPrecio = fragmentos.filter((f) => f.metadata.precio_desde != null).length;
  console.log(`Catálogo origen: ${cat.tours.length} tours publicados · ${conPrecio} con precio, ${cat.tours.length - conPrecio} sin precio publicado`);
  console.log(`Fragmentos armados: ${fragmentos.length} · ${caracteres} caracteres (≈ ${Math.round(caracteres / 4)} tokens [estimado])`);

  if (dryRun) {
    console.log('\n--dry-run: no se llama a Voyage ni se escribe nada. Ejemplos:\n');
    for (const f of (verbose ? fragmentos : fragmentos.slice(0, 3))) console.log(`[${f.origen_id}]\n${f.contenido}\n`);
    return;
  }

  // -- Escritura real: exige las dos llaves, que el usuario pone en scripts/rag/.env ---------
  const llaveVoyage = process.env.VOYAGE_API_KEY;
  const llaveServicio = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!llaveVoyage) falta('Falta VOYAGE_API_KEY en scripts/rag/.env (ver scripts/rag/README.md).');
  if (!llaveServicio) falta('Falta SUPABASE_SERVICE_ROLE_KEY en scripts/rag/.env (ver scripts/rag/README.md).');
  const db = createClient(url, llaveServicio, { auth: { persistSession: false } });

  const { data: destino, error: errDest } = await db.from('tenants').select('id, slug').eq('slug', SLUG_DESTINO).maybeSingle();
  if (errDest) throw new Error('tenants: ' + errDest.message);
  if (!destino) falta(`El tenant "${SLUG_DESTINO}" no existe todavía: hay que crearlo primero (scripts/demo/sembrar-tenant-demo.sql).`);
  exigirDestinoDemo(destino.slug);

  const { data: existentes, error: errEx } = await db.from('kb_chunks')
    .select('origen_id, contenido_hash').eq('tenant_id', destino.id).eq('fuente', FUENTE);
  if (errEx) throw new Error('kb_chunks (¿se aplicó la migración 20260920120000?): ' + errEx.message);
  const hashPrevio = new Map((existentes ?? []).map((e) => [e.origen_id, e.contenido_hash]));

  const aEmbeber = fragmentos.filter((f) => hashPrevio.get(f.origen_id) !== f.contenido_hash);
  const nuevos = aEmbeber.filter((f) => !hashPrevio.has(f.origen_id)).length;
  const vigentes = new Set(fragmentos.map((f) => f.origen_id));
  const sobrantes = [...hashPrevio.keys()].filter((id) => !vigentes.has(id));
  console.log(`Destino ${SLUG_DESTINO}: ${hashPrevio.size} fragmentos hoy → ${nuevos} nuevos, ${aEmbeber.length - nuevos} cambiados, ${fragmentos.length - aEmbeber.length} sin cambios, ${sobrantes.length} a borrar`);

  let tokens = 0;
  for (let i = 0; i < aEmbeber.length; i += LOTE) {
    const lote = aEmbeber.slice(i, i + LOTE);
    const { vectores, tokens: t } = await embeber(lote.map((f) => f.contenido), llaveVoyage);
    tokens += t;
    const filas = lote.map((f, k) => ({
      tenant_id: destino.id, fuente: FUENTE, origen_id: f.origen_id, contenido: f.contenido,
      contenido_hash: f.contenido_hash, metadata: f.metadata, embedding: JSON.stringify(vectores[k]),
      actualizado_at: new Date().toISOString(),
    }));
    const { error } = await db.from('kb_chunks').upsert(filas, { onConflict: 'tenant_id,fuente,origen_id' });
    if (error) throw new Error('kb_chunks upsert: ' + error.message);
    console.log(`  lote ${Math.floor(i / LOTE) + 1}: ${lote.length} fragmentos, ${t} tokens`);
  }

  if (sobrantes.length) {
    const { error } = await db.from('kb_chunks').delete()
      .eq('tenant_id', destino.id).eq('fuente', FUENTE).in('origen_id', sobrantes);
    if (error) throw new Error('kb_chunks delete: ' + error.message);
  }

  const { count } = await db.from('kb_chunks').select('id', { count: 'exact', head: true })
    .eq('tenant_id', destino.id).eq('fuente', FUENTE);
  const costo = (tokens / 1e6) * PRECIO_POR_MILLON;
  console.log(`\nListo. kb_chunks de ${SLUG_DESTINO}: ${count} filas · ${tokens} tokens [medido] · ~US$${costo.toFixed(6)} [calculado, precio por verificar]`);
}

main().catch((e) => { console.error('✗', e.message); process.exit(1); });
