// Pruebas del armado de fragmentos. Sin red ni base de datos:   node --test scripts/rag/
import test from 'node:test';
import assert from 'node:assert/strict';
import { armarFragmentoTour, texto } from './fragmentos.mjs';

const base = {
  slug: 'graffiti-comuna-13',
  name: { es: 'Graffiti tour + Comuna 13', en: 'Graffiti tour' },
  summary: { es: 'Recorrido guiado por la Comuna 13 con escaleras eléctricas y arte urbano' },
  description: { es: 'Recorrido guiado por la Comuna 13 con escaleras eléctricas y arte urbano' },
  city: 'Medellín', region: 'Antioquia', category: 'cultural',
  price_from: 80000, currency: 'COP',
  duration_label: { es: '3 horas' }, difficulty: 'easy', min_pax: 1, max_pax: null,
};

test('escribe una frase en español natural, no JSON', () => {
  const f = armarFragmentoTour(base);
  assert.match(f.contenido, /^Tour «Graffiti tour \+ Comuna 13» en Medellín, Antioquia\./);
  assert.match(f.contenido, /Dificultad: fácil\./);
  assert.match(f.contenido, /Precio desde COP 80\.000\./);
  assert.doesNotMatch(f.contenido, /[{}"]/);
});

test('sin precio lo dice explícitamente y NO lo calla ni lo inventa', () => {
  const f = armarFragmentoTour({ ...base, price_from: null });
  assert.match(f.contenido, /Sin precio publicado/);
  assert.doesNotMatch(f.contenido, /Precio desde/);
  assert.equal(f.metadata.precio_desde, null);
});

test('no repite la descripción cuando es igual al resumen', () => {
  const f = armarFragmentoTour(base);
  assert.equal(f.contenido.split('Recorrido guiado').length - 1, 1);
});

test('recorta descripciones largas sin cortar a media frase', () => {
  const larga = 'Una frase corta. ' + 'Otra frase que se repite para llenar espacio. '.repeat(40);
  const f = armarFragmentoTour({ ...base, summary: null, description: { es: larga } });
  assert.ok(f.contenido.length < 900, `largo ${f.contenido.length}`);
  assert.match(f.contenido, /[.…]( |$)/);
});

test('grupo: máximo no indicado no se inventa', () => {
  const f = armarFragmentoTour(base);
  assert.match(f.contenido, /Grupo desde 1 persona, sin máximo indicado\./);
});

test('duración y horario: sin "horario Horario" repetido ni doble punto', () => {
  const f = armarFragmentoTour({
    ...base, duration_label: { es: 'Full day (8:00 a. m. – 4:00 p. m.)' },
    schedule_label: { es: 'Horario a coordinar.' },
  });
  assert.match(f.contenido, /Duración: Full day \(8:00 a\. m\. – 4:00 p\. m\.\)\./);
  assert.match(f.contenido, /Horario: a coordinar\./);
  assert.doesNotMatch(f.contenido, /Horario Horario|\.\./);
});

test('lista las inclusiones en español', () => {
  const f = armarFragmentoTour(base, { incluye: ['Guía local', 'Transporte', 'Almuerzo'] });
  assert.match(f.contenido, /Incluye: Guía local, Transporte y Almuerzo\./);
});

test('el hash es estable y cambia cuando cambia el texto', () => {
  const a = armarFragmentoTour(base);
  const b = armarFragmentoTour(base);
  const c = armarFragmentoTour({ ...base, price_from: 90000 });
  assert.equal(a.contenido_hash, b.contenido_hash);
  assert.notEqual(a.contenido_hash, c.contenido_hash);
});

test('origen_id es el slug: es lo que hace idempotente la ingesta', () => {
  assert.equal(armarFragmentoTour(base).origen_id, 'graffiti-comuna-13');
});

test('un tour sin nombre falla en voz alta en vez de indexar basura', () => {
  assert.throws(() => armarFragmentoTour({ ...base, name: {} }), /no tiene nombre/);
});

test('texto() prefiere español y cae a inglés', () => {
  assert.equal(texto({ es: 'hola', en: 'hi' }), 'hola');
  assert.equal(texto({ en: 'hi' }), 'hi');
  assert.equal(texto(null), '');
});
