import CandyLollipopLogo from "./CandyLollipopLogo.jsx";

// Marco compartido de las pantallas de acceso (Login, NuevaContrasena,
// PreparandoEspacio).
//
//   < lg  : a sangre — la foto es una franja arriba y el contenido va en una
//           hoja debajo (patrón de login de app).
//   >= lg : una sola tarjeta CENTRADA en la pantalla, con la foto a la
//           izquierda y el formulario a la derecha. No es un split a sangre:
//           eso dejaba el formulario descentrado respecto del viewport.
//
// La foto va en dos divs distintos y no en uno con clases responsive porque
// cada orientación necesita su propio encuadre: apaisado en mobile (se ve la
// sala) y vertical en desktop (hay que correrse a la derecha para agarrar el
// frasco, si no queda pura pared).
const FONDO = "url(/login-fondo.jpg)";

export default function MarcoAcceso({ children }) {
  return (
    <div className="candy-fondo flex min-h-screen items-center justify-center font-candy-body lg:p-8">
      <div className="flex min-h-screen w-full flex-col overflow-hidden bg-white lg:min-h-[600px] lg:w-[920px] lg:max-w-full lg:flex-row lg:rounded-[32px] lg:shadow-[0_30px_80px_rgba(80,40,140,0.22)]">
        {/* Foto — franja superior en mobile. */}
        <div
          className="relative h-[32vh] min-h-[190px] w-full shrink-0 lg:hidden"
          style={{ backgroundImage: FONDO, backgroundSize: "cover", backgroundPosition: "center 35%" }}
        >
          <div
            className="absolute inset-0"
            style={{ background: "linear-gradient(to bottom, transparent 55%, #ffffff 100%)" }}
          />
        </div>

        {/* Foto — columna izquierda en desktop, encuadrada sobre el frasco. */}
        <div
          className="hidden shrink-0 lg:block lg:w-[46%]"
          style={{ backgroundImage: FONDO, backgroundSize: "cover", backgroundPosition: "72% 60%" }}
        />

        {/* Contenido. */}
        <div className="flex flex-1 flex-col justify-center px-7 pb-9 pt-2 sm:px-10 lg:px-14 lg:py-12">
          <div className="mx-auto w-full max-w-[340px]">
            <div className="flex flex-col items-center text-center">
              <CandyLollipopLogo size={44} />
              <div className="mt-2 font-candy-display text-[22px] font-extrabold leading-none text-candy-tinta">
                Candy CRM
              </div>
              <div className="mt-1 text-[11.5px] font-semibold text-candy-tinta-media">
                by hellominus.com
              </div>
            </div>

            <div className="mt-7">{children}</div>

            <div className="mt-8 flex items-center justify-center gap-4 text-[11px] font-semibold text-candy-tinta-tenue">
              <a href="#" className="hover:text-candy-tinta-media">Política de privacidad</a>
              <span aria-hidden>·</span>
              <a href="#" className="hover:text-candy-tinta-media">Términos</a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
