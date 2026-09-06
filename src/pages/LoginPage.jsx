import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext.jsx";
import { supabaseConfigured } from "../lib/supabase.js";
import CandyGemLogo from "../components/CandyGemLogo.jsx";

const REDIRECT_KEY = "candycrm:auth:redirect";

// El magic link no completa el login en esta misma pestaña de forma
// síncrona: mandar el correo solo deja la UI en "sent". El login real pasa
// cuando el usuario vuelve por el link (a veces en otro momento/contexto),
// así que `from` no puede vivir solo en location.state — se persiste en
// sessionStorage, que sobrevive el reload de esa vuelta.
export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("idle"); // idle | sending | sent | error
  const [errorMsg, setErrorMsg] = useState("");
  const { session, signIn } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (!session) return;
    const from = sessionStorage.getItem(REDIRECT_KEY) || "/";
    sessionStorage.removeItem(REDIRECT_KEY);
    navigate(from, { replace: true });
  }, [session, navigate]);

  async function handleSubmit(e) {
    e.preventDefault();
    const from = location.state?.from?.pathname || "/";
    sessionStorage.setItem(REDIRECT_KEY, from);

    setStatus("sending");
    const { error } = await signIn(email);
    if (error) {
      setErrorMsg(error.message || "No se pudo enviar el link. Intentá de nuevo.");
      setStatus("error");
    } else {
      setStatus("sent");
    }
  }

  return (
    <div className="candy-bg flex h-dvh items-center justify-center px-4 font-candy-body">
      <div className="candy-glass w-full max-w-sm rounded-[24px] p-8">
        <div className="flex flex-col items-center text-center">
          <CandyGemLogo size={40} />
          <h1 className="mt-3 font-candy-display text-xl font-extrabold text-[#3b2a55]">candyCRM</h1>
          <p className="mt-1 text-sm text-[#8478a0]">Iniciá sesión para ver tu bandeja</p>
        </div>

        {!supabaseConfigured && (
          <p className="mt-6 rounded-2xl px-4 py-3 text-sm text-[#7a6a99]" style={{ background: "rgba(150,120,200,0.14)" }}>
            Falta configurar <code className="font-mono text-[#5b9bff]">VITE_SUPABASE_URL</code> y{" "}
            <code className="font-mono text-[#5b9bff]">VITE_SUPABASE_ANON_KEY</code> (ver .env.example).
          </p>
        )}

        <form onSubmit={handleSubmit} className="mt-6 space-y-3">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="tu@correo.com"
            disabled={status === "sending"}
            className="candy-glass w-full rounded-full px-4 py-2.5 text-sm text-[#3b2a55] outline-none placeholder:text-[#9b8fb5] disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={status === "sending" || !supabaseConfigured}
            className="w-full rounded-full py-2.5 text-sm font-bold text-white transition disabled:opacity-50"
            style={{
              background: "linear-gradient(180deg, #ff8fc0, #ff5ca8)",
              boxShadow: "0 3px 10px rgba(255,92,168,0.4)",
            }}
          >
            {status === "sending" ? "Enviando..." : "Enviar link de acceso"}
          </button>
        </form>

        {status === "sent" && (
          <p className="mt-4 text-center text-sm" style={{ color: "#0b8a5e" }}>
            Revisá tu correo para el link de acceso.
          </p>
        )}
        {status === "error" && (
          <p className="mt-4 text-center text-sm text-red-500">{errorMsg}</p>
        )}
      </div>
    </div>
  );
}
