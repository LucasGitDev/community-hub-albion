import { useCallback, useEffect, useState } from "react";
import { nextPollDelay } from "@/lib/events";
import { errorText } from "./http";

/**
 * Atualização automática por polling (AC#4; doc-002: realtime fica pra depois).
 *
 * Regras: agenda a próxima busca só depois que a anterior voltou (nada de pilha de requisições),
 * pausa enquanto a aba está escondida e busca na hora quando ela volta, e espaça o intervalo quando a
 * API falha. `refresh()` é o que as mutações chamam pra ver o resultado sem esperar o próximo ciclo.
 */
export interface Poll<T> {
  data: T | null;
  error: string | null;
  /** Momento da última resposta boa; alimenta o "atualizado há Xs". */
  updatedAt: number | null;
  loading: boolean;
  refresh: () => void;
}

interface PollState<T> {
  data: T | null;
  error: string | null;
  updatedAt: number | null;
}

export function usePoll<T>(load: () => Promise<T>, fallbackError: string): Poll<T> {
  const [state, setState] = useState<PollState<T>>({ data: null, error: null, updatedAt: null });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const run = async (): Promise<void> => {
      if (timer) clearTimeout(timer);
      try {
        const data = await load();
        if (!alive) return;
        failures = 0;
        setState({ data, error: null, updatedAt: Date.now() });
      } catch (e) {
        if (!alive) return;
        failures += 1;
        setState((prev) => ({ ...prev, error: errorText(e, fallbackError) }));
      }
      if (!alive) return;
      // Aba escondida não agenda nada: ninguém está olhando.
      const delay = nextPollDelay({ visible: document.visibilityState === "visible", failures });
      if (delay !== null) timer = setTimeout(() => void run(), delay);
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") void run();
    };

    void run();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onVisibility);
      if (timer) clearTimeout(timer);
    };
  }, [load, fallbackError, nonce]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  return { ...state, loading: state.data === null && state.error === null, refresh };
}
