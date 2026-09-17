import type { ReactNode } from "react";
import { Check, Hand, Hourglass, PackageCheck, RotateCcw, X } from "lucide-react";
import { formatAmount, formatAmountShort, SHOP_ORDER_STATUS_LABELS, type Currency, type ShopOrderStatus, type WithdrawalStatus } from "@albion-hub/shared";
import { cn } from "@/lib/utils";
import buffunfaIcon from "@/assets/buffunfa.png";

/**
 * **O** renderizador de valor do sistema, agora por moeda (F6-4). A moeda é obrigatória: um valor sem
 * moeda declarada não existe mais, nem no ledger nem na tela.
 *
 * A cor é identidade, não decoração (doc-009): prata é neutra (`foreground`), Buffunfa é o ouro do
 * `--brand`, reservado a ela desde a TASK-055. Âmbar continua sendo só CTA e não aparece aqui. Quem
 * chama pode sobrescrever (valor estornado fica cinza, crédito fica verde) — o default é a moeda.
 *
 * Sinal explícito quando `signed`. `short` é para contexto apertado (o chip do header): prata abrevia
 * para `1,48M`, Buffunfa **nunca** abrevia (F6-5) e sai cheia mesmo pedindo `short` — a regra mora no
 * `formatAmountShort` compartilhado, que o bot usa também, então painel e Discord não divergem.
 */
export function Amount({
  value,
  currency,
  signed,
  short,
  className,
}: {
  value: bigint;
  currency: Currency;
  signed?: boolean;
  short?: boolean;
  className?: string;
}) {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const sign = signed ? (negative ? "−" : "+") : negative ? "−" : "";
  return (
    <span className={cn("num inline-flex items-baseline whitespace-nowrap", currency === "buffunfa" && "text-brand", className)}>
      {currency === "buffunfa" && <BuffunfaIcon />}
      {sign}
      {short ? formatAmountShort(abs, currency) : formatAmount(abs, currency)}
    </span>
  );
}

/**
 * A moeda da Toca da Turma como ícone inline (doc-009: "no painel, o PNG como ícone inline junto do
 * número"). Mora aqui, dentro do `<Amount>`, e em lugar nenhum mais: espalhar a `<img>` pelas telas
 * faria a Buffunfa aparecer de dois jeitos, que é exatamente o que o formatador compartilhado evita.
 *
 * `aria-hidden` de propósito: quem lê com leitor de tela já ouve o `BUF` do texto, e o ícone repetiria
 * a moeda em toda linha do extrato. O texto também é o que garante que a distinção entre prata e
 * Buffunfa **nunca** dependa da cor nem da imagem ter carregado.
 *
 * `1em` amarra o ícone ao tamanho da fonte, então o mesmo componente serve do extrato (14px) ao
 * número-chave da carteira (30px) sem tamanho mágico por tela. O PNG versionado é de 512px e pesa
 * 318 KB; o que entra no bundle é a redução para 64px (@2x do maior uso).
 */
function BuffunfaIcon() {
  return (
    <img
      src={buffunfaIcon}
      alt=""
      aria-hidden
      draggable={false}
      width={64}
      height={64}
      className="mr-[0.3em] size-[1em] shrink-0 translate-y-[0.1em] select-none"
    />
  );
}

const statusMeta: Record<WithdrawalStatus, { label: string; icon: ReactNode; tone: "warning" | "info" | "destructive" | "success" }> = {
  pending: { label: "Em análise", icon: <Hourglass strokeWidth={2.25} />, tone: "warning" },
  approved: { label: "Aprovado, aguardando entrega", icon: <Check strokeWidth={2.5} />, tone: "info" },
  rejected: { label: "Recusado", icon: <X strokeWidth={2.5} />, tone: "destructive" },
  settled: { label: "Entregue", icon: <PackageCheck strokeWidth={2.25} />, tone: "success" },
};

const toneClass = {
  warning: "border-warning/35 bg-warning/10 text-warning",
  info: "border-info/35 bg-info/10 text-info",
  destructive:
    "border-destructive/35 bg-destructive/10 text-destructive",
  success: "border-success/35 bg-success/10 text-success",
  /** Buffunfa, e só ela: `--brand` é o ouro dela desde a TASK-055. Âmbar continua reservado a CTA. */
  brand: "border-brand/35 bg-brand/10 text-brand",
  neutral: "border-border bg-muted text-muted-foreground",
} as const;

export type Tone = keyof typeof toneClass;

