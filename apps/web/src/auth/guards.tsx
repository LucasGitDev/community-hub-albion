import type { Action, SubjectType } from "@albion-hub/shared";
import { ShieldX } from "lucide-react";
import type { ReactNode } from "react";
import { Link, Navigate, useLocation } from "react-router";
import { PageHeader } from "@/components/display";
import { Button } from "@/components/ui/button";
import { useAuth, useCurrentUser } from "./AuthProvider";

export function FullPageStatus({ children }: { children: ReactNode }) {
  return <div className="grid min-h-dvh place-items-center px-4 text-muted-foreground">{children}</div>;
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { state, reload } = useAuth();
  const location = useLocation();
  if (state.status === "loading") return <FullPageStatus>Carregando sua sessão…</FullPageStatus>;
  if (state.status === "error")
    return (
      <FullPageStatus>
        <div className="text-center">
          <p>Não foi possível falar com o servidor.</p>
          <Button variant="outline" className="mt-4" onClick={reload}>
            Tentar de novo
          </Button>
        </div>
      </FullPageStatus>
    );
  if (state.status === "anonymous") return <Navigate to="/entrar" replace state={{ from: location.pathname }} />;
  return children;
}

/** Rota que exige permissão: sem ela mostra acesso negado (não redireciona, AC#3). */
export function RequirePermission({ action, subject, children }: { action: Action; subject: SubjectType; children: ReactNode }) {
  const { ability } = useCurrentUser();
  return ability.can(action, subject) ? children : <AccessDenied />;
}

function AccessDenied() {
  return (
    <section aria-labelledby="denied-title">
      <PageHeader title="Acesso negado" description="Seu papel não permite abrir esta área." />
      <div className="flex max-w-xl items-start gap-4 rounded-xl border bg-card p-5">
        <ShieldX className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden />
        <div>
          <p id="denied-title">Se você acha que deveria ter acesso, fale com um admin da comunidade no Discord.</p>
          <Link to="/carteira" className="mt-3 inline-block text-sm font-medium underline-offset-4 hover:underline">
            Voltar pra carteira
          </Link>
        </div>
      </div>
    </section>
  );
}
