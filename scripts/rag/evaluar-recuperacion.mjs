#!/usr/bin/env node
/**
 * Evalúa la RECUPERACIÓN del RAG (pasos 7 y 10 del traspaso, candidato [10]): ¿llega el tour
 * correcto, llega arriba, y cuánto cuesta en contexto y en tiempo?
 *
 *   node scripts/rag/evaluar-recuperacion.mjs [--k 6] [--etiqueta base]
 *
 * Determinístico: Voyage (embeddings) y Postgres. NO llama a Claude — la FIDELIDAD (que lo que
 * Claude responde no invente nada) es otra medición y va en agentes-sdk/validacion-rag/.
 *
 * Lee el set de agentes-sdk/validacion-rag/preguntas.json. Cada pregunta puede traer `contexto`
 * (mensajes previos del cliente): se concatenan a la pregunta, como hará el agente real, porque
 * «¿cuánto sale 5 noches ahí?» no dice dónde es «ahí» (paso 7 del traspaso: últimos 3 a 5 mensajes).
 *
 * Todas las preguntas viajan en UNA petición a Voyage: sin método de pago la cuenta permite 3
 * peticiones y 10.000 tokens por minuto, y una petición por pregunta se toparía con el límite.
 *
 * Usa la clave de servicio (salta RLS): sirve porque solo hay un tenant con datos (demo-pruebas).
 * El aislamiento entre tenants NO se prueba acá: es el paso 6, con un usuario real.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const aqui = dirname(fileURLToPath(import.meta.url));
const raiz = join(aqui, '..', '..');
const SET = join(raiz, 'agentes-sdk', 'validacion-rag', 'preguntas.json');
const SALIDA = join(raiz, 'agentes-sdk', 'validacion-rag', 'resultados');
const MODELO = 'voyage-3.5';
const DIMENSION = 1024;
const PRECIO_POR_MILLON = 0.06; // US$, [por verificar] contra la página de precios de Voyage

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const K = Number(arg('k', 6));
const etiqueta = arg('etiqueta', 'base');

const env = {};
for (const f of [join(aqui, '.env'), join(raiz, '.env')]) {
  try { for (const l of readFileSync(f, 'utf8').split('\n')) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !env[m[1]]) env[m[1]] = m[2].trim(); } } catch { /* sin archivo */ }
}
for (const v of ['VITE_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'VOYAGE_API_KEY']) {
  if (!env[v]) { console.error(`✗ Falta ${v} (ver scripts/rag/README.md)`); process.exit(1); }
}
const db = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// Los casos duros de fidelidad (inyección, premisa falsa…) no miden la recuperación: se excluyen.
const preguntas = JSON.parse(readFileSync(SET, 'utf8')).preguntas.filter((p) => !p.solo_fidelidad);
const textoConsulta = (p) => [...(p.contexto ?? []), p.pregunta].join(' ');

const pct = (v, p) => { const s = [...v].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)]; };
const media = (v) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);
const f2 = (n) => n.toFixed(2);

