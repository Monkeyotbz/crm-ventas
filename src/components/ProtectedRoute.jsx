import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext.jsx";

export default function ProtectedRoute() {
  const { session, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="candy-bg flex h-dvh items-center justify-center font-candy-body">
        <div className="candy-glass rounded-[20px] px-6 py-4 text-sm text-[#8478a0]">
          Verificando sesión...
        </div>
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <Outlet />;
}
