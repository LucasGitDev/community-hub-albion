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
import { WalletProvider } from "./api/WalletProvider";
import { QueueProvider } from "./api/QueueProvider";
import { Login } from "./pages/Login";
import { MyWithdrawals } from "./pages/MyWithdrawals";
import { Profile } from "./pages/Profile";
import { Shop } from "./pages/Shop";
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
                <WalletProvider>
                  {/* QueueProvider: fila de saques da staff (TASK-032); não busca nada sem a permissão. */}
                  <QueueProvider>
                    <AppShell />
                  </QueueProvider>
                </WalletProvider>
              </RequireAuth>
            }
          >
            <Route path="/carteira" element={<Wallet />} />
            <Route path="/saques" element={<MyWithdrawals />} />
            <Route path="/perfil" element={<Profile />} />
            {/* TASK-041: "Meu nick" virou "Meu perfil"; link antigo (e o do bot) continua funcionando. */}
            <Route path="/nick" element={<Navigate to="/perfil" replace />} />
            {/* Loja: qualquer membro vê o catálogo e compra com Buffunfa (TASK-059). */}
            <Route path="/loja" element={<Shop />} />
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
                /* `read`/`MemberProfile` (TASK-047): admin e staff gerem a ficha do membro aqui. Não é
                   `read`/`UserRole` — esse subject é só de papéis, e `/admin/papeis` segue exclusivo do
                   admin logo abaixo. Member e caller continuam fora. */
                <RequirePermission action="read" subject="MemberProfile">
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
