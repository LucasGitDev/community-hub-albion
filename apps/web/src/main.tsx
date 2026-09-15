import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { Toaster } from "sonner";
import "@fontsource/spectral/400.css";
import "@fontsource/spectral/500.css";
import "@fontsource/spectral/600.css";
import "@fontsource-variable/hanken-grotesk";
import "./index.css";
import { AuthProvider } from "./auth/AuthProvider";
import { RequireAuth, RequirePermission } from "./auth/guards";
import { AppShell } from "./components/AppShell";
import { StoreProvider } from "./mock/store";
import { Login } from "./pages/Login";
import { MyWithdrawals } from "./pages/MyWithdrawals";
import { Placeholder } from "./pages/Placeholder";
import { StaffWithdrawals } from "./pages/StaffWithdrawals";
import { Wallet } from "./pages/Wallet";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/entrar" element={<Login />} />
          <Route
            element={
              <RequireAuth>
                <StoreProvider>
                  <AppShell />
                </StoreProvider>
              </RequireAuth>
            }
          >
            <Route path="/carteira" element={<Wallet />} />
            <Route path="/saques" element={<MyWithdrawals />} />
            {/* Gate de UI com as mesmas regras CASL da API; a API é a autoridade (TASK-009). */}
            <Route
              path="/staff/saques"
              element={
                <RequirePermission action="approve" subject="Withdrawal">
                  <StaffWithdrawals />
                </RequirePermission>
              }
            />
            <Route
              path="/staff/eventos"
              element={
                <RequirePermission action="create" subject="Event">
                  <Placeholder title="Eventos" description="Criar, abrir inscrições, iniciar e encerrar eventos." task="TASK-023" />
                </RequirePermission>
              }
            />
            <Route
              path="/staff/membros"
              element={
                <RequirePermission action="approve" subject="MemberRequest">
                  <Placeholder title="Membros" description="Aprovação de nick dos novos membros." task="TASK-013" />
                </RequirePermission>
              }
            />
            <Route
              path="/staff/splits"
              element={
                <RequirePermission action="update" subject="LootSplit">
                  <Placeholder title="Loot splits" description="Rascunho, ajuste de porcentagem e confirmação." task="TASK-029" />
                </RequirePermission>
              }
            />
            <Route
              path="/admin/papeis"
              element={
                <RequirePermission action="read" subject="UserRole">
                  <Placeholder title="Papéis" description="Conceder e remover papéis de caller, staff e admin." task="TASK-011" />
                </RequirePermission>
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
    </AuthProvider>
  </StrictMode>,
);
