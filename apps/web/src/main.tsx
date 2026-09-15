import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { Toaster } from "sonner";
import "@fontsource/spectral/400.css";
import "@fontsource/spectral/500.css";
import "@fontsource/spectral/600.css";
import "@fontsource-variable/hanken-grotesk";
import "./index.css";
import { AppShell } from "./components/AppShell";
import { canManageWithdrawals, isStaffArea, StoreProvider, useStore } from "./mock/store";
import type { Role } from "./mock/types";
import { Login } from "./pages/Login";
import { MyWithdrawals } from "./pages/MyWithdrawals";
import { Placeholder } from "./pages/Placeholder";
import { StaffWithdrawals } from "./pages/StaffWithdrawals";
import { Wallet } from "./pages/Wallet";

function RequireAuth({ children }: { children: ReactNode }) {
  const { user } = useStore();
  return user ? children : <Navigate to="/entrar" replace />;
}

/** Gate de UI. A regra de verdade mora na API (CASL, TASK-009). */
function RequireRole({ allow, children }: { allow: (role: Role) => boolean; children: ReactNode }) {
  const { user } = useStore();
  return user && allow(user.role) ? children : <Navigate to="/carteira" replace />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StoreProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/entrar" element={<Login />} />
          <Route
            element={
              <RequireAuth>
                <AppShell />
              </RequireAuth>
            }
          >
            <Route path="/carteira" element={<Wallet />} />
            <Route path="/saques" element={<MyWithdrawals />} />
            <Route
              path="/staff/saques"
              element={
                <RequireRole allow={canManageWithdrawals}>
                  <StaffWithdrawals />
                </RequireRole>
              }
            />
            <Route
              path="/staff/eventos"
              element={
                <RequireRole allow={isStaffArea}>
                  <Placeholder title="Eventos" description="Criar, abrir inscrições, iniciar e encerrar eventos." task="TASK-023" />
                </RequireRole>
              }
            />
            <Route
              path="/staff/membros"
              element={
                <RequireRole allow={isStaffArea}>
                  <Placeholder title="Membros" description="Aprovação de nick e gestão de papéis." task="TASK-013" />
                </RequireRole>
              }
            />
            <Route
              path="/staff/splits"
              element={
                <RequireRole allow={isStaffArea}>
                  <Placeholder title="Loot splits" description="Rascunho, ajuste de porcentagem e confirmação." task="TASK-029" />
                </RequireRole>
              }
            />
          </Route>
          <Route path="*" element={<Navigate to="/carteira" replace />} />
        </Routes>
      </BrowserRouter>
      <Toaster
        theme="dark"
        position="bottom-right"
        mobileOffset={{ bottom: "calc(4.5rem + env(safe-area-inset-bottom))" }}
        toastOptions={{ style: { background: "#232932", border: "1px solid #2e353f", color: "#e9e4d8" } }}
      />
    </StoreProvider>
  </StrictMode>,
);
