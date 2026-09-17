import { useState } from "react";
import { Hand, Hourglass, Inbox, PackageCheck, Truck } from "lucide-react";
import { formatAmount, isRefundedShopOrder, SHOP_CURRENCY, type ShopOrderDto, type ShopOrderStatus } from "@albion-hub/shared";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Amount, EmptyState, PageHeader, ShopOrderBadge, StatCard } from "@/components/display";
import { ErrorState } from "@/pages/MyWithdrawals";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/format";
import { errorText } from "@/api/http";
import { useShopOrderQueue } from "@/api/ShopQueueProvider";
import type { ShopOrder } from "@/api/shop";
import { cancelShopOrder, claimShopOrder, deliverShopOrder, refundShopOrder, rejectShopOrder, releaseShopOrder } from "@/api/shop-queue";

/**
 * Fila de pedidos da loja (TASK-060, F6-21 a F6-24), no molde da fila de saques (TASK-032): a staff já
 * sabe usar essa tela, então ela é a mesma — abas por estado com contador, três números no topo, e a ação
 * de cada linha ao lado do que ela decide.
 *
 * Decisões de tela que vêm do doc-005:
 * - o preço vem no ouro do `--brand`, que é a cor da Buffunfa (doc-009), e **nunca abreviado** (F6-5);
 * - "Pegar pra entregar" é o primeiro passo e existe para a staff ver **quem** já está entregando (F6-22);
 *   por isso a linha de um pedido pego diz o nick de quem pegou, e não só "em entrega";
 * - a entrega exige a nota de onde e para quem foi (AC#4): o botão só habilita depois de escrita, igual à
 *   nota de liquidação do saque.
 *
 * Duas pessoas da staff podem estar olhando a mesma fila. Quando a outra já agiu, a API devolve 409 e a
 * tela mostra o motivo e recarrega — nunca finge que a ação deu certo.
 */
const tabs: { key: ShopOrderStatus; label: string }[] = [
  { key: "reserved", label: "Na fila" },
  { key: "claimed", label: "Em entrega" },
  { key: "delivered", label: "Entregues" },
  { key: "cancelled", label: "Cancelados" },
  { key: "rejected", label: "Recusados" },
];

const emptyByTab: Record<ShopOrderStatus, { title: string; description: string }> = {
  reserved: { title: "Nenhum pedido esperando.", description: "Compras novas na loja entram aqui na hora. A Buffunfa do membro já fica reservada." },
  claimed: { title: "Ninguém está entregando nada agora.", description: "Pegue um pedido da fila para avisar o resto da staff que ele é seu." },
  delivered: { title: "Nenhuma entrega registrada ainda.", description: "Depois de entregar, o pedido fica aqui com a nota e o débito de Buffunfa no extrato do membro." },
  cancelled: { title: "Nenhum pedido cancelado.", description: "Pedido que o membro desistiu (ou que a staff encerrou) aparece aqui, com a Buffunfa e o estoque devolvidos." },
  rejected: { title: "Nenhum pedido recusado.", description: "Quando a staff recusa um pedido, o motivo escrito fica registrado aqui." },
};

const sum = (list: ShopOrder[]) => list.reduce((s, o) => s + o.price, 0n);

export function StaffShopOrders() {
  const { orders, loading, error, refresh, apply } = useShopOrderQueue();
  const [tab, setTab] = useState<ShopOrderStatus>("reserved");
  const by = (s: ShopOrderStatus) => orders.filter((o) => o.status === s);
  const list = by(tab);
  const reserved = by("reserved");
  const claimed = by("claimed");
  const delivered = by("delivered");

  return (
    <>
      <PageHeader
        title="Fila de pedidos"
        description="Pegue o pedido antes de entrar no jogo: é como o resto da staff sabe que ele é seu. A Buffunfa só sai do saldo do membro quando você marca a entrega."
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard
          emphasis
          label="Na fila"
          icon={<Hourglass />}
          value={<Amount currency={SHOP_CURRENCY} value={sum(reserved)} />}
          hint={`${reserved.length} ${reserved.length === 1 ? "pedido esperando alguém pegar" : "pedidos esperando alguém pegar"}`}
          className="col-span-2 lg:col-span-1"
        />
        <StatCard
          label="Em entrega"
          icon={<Truck />}
          value={<Amount currency={SHOP_CURRENCY} value={sum(claimed)} />}
          hint={`${claimed.length} ${claimed.length === 1 ? "pedido com a staff" : "pedidos com a staff"}`}
        />
        <StatCard
          label="Entregues"
          icon={<PackageCheck />}
          value={<Amount currency={SHOP_CURRENCY} value={sum(delivered)} />}
          hint={`${delivered.length} ${delivered.length === 1 ? "pedido concluído" : "pedidos concluídos"}`}
        />
      </div>

      {error ? (
        <ErrorState message={error} onRetry={refresh} />
      ) : (
        <section className="overflow-hidden rounded-xl border bg-card">
          <Tabs value={tab} onValueChange={(v) => setTab(v as ShopOrderStatus)} className="gap-0">
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
                          t.key === "reserved" && count > 0 ? "bg-foreground text-background" : "bg-muted text-muted-foreground",
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
            <ul className="divide-y" aria-label="Pedidos da loja">
              {list.map((o) => (
                <StaffOrderRow key={o.id} order={o} onDone={apply} onConflict={refresh} />
              ))}
            </ul>
          )}
        </section>
      )}
    </>
  );
}

