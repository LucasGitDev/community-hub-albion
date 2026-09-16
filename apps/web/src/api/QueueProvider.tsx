import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { WithdrawalDto } from "@albion-hub/shared";
import { useCurrentUser } from "@/auth/AuthProvider";
import { fetchWithdrawalQueue, type QueueItem } from "./withdrawals-queue";
import { usePoll } from "./use-poll";

/**
 * Fila de saques da staff (TASK-032), buscada uma vez e compartilhada: o contador do menu no AppShell e
 * a tela da fila leem daqui, então os dois nunca mostram números diferentes. Mesmo desenho do
 * `WalletProvider` da TASK-031, com o mesmo polling (doc-002: realtime fica pra depois).
 *
 * Quem não tem a permissão de aprovar saque **não busca nada**: a fila fica vazia e nenhuma requisição
 * sai do painel. A API é a autoridade de verdade; isto aqui só evita um 403 inútil a cada ciclo.
 */
export interface QueueState {
  items: QueueItem[];
  loading: boolean;
  /** Erro só quando não há nada em tela; com dados velhos o painel prefere continuar mostrando. */
  error: string | null;
  refresh: () => void;
  /** Aplica o saque que a API acabou de devolver e repõe o polling: a linha muda na hora. */
  apply: (withdrawal: WithdrawalDto) => void;
}

const QueueContext = createContext<QueueState | null>(null);

const EMPTY: QueueItem[] = [];
const none = (): Promise<QueueItem[]> => Promise.resolve(EMPTY);

export function QueueProvider({ children }: { children: ReactNode }) {
  const { ability } = useCurrentUser();
  const allowed = ability.can("approve", "Withdrawal");
  const load = useCallback(() => (allowed ? fetchWithdrawalQueue() : none()), [allowed]);
  const poll = usePoll<QueueItem[]>(load, "Não foi possível carregar a fila de saques.");
  // `base` guarda contra qual resposta do polling este patch foi aplicado: quando o polling traz outra,
  // a versão do servidor volta a mandar, sem precisar de efeito pra limpar (mesma ideia do WalletProvider).
  const [patch, setPatch] = useState<{ withdrawal: WithdrawalDto; base: QueueItem[] | null } | null>(null);

  const apply = useCallback(
    (withdrawal: WithdrawalDto) => {
      setPatch({ withdrawal, base: poll.data });
      poll.refresh();
    },
    [poll],
  );

  const items = useMemo(() => {
    const base = poll.data ?? EMPTY;
    if (!patch || patch.base !== poll.data) return base;
    const w = patch.withdrawal;
    return base.map((item) => (item.id === w.id ? { ...item, ...w, amount: BigInt(w.amount) } : item));
  }, [poll.data, patch]);

  const value = useMemo<QueueState>(
    () => ({
      items,
      loading: allowed && poll.loading,
      error: poll.data ? null : poll.error,
      refresh: poll.refresh,
      apply,
    }),
    [items, allowed, poll.loading, poll.error, poll.data, poll.refresh, apply],
  );

  return <QueueContext.Provider value={value}>{children}</QueueContext.Provider>;
}

export function useWithdrawalQueue(): QueueState {
  const ctx = useContext(QueueContext);
  if (!ctx) throw new Error("useWithdrawalQueue fora de QueueProvider");
  return ctx;
}
