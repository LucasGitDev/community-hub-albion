import { HandCoins, RefreshCw, TriangleAlert } from "lucide-react";
import { WITHDRAWAL_STATUSES, type WithdrawalStatus } from "@albion-hub/shared";
import { useWallet } from "@/api/WalletProvider";
import type { Withdrawal } from "@/api/wallet";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, PageHeader, Pill, Silver, StatusBadge } from "@/components/display";
import { WithdrawDialog } from "@/components/WithdrawDialog";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/format";

/**
 * Meus saques (TASK-031, AC#3): a lista real da API, com o estado de cada pedido e o motivo quando a
 * staff recusa — é o único retorno que o membro tem. O dono vem da sessão (AC#2).
 */
const countLabel: Record<WithdrawalStatus, string> = {
  pending: "em análise",
  approved: "aprovados",
  rejected: "recusados",
  settled: "entregues",
};

export function MyWithdrawals() {
  const { withdrawals, balance, loading, error, refresh } = useWallet();
  const negative = (balance?.balance ?? 0n) < 0n;
  const canRequest = !!balance && !negative && balance.available > 0n;
  const counts = WITHDRAWAL_STATUSES.map((status) => ({ status, n: withdrawals.filter((w) => w.status === status).length })).filter((c) => c.n > 0);
  const total = withdrawals.filter((w) => w.status === "settled").reduce((s, w) => s + w.amount, 0n);

  return (
    <>
      <PageHeader
        title="Meus saques"
        description="Pedidos ficam em análise até a staff aprovar e entregar a prata in-game."
        badge={
          withdrawals.length > 0 && (
            <span className="num rounded-full bg-muted px-2 py-0.5 text-xs font-semibold">
              {withdrawals.length}
            </span>
          )
        }
        // Um CTA só na tela (marclou #22): o polling atualiza a lista sozinho, o erro tem o próprio "Tentar
        // de novo", e com a lista vazia o botão vive dentro do estado vazio, onde a explicação está.
        action={withdrawals.length > 0 && <WithdrawDialog trigger={<Button disabled={!canRequest}>Pedir saque</Button>} />}
      />

      {counts.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
          {counts.map((c) => (
            <Pill key={c.status} tone="neutral">
              <span className="num font-semibold text-foreground">{c.n}</span> {countLabel[c.status]}
            </Pill>
          ))}
          {total > 0n && (
            <span className="text-muted-foreground">
              Já recebeu <Silver value={total} className="font-semibold text-foreground" /> de prata.
            </span>
          )}
        </div>
      )}

      {error ? (
        <ErrorState message={error} onRetry={refresh} />
      ) : loading ? (
        <ul className="divide-y overflow-hidden rounded-xl border bg-card" aria-busy>
          {[0, 1, 2].map((i) => (
            <li key={i} className="flex items-center justify-between gap-6 px-4 py-4">
              <Skeleton className="h-7 w-32" />
              <Skeleton className="h-4 w-48" />
            </li>
          ))}
        </ul>
      ) : withdrawals.length === 0 ? (
        <EmptyState
          icon={<HandCoins />}
          title="Você ainda não pediu nenhum saque."
          description="Não existe valor mínimo: peça qualquer quantia até o seu disponível e a staff entrega a prata in-game."
          action={<WithdrawDialog trigger={<Button disabled={!canRequest}>Pedir saque</Button>} />}
        />
      ) : (
        <ul className="divide-y overflow-hidden rounded-xl border bg-card">
          {withdrawals.map((w) => (
            <WithdrawalRow key={w.id} w={w} />
          ))}
        </ul>
      )}
    </>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 rounded-xl border border-destructive/40 bg-destructive/10 px-6 py-10 text-center">
      <TriangleAlert className="size-5 text-destructive" aria-hidden />
      <p className="font-medium">{message}</p>
      <Button variant="outline" onClick={onRetry}>
        <RefreshCw />
        Tentar de novo
      </Button>
    </div>
  );
}

/** Linha da história do pedido: quando foi pedido, decidido e entregue. */
function WithdrawalTimeline({ w }: { w: Withdrawal }) {
  return (
    <p className="text-sm text-muted-foreground">
      Pedido em {formatDateTime(w.createdAt)}
      {w.decidedAt && `. ${w.status === "rejected" ? "Recusado" : "Aprovado"} em ${formatDateTime(w.decidedAt)}`}
      {w.settledAt && `. Entregue em ${formatDateTime(w.settledAt)}`}
    </p>
  );
}

function WithdrawalRow({ w }: { w: Withdrawal }) {
  const note = w.status === "settled" ? (w.settlementNote ?? w.decisionNote) : w.decisionNote;
  return (
    <li
      className={cn(
        "grid gap-x-6 gap-y-2 px-4 py-3 md:grid-cols-[12rem_minmax(0,1fr)] md:items-center",
        w.status === "pending" && "shadow-[inset_3px_0_0_var(--warning)]",
        w.status === "approved" && "shadow-[inset_3px_0_0_var(--info)]",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 md:block">
        <Silver value={w.amount} className={cn("text-2xl font-semibold", w.status === "rejected" && "text-muted-foreground line-through")} />
        <span className="md:mt-1 md:block">
          <StatusBadge status={w.status} />
        </span>
      </div>
      <div className="min-w-0 space-y-1">
        <WithdrawalTimeline w={w} />
        {note && (
          <p className={cn("border-l-2 pl-3 text-sm", w.status === "rejected" ? "border-destructive/60" : "border-border")}>
            {w.status === "rejected" && <span className="font-medium">Motivo: </span>}
            {note}
          </p>
        )}
      </div>
    </li>
  );
}
