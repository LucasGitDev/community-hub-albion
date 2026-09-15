import type { NickRequestStatus } from "@albion-hub/shared";
import { useCallback, useEffect, useState } from "react";

export interface MyNick {
  gameNick: string | null;
  pending: { id: string; nick: string; status: NickRequestStatus; createdAt: string; updatedAt: string } | null;
}

async function readError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { message?: unknown } | null;
  return typeof body?.message === "string" ? body.message : "Não foi possível enviar agora. Tente de novo em instantes.";
}

async function fetchMyNick(signal?: AbortSignal): Promise<MyNick> {
  const res = await fetch("/api/me/nick", { credentials: "same-origin", signal, headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as MyNick;
}

/** Cria a solicitação ou corrige a pendente. Erro vem com a mensagem PT-BR da API. */
export async function submitNick(nick: string): Promise<MyNick> {
  const res = await fetch("/api/me/nick", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ nick }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as MyNick;
}

export type MyNickState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: MyNick };

export function useMyNick() {
  const [state, setState] = useState<MyNickState>({ status: "loading" });
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetchMyNick(controller.signal)
      .then((data) => setState({ status: "ready", data }))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setState({ status: "error", message: error instanceof Error ? error.message : "Erro ao carregar nick" });
      });
    return () => controller.abort();
  }, [version]);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  const set = useCallback((data: MyNick) => setState({ status: "ready", data }), []);
  return { state, reload, set };
}
