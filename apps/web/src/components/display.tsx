import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Hourglass, PackageCheck, X } from "lucide-react";
import { formatSilver } from "@albion-hub/shared";
import { cn } from "@/lib/utils";
import { easeOutCubic, interpolateSilver } from "@/lib/wallet";
import { useVariant } from "@/theme/variant";
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

const COUNT_UP_MS = 600;
/** improve-animations (frequência): o count-up do zero só roda na 1ª visita da sessão; depois só anima mudanças. */
let countedUpThisSession = false;

/**
 * Prata com count-up (variação C). Gate do `animate`: tela visitada poucas vezes por dia, propósito
 * = recompensa/estado (o saldo "chega"). Anima só a primeira montagem e mudanças de valor;
 * reduced-motion mostra o valor final direto. Texto final é o mesmo do <Silver>.
 */
export function CountUpSilver({ value, className }: { value: bigint; className?: string }) {
  const { rewardMotion } = useVariant();
  const startFromZero = rewardMotion && !countedUpThisSession;
  const [shown, setShown] = useState(startFromZero ? 0n : value);
  const fromRef = useRef(startFromZero ? 0n : value);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!rewardMotion || reduce) {
      fromRef.current = value;
      setShown(value);
      return;
    }
    countedUpThisSession = true;
    const from = fromRef.current;
    if (from === value) return;
    const start = performance.now();
    let raf = requestAnimationFrame(function tick(now) {
      const t = (now - start) / COUNT_UP_MS;
      const current = interpolateSilver(from, value, easeOutCubic(t));
      fromRef.current = current;
      setShown(current);
      if (t < 1) raf = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(raf);
  }, [value, rewardMotion]);

  return (
    <>
      <span aria-hidden={shown !== value}>
        <Silver value={shown} className={className} />
      </span>
      {shown !== value && <span className="sr-only">{formatSilver(value)}</span>}
    </>
  );
}

const statusMeta: Record<WithdrawalStatus, { label: string; icon: ReactNode; tone: "warning" | "info" | "destructive" | "success" }> = {
  pending: { label: "Em análise", icon: <Hourglass strokeWidth={2.25} />, tone: "warning" },
  approved: { label: "Aprovado, aguardando entrega", icon: <Check strokeWidth={2.5} />, tone: "info" },
  rejected: { label: "Recusado", icon: <X strokeWidth={2.5} />, tone: "destructive" },
  settled: { label: "Entregue", icon: <PackageCheck strokeWidth={2.25} />, tone: "success" },
};

const toneClass = {
  warning: "border-warning/35 bg-warning/10 text-warning v-c:border-warning v-c:bg-warning v-c:text-black",
  info: "border-info/35 bg-info/10 text-info v-c:border-info v-c:bg-info v-c:text-black",
  destructive:
    "border-destructive/35 bg-destructive/10 text-destructive v-c:border-destructive v-c:bg-destructive v-c:text-black",
  success: "border-success/35 bg-success/10 text-success v-c:border-success v-c:bg-success v-c:text-black",
  neutral: "border-border bg-muted text-muted-foreground",
} as const;

export type Tone = keyof typeof toneClass;

/** Pílula de estado: ícone + texto + cor (nunca só cor). Na C vira preenchida. */
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
        emphasis && "v-b:border-brand/40 v-c:border-foreground/60",
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
