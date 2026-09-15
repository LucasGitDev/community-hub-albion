import { useState } from "react";
import { toast } from "sonner";
import { Button, PageHeader, Silver, StatusBadge } from "@/components/ui";
import { cn, formatSilver } from "@/lib/format";
import { nickOf, useStore } from "@/mock/store";
import type { Withdrawal, WithdrawalStatus } from "@/mock/types";
import { WithdrawalTimeline } from "./MyWithdrawals";

const tabs: { key: WithdrawalStatus; label: string }[] = [
  { key: "pending", label: "Em análise" },
  { key: "approved", label: "A entregar" },
  { key: "settled", label: "Entregues" },
  { key: "rejected", label: "Recusados" },
];

export function StaffWithdrawals() {
  const { allWithdrawals } = useStore();
  const [tab, setTab] = useState<WithdrawalStatus>("pending");
  const list = allWithdrawals.filter((w) => w.status === tab);

  return (
    <>
      <PageHeader title="Fila de saques" description="Aprovar debita o saldo do membro. Marque como entregue depois de transferir in-game." />

      <div role="tablist" className="mb-6 flex gap-1 overflow-x-auto border-b border-rule [scrollbar-width:none]">
        {tabs.map((t) => {
          const count = allWithdrawals.filter((w) => w.status === t.key).length;
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                "-mb-px flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm whitespace-nowrap transition-colors duration-150",
                tab === t.key ? "border-brass text-parchment" : "border-transparent text-muted hover:text-parchment",
              )}
            >
              {t.label}
              <span className="num text-xs text-faint">{count}</span>
            </button>
          );
        })}
      </div>

      {list.length === 0 ? (
        <p className="text-muted">Nada aqui agora.</p>
      ) : (
        <ul className="space-y-3">
          {list.map((w) => (
            <StaffRow key={w.id} w={w} />
          ))}
        </ul>
      )}
    </>
  );
}

function StaffRow({ w }: { w: Withdrawal }) {
  const { decideWithdrawal, settleWithdrawal, balanceFor } = useStore();
  const [note, setNote] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const balance = balanceFor(w.userId);
  const nick = nickOf(w.userId);

  return (
    <li className="rounded-lg border border-rule bg-stone p-4 md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-medium">{nick}</p>
          <Silver value={w.amount} className="text-3xl text-silver" />
        </div>
        <StatusBadge status={w.status} />
      </div>
      <div className="mt-2">
        <WithdrawalTimeline w={w} />
      </div>
      {w.status === "pending" && (
        <p className="mt-1 text-sm text-faint">
          Saldo total de {nick}: <Silver value={balance.total} className="text-muted" />
        </p>
      )}
      {w.note && <p className="mt-3 border-l-2 border-rule pl-3 text-sm">{w.note}</p>}

      {w.status === "pending" && (
        <div className="mt-4 space-y-3">
          {rejecting && (
            <textarea
              autoFocus
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Motivo da recusa (o membro vê essa mensagem)"
              rows={2}
              className="w-full rounded-md border border-rule bg-ink p-3 text-sm outline-none focus:border-brass"
            />
          )}
          <div className="flex flex-wrap gap-2">
            {!rejecting ? (
              <>
                <Button
                  onClick={() => {
                    decideWithdrawal(w.id, "approved");
                    toast.success("Saque aprovado", { description: `${formatSilver(w.amount)} debitados de ${nick}.` });
                  }}
                >
                  Aprovar saque
                </Button>
                <Button variant="danger" onClick={() => setRejecting(true)}>
                  Recusar
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="danger"
                  disabled={!note.trim()}
                  onClick={() => {
                    decideWithdrawal(w.id, "rejected", note.trim());
                    toast("Saque recusado", { description: `Reserva de ${nick} liberada.` });
                  }}
                >
                  Confirmar recusa
                </Button>
                <Button variant="ghost" onClick={() => setRejecting(false)}>
                  Voltar
                </Button>
              </>
            )}
          </div>
        </div>
      )}

      {w.status === "approved" && (
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Nota da entrega, ex: banco de Martlock"
            className="h-10 w-full rounded-md border sm:flex-1 border-rule bg-ink px-3 text-sm outline-none focus:border-brass"
          />
          <Button
            variant="quiet"
            onClick={() => {
              settleWithdrawal(w.id, note.trim() || undefined);
              toast.success("Marcado como entregue");
            }}
          >
            Marcar como entregue
          </Button>
        </div>
      )}
    </li>
  );
}
