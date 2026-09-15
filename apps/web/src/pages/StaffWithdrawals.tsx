import { useState } from "react";
import { Check, Hourglass, Inbox, PackageCheck, Truck } from "lucide-react";
import { formatSilver } from "@albion-hub/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState, PageHeader, Silver, StatCard, StatusBadge } from "@/components/display";
import { cn } from "@/lib/utils";
import { nickOf, useStore } from "@/mock/store";
import { toast } from "sonner";
import type { Withdrawal, WithdrawalStatus } from "@/mock/types";
import { WithdrawalTimeline } from "./MyWithdrawals";

const tabs: { key: WithdrawalStatus; label: string }[] = [
  { key: "pending", label: "Em análise" },
  { key: "approved", label: "A entregar" },
  { key: "settled", label: "Entregues" },
  { key: "rejected", label: "Recusados" },
];

const sum = (list: Withdrawal[]) => list.reduce((s, w) => s + w.amount, 0n);

export function StaffWithdrawals() {
  const { allWithdrawals } = useStore();
  const [tab, setTab] = useState<WithdrawalStatus>("pending");
  const by = (s: WithdrawalStatus) => allWithdrawals.filter((w) => w.status === s);
  const list = by(tab);
  const pending = by("pending");
  const approved = by("approved");
  const settled = by("settled");

  return (
    <>
      <PageHeader title="Fila de saques" description="Aprovar debita o saldo do membro. Marque como entregue depois de transferir in-game." />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard
          emphasis
          label="Em análise"
          icon={<Hourglass />}
          value={<Silver value={sum(pending)} />}
          hint={`${pending.length} ${pending.length === 1 ? "pedido esperando decisão" : "pedidos esperando decisão"}`}
          className="col-span-2 lg:col-span-1"
        />
        <StatCard label="A entregar" icon={<Truck />} value={<Silver value={sum(approved)} />} hint={`${approved.length} ${approved.length === 1 ? "aprovado" : "aprovados"}, prata a transferir`} />
        <StatCard label="Entregue" icon={<PackageCheck />} value={<Silver value={sum(settled)} />} hint={`${settled.length} ${settled.length === 1 ? "saque concluído" : "saques concluídos"}`} />
      </div>

      <section className="overflow-hidden rounded-xl border bg-card">
        <Tabs value={tab} onValueChange={(v) => setTab(v as WithdrawalStatus)} className="gap-0">
          <div className="overflow-x-auto border-b px-2 pt-2 [scrollbar-width:none]">
            <TabsList variant="line" className="h-10">
              {tabs.map((t) => {
                const count = by(t.key).length;
                return (
                  <TabsTrigger key={t.key} value={t.key} className="px-3">
                    {t.label}
                    <span
                      className={cn(
                        "num grid h-5 min-w-5 place-items-center rounded-full px-1.5 text-xs font-semibold",
                        t.key === "pending" && count > 0 ? "bg-foreground text-background" : "bg-muted text-muted-foreground",
                      )}
                    >
                      {count}
                    </span>
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </div>
        </Tabs>

        {list.length === 0 ? (
          <div className="p-4">
            <EmptyState icon={<Inbox />} title="Nada aqui agora." description="Pedidos novos dos membros entram em análise e aparecem nesta aba." />
          </div>
        ) : (
          <ul className="divide-y">
            {list.map((w) => (
              <StaffRow key={w.id} w={w} />
            ))}
          </ul>
        )}
      </section>
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
    <li
      className="grid gap-x-6 gap-y-3 px-4 py-3 lg:grid-cols-[minmax(0,15rem)_minmax(0,10rem)_minmax(0,1fr)_auto] lg:items-center lg:py-(--row-py)"
    >
      <div className="flex min-w-0 items-center gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground" aria-hidden>
          {nick.slice(0, 2).toUpperCase()}
        </span>
        <div className="min-w-0">
          <p className="truncate font-medium">{nick}</p>
          {w.status === "pending" && (
            <p className="truncate text-xs text-muted-foreground">
              Saldo total: <Silver value={balance.total} />
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 lg:block">
        <Silver value={w.amount} className="text-2xl font-semibold" />
        <span className="lg:mt-1 lg:block">
          <StatusBadge status={w.status} />
        </span>
      </div>

      <div className="min-w-0 space-y-1">
        <WithdrawalTimeline w={w} />
        {w.note && <p className="border-l-2 pl-3 text-sm">{w.note}</p>}
      </div>

      {w.status === "pending" && (
        <div className="space-y-2 lg:w-72">
          {rejecting && (
            <Textarea
              autoFocus
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Motivo da recusa (o membro vê essa mensagem)"
              rows={2}
              className="min-h-16 text-sm"
            />
          )}
          <div className="flex flex-wrap gap-2 lg:justify-end">
            {!rejecting ? (
              <>
                <Button variant="outline" onClick={() => setRejecting(true)}>
                  Recusar
                </Button>
                <Button
                  onClick={() => {
                    decideWithdrawal(w.id, "approved");
                    toast.success("Saque aprovado", { description: `${formatSilver(w.amount)} debitados de ${nick}.` });
                  }}
                >
                  <Check />
                  Aprovar saque
                </Button>
              </>
            ) : (
              <>
                <Button variant="ghost" onClick={() => setRejecting(false)}>
                  Voltar
                </Button>
                <Button
                  variant="destructive"
                  disabled={!note.trim()}
                  onClick={() => {
                    decideWithdrawal(w.id, "rejected", note.trim());
                    toast("Saque recusado", { description: `Reserva de ${nick} liberada.` });
                  }}
                >
                  Confirmar recusa
                </Button>
              </>
            )}
          </div>
        </div>
      )}

      {w.status === "approved" && (
        <div className="flex flex-col gap-2 sm:flex-row lg:w-96">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Nota da entrega, ex: banco de Martlock" className="sm:flex-1" />
          <Button
            variant="outline"
            onClick={() => {
                    settleWithdrawal(w.id, note.trim() || undefined);
                    toast.success("Marcado como entregue", { description: `${formatSilver(w.amount)} entregues a ${nick}.` });
                  }}
          >
            Marcar como entregue
          </Button>
        </div>
      )}
    </li>
  );
}
