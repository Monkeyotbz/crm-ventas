import CandyLollipopLogo from "./CandyLollipopLogo.jsx";

// Marco compartido de las pantallas de acceso (Login, NuevaContrasena,
// PreparandoEspacio).
//
//   < lg  : la foto es una franja arriba y el contenido va en una hoja debajo
//           (patrón de login de app: Perplexity, Linear).
//   >= lg : split a pantalla completa — foto a la izquierda, contenido
//           centrado a la derecha. Es lo que hace que en desktop no parezca
//           una app móvil metida en un recuadro.
const FONDO = "url(/login-fondo.jpg)";

export default function MarcoAcceso({ children }) {
  return (
    <div className="candy-fondo min-h-screen font-candy-body lg:flex">
      {/* Panel de imagen — solo desktop, ocupa la mitad izquierda a sangre. */}
      <div
        className="hidden lg:block lg:w-[52%] xl:w-[56%]"
        style={{ backgroundImage: FONDO, backgroundSize: "cover", backgroundPosition: "center" }}
      />

      {/* Columna de contenido. */}
      <div className="flex min-h-screen flex-col bg-white lg:w-[48%] xl:w-[44%]">
        {/* Banner — solo mobile/tablet. Se funde en el blanco de la hoja. */}
        <div
          className="relative h-[32vh] min-h-[190px] w-full shrink-0 lg:hidden"
          style={{ backgroundImage: FONDO, backgroundSize: "cover", backgroundPosition: "center 35%" }}
        >
          <div
            className="absolute inset-0"
            style={{ background: "linear-gradient(to bottom, transparent 55%, #ffffff 100%)" }}
          />
        </div>

        <div className="flex flex-1 flex-col justify-center px-7 pb-9 pt-2 sm:px-10 lg:px-14 lg:pt-10">
          <div className="mx-auto w-full max-w-[380px]">
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
