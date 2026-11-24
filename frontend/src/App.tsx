import { useState } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthUser, clearStoredAuth, getStoredUser } from "./lib/auth";
import { LoginPage } from "./pages/LoginPage";
import { SalesmanView } from "./pages/SalesmanView";
import { AdminView } from "./pages/AdminView";
import { ProductionView } from "./pages/ProductionView";
import { AuditorView } from "./pages/AuditorView";
import { OwnerView } from "./pages/OwnerView";

function RoleWorkspace({ user, onLogout }: { user: AuthUser; onLogout: () => void }) {
  switch (user.role) {
    case "SALESMAN":
      return <SalesmanView user={user} onLogout={onLogout} />;
    case "ADMIN":
      return <AdminView user={user} onLogout={onLogout} />;
    case "PRODUCTION":
      return <ProductionView user={user} onLogout={onLogout} />;
    case "AUDITOR":
      return <AuditorView user={user} onLogout={onLogout} />;
    case "OWNER":
      return <OwnerView user={user} onLogout={onLogout} />;
  }
}

export default function App() {
  const [user, setUser] = useState<AuthUser | null>(getStoredUser);

  function handleLogout() {
    clearStoredAuth();
    setUser(null);
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/login"
          element={
            user ? <Navigate to="/" replace /> : <LoginPage onLogin={(u) => setUser(u)} />
          }
        />
        <Route
          path="/"
          element={
            user ? (
              <RoleWorkspace user={user} onLogout={handleLogout} />
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
