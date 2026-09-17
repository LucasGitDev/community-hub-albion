import { useState } from "react";
import { Check, Hourglass, Inbox, PackageCheck, Truck } from "lucide-react";
import { formatAmount, type WithdrawalDto, type WithdrawalStatus } from "@albion-hub/shared";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState, PageHeader, Amount, StatCard, StatusBadge } from "@/components/display";
import { ErrorState } from "@/pages/MyWithdrawals";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/format";
import { errorText } from "@/api/http";
import { useWithdrawalQueue } from "@/api/QueueProvider";
import { approveWithdrawal, rejectWithdrawal, settleWithdrawal, type QueueItem } from "@/api/withdrawals-queue";

/**
 * Fila de saques da staff (TASK-032, Q10/Q11/Q25) contra a API real. Aprovar lança o débito no ledger;
 * marcar a entrega registra quem transferiu a prata in-game e a nota (Q11).
 *
 * Duas pessoas da staff podem estar olhando a mesma fila. Quando a outra já decidiu, a API devolve 409 e
 * a tela mostra o motivo e recarrega a lista — nunca finge que a ação deu certo.
 */
const tabs: { key: WithdrawalStatus; label: string }[] = [
  { key: "pending", label: "Em análise" },
  { key: "approved", label: "A entregar" },
  { key: "settled", label: "Entregues" },
  { key: "rejected", label: "Recusados" },
];

const emptyByTab: Record<WithdrawalStatus, { title: string; description: string }> = {
  pending: { title: "Nenhum pedido esperando decisão.", description: "Pedidos novos dos membros entram aqui assim que são feitos." },
  approved: { title: "Nada para entregar agora.", description: "Saques aprovados ficam aqui até alguém transferir a prata in-game e marcar a entrega." },
  settled: { title: "Nenhuma entrega registrada ainda.", description: "Depois de marcar um saque como entregue, ele fica aqui com a nota de quem pagou." },
  rejected: { title: "Nenhum pedido recusado.", description: "Quando a staff recusa um pedido, o motivo escrito fica registrado aqui." },
};

const sum = (list: QueueItem[]) => list.reduce((s, w) => s + w.amount, 0n);

export function StaffWithdrawals() {
  const { items, loading, error, refresh, apply } = useWithdrawalQueue();
  const [tab, setTab] = useState<WithdrawalStatus>("pending");
  const by = (s: WithdrawalStatus) => items.filter((w) => w.status === s);
  const list = by(tab);
  const pending = by("pending");
  const approved = by("approved");
  const settled = by("settled");

  return (
    <>
      <PageHeader title="Fila de saques" description="Aprovar debita o saldo do membro na hora. Marque como entregue depois de transferir a prata in-game." />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard
          emphasis
          label="Em análise"
          icon={<Hourglass />}
          value={<Amount currency="silver" value={sum(pending)} />}
          hint={`${pending.length} ${pending.length === 1 ? "pedido esperando decisão" : "pedidos esperando decisão"}`}
          className="col-span-2 lg:col-span-1"
        />
        <StatCard label="A entregar" icon={<Truck />} value={<Amount currency="silver" value={sum(approved)} />} hint={`${approved.length} ${approved.length === 1 ? "aprovado" : "aprovados"}, prata a transferir`} />
        <StatCard label="Entregue" icon={<PackageCheck />} value={<Amount currency="silver" value={sum(settled)} />} hint={`${settled.length} ${settled.length === 1 ? "saque concluído" : "saques concluídos"}`} />
      </div>

      {error ? (
        <ErrorState message={error} onRetry={refresh} />
      ) : (
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

          {loading ? (
            <ul className="divide-y" aria-busy>
              {[0, 1, 2].map((i) => (
                <li key={i} className="flex items-center justify-between gap-6 px-4 py-4">
                  <Skeleton className="h-8 w-40" />
                  <Skeleton className="h-7 w-28" />
                  <Skeleton className="hidden h-4 w-48 lg:block" />
                </li>
              ))}
            </ul>
          ) : list.length === 0 ? (
            <div className="p-4">
              <EmptyState icon={<Inbox />} title={emptyByTab[tab].title} description={emptyByTab[tab].description} />
            </div>
          ) : (
            <ul className="divide-y" aria-label="Pedidos de saque">
              {list.map((w) => (
                <StaffRow key={w.id} w={w} onDone={apply} onConflict={refresh} />
              ))}
            </ul>
          )}
        </section>
      )}
    </>
  );
}

interface RowProps {
  w: QueueItem;
  onDone: (w: WithdrawalDto) => void;
  onConflict: () => void;
}

