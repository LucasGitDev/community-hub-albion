import { useCallback, useState } from "react";
import { toast } from "sonner";
import { EyeOff, PackageOpen, Pencil, Plus, ShoppingBag, Store } from "lucide-react";
import { canOwnerCancelShopOrder, checkShopPurchase, formatAmount, isRefundedShopOrder, isSoldOut, SHOP_CURRENCY, shopRefusalMessage } from "@albion-hub/shared";
import { useCurrentUser } from "@/auth/AuthProvider";
import { errorText } from "@/api/http";
import { usePoll } from "@/api/use-poll";
import { buyShopItem, fetchShopCatalog, setShopItemPublished, type ShopBalance, type ShopCatalog, type ShopItem, type ShopOrder } from "@/api/shop";
import { cancelShopOrder } from "@/api/shop-queue";
import { Amount, EmptyState, PageHeader, Panel, Pill, ShopOrderBadge } from "@/components/display";
import { ShopItemDialog } from "@/components/ShopItemDialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/pages/MyWithdrawals";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Loja (TASK-059, F6-17 a F6-20). Uma tela só: o saldo de Buffunfa, o catálogo e os meus pedidos.
 *
 * Decisões de tela que vêm do doc-005:
 * - preço no ouro do `--brand`, que é a cor **da Buffunfa** (doc-009), e **nunca abreviado** (F6-5);
 * - item esgotado fica **cinza e não clicável, sem sair da lista** (F6-18): sumir esconde o que existe e
 *   faz o item voltar como novidade; aparecer esgotado cria fila de espera;
 * - quando falta Buffunfa o card diz **quanto** falta, em vez de só desabilitar — é o que liga a loja de
 *   volta ao evento, que é onde a Buffunfa é ganha.
 */
export function Shop() {
  const { ability } = useCurrentUser();
  const canManage = ability.can("manage", "ShopItem");
  const load = useCallback(() => fetchShopCatalog(), []);
  const poll = usePoll<ShopCatalog>(load, "Não foi possível carregar a loja.");
  const [fresh, setFresh] = useState<{ catalog: ShopCatalog; base: ShopCatalog | null } | null>(null);
  // Mesmo desenho do WalletProvider: o POST já devolve o catálogo novo, e o próximo ciclo confirma.
  const data = fresh && fresh.base === poll.data ? fresh.catalog : poll.data;
  const apply = (catalog: ShopCatalog) => {
    setFresh({ catalog, base: poll.data });
    poll.refresh();
  };

  const items = data?.items ?? [];
  const orders = data?.orders ?? [];
  const balance = data?.balance ?? null;
  const waiting = orders.filter((o) => o.status === "reserved" || o.status === "claimed");

  return (
    <>
      <PageHeader
        title="Loja"
        description="Gaste a Buffunfa que você ganhou nos eventos. A staff entrega cada pedido à mão."
        badge={waiting.length > 0 && <Pill tone="warning">{waiting.length} aguardando entrega</Pill>}
        action={canManage && <ShopItemDialog trigger={<Button variant="outline"><Plus />Novo item</Button>} onSaved={poll.refresh} />}
      />

      <BalanceStrip balance={balance} />

      {poll.error && !data ? (
        <ErrorState message={poll.error} onRetry={poll.refresh} />
      ) : !data ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-busy>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-40 rounded-xl" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Store />}
          title="A loja ainda está vazia."
          description={canManage ? "Cadastre o primeiro item: nome, o que a guilda entrega e o preço em Buffunfa." : "A staff ainda não cadastrou nenhum item. Continue participando dos eventos: a Buffunfa acumula."}
          action={canManage ? <ShopItemDialog trigger={<Button><Plus />Cadastrar item</Button>} onSaved={poll.refresh} /> : undefined}
        />
      ) : (
        <ul aria-label="Catálogo" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => (
            <ItemCard key={item.id} item={item} balance={balance} canManage={canManage} onChanged={poll.refresh} onBought={apply} />
          ))}
        </ul>
      )}

      {orders.length > 0 && (
        <Panel title="Meus pedidos" titleId="meus-pedidos" className="mt-8">
          <ul aria-label="Meus pedidos" className="divide-y">
            {orders.map((order) => (
              <OrderRow key={order.id} order={order} onChanged={poll.refresh} />
            ))}
          </ul>
        </Panel>
      )}
    </>
  );
}

