import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { ShopOrderDto } from "@albion-hub/shared";
import { useCurrentUser } from "@/auth/AuthProvider";
import { fetchShopOrderQueue, toQueueOrder } from "./shop-queue";
import type { ShopOrder } from "./shop";
import { usePoll } from "./use-poll";

/**
 * Fila de pedidos da loja (TASK-060), buscada uma vez e compartilhada: o contador do menu no AppShell e a
 * tela da fila leem daqui, então os dois nunca mostram números diferentes. Mesmo desenho do
 * `QueueProvider` dos saques (TASK-032), com o mesmo polling (doc-002: realtime fica pra depois).
 *
 * Quem não tem `shop:fulfill` **não busca nada**: a fila fica vazia e nenhuma requisição sai do painel. A
 * API é a autoridade de verdade; isto aqui só evita um 403 inútil a cada ciclo.
 */
export interface ShopQueueState {
  orders: ShopOrder[];
  loading: boolean;
  /** Erro só quando não há nada em tela; com dados velhos o painel prefere continuar mostrando. */
  error: string | null;
  refresh: () => void;
  /** Aplica o pedido que a API acabou de devolver e repõe o polling: a linha muda na hora. */
  apply: (order: ShopOrderDto) => void;
}

const ShopQueueContext = createContext<ShopQueueState | null>(null);

const EMPTY: ShopOrder[] = [];
const none = (): Promise<ShopOrder[]> => Promise.resolve(EMPTY);

export function ShopQueueProvider({ children }: { children: ReactNode }) {
  const { ability } = useCurrentUser();
  const allowed = ability.can("fulfill", "ShopOrder");
  const load = useCallback(() => (allowed ? fetchShopOrderQueue() : none()), [allowed]);
  const poll = usePoll<ShopOrder[]>(load, "Não foi possível carregar a fila de pedidos.");
  // `base` guarda contra qual resposta do polling este patch foi aplicado: quando o polling traz outra, a
  // versão do servidor volta a mandar, sem precisar de efeito pra limpar (mesma ideia do WalletProvider).
  const [patch, setPatch] = useState<{ order: ShopOrderDto; base: ShopOrder[] | null } | null>(null);

  const apply = useCallback(
    (order: ShopOrderDto) => {
      setPatch({ order, base: poll.data });
      poll.refresh();
    },
    [poll],
  );

  const orders = useMemo(() => {
    const base = poll.data ?? EMPTY;
    if (!patch || patch.base !== poll.data) return base;
    return base.map((item) => (item.id === patch.order.id ? toQueueOrder(patch.order) : item));
  }, [poll.data, patch]);

  const value = useMemo<ShopQueueState>(
    () => ({ orders, loading: allowed && poll.loading, error: poll.data ? null : poll.error, refresh: poll.refresh, apply }),
    [orders, allowed, poll.loading, poll.error, poll.data, poll.refresh, apply],
  );

  return <ShopQueueContext.Provider value={value}>{children}</ShopQueueContext.Provider>;
}

export function useShopOrderQueue(): ShopQueueState {
  const ctx = useContext(ShopQueueContext);
  if (!ctx) throw new Error("useShopOrderQueue fora de ShopQueueProvider");
  return ctx;
}