/** Pílula de estado: ícone + texto + cor (nunca só cor). */
export function Pill({ tone, icon, children, className }: { tone: Tone; icon?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 w-fit shrink-0 items-center gap-1.5 rounded-full border px-2 text-xs font-medium whitespace-nowrap [&_svg]:size-3.5",
        toneClass[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: WithdrawalStatus }) {
  const m = statusMeta[status];
  return (
    <Pill tone={m.tone} icon={m.icon}>
      {m.label}
    </Pill>
  );
}

/**
 * Pílula de estado do pedido da loja (TASK-060). Mora aqui, junto da do saque, porque a fila da staff e a
 * lista "Meus pedidos" do membro precisam dizer a mesma coisa da mesma forma — duas versões divergiriam
 * na primeira mudança, e aí a conversa entre staff e membro passaria a ter duas verdades.
 *
 * Os tons seguem a paleta (doc-009, TASK-055): estado que espera é `warning`, estado em andamento é
 * `info`, fim bom é `success`, fim ruim é `destructive`. `refunded` não é um estado do pedido — é o
 * pedido entregue que ganhou um estorno (F6-19), e a tela precisa dizer isso em vez de continuar
 * mostrando só "entregue".
 */
const shopStatusMeta: Record<ShopOrderStatus | "refunded", { label: string; icon: ReactNode; tone: Tone }> = {
  reserved: { label: SHOP_ORDER_STATUS_LABELS.reserved, icon: <Hourglass strokeWidth={2.25} />, tone: "warning" },
  claimed: { label: SHOP_ORDER_STATUS_LABELS.claimed, icon: <Hand strokeWidth={2.25} />, tone: "info" },
  delivered: { label: SHOP_ORDER_STATUS_LABELS.delivered, icon: <PackageCheck strokeWidth={2.25} />, tone: "success" },
  cancelled: { label: SHOP_ORDER_STATUS_LABELS.cancelled, icon: <X strokeWidth={2.5} />, tone: "neutral" },
  rejected: { label: SHOP_ORDER_STATUS_LABELS.rejected, icon: <X strokeWidth={2.5} />, tone: "destructive" },
  refunded: { label: "estornado", icon: <RotateCcw strokeWidth={2.25} />, tone: "destructive" },
};

export function ShopOrderBadge({ status, refunded }: { status: ShopOrderStatus; refunded?: boolean }) {
  const m = shopStatusMeta[refunded ? "refunded" : status];
  return (
    <Pill tone={m.tone} icon={m.icon}>
      {m.label}
    </Pill>
  );
}

export function PageHeader({ title, description, action, badge }: { title: string; description?: string; action?: ReactNode; badge?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-4 border-b pb-5">
      <div className="min-w-0 max-w-2xl">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold">{title}</h1>
          {badge}
        </div>
        {description && <p className="mt-1 text-muted-foreground">{description}</p>}
      </div>
      {action && <div className="flex flex-wrap items-center gap-2">{action}</div>}
    </header>
  );
}

/** Card de número. `emphasis` = o número principal da tela (maior; a cor, quando há, vem da moeda). */
export function StatCard({
  label,
  labelId,
  value,
  hint,
  icon,
  emphasis,
  className,
}: {
  label: string;
  labelId?: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  emphasis?: boolean;
  className?: string;
}) {
  return (
    <section
      aria-labelledby={labelId}
      className={cn(
        "flex min-w-0 flex-col justify-between gap-3 rounded-xl border bg-card p-4 text-card-foreground",
        emphasis && "dark:border-foreground/25",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2 text-muted-foreground">
        <p id={labelId} className="text-sm">
          {label}
        </p>
        {icon && <span className="[&_svg]:size-4">{icon}</span>}
      </div>
      <div className={cn("min-w-0 font-semibold", emphasis ? "text-3xl" : "text-xl sm:text-2xl")}>{value}</div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </section>
  );
}

/** Estado vazio com um próximo passo (revenue-centric-design: nunca um painel em branco). */
export function EmptyState({ icon, title, description, action }: { icon: ReactNode; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-10 text-center">
      <span className="mb-1 grid size-10 place-items-center rounded-full bg-muted text-muted-foreground [&_svg]:size-5">{icon}</span>
      <p className="font-medium">{title}</p>
      {description && <p className="max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Panel({ title, action, children, className, titleId }: { title: string; action?: ReactNode; children: ReactNode; className?: string; titleId?: string }) {
  return (
    <section aria-labelledby={titleId} className={cn("min-w-0 rounded-xl border bg-card text-card-foreground", className)}>
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <h2 id={titleId} className="text-lg font-semibold">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}