function StaffRow({ w, onDone, onConflict }: RowProps) {
  const [note, setNote] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const nick = w.userNick ?? "Membro";

  /**
   * Toda ação passa por aqui. Erro da API (inclusive o 409 de quem chegou depois) vira toast com a
   * mensagem que a API escreveu e recarrega a fila: a linha some ou muda de aba sozinha, e a tela nunca
   * mostra sucesso que não aconteceu.
   */
  const run = (action: () => Promise<WithdrawalDto>, success: { title: string; description: string }) => {
    setBusy(true);
    action()
      .then((updated) => {
        onDone(updated);
        toast.success(success.title, { description: success.description });
        setRejecting(false);
        setNote("");
      })
      .catch((e: unknown) => {
        toast.error("Nada mudou neste saque", { description: errorText(e, "Não foi possível concluir a ação. Tente de novo.") });
        onConflict();
      })
      .finally(() => setBusy(false));
  };

  return (
    <li
      className={cn(
        // Três colunas no desktop: quem pediu (com a história do pedido embaixo), quanto, e a ação. A
        // linha do tempo mora junto do nome de propósito — como coluna própria ela era espremida pelo
        // formulário de entrega e a pílula de estado passava por cima do texto.
        "grid gap-x-6 gap-y-3 px-4 py-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,14rem)_auto] lg:items-start",
        w.status === "pending" && "shadow-[inset_3px_0_0_var(--warning)]",
        w.status === "approved" && "shadow-[inset_3px_0_0_var(--info)]",
      )}
    >
      <div className="flex min-w-0 gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground" aria-hidden>
          {nick.slice(0, 2).toUpperCase()}
        </span>
        <div className="min-w-0 space-y-1">
          <p className="truncate font-medium">{nick}</p>
          <MemberContext w={w} />
          <WithdrawalTimeline w={w} />
          {w.decisionNote && (
            <p className={cn("border-l-2 pl-3 text-sm", w.status === "rejected" ? "border-destructive/60" : "border-border")}>
              {w.status === "rejected" && <span className="font-medium">Motivo: </span>}
              {w.decisionNote}
            </p>
          )}
          {w.settlementNote && <p className="border-l-2 pl-3 text-sm">{w.settlementNote}</p>}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 lg:block">
        <Amount currency="silver" value={w.amount} className={cn("text-2xl font-semibold", w.status === "rejected" && "text-muted-foreground line-through")} />
        <span className="lg:mt-1 lg:block">
          <StatusBadge status={w.status} />
        </span>
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
              aria-label={`Motivo da recusa do saque de ${nick}`}
              className="min-h-16 text-sm"
            />
          )}
          <div className="flex flex-wrap gap-2 lg:justify-end">
            {!rejecting ? (
              <>
                <Button variant="outline" disabled={busy} onClick={() => setRejecting(true)}>
                  Recusar
                </Button>
                <Button
                  disabled={busy}
                  onClick={() => run(() => approveWithdrawal(w.id), { title: "Saque aprovado", description: `${formatAmount(w.amount, "silver")} debitados de ${nick}.` })}
                >
                  <Check />
                  Aprovar saque
                </Button>
              </>
            ) : (
              <>
                <Button variant="ghost" disabled={busy} onClick={() => setRejecting(false)}>
                  Voltar
                </Button>
                <Button
                  variant="destructive"
                  disabled={busy || !note.trim()}
                  onClick={() => run(() => rejectWithdrawal(w.id, note.trim()), { title: "Saque recusado", description: `A reserva de ${nick} foi liberada.` })}
                >
                  Confirmar recusa
                </Button>
              </>
            )}
          </div>
        </div>
      )}

      {w.status === "approved" && (
        <div className="flex flex-col gap-2 sm:flex-row lg:w-80">
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Como pagou (ex: banco de Martlock)"
            aria-label={`Nota da entrega do saque de ${nick}`}
            className="sm:flex-1"
          />
          <Button
            variant="outline"
            disabled={busy || !note.trim()}
            onClick={() => run(() => settleWithdrawal(w.id, note.trim()), { title: "Marcado como entregue", description: `${formatAmount(w.amount, "silver")} entregues a ${nick}.` })}
          >
            Marcar como entregue
          </Button>
        </div>
      )}
    </li>
  );
}

/**
 * O contexto de quem decide: quanto o membro tem no total e quanto ainda está preso em outros pedidos.
 * Sem isso a staff aprova no escuro. Só aparece enquanto há decisão a tomar — depois de decidido, o
 * saldo de hoje não diz nada sobre a decisão de ontem.
 */
function MemberContext({ w }: { w: QueueItem }) {
  if (w.status !== "pending" || !w.balance) return null;
  const others = w.balance.reserved - w.amount;
  return (
    <p className="truncate text-xs text-muted-foreground">
      Saldo <Amount currency="silver" value={w.balance.balance} className="font-medium text-foreground" />
      {others > 0n && (
        <>
          {" · "}
          <Amount currency="silver" value={others} /> em outros pedidos
        </>
      )}
    </p>
  );
}

/** Quando foi pedido, quem decidiu e quem entregou: a história do pedido numa linha. */
function WithdrawalTimeline({ w }: { w: QueueItem }) {
  return (
    <p className="text-sm text-muted-foreground">
      Pedido em {formatDateTime(w.createdAt)}
      {w.decidedAt && `. ${w.status === "rejected" ? "Recusado" : "Aprovado"} em ${formatDateTime(w.decidedAt)}`}
      {w.settledAt && `. Entregue em ${formatDateTime(w.settledAt)}`}
    </p>
  );
}
