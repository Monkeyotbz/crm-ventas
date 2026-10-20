/**
 * Convierte un registro del catálogo turístico en un FRAGMENTO de texto legible para el
 * buscador semántico (paso 3 del traspaso RAG, candidato [10] de docs/DECISIONES.md).
 *
 * Puro y determinístico: sin red, sin base de datos, sin llamar a Claude. Por eso se prueba solo
 * (ver fragmentos.test.mjs) y por eso vive aparte de la ingesta.
 *
 * Un fragmento = un registro, escrito como frase en español natural y NO como JSON: el modelo de
 * embeddings compara significado, y "Dificultad: fácil" se parece más a "algo tranquilo" que
 * `"difficulty":"easy"`.
 *
 * Regla de oro: **solo se escribe lo que el registro dice.** Si no hay precio, el fragmento dice
 * "sin precio publicado" — nunca se omite en silencio ni se inventa. Un fragmento que calla un
 * hueco hace que el asistente lo rellene.
 */
import { createHash } from 'node:crypto';

const DIFICULTAD = { easy: 'fácil', moderate: 'moderada', hard: 'difícil' };
const MAX_DESCRIPCION = 600; // caracteres: lo que sobra no mejora la búsqueda y encarece el embedding

/** Los textos del catálogo son jsonb {es, en}: se prefiere el español. */
export function texto(campo) {
  if (campo && typeof campo === 'object') return (campo.es || campo.en || '').trim();
  return typeof campo === 'string' ? campo.trim() : '';
}

function precio(valor, moneda) {
  if (valor == null) return null;
  return `${moneda || 'COP'} ${Number(valor).toLocaleString('es-CO')}`;
}

/** Quita el punto final: las frases se vuelven a cerrar con uno solo (evita "p. m..") */
function sinPunto(s) { return s.replace(/[.\s]+$/, ''); }

function personas(n) { return n === 1 ? 'persona' : 'personas'; }

function recortar(s, max) {
  if (s.length <= max) return s;
  const corte = s.slice(0, max);
  const ultimoPunto = Math.max(corte.lastIndexOf('. '), corte.lastIndexOf('.'));
  return (ultimoPunto > max * 0.5 ? corte.slice(0, ultimoPunto + 1) : corte.trimEnd()) + '…';
}

function lista(items) {
  return items.length > 1 ? items.slice(0, -1).join(', ') + ' y ' + items.at(-1) : items[0] ?? '';
}

/**
 * @param {object} tour  fila de `tours`
 * @param {{destino?: object, incluye?: string[]}} contexto  destino ya resuelto y etiquetas de
 *   inclusiones del tour (se resuelven fuera para que esta función siga siendo pura)
 * @returns {{origen_id: string, contenido: string, contenido_hash: string, metadata: object}}
 */
export function armarFragmentoTour(tour, { destino = null, incluye = [] } = {}) {
  const nombre = texto(tour.name);
  if (!nombre) throw new Error(`el tour ${tour.slug ?? tour.id} no tiene nombre`);

  const partes = [];

  const donde = [tour.city, tour.region].filter(Boolean).join(', ');
  partes.push(`Tour «${nombre}»${donde ? ` en ${donde}` : ''}.`);

  const nombreDestino = destino ? texto(destino.name) : '';
  if (nombreDestino && nombreDestino !== tour.city) partes.push(`Destino: ${nombreDestino}.`);

  const resumen = texto(tour.summary);
  if (resumen) partes.push(/[.!?…]$/.test(resumen) ? resumen : resumen + '.');

  const descripcion = texto(tour.description);
  if (descripcion && descripcion !== resumen) partes.push(recortar(descripcion, MAX_DESCRIPCION));

  if (tour.category) partes.push(`Categoría: ${tour.category}.`);

  const duracion = sinPunto(texto(tour.duration_label));
  // Algunos horarios ya traen la palabra ("Horario a coordinar"): no se repite.
  const horario = sinPunto(texto(tour.schedule_label)).replace(/^horario\s*:?\s*/i, '');
  if (duracion) partes.push(`Duración: ${duracion}.`);
  if (horario) partes.push(`Horario: ${horario}.`);

  if (tour.difficulty && DIFICULTAD[tour.difficulty]) {
    partes.push(`Dificultad: ${DIFICULTAD[tour.difficulty]}.`);
  }

  if (tour.min_pax != null || tour.max_pax != null) {
    const { min_pax: a, max_pax: b } = tour;
    partes.push(
      a != null && b != null ? `Grupo de ${a} a ${b} personas.`
        : a != null ? `Grupo desde ${a} ${personas(a)}, sin máximo indicado.`
        : `Grupo de hasta ${b} ${personas(b)}.`,
    );
  }

  const p = precio(tour.price_from, tour.currency);
  partes.push(p ? `Precio desde ${p}.` : 'Sin precio publicado: hay que consultarlo con el operador.');

  if (incluye.length) partes.push(`Incluye: ${lista(incluye)}.`);

  const contenido = partes.join(' ');
  return {
    origen_id: tour.slug,
    contenido,
    contenido_hash: createHash('sha256').update(contenido).digest('hex'),
    metadata: {
      origen: 'tours',
      slug: tour.slug,
      ciudad: tour.city ?? null,
      region: tour.region ?? null,
      categoria: tour.category ?? null,
      precio_desde: tour.price_from ?? null,
      moneda: tour.currency ?? null,
    },
  };
}