/** Saldo em linha, não em card: o número já mora no chip do header, aqui ele é contexto da compra. */
function BalanceStrip({ balance }: { balance: ShopBalance | null }) {
  return (
    <section aria-label="Sua Buffunfa" className="mb-6 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border bg-card px-4 py-3">
      <p className="flex items-center gap-2">
        {/* Sem `<Sparkles>` aqui: a moeda que o `<Amount>` desenha (TASK-071) já é o símbolo da Buffunfa,
            e dois símbolos para a mesma moeda na mesma linha não dizem nada a mais. */}
        <span className="text-sm text-muted-foreground">Disponível pra gastar</span>
        {balance ? <Amount value={balance.available} currency={SHOP_CURRENCY} className="text-2xl font-semibold" /> : <Skeleton className="h-7 w-24" />}
      </p>
      {balance && balance.reserved > 0n && (
        <p className="text-sm text-muted-foreground">
          <Amount value={balance.reserved} currency={SHOP_CURRENCY} className="font-semibold text-foreground" /> em pedidos aguardando entrega
        </p>
      )}
    </section>
  );
}

function ItemCard({
  item,
  balance,
  canManage,
  onChanged,
  onBought,
}: {
  item: ShopItem;
  balance: ShopBalance | null;
  canManage: boolean;
  onChanged: () => void;
  onBought: (catalog: ShopCatalog) => void;
}) {
  const soldOut = isSoldOut(item);
  // Mesma função do servidor: a tela desabilita pelo mesmo critério que a transação usa pra recusar (AC#4).
  const refusal = balance ? checkShopPurchase({ price: item.price, stock: item.stock, published: item.published }, balance.balance, balance.reserved) : null;
  const missing = refusal?.reason === "insufficient" ? refusal.price - refusal.available : null;

  return (
    <li
      className={cn(
        "flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 text-card-foreground",
        // Esgotado fica cinza e o card inteiro recua, mas continua na lista (F6-18).
        soldOut && "bg-muted/40 text-muted-foreground",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className={cn("font-semibold break-words", soldOut && "text-muted-foreground")}>{item.name}</h3>
          {item.description && <p className="mt-1 text-sm text-muted-foreground">{item.description}</p>}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {/* Nunca abrevia: `340 BUF`, não `0,3K` (F6-5). */}
          {/* Esgotado recua o card inteiro (F6-18), e o ícone da moeda recua junto: um card cinza com uma
              moeda dourada acesa no canto chamaria atenção justamente para o que não dá pra comprar. */}
          <Amount value={item.price} currency={SHOP_CURRENCY} className={cn("text-xl font-semibold", soldOut && "text-muted-foreground [&_[data-currency-icon]]:opacity-45 [&_[data-currency-icon]]:grayscale")} />
          <StockHint item={item} />
        </div>
      </div>

      <div className="mt-auto flex flex-wrap items-center justify-between gap-2">
        {soldOut ? (
          // Não clicável de propósito (AC#3): `disabled` de verdade, não um botão que abre e recusa.
          <Button disabled variant="outline" aria-label={`${item.name} esgotado`}>
            <PackageOpen />
            Esgotado
          </Button>
        ) : (
          <BuyDialog item={item} balance={balance} disabled={!!refusal} onBought={onBought} />
        )}
        {missing !== null && (
          <p className="text-xs text-muted-foreground">
            Faltam <Amount value={missing} currency={SHOP_CURRENCY} className="font-semibold text-foreground" />
          </p>
        )}
        {canManage && <StaffControls item={item} onChanged={onChanged} />}
      </div>
    </li>
  );
}

function StockHint({ item }: { item: ShopItem }) {
  if (item.stock === null) return <span className="text-xs text-muted-foreground">sem limite</span>;
  if (item.stock <= 0) return <Pill tone="neutral">esgotado</Pill>;
  return (
    <span className="text-xs text-muted-foreground">
      <span className="num font-semibold text-foreground">{item.stock}</span> {item.stock === 1 ? "unidade" : "unidades"}
    </span>
  );
}

/** Ações de `shop:manage` (F6-25): editar e tirar/devolver o item da loja. Nunca apagar. */
function StaffControls({ item, onChanged }: { item: ShopItem; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await setShopItemPublished(item.id, !item.published);
      toast.success(item.published ? "Item fora da loja" : "Item de volta na loja", { description: item.name });
      onChanged();
    } catch (e) {
      toast.error("Não foi possível mudar o item", { description: errorText(e, "Tente de novo em instantes.") });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-1">
      {!item.published && <Pill tone="neutral">fora da loja</Pill>}
      <ShopItemDialog item={item} trigger={<Button variant="ghost" size="icon-sm" aria-label={`Editar ${item.name}`}><Pencil /></Button>} onSaved={onChanged} />
      <Button variant="ghost" size="icon-sm" disabled={busy} aria-label={item.published ? `Despublicar ${item.name}` : `Publicar ${item.name}`} onClick={() => void toggle()}>
        <EyeOff />
      </Button>
    </div>
  );
}

/**
 * Confirmação da compra. Existe porque a compra **prende** Buffunfa na hora: o membro precisa ver o preço
 * e o que sobra antes de clicar, e a recusa (se a tela estiver velha) chega como toast com a frase da API.
 */
function BuyDialog({ item, balance, disabled, onBought }: { item: ShopItem; balance: ShopBalance | null; disabled: boolean; onBought: (catalog: ShopCatalog) => void }) {
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const after = balance ? balance.available - item.price : null;

  const buy = async () => {
    if (sending) return;
    setSending(true);
    try {
      onBought(await buyShopItem(item.id));
      toast.success("Pedido feito", { description: `${formatAmount(item.price, SHOP_CURRENCY)} reservados até a staff entregar “${item.name}”.` });
      setOpen(false);
    } catch (e) {
      toast.error("Compra não concluída", { description: errorText(e, "Não foi possível comprar agora. Tente de novo em instantes.") });
    } finally {
      setSending(false);
    }
  };

  const refusal = balance ? checkShopPurchase({ price: item.price, stock: item.stock, published: item.published }, balance.balance, balance.reserved) : null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button disabled={disabled} onClick={() => setOpen(true)}>
        <ShoppingBag />
        Comprar
      </Button>
      <DialogContent>
        <DialogTitle className="text-xl">Comprar “{item.name}”?</DialogTitle>
        <DialogDescription>
          A Buffunfa fica reservada na hora e sai do seu saldo quando a staff entregar. Nada é lançado no seu extrato antes disso.
        </DialogDescription>

        <dl className="space-y-2 rounded-lg border bg-muted/40 p-4 text-sm">
          <div className="flex items-center justify-between gap-4">
            <dt className="text-muted-foreground">Preço</dt>
            <dd>
              <Amount value={item.price} currency={SHOP_CURRENCY} className="font-semibold" />
            </dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-muted-foreground">Sobra pra gastar</dt>
            <dd>{after === null ? "—" : <Amount value={after} currency={SHOP_CURRENCY} className="font-semibold" />}</dd>
          </div>
        </dl>

        {refusal && (
          <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
            {shopRefusalMessage(refusal)}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <DialogClose asChild>
            <Button type="button" variant="ghost">
              Cancelar
            </Button>
          </DialogClose>
          <Button disabled={sending || !!refusal} onClick={() => void buy()}>
            {sending ? "Comprando…" : "Confirmar compra"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Um pedido meu. O estado é a pílula da direita, e o único botão que existe aqui é o de desistir — e ele
 * só existe enquanto ninguém da staff pegou o pedido (F6-24): depois de `claimed` alguém já pode estar no
 * jogo com o item na mão, e aí quem encerra é a staff.
 */
function OrderRow({ order, onChanged }: { order: ShopOrder; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const refunded = isRefundedShopOrder(order);
  const canCancel = canOwnerCancelShopOrder(order.status);

  const cancel = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await cancelShopOrder(order.id);
      toast.success("Pedido cancelado", { description: `${formatAmount(order.price, SHOP_CURRENCY)} de volta no seu saldo.` });
      onChanged();
    } catch (e) {
      // A staff pode ter pegado o pedido entre a tela e o clique: a frase do 403 vem pronta da API.
      toast.error("Pedido não cancelado", { description: errorText(e, "Não foi possível cancelar agora. Atualize a página.") });
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <li
      className={cn(
        "flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3",
        order.status === "reserved" && "shadow-[inset_3px_0_0_var(--warning)]",
        order.status === "claimed" && "shadow-[inset_3px_0_0_var(--info)]",
      )}
    >
      <div className="min-w-0">
        <p className="font-medium break-words">{order.itemName}</p>
        <p className="text-sm text-muted-foreground">
          Pedido em {formatDateTime(order.createdAt)}
          {order.note && ` — ${order.note}`}
        </p>
      </div>
      <div className="flex items-center gap-3">
        <Amount
          value={order.price}
          currency={SHOP_CURRENCY}
          className={cn("font-semibold", (order.status === "cancelled" || order.status === "rejected" || refunded) && "text-muted-foreground line-through")}
        />
        <ShopOrderBadge status={order.status} refunded={refunded} />
        {canCancel && (
          <Button variant="ghost" size="sm" disabled={busy} aria-label={`Cancelar pedido de ${order.itemName}`} onClick={() => void cancel()}>
            Cancelar
          </Button>
        )}
      </div>
    </li>
  );
}
