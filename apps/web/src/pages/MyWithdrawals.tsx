import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader, Silver, StatusBadge } from "@/components/display";
import { HandCoins } from "lucide-react";
import { WithdrawDialog } from "@/components/WithdrawDialog";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/format";
import { useCurrentUser } from "@/auth/AuthProvider";
import { MIN_WITHDRAWAL, useStore } from "@/mock/store";
import type { Withdrawal } from "@/mock/types";

export function MyWithdrawals() {
  const { user } = useCurrentUser();
  const { withdrawalsFor, balanceFor } = useStore();
  const list = withdrawalsFor(user.discordId);
  const { available } = balanceFor(user.discordId);

  return (
    <>
      <PageHeader
        title="Meus saques"
        description="Pedidos ficam em análise até a staff aprovar e entregar a prata in-game."
        action={<WithdrawDialog trigger={<Button disabled={available < MIN_WITHDRAWAL}>Pedir saque</Button>} />}
      />
      {list.length === 0 ? (
        <EmptyState icon={<HandCoins />} title="Você ainda não pediu nenhum saque." description={`Com pelo menos 1M disponível, peça aqui e a staff entrega a prata in-game.`} />
      ) : (
        <ul className="divide-y overflow-hidden rounded-xl border bg-card">
          {list.map((w) => (
            <WithdrawalRow key={w.id} w={w} />
          ))}
        </ul>
      )}
    </>
  );
}

export function WithdrawalTimeline({ w }: { w: Withdrawal }) {
  return (
    <p className="text-sm text-muted-foreground">
      Pedido em {formatDateTime(w.requestedAt)}
      {w.decidedAt && `. ${w.status === "rejected" ? "Recusado" : "Aprovado"} por ${w.decidedBy} em ${formatDateTime(w.decidedAt)}`}
      {w.settledAt && `. Entregue por ${w.settledBy} em ${formatDateTime(w.settledAt)}`}
    </p>
  );
}

function WithdrawalRow({ w }: { w: Withdrawal }) {
  return (
    <li
      className={cn(
        "grid gap-x-6 gap-y-2 px-4 py-3 md:grid-cols-[12rem_minmax(0,1fr)] md:items-center",
        w.status === "pending" && "shadow-[inset_3px_0_0_var(--warning)]",
        w.status === "approved" && "shadow-[inset_3px_0_0_var(--info)]",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 md:block">
        <Silver
          value={w.amount}
          className={cn("text-2xl font-semibold", w.status === "rejected" && "text-muted-foreground line-through")}
        />
        <span className="md:mt-1 md:block">
          <StatusBadge status={w.status} />
        </span>
      </div>
      <div className="min-w-0 space-y-1">
        <WithdrawalTimeline w={w} />
        {w.note && <p className={cn("border-l-2 pl-3 text-sm", w.status === "rejected" && "border-destructive/60")}>{w.note}</p>}
      </div>
    </li>
  );
}
