import { ROLE_LABELS } from "@albion-hub/shared";
import { Navigate } from "react-router";
import { useState } from "react";
import { Button } from "@/components/ui";
import { useStore } from "@/mock/store";


function DiscordMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="currentColor" aria-hidden>
      <path d="M20.3 4.4A19.8 19.8 0 0 0 15.4 3l-.6 1.3a18.3 18.3 0 0 0-5.6 0L8.6 3a19.7 19.7 0 0 0-4.9 1.4C.6 9 0 13.5.3 18a19.9 19.9 0 0 0 6 3l1.3-2.1c-.7-.3-1.4-.6-2-1l.5-.4a14.2 14.2 0 0 0 12 0l.5.4c-.6.4-1.3.7-2 1l1.3 2.1a19.8 19.8 0 0 0 6-3c.5-5.2-.8-9.7-3.6-13.6ZM8.5 15.3c-1.2 0-2.1-1.1-2.1-2.4s.9-2.4 2.1-2.4 2.2 1.1 2.1 2.4c0 1.3-.9 2.4-2.1 2.4Zm7 0c-1.2 0-2.1-1.1-2.1-2.4s.9-2.4 2.1-2.4 2.2 1.1 2.1 2.4c0 1.3-.9 2.4-2.1 2.4Z" />
    </svg>
  );
}

export function Login() {
  const { user, users, loginAs } = useStore();
  const [picking, setPicking] = useState(false);

  if (user) return <Navigate to="/carteira" replace />;

  return (
    <div className="grid min-h-dvh place-items-center px-4 py-12">
      <div className="w-full max-w-sm">
        <h1 className="font-display text-5xl leading-none font-medium tracking-tight">albion-hub</h1>
        <p className="mt-4 text-muted">
          Sua prata dos loot splits da comunidade, com extrato de cada evento e pedido de saque.
        </p>

        {!picking ? (
          <Button className="mt-10 h-12 w-full bg-[#5865f2] text-white hover:bg-[#4752c4]" onClick={() => setPicking(true)}>
            <DiscordMark />
            Entrar com Discord
          </Button>
        ) : (
          <div className="mt-10 rounded-xl border border-rule bg-stone p-2">
            <p className="px-3 pt-2 pb-3 text-xs text-faint">OAuth mockado. Escolha com quem entrar:</p>
            <ul>
              {users.map((u) => (
                <li key={u.id}>
                  <button
                    onClick={() => loginAs(u.id)}
                    className="press flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-stone-raised"
                  >
                    <span className="grid size-8 place-items-center rounded-full bg-rule text-xs font-semibold text-silver">
                      {u.initials}
                    </span>
                    <span className="flex-1">
                      <span className="block text-sm font-medium">{u.nick}</span>
                      <span className="block text-xs text-muted">@{u.discordName}</span>
                    </span>
                    <span className="text-xs text-muted">{ROLE_LABELS[u.role]}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="mt-6 text-xs text-faint">Só membros do servidor conseguem entrar.</p>
      </div>
    </div>
  );
}