interface RowProps {
  order: ShopOrder;
  onDone: (order: ShopOrderDto) => void;
  onConflict: () => void;
}

function StaffOrderRow({ order, onDone, onConflict }: RowProps) {
  const [note, setNote] = useState("");
  /** Qual formulário de texto está aberto. Um por vez: recusar e estornar pedem motivo, e são caminhos diferentes. */
  const [form, setForm] = useState<"reject" | "refund" | null>(null);
  const [busy, setBusy] = useState(false);
  const nick = order.userNick ?? "Membro";
  const refunded = isRefundedShopOrder(order);

  /**
   * Toda ação passa por aqui. Erro da API (inclusive o 409 de quem chegou depois) vira toast com a
   * mensagem que a API escreveu e recarrega a fila: a linha muda de aba sozinha, e a tela nunca mostra
   * sucesso que não aconteceu.
   */
  const run = (action: () => Promise<ShopOrderDto>, success: { title: string; description: string }) => {
    setBusy(true);
    action()
      .then((updated) => {
        onDone(updated);
        toast.success(success.title, { description: success.description });
        setForm(null);
        setNote("");
      })
      .catch((e: unknown) => {
        toast.error("Nada mudou neste pedido", { description: errorText(e, "Não foi possível concluir a ação. Tente de novo.") });
        onConflict();
      })
      .finally(() => setBusy(false));
  };

  return (
    <li
      className={cn(
        // Três colunas no desktop, como na fila de saques: quem pediu (com a história do pedido embaixo),
        // quanto, e a ação. A linha do tempo mora junto do nome — como coluna própria ela era espremida.
        "grid gap-x-6 gap-y-3 px-4 py-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,12rem)_auto] lg:items-start",
        order.status === "reserved" && "shadow-[inset_3px_0_0_var(--warning)]",
        order.status === "claimed" && "shadow-[inset_3px_0_0_var(--info)]",
      )}
    >
      <div className="flex min-w-0 gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground" aria-hidden>
          {nick.slice(0, 2).toUpperCase()}
        </span>
        <div className="min-w-0 space-y-1">
          {/* O item primeiro: é o que a staff vai buscar no jogo. O nick vem em seguida, para quem entregar. */}
          <p className="font-medium break-words">{order.itemName}</p>
          <p className="truncate text-sm">
            para <span className="font-medium">{nick}</span>
          </p>
          <OrderTimeline order={order} />
          {order.note && (
            <p className={cn("border-l-2 pl-3 text-sm", order.status === "rejected" || refunded ? "border-destructive/60" : "border-border")}>
              {(order.status === "rejected" || order.status === "cancelled") && <span className="font-medium">Motivo: </span>}
              {order.note}
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 lg:block">
        {/* Buffunfa nunca abrevia (F6-5); o ouro do `--brand` é dela (doc-009). */}
        <Amount
          currency={SHOP_CURRENCY}
          value={order.price}
          className={cn("text-2xl font-semibold", (order.status === "cancelled" || order.status === "rejected" || refunded) && "text-muted-foreground line-through")}
        />
        <span className="lg:mt-1 lg:block">
          <ShopOrderBadge status={order.status} refunded={refunded} />
        </span>
      </div>

      {order.status === "reserved" && (
        <div className="space-y-2 lg:w-72">
          {form === "reject" && (
            <Textarea
              autoFocus
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Motivo da recusa (o membro vê essa mensagem)"
              rows={2}
              aria-label={`Motivo da recusa do pedido de ${nick}`}
              className="min-h-16 text-sm"
            />
          )}
          <div className="flex flex-wrap gap-2 lg:justify-end">
            {form !== "reject" ? (
              <>
                <Button variant="outline" disabled={busy} onClick={() => setForm("reject")}>
                  Recusar
                </Button>
                <Button
                  disabled={busy}
                  onClick={() =>
                    run(() => claimShopOrder(order.id), { title: "Pedido é seu", description: `O resto da staff já vê que você vai entregar “${order.itemName}”.` })
                  }
                >
                  <Hand />
                  Pegar pra entregar
                </Button>
              </>
            ) : (
              <>
                <Button variant="ghost" disabled={busy} onClick={() => setForm(null)}>
                  Voltar
                </Button>
                <Button
                  variant="destructive"
                  disabled={busy || !note.trim()}
                  onClick={() =>
                    run(() => rejectShopOrder(order.id, note.trim()), {
                      title: "Pedido recusado",
                      description: `${formatAmount(order.price, SHOP_CURRENCY)} e o estoque voltaram para ${nick}.`,
                    })
                  }
                >
                  Confirmar recusa
                </Button>
              </>
            )}
          </div>
        </div>
      )}

      {order.status === "claimed" && (
        <div className="space-y-2 lg:w-80">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Onde e para quem entregou"
              aria-label={`Nota da entrega do pedido de ${nick}`}
              className="sm:flex-1"
            />
            <Button
              disabled={busy || !note.trim()}
              onClick={() =>
                run(() => deliverShopOrder(order.id, note.trim()), {
                  title: "Pedido entregue",
                  description: `${formatAmount(order.price, SHOP_CURRENCY)} debitados de ${nick}.`,
                })
              }
            >
              <PackageCheck />
              Marcar como entregue
            </Button>
          </div>
          <div className="flex flex-wrap gap-2 lg:justify-end">
            {/* Devolver à fila é o caminho de "não vou conseguir": o membro não fica preso a mim (F6-22). */}
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => run(() => releaseShopOrder(order.id), { title: "Pedido de volta na fila", description: "Qualquer um da staff pode pegar agora." })}
            >
              Devolver à fila
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                run(() => cancelShopOrder(order.id, note.trim() || "Cancelado pela staff."), {
                  title: "Pedido cancelado",
                  description: `${formatAmount(order.price, SHOP_CURRENCY)} e o estoque voltaram para ${nick}.`,
                })
              }
            >
              Cancelar pedido
            </Button>
          </div>
        </div>
      )}

      {order.status === "delivered" && !refunded && (
        <div className="space-y-2 lg:w-72">
          {form === "refund" ? (
            <>
              <Textarea
                autoFocus
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Motivo do estorno (fica no extrato do membro)"
                rows={2}
                aria-label={`Motivo do estorno do pedido de ${nick}`}
                className="min-h-16 text-sm"
              />
              <div className="flex flex-wrap gap-2 lg:justify-end">
                <Button variant="ghost" disabled={busy} onClick={() => setForm(null)}>
                  Voltar
                </Button>
                <Button
                  variant="destructive"
                  disabled={busy || !note.trim()}
                  onClick={() =>
                    run(() => refundShopOrder(order.id, note.trim()), {
                      title: "Compra estornada",
                      description: `${formatAmount(order.price, SHOP_CURRENCY)} voltaram para ${nick}, e o item voltou ao estoque.`,
                    })
                  }
                >
                  Confirmar estorno
                </Button>
              </div>
            </>
          ) : (
            <div className="flex lg:justify-end">
              <Button variant="ghost" disabled={busy} onClick={() => setForm("refund")}>
                Estornar compra
              </Button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

/** Quando foi comprado, quem pegou e quando foi entregue: a história do pedido numa linha. */
function OrderTimeline({ order }: { order: ShopOrder }) {
  const who = order.handledByNick ?? "a staff";
  return (
    <p className="text-sm text-muted-foreground">
      Comprado em {formatDateTime(order.createdAt)}
      {order.status === "claimed" && order.handledAt && `. ${who} pegou em ${formatDateTime(order.handledAt)}`}
      {order.status === "delivered" && order.handledAt && `. ${who} entregou em ${formatDateTime(order.handledAt)}`}
      {order.status === "cancelled" && order.handledAt && `. Cancelado em ${formatDateTime(order.handledAt)}`}
      {order.status === "rejected" && order.handledAt && `. ${who} recusou em ${formatDateTime(order.handledAt)}`}
    </p>
  );
}
