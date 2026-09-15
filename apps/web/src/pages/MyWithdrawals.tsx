import { Button } from "@/components/ui/button";
import { PageHeader, Silver, StatusBadge } from "@/components/display";
import { WithdrawDialog } from "@/components/WithdrawDialog";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/format";
import { MIN_WITHDRAWAL, useStore, useUser } from "@/mock/store";
import type { Withdrawal } from "@/mock/types";

export function MyWithdrawals() {
  const user = useUser();
  const { withdrawalsFor, balanceFor } = useStore();
  const list = withdrawalsFor(user.id);
  const { available } = balanceFor(user.id);

  return (
    <>
      <PageHeader
        title="Meus saques"
        description="Pedidos ficam em análise até a staff aprovar e entregar a prata in-game."
        action={<WithdrawDialog trigger={<Button disabled={available < MIN_WITHDRAWAL}>Pedir saque</Button>} />}
      />
      {list.length === 0 ? (
        <p className="text-muted">Você ainda não pediu nenhum saque.</p>
      ) : (
        <ul className="space-y-3">
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
    <p className="text-sm text-faint">
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
        "rounded-lg border p-4 md:p-5",
        w.status === "pending" && "border-dashed border-brass/50",
        w.status === "approved" && "border-verdigris/40",
        w.status === "rejected" && "border-rule",
        w.status === "settled" && "border-rule",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Silver
          value={w.amount}
          className={cn("text-3xl", w.status === "rejected" ? "text-faint line-through decoration-oxblood/70" : "text-silver")}
        />
        <StatusBadge status={w.status} />
      </div>
      <div className="mt-2">
        <WithdrawalTimeline w={w} />
      </div>
      {w.note && (
        <p className={cn("mt-3 border-l-2 pl-3 text-sm", w.status === "rejected" ? "border-oxblood/60" : "border-rule")}>
          {w.note}
        </p>
      )}
    </li>
  );
}
