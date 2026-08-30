// Guardrail [1] de docs/DECISIONES.md — bloquea escribir credenciales reales a disco.
//
// Lee el JSON del hook por stdin y, si el contenido a escribir trae un secreto,
// imprime la decisión de bloqueo. Silencio = deja pasar.
//
// Busca VALORES de credenciales, no nombres de variables: `SUPABASE_SERVICE_ROLE_KEY`
// como nombre es legítimo (una Edge Function tiene que leerlo de su entorno). Lo que
// no puede quedar en un archivo es la clave misma.

const PATRONES = [
  // JWT completo de tres partes — anon key y service_role key de Supabase.
  { re: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, que: "un JWT (anon key o service_role key)" },
  // Cadena de conexión a Postgres con contraseña embebida.
  { re: /postgres(ql)?:\/\/[^:@\s/]+:[^@\s/]{3,}@/i, que: "una cadena de conexión a Postgres con contraseña" },
  // Formato nuevo de claves secretas de Supabase.
  { re: /\bsb_secret_[A-Za-z0-9_-]{15,}/, que: "una clave secreta de Supabase (sb_secret_...)" },
  // Claves de API de Anthropic.
  { re: /\bsk-ant-[A-Za-z0-9_-]{20,}/, que: "una API key de Anthropic" },
];

let entrada = "";
process.stdin.on("data", (d) => (entrada += d));
process.stdin.on("end", () => {
  let contenido = "";
  try {
    const hook = JSON.parse(entrada);
    // Write manda `content`; Edit manda `new_string`.
    contenido = hook.tool_input?.content ?? hook.tool_input?.new_string ?? "";
  } catch {
    return; // Payload ilegible: no es motivo para bloquear una escritura.
  }

  const hallazgo = PATRONES.find((p) => p.re.test(contenido));
  if (!hallazgo) return;

  console.log(JSON.stringify({
    continue: false,
    stopReason:
      `GUARDRAIL [1] — escritura bloqueada: el contenido incluye ${hallazgo.que}. ` +
      `Este proyecto tiene datos reales de clientes; una credencial en un archivo termina en git. ` +
      `Poné el secreto en .env (gitignored) o en 'supabase secrets set', y en el archivo dejá ` +
      `solo el nombre de la variable de entorno.`,
  }));
});
