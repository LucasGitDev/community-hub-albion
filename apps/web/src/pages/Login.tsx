import { loginErrorMessage } from "@albion-hub/shared";
import { Navigate, useSearchParams } from "react-router";
import { DISCORD_LOGIN_URL } from "@/auth/api";
import { useAuth } from "@/auth/AuthProvider";
import { FullPageStatus } from "@/auth/guards";
import { Button } from "@/components/ui/button";

function DiscordMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="currentColor" aria-hidden>
      <path d="M20.3 4.4A19.8 19.8 0 0 0 15.4 3l-.6 1.3a18.3 18.3 0 0 0-5.6 0L8.6 3a19.7 19.7 0 0 0-4.9 1.4C.6 9 0 13.5.3 18a19.9 19.9 0 0 0 6 3l1.3-2.1c-.7-.3-1.4-.6-2-1l.5-.4a14.2 14.2 0 0 0 12 0l.5.4c-.6.4-1.3.7-2 1l1.3 2.1a19.8 19.8 0 0 0 6-3c.5-5.2-.8-9.7-3.6-13.6ZM8.5 15.3c-1.2 0-2.1-1.1-2.1-2.4s.9-2.4 2.1-2.4 2.2 1.1 2.1 2.4c0 1.3-.9 2.4-2.1 2.4Zm7 0c-1.2 0-2.1-1.1-2.1-2.4s.9-2.4 2.1-2.4 2.2 1.1 2.1 2.4c0 1.3-.9 2.4-2.1 2.4Z" />
    </svg>
  );
}

export function Login() {
  const { state } = useAuth();
  const [params] = useSearchParams();
  const error = params.get("erro");

  if (state.status === "authenticated") return <Navigate to="/carteira" replace />;
  if (state.status === "loading") return <FullPageStatus>Carregando…</FullPageStatus>;

  return (
    <div className="grid min-h-dvh place-items-center px-4 py-12">
      <div className="w-full max-w-sm">
        <h1 className="font-display text-5xl leading-none font-medium tracking-tight">albion-hub</h1>
        <p className="mt-4 text-muted">Sua prata dos loot splits da comunidade, com extrato de cada evento e pedido de saque.</p>

        {error && (
          <p role="alert" className="mt-8 rounded-md border border-oxblood/40 bg-oxblood/10 p-4 text-sm">
            {loginErrorMessage(error)}
          </p>
        )}

        <Button asChild className="mt-10 h-12 w-full bg-[#5865f2] text-white hover:bg-[#4752c4]">
          <a href={DISCORD_LOGIN_URL}>
            <DiscordMark />
            Entrar com Discord
          </a>
        </Button>

        <p className="mt-6 text-xs text-faint">Só membros do servidor da comunidade conseguem entrar.</p>
      </div>
    </div>
  );
}
