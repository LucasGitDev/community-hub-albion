import type { ReactNode } from "react";
import { Check, Hourglass, PackageCheck, X } from "lucide-react";
import { formatSilver } from "@albion-hub/shared";
import { cn } from "@/lib/utils";
import type { WithdrawalStatus } from "@/mock/types";

/** Valor em prata. Sinal explícito quando `signed`. */
export function Silver({ value, signed, className }: { value: bigint; signed?: boolean; className?: string }) {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const sign = signed ? (negative ? "−" : "+") : negative ? "−" : "";
  return (
    <span className={cn("num whitespace-nowrap", className)}>
      {sign}
      {formatSilver(abs)}
    </span>
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

/** Card de número. `emphasis` = o número principal da tela (maior, cor de destaque na B). */
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
        emphasis && "dark:border-brand/40",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2 text-muted-foreground">
        <p id={labelId} className="text-sm">
          {label}
        </p>
        {icon && <span className="[&_svg]:size-4">{icon}</span>}
      </div>
      <div className={cn("min-w-0 font-semibold", emphasis ? "text-3xl text-brand" : "text-xl sm:text-2xl")}>{value}</div>
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
