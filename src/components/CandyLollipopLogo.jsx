// Isotipo de Candy CRM: la paleta viene del logo que trajo el usuario
// (rosa #f0568f, azul #3c9acd). Dibujado a mano y no auto-trazado del JPG de
// referencia — vtracer sobre ese archivo daba un SVG de +450 KB (ruido de
// JPEG + el texto trazado como polígonos). El mismo dibujo, sin depender de
// React, está en public/candy-lollipop.svg (favicon) y public/candy-logo.svg
// (lockup con la tipografía). Si tocás la espiral, actualizá los tres.
export default function CandyLollipopLogo({ size = 24, className }) {
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label="Candy CRM"
    >
      <line x1="32" y1="30" x2="32" y2="60" stroke="#3c9acd" strokeWidth="3.6" strokeLinecap="round" />
      <circle cx="32" cy="27.5" r="20" fill="#f0568f" />
      <path
        fill="none"
        stroke="#ffffff"
        strokeWidth="4.3"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M32.00,27.50 L32.05,27.31 L32.18,27.15 L32.38,27.05 L32.63,27.03 L32.91,27.11 L33.17,27.30 L33.38,27.59 L33.51,27.96 L33.53,28.40 L33.42,28.86 L33.18,29.32 L32.79,29.73 L32.28,30.05 L31.65,30.24 L30.96,30.27 L30.24,30.12 L29.54,29.77 L28.91,29.24 L28.40,28.53 L28.06,27.68 L27.93,26.72 L28.04,25.72 L28.40,24.74 L29.02,23.83 L29.86,23.06 L30.90,22.49 L32.10,22.18 L33.37,22.15 L34.66,22.44 L35.89,23.05 L36.98,23.95 L37.84,25.13 L38.43,26.51 L38.67,28.04 L38.56,29.63 L38.06,31.19 L37.18,32.63 L35.96,33.86 L34.44,34.79 L32.71,35.35 L30.84,35.50 L28.95,35.20 L27.14,34.45 L25.52,33.27 L24.19,31.70 L23.24,29.83 L22.74,27.75 L22.74,25.56 L23.26,23.39 L24.29,21.35 L25.80,19.58 L27.72,18.19 L29.95,17.25 L32.38,16.86 L34.88,17.05 L37.32,17.83 L39.54,19.17 L41.43,21.03 L42.85,23.32 L43.72,25.91 L43.97,28.69 L43.55,31.49 L42.49,34.15 L40.80,36.54 L38.57,38.50 L35.91,39.91 L32.95,40.67 L29.84,40.73 L26.77,40.06 L23.89,38.66"
      />
    </svg>
  );
}
