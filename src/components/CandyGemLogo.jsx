// Isotipo de candyCRM: gema baja-poli con la paleta candy confirmada
// (ver docs/brand-vision.md: "un isotipo minimalista, como una esfera con
// degradado de colores candy"). Dibujado a mano como SVG en vez de vectorizar
// el render 3D de referencia — un auto-trace de un render fotorrealista con
// degradados suaves da manchas de color a tamaño chico (nav/favicon), no un
// logo limpio. La versión standalone para el favicon vive en
// public/candy-gem.svg — si tocás los facetados, actualizá los dos archivos.
export default function CandyGemLogo({ size = 24, className }) {
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label="candyCRM"
    >
      <polygon points="32,32 32,5 51.09,12.91" fill="#ff5ca8" />
      <polygon points="32,32 51.09,12.91 59,32" fill="#ffb35c" />
      <polygon points="32,32 59,32 51.09,51.09" fill="#6ee7b7" />
      <polygon points="32,32 51.09,51.09 32,59" fill="#5b9bff" />
      <polygon points="32,32 32,59 12.91,51.09" fill="#b98bff" />
      <polygon points="32,32 12.91,51.09 5,32" fill="#ff5ca8" />
      <polygon points="32,32 5,32 12.91,12.91" fill="#ffb35c" />
      <polygon points="32,32 12.91,12.91 32,5" fill="#6ee7b7" />
      <circle cx="22" cy="18" r="22" fill="url(#candyGemShine)" />
      <defs>
        <radialGradient id="candyGemShine" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.4" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
      </defs>
    </svg>
  );
}
