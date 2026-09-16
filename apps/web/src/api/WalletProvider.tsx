import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { fetchMyWallet, type Balance, type MyWallet, type Withdrawal } from "./wallet";
import { usePoll } from "./use-poll";

/**
 * Saldo e saques do membro logado, buscados uma vez e compartilhados (TASK-031): o chip do header, a
 * Carteira, Meus saques e o diálogo de pedido leem daqui, então nunca mostram números diferentes entre si.
 *
 * Usa o mesmo polling do resto do painel (doc-002: realtime fica pra depois). `apply` existe porque o
 * POST do saque já devolve o saldo novo: a tela mostra o efeito na hora e o próximo ciclo confirma.
 */
export interface WalletState {
  balance: Balance | null;
  withdrawals: Withdrawal[];
  loading: boolean;
  /** Erro só quando não há nada em tela; com dados velhos o painel prefere continuar mostrando. */
  error: string | null;
  refresh: () => void;
  apply: (wallet: MyWallet) => void;
}

const WalletContext = createContext<WalletState | null>(null);

const EMPTY: Withdrawal[] = [];

export function WalletProvider({ children }: { children: ReactNode }) {
  const load = useCallback(() => fetchMyWallet(), []);
  const poll = usePoll<MyWallet>(load, "Não foi possível carregar sua carteira.");
  // `base` guarda contra qual resposta do polling este resultado foi aplicado: quando o polling traz
  // outra, a versão do servidor volta a mandar, sem precisar de efeito pra limpar.
  const [fresh, setFresh] = useState<{ wallet: MyWallet; base: MyWallet | null } | null>(null);

  const apply = useCallback(
    (wallet: MyWallet) => {
      setFresh({ wallet, base: poll.data });
      poll.refresh();
    },
    [poll],
  );

  const data = fresh && fresh.base === poll.data ? fresh.wallet : poll.data;
  const value = useMemo<WalletState>(
    () => ({
      balance: data?.balance ?? null,
      withdrawals: data?.withdrawals ?? EMPTY,
      loading: poll.loading,
      error: data ? null : poll.error,
      refresh: poll.refresh,
      apply,
    }),
    [data, poll.loading, poll.error, poll.refresh, apply],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletState {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet fora de WalletProvider");
  return ctx;
}
