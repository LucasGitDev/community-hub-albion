import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { Toaster } from "sonner";
import "@fontsource-variable/geist";
import "./index.css";
import { AuthProvider } from "./auth/AuthProvider";
import { RequireAuth, RequirePermission } from "./auth/guards";
import { AppShell } from "./components/AppShell";
import { AdminMembers } from "./pages/AdminMembers";
import { AdminRoles } from "./pages/AdminRoles";
import { Events } from "./pages/Events";
import { StoreProvider } from "./mock/store";
import { Login } from "./pages/Login";
import { MyWithdrawals } from "./pages/MyWithdrawals";
import { Nick } from "./pages/Nick";
import { Placeholder } from "./pages/Placeholder";
import { StaffMembers } from "./pages/StaffMembers";
import { StaffEvents } from "./pages/StaffEvents";
import { StaffRoles } from "./pages/StaffRoles";
import { StaffTemplates } from "./pages/StaffTemplates";
import { StaffWithdrawals } from "./pages/StaffWithdrawals";
import { Wallet } from "./pages/Wallet";
import { ThemeProvider, useTheme } from "./theme/theme";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
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
            {/* Eventos: qualquer membro vê e se inscreve (TASK-023). */}
            <Route path="/eventos" element={<Events />} />
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
                  <StaffEvents />
                </RequirePermission>
              }
            />
            <Route
              path="/staff/templates"
              element={
                <RequirePermission action="update" subject="EventTemplate">
                  <StaffTemplates />
                </RequirePermission>
              }
            />
            {/* Catálogo de roles (TASK-040): mesma permissão que tinha dentro de /staff/templates. */}
            <Route
              path="/staff/roles"
              element={
                <RequirePermission action="update" subject="EventTemplate">
                  <StaffRoles />
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
              path="/admin/membros"
              element={
                <RequirePermission action="read" subject="UserRole">
                  <AdminMembers />
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
    </AuthProvider>
    </ThemeProvider>
  </StrictMode>,
);

/** Toaster segue o tema do painel. */
function ThemedToaster() {
  const { theme } = useTheme();
  return (
    <Toaster
      theme={theme}
      position="bottom-right"
      mobileOffset={{ bottom: "calc(4.5rem + env(safe-area-inset-bottom))" }}
      toastOptions={{ className: "font-sans" }}
    />
  );
}
