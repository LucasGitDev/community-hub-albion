import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Check, Hourglass, PackageCheck, X } from "lucide-react";
import { cn, formatSilver } from "@/lib/format";
import type { WithdrawalStatus } from "@/mock/types";

type Variant = "primary" | "quiet" | "danger" | "ghost";

const variants: Record<Variant, string> = {
  primary: "bg-brass text-ink hover:bg-[#d6b36d] font-semibold",
  quiet: "bg-stone-raised text-parchment hover:bg-rule border border-rule",
  danger: "bg-transparent text-oxblood border border-oxblood/40 hover:bg-oxblood/10",
  ghost: "bg-transparent text-muted hover:text-parchment",
};

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }>(
  ({ variant = "primary", className, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        "press inline-flex h-10 items-center justify-center gap-2 rounded-md px-4 text-sm disabled:pointer-events-none disabled:opacity-40",
        variants[variant],
        className,
      )}
      {...props}
    />
  ),
);
Button.displayName = "Button";

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

const statusMeta: Record<WithdrawalStatus, { label: string; icon: ReactNode; className: string }> = {
  pending: {
    label: "Em análise",
    icon: <Hourglass className="size-3.5" strokeWidth={2.25} />,
    className: "text-brass border-brass/60 border-dashed",
  },
  approved: {
    label: "Aprovado, aguardando entrega",
    icon: <Check className="size-3.5" strokeWidth={2.5} />,
    className: "text-verdigris border-verdigris/50 bg-verdigris/10",
  },
  rejected: {
    label: "Recusado",
    icon: <X className="size-3.5" strokeWidth={2.5} />,
    className: "text-oxblood border-oxblood/50 bg-oxblood/10",
  },
  settled: {
    label: "Entregue",
    icon: <PackageCheck className="size-3.5" strokeWidth={2.25} />,
    className: "text-ink border-silver bg-silver",
  },
};

export function StatusBadge({ status }: { status: WithdrawalStatus }) {
  const m = statusMeta[status];
  return (
    <span className={cn("inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium", m.className)}>
      {m.icon}
      {m.label}
    </span>
  );
}

export function PageHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="max-w-xl">
        <h1 className="font-display text-3xl font-medium tracking-tight text-parchment">{title}</h1>
        {description && <p className="mt-1 text-muted">{description}</p>}
      </div>
      {action}
    </header>
  );
}
