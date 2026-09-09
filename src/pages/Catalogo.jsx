import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  listarCatalogo,
  urlImagen,
  txt,
  precioDesde,
  TIPOS_CATALOGO,
  ETIQUETA_ESTADO,
} from "../lib/catalogo.js";

// Vista de solo lectura del catálogo turístico. La administración (crear /
// editar / imágenes) queda para una iteración siguiente; acá se listan y se
// abren en detalle los destinos, hospedajes y tours del tenant.
export default function Catalogo({ onVolver }) {
  const [tipo, setTipo] = useState("destinos");
  const [detalle, setDetalle] = useState(null);

  const { data: items, isLoading, error } = useQuery({
    queryKey: ["catalogo", tipo],
    queryFn: () => listarCatalogo(tipo),
  });

  return (
    <div className="min-h-screen candy-fondo flex flex-col">
      <div className="shrink-0 mx-3 sm:mx-5 mt-3 sm:mt-3.5 px-4 sm:px-5 h-[60px] rounded-full flex items-center gap-2.5 candy-glass font-candy-body">
        <button
          type="button"
          onClick={onVolver}
          className="w-9 h-9 rounded-full flex items-center justify-center text-candy-tinta-media hover:bg-white/50 shrink-0"
          title="Volver a la bandeja"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="font-candy-display text-base sm:text-lg font-extrabold text-candy-tinta">Catálogo</div>
      </div>

      <div className="flex-1 px-3 sm:px-5 pb-10 pt-4 sm:pt-5 max-w-[1100px] w-full mx-auto font-candy-body">
        {/* Sub-pestañas por tipo. */}
        <div className="flex gap-1 bg-white/50 border border-white/80 rounded-full p-1 w-fit mb-5">
          {TIPOS_CATALOGO.map((t) => (
            <button
              key={t.clave}
              type="button"
              onClick={() => setTipo(t.clave)}
              className={`px-4 py-2 rounded-full text-[13px] font-bold transition-colors ${
                tipo === t.clave ? "text-white" : "text-candy-tinta-media hover:text-candy-tinta"
              }`}
              style={tipo === t.clave ? { background: "linear-gradient(180deg, #ff8fc0, #ff5ca8)" } : undefined}
            >
              {t.etiqueta}
            </button>
          ))}
        </div>

        {isLoading && <p className="text-sm text-candy-tinta-tenue">Cargando el catálogo…</p>}
        {error && <p className="text-sm text-rose-500">No se pudo cargar: {error.message}</p>}
        {items && items.length === 0 && (
          <p className="text-[13px] text-candy-tinta-tenue">Todavía no hay nada en esta sección.</p>
        )}

        {items && items.length > 0 && (
          <div className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((it) => (
              <Tarjeta key={it.id} item={it} tipo={tipo} onAbrir={() => setDetalle(it)} />
            ))}
          </div>
        )}
      </div>

      {detalle && <PanelDetalle item={detalle} tipo={tipo} onCerrar={() => setDetalle(null)} />}
    </div>
  );
}

function Tarjeta({ item, tipo, onAbrir }) {
  const precio = precioDesde(item);
  const sub =
    tipo === "destinos"
      ? [item.region, item.country].filter(Boolean).join(", ")
      : [item.city || item.region, precio].filter(Boolean).join(" · ");

  return (
    <button
      type="button"
      onClick={onAbrir}
      className="candy-glass rounded-[18px] overflow-hidden text-left flex flex-col hover:shadow-[0_10px_26px_rgba(120,60,200,0.14)] transition-shadow"
    >
      <div className="relative h-40 bg-candy-tinta/5">
        {item.portada ? (
          <img src={urlImagen(item.portada)} alt={item.nombre} className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-candy-tinta-tenue text-[12px]">
            Sin imagen
          </div>
        )}
        <span
          className={`absolute top-2 left-2 text-[10px] font-extrabold rounded-full px-2 py-0.5 ${
            item.status === "published"
              ? "bg-emerald-500 text-white"
              : item.status === "draft"
              ? "bg-white/90 text-candy-tinta-media"
              : "bg-candy-tinta/70 text-white"
          }`}
        >
          {ETIQUETA_ESTADO[item.status] ?? item.status}
        </span>
        {item.featured && (
          <span className="absolute top-2 right-2 text-[10px] font-extrabold rounded-full px-2 py-0.5 bg-candy-durazno text-white">
            Destacado
          </span>
        )}
      </div>
      <div className="p-3.5 flex-1">
        <div className="text-[13.5px] font-bold text-candy-tinta leading-snug">{item.nombre || item.slug}</div>
        {sub && <div className="text-[11.5px] text-candy-tinta-media mt-0.5">{sub}</div>}
        {txt(item.tagline || item.summary) && (
          <div className="text-[11.5px] text-candy-tinta-tenue mt-1.5 line-clamp-2">
            {txt(item.tagline || item.summary)}
          </div>
        )}
      </div>
    </button>
  );
}

