import CandyLollipopLogo from "./CandyLollipopLogo.jsx";

// Marco compartido de las tres pantallas de acceso (Login, NuevaContrasena,
// PreparandoEspacio). Layout "banner + hoja", inspirado en logins de app
// (Perplexity, Linear): la foto ocupa la franja de arriba y el contenido vive
// en una hoja sólida abajo, en vez de una tarjeta de vidrio flotando sobre la
// imagen entera. Se lee más limpio y el contraste deja de depender del blur.
//
// Una sola columna centrada (max ~420px) que sirve igual en mobile y desktop:
// en un celular ocupa casi todo el ancho, en desktop queda como una "card de
// app" centrada. No hay breakpoints.
export default function MarcoAcceso({ children }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-candy-fondo p-0 font-candy-body sm:p-6">
      <div className="flex min-h-screen w-full max-w-[420px] flex-col overflow-hidden bg-white shadow-[0_30px_80px_rgba(80,40,140,0.18)] sm:min-h-0 sm:rounded-[32px]">
        {/* Banner: la foto de la juguetería, con un degradado que la funde en
            el blanco de la hoja para que no haya un corte duro. */}
        <div
          className="relative h-[34vh] min-h-[200px] w-full shrink-0 sm:h-[240px]"
          style={{
            backgroundImage: "url(/login-fondo.jpg)",
            backgroundSize: "cover",
            backgroundPosition: "center 35%",
          }}
        >
          <div
            className="absolute inset-0"
            style={{ background: "linear-gradient(to bottom, transparent 55%, #ffffff 100%)" }}
          />
        </div>

        {/* Hoja: logo centrado + contenido de cada pantalla + pie. */}
        <div className="flex flex-1 flex-col px-7 pb-9 pt-2 sm:px-9">
          <div className="flex flex-col items-center text-center">
            <CandyLollipopLogo size={44} />
            <div className="mt-2 font-candy-display text-[22px] font-extrabold leading-none text-candy-tinta">
              Candy CRM
            </div>
            <div className="mt-1 text-[11.5px] font-semibold text-candy-tinta-media">
              by hellominus.com
            </div>
          </div>

          <div className="mt-7 flex-1">{children}</div>

          <div className="mt-8 flex items-center justify-center gap-4 text-[11px] font-semibold text-candy-tinta-tenue">
            <a href="#" className="hover:text-candy-tinta-media">Política de privacidad</a>
            <span aria-hidden>·</span>
            <a href="#" className="hover:text-candy-tinta-media">Términos</a>
          </div>
        </div>
      </div>
    </div>
  );
}
