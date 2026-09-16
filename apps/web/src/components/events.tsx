import type { EventDto, EventStatus } from "@albion-hub/shared";
import { CalendarClock, CheckCircle2, CircleDot, DoorOpen, FileEdit, Lock, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import { Pill, type Tone } from "@/components/display";
import { POLL_INTERVAL_MS } from "@/lib/events";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Peças compartilhadas pelas duas telas de evento (TASK-023): estado, vagas e frescor do polling. */

const STATUS_META: Record<EventStatus, { label: string; tone: Tone; icon: ReactNode }> = {
  draft: { label: "Rascunho", tone: "neutral", icon: <FileEdit aria-hidden /> },
  open: { label: "Inscrições abertas", tone: "success", icon: <DoorOpen aria-hidden /> },
  closed: { label: "Inscrições fechadas", tone: "warning", icon: <Lock aria-hidden /> },
  running: { label: "Acontecendo agora", tone: "info", icon: <CircleDot aria-hidden /> },
  finished: { label: "Finalizado", tone: "neutral", icon: <CheckCircle2 aria-hidden /> },
  cancelled: { label: "Cancelado", tone: "destructive", icon: <XCircle aria-hidden /> },
};

/** Estado do evento com ícone + texto + cor (nunca só cor). */
export function EventStatusPill({ status }: { status: EventStatus }) {
  const meta = STATUS_META[status];
  return (
    <Pill tone={meta.tone} icon={meta.icon}>
      {meta.label}
    </Pill>
  );
}

export const eventStatusText = (status: EventStatus) => STATUS_META[status].label;

/** Linha de contexto do evento: template, quem manda e quando começa. */
export function EventMeta({ event, className }: { event: EventDto; className?: string }) {
  return (
    <p className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground", className)}>
      <span className="truncate">{event.templateName ?? "Template removido"}</span>
      <span className="truncate">
        caller <span className="font-medium text-foreground">{event.ownerNick ?? "—"}</span>
      </span>
      {event.startsAt && (
        <span className="inline-flex items-center gap-1.5">
          <CalendarClock className="size-3.5" aria-hidden />
          <span className="num">{formatDateTime(event.startsAt)}</span>
        </span>
      )}
      {!event.startsAt && <span>sem horário marcado</span>}
    </p>
  );
}

/**
 * Quanto do evento já encheu. O número vem antes da barra: é ele que diz "corre que tá acabando",
 * e a barra só dá a leitura de relance (dashboards: dado com significado, não enfeite).
 */
export function FillMeter({ confirmed, total, percent, waitlist }: { confirmed: number; total: number; percent: number; waitlist: number }) {
  return (
    <div className="min-w-0">
      {/* Texto corrido (sem flex): o número e o rótulo formam uma frase só, legível por leitor de tela. */}
      <p className="text-sm text-muted-foreground">
        <span className="num text-base font-semibold text-foreground">
          {confirmed}/{total}
        </span>{" "}
        vagas preenchidas
        {waitlist > 0 && (
          <>
            {" · "}
            <span className="num">{waitlist}</span> na espera
          </>
        )}
      </p>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted" role="presentation">
        <div className="h-full rounded-full bg-foreground transition-[width] duration-200 ease-(--ease-out)" style={{ width: `${Math.min(100, percent)}%` }} />
      </div>
    </div>
  );
}

/**
 * Estado do polling (AC#4). Sem contador de segundos de propósito: um relógio na tela repintaria
 * tudo a cada segundo para informar menos do que a frase abaixo já informa. O texto troca a cada
 * resposta nova, então ele também é o sinal de que a busca automática continua de pé.
 */
export function Freshness({ updatedAt, error }: { updatedAt: number | null; error?: string | null }) {
  if (error) return <span className="text-sm text-destructive">sem conexão com o servidor — tentando de novo</span>;
  if (updatedAt === null) return <span className="text-sm text-muted-foreground">carregando…</span>;
  return (
    <span className="text-sm text-muted-foreground" aria-live="polite">
      atualiza sozinho a cada <span className="num">{POLL_INTERVAL_MS / 1000}</span>s
    </span>
  );
}