function PanelDetalle({ item, tipo, onCerrar }) {
  useEffect(() => {
    const onEsc = (e) => e.key === "Escape" && onCerrar();
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [onCerrar]);

  const datos = filasDeDatos(item, tipo);

  return (
    <div className="fixed inset-0 z-[60] flex justify-end">
      <div className="absolute inset-0 bg-candy-tinta/30" onClick={onCerrar} />
      <div className="relative flex h-full w-full max-w-[460px] flex-col p-3">
        <div className="candy-glass flex-1 rounded-[24px] overflow-y-auto font-candy-body">
          <div className="relative">
            {item.imagenes.length > 0 ? (
              <div className="flex gap-1.5 overflow-x-auto no-scrollbar snap-x">
                {item.imagenes.map((img) => (
                  <img
                    key={img.storage_path}
                    src={urlImagen(img.storage_path)}
                    alt={item.nombre}
                    className="h-52 w-[85%] shrink-0 object-cover snap-start first:rounded-tl-[24px] last:rounded-tr-[24px]"
                    loading="lazy"
                  />
                ))}
              </div>
            ) : (
              <div className="h-32 bg-candy-tinta/5" />
            )}
            <button
              type="button"
              onClick={onCerrar}
              className="absolute top-3 right-3 w-8 h-8 rounded-full bg-white/90 flex items-center justify-center text-candy-tinta-media hover:bg-white"
              aria-label="Cerrar"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="p-5 sm:p-6 flex flex-col gap-4">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className={`text-[10px] font-extrabold rounded-full px-2 py-0.5 ${
                    item.status === "published" ? "bg-emerald-500 text-white" : "bg-candy-tinta/10 text-candy-tinta-media"
                  }`}
                >
                  {ETIQUETA_ESTADO[item.status] ?? item.status}
                </span>
                {item.featured && (
                  <span className="text-[10px] font-extrabold rounded-full px-2 py-0.5 bg-candy-durazno text-white">
                    Destacado
                  </span>
                )}
              </div>
              <h2 className="font-candy-display text-lg font-extrabold text-candy-tinta mt-2">
                {item.nombre || item.slug}
              </h2>
              <div className="text-[11.5px] text-candy-tinta-tenue">/{item.slug}</div>
            </div>

            {txt(item.tagline || item.summary) && (
              <p className="text-[13px] text-candy-tinta-media leading-relaxed">{txt(item.tagline || item.summary)}</p>
            )}

            {datos.length > 0 && (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 border-t border-black/5 pt-4">
                {datos.map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-[10.5px] font-bold uppercase tracking-wide text-candy-tinta-tenue">{k}</dt>
                    <dd className="text-[12.5px] text-candy-tinta">{v}</dd>
                  </div>
                ))}
              </dl>
            )}

            {txt(item.description) && (
              <div className="border-t border-black/5 pt-4">
                <p className="text-[12.5px] text-candy-tinta-media leading-relaxed whitespace-pre-line">
                  {txt(item.description)}
                </p>
              </div>
            )}

            {item.features.length > 0 && (
              <div className="border-t border-black/5 pt-4">
                <p className="text-[10.5px] font-bold uppercase tracking-wide text-candy-tinta-tenue mb-2">
                  {tipo === "tours" ? "Incluye" : "Comodidades"}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {item.features.map((f) => (
                    <span
                      key={f.slug}
                      className="text-[11.5px] rounded-full bg-white/60 border border-white/80 px-2.5 py-1 text-candy-tinta"
                    >
                      {txt(f.label)}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {item.external_booking_url && (
              <a
                href={item.external_booking_url}
                target="_blank"
                rel="noreferrer"
                className="text-[12.5px] font-bold text-candy-azul underline decoration-dotted underline-offset-2"
              >
                Ver en {item.external_platform || "la plataforma de reservas"}
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function filasDeDatos(item, tipo) {
  const filas = [];
  const push = (k, v) => v != null && v !== "" && filas.push([k, v]);
  const precio = precioDesde(item);

  if (tipo === "destinos") {
    push("Región", item.region);
    push("País", item.country);
  }
  if (tipo === "hospedajes") {
    push("Tipo", { cabin: "Cabaña", hotel: "Hotel", apartment: "Apartamento", house: "Casa" }[item.type] ?? item.type);
    push("Ciudad", item.city || item.region);
    push("Precio desde", precio);
    push("Huéspedes", item.max_guests);
    push("Habitaciones", item.bedrooms);
    push("Camas", item.beds);
    push("Baños", item.bathrooms);
  }
  if (tipo === "tours") {
    push("Categoría", item.category);
    push("Ciudad", item.city || item.region);
    push("Precio desde", precio);
    push("Duración", txt(item.duration_label) || (item.duration_hours ? `${item.duration_hours} h` : null));
    push("Horario", txt(item.schedule_label));
    push("Dificultad", { easy: "Fácil", moderate: "Moderada", hard: "Exigente" }[item.difficulty] ?? item.difficulty);
    push("Personas", item.min_pax && item.max_pax ? `${item.min_pax}–${item.max_pax}` : item.max_pax || item.min_pax);
  }
  return filas;
}
