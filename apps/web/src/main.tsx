import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { Toaster } from "sonner";
import "@fontsource-variable/geist";
import "./index.css";
import "./theme/picker.css";
import { AuthProvider } from "./auth/AuthProvider";
import { RequireAuth, RequirePermission } from "./auth/guards";
import { AppShell } from "./components/AppShell";
import { AdminRoles } from "./pages/AdminRoles";
import { StoreProvider } from "./mock/store";
import { Login } from "./pages/Login";
import { MyWithdrawals } from "./pages/MyWithdrawals";
import { Nick } from "./pages/Nick";
import { Placeholder } from "./pages/Placeholder";
import { StaffMembers } from "./pages/StaffMembers";
import { StaffWithdrawals } from "./pages/StaffWithdrawals";
import { Wallet } from "./pages/Wallet";
import { useVariant, VariantPicker, VariantProvider } from "./theme/variant";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <VariantProvider>
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
            <Route path="/nick" element={<Nick />} />
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
                  <StaffMembers />
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
                  <AdminRoles />
                </RequirePermission>
              }
            />
          </Route>
          <Route path="*" element={<Navigate to="/carteira" replace />} />
        </Routes>
      </BrowserRouter>
      <ThemedToaster />
      <VariantPicker />
    </AuthProvider>
    </VariantProvider>
  </StrictMode>,
);

/** Toaster segue a variação: tema claro/escuro; na C, cores de estado (richColors) pra reforçar o feedback. */
function ThemedToaster() {
  const { variant } = useVariant();
  return (
    <Toaster
      theme={variant === "a" ? "light" : "dark"}
      richColors={variant === "c"}
      position="bottom-right"
      mobileOffset={{ bottom: "calc(4.5rem + env(safe-area-inset-bottom))" }}
      toastOptions={{ className: "font-sans" }}
    />
  );
}