async function embeber(textos) {
  for (let intento = 0; intento < 2; intento++) {
    const t0 = performance.now();
    const res = await fetch('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.VOYAGE_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ input: textos, model: MODELO, input_type: 'query', output_dimension: DIMENSION }),
    });
    const ms = performance.now() - t0;
    if (res.status === 429 && intento === 0) { console.log('  (límite de Voyage: espero 62 s y reintento)'); await new Promise((r) => setTimeout(r, 62000)); continue; }
    if (!res.ok) throw new Error(`Voyage ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const j = await res.json();
    return { vectores: j.data.map((d) => d.embedding), tokens: j.usage?.total_tokens ?? 0, ms };
  }
}

const emb = await embeber(preguntas.map(textoConsulta));
console.log(`Voyage: ${preguntas.length} consultas en 1 petición · ${emb.tokens} tokens · ${Math.round(emb.ms)} ms`);

// -- recuperación, una pregunta a la vez (así se mide la latencia de cada búsqueda) ------------
const filas = [];
for (let i = 0; i < preguntas.length; i++) {
  const p = preguntas[i];
  const t0 = performance.now();
  const { data, error } = await db.rpc('match_kb_chunks', {
    query_embedding: JSON.stringify(emb.vectores[i]), match_count: K, min_similitud: 0,
  });
  const ms = performance.now() - t0;
  if (error) { console.error('✗ match_kb_chunks:', error.message); process.exit(1); }
  const top = data.map((d) => ({ slug: d.metadata.slug, sim: d.similitud, chars: d.contenido.length }));
  const rango = top.findIndex((t) => p.esperados.includes(t.slug)); // -1 = no llegó
  filas.push({ id: p.id, tipo: p.tipo, pregunta: p.pregunta, sin_respuesta: p.sin_respuesta, esperados: p.esperados,
    rango: rango < 0 ? null : rango + 1, sim_top1: top[0]?.sim ?? 0, sim_acierto: rango < 0 ? null : top[rango].sim,
    ms, contexto_tokens_est: Math.round(top.reduce((s, t) => s + t.chars, 0) / 4), top: top.map((t) => `${t.slug} ${f2(t.sim)}`) });
}

// -- métricas ------------------------------------------------------------------------------
const con = filas.filter((f) => !f.sin_respuesta);
const sin = filas.filter((f) => f.sin_respuesta);
const recall = (n) => con.filter((f) => f.rango && f.rango <= n).length / con.length;
const mrr = media(con.map((f) => (f.rango ? 1 / f.rango : 0)));

console.log(`\n=== Recuperación (${con.length} preguntas con respuesta, k=${K}) ===`);
console.log(`recall@1 ${(recall(1) * 100).toFixed(1)} %   recall@3 ${(recall(3) * 100).toFixed(1)} %   recall@${K} ${(recall(K) * 100).toFixed(1)} %   MRR ${f2(mrr)}`);
console.log('\nPor tipo:');
for (const tipo of [...new Set(con.map((f) => f.tipo))]) {
  const g = con.filter((f) => f.tipo === tipo);
  const r = (n) => ((g.filter((f) => f.rango && f.rango <= n).length / g.length) * 100).toFixed(0).padStart(3);
  console.log(`  ${tipo.padEnd(16)} n=${String(g.length).padStart(2)}  recall@1 ${r(1)} %  @3 ${r(3)} %  @${K} ${r(K)} %  MRR ${f2(media(g.map((f) => (f.rango ? 1 / f.rango : 0))))}`);
}
const fallos = con.filter((f) => !f.rango || f.rango > 3);
if (fallos.length) {
  console.log(`\nNo llegaron al top-3 (${fallos.length}):`);
  for (const f of fallos) console.log(`  ${f.id} «${f.pregunta}» → ${f.rango ? 'puesto ' + f.rango : 'fuera del top-' + K}; esperaba ${f.esperados.join(' | ')}\n     recuperó: ${f.top.slice(0, 3).join(' · ')}`);
}

// -- el problema del umbral: ¿se puede separar «sin respuesta» de «con respuesta» por similitud? --
console.log(`\n=== ¿Sirve un umbral de similitud para decir «no lo sé»? ===`);
const simCon = con.map((f) => f.sim_top1), simSin = sin.map((f) => f.sim_top1);
console.log(`similitud del mejor resultado: CON respuesta  mín ${f2(Math.min(...simCon))}  mediana ${f2(pct(simCon, 0.5))}  máx ${f2(Math.max(...simCon))}`);
console.log(`                               SIN respuesta  mín ${f2(Math.min(...simSin))}  mediana ${f2(pct(simSin, 0.5))}  máx ${f2(Math.max(...simSin))}`);
console.log('umbral | preguntas CON respuesta que se conservan | preguntas SIN respuesta que se rechazan | exactitud');
let mejor = { u: 0, ex: 0 };
for (let u = 0.30; u <= 0.62; u += 0.02) {
  const cons = con.filter((f) => f.sim_top1 >= u).length / con.length;
  const rech = sin.filter((f) => f.sim_top1 < u).length / sin.length;
  const ex = (cons * con.length + rech * sin.length) / filas.length;
  if (ex > mejor.ex) mejor = { u, ex, cons, rech };
  console.log(`  ${f2(u)}  |  ${(cons * 100).toFixed(0).padStart(3)} %  |  ${(rech * 100).toFixed(0).padStart(3)} %  |  ${(ex * 100).toFixed(0)} %`);
}
console.log(`Mejor umbral posible: ${f2(mejor.u)} → exactitud ${(mejor.ex * 100).toFixed(0)} % (conserva ${(mejor.cons * 100).toFixed(0)} % de las preguntas válidas y rechaza ${(mejor.rech * 100).toFixed(0)} % de las que no tienen respuesta)`);

// -- costo en contexto y tiempo ---------------------------------------------------------------
const ctx = filas.map((f) => f.contexto_tokens_est), lat = filas.map((f) => f.ms);
console.log(`\n=== Contexto y latencia ===`);
console.log(`Tokens de contexto por turno (top-${K}) [estimado, caracteres/4]: media ${Math.round(media(ctx))}  p95 ${pct(ctx, 0.95)}   (meta de la guía: < 1.200)`);
console.log(`Latencia de la búsqueda match_kb_chunks [medido desde este PC, incluye la red a Supabase]: p50 ${Math.round(pct(lat, 0.5))} ms  p95 ${Math.round(pct(lat, 0.95))} ms   (meta: p95 < 300 ms)`);
console.log(`Embedding de las consultas: ${Math.round(emb.ms)} ms en total para ${preguntas.length} (una sola petición)`);
console.log(`Costo de esta corrida: ${emb.tokens} tokens ≈ US$${((emb.tokens / 1e6) * PRECIO_POR_MILLON).toFixed(6)} [calculado, precio por verificar]`);

mkdirSync(SALIDA, { recursive: true });
const ruta = join(SALIDA, `${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}_recuperacion_${etiqueta}.json`);
writeFileSync(ruta, JSON.stringify({ etiqueta, k: K, modelo: MODELO, tokens_voyage: emb.tokens,
  metricas: { recall1: recall(1), recall3: recall(3), recallK: recall(K), mrr, mejor_umbral: mejor, contexto_tokens_media: media(ctx), latencia_p50_ms: pct(lat, 0.5), latencia_p95_ms: pct(lat, 0.95) }, filas }, null, 2));
console.log(`\nGuardado en ${ruta.replace(raiz + '\\', '')}`);
