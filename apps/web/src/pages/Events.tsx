import type { EventDto } from "@albion-hub/shared";
import { CalendarRange, ChevronRight, CircleDot, DoorOpen, LogOut, Ticket } from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import * as api from "@/api/events";
import { errorText } from "@/api/http";
import { usePoll } from "@/api/use-poll";
import { EventArchivedNote, EventCancelledNote, EventMeta, EventStatusPill, FillMeter, Freshness } from "@/components/events";
import { EmptyState, PageHeader, Panel, Pill, StatCard } from "@/components/display";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { canJoinEvent, eventFill, groupEvents, mySignupFor, mySignupLabel, roleViews, type EventBoard, type RoleView } from "@/lib/events";
import { cn } from "@/lib/utils";

/**
 * Eventos vistos pelo membro (TASK-023, AC#1): o que dá pra entrar agora, em que role estou e
 * quantas vagas sobraram. A tela se atualiza por polling (AC#4) e toda ação recarrega na hora.
 */
export function Events() {
  const load = useCallback(() => api.fetchEventBoard(), []);
  const { data, error, updatedAt, loading, refresh } = usePoll<EventBoard>(load, "Erro ao carregar os eventos");
  const [busy, setBusy] = useState<string | null>(null);

  const board = data ?? { events: [], occupancy: [], mySignups: [] };
  const groups = groupEvents(board.events);
  const mine = board.mySignups.filter((s) => s.status !== "cancelled");

  /** Toda mutação segue o mesmo rito: trava o botão, avisa no toast e recarrega a lista (AC#4). */
  async function act<T>(key: string, run: () => Promise<T>, ok: (result: T) => { title: string; description?: string }) {
    setBusy(key);
    try {
      const result = await run();
      const message = ok(result);
      toast.success(message.title, { description: message.description });
      refresh();
    } catch (e) {
      toast.error(errorText(e, "Não foi possível falar com o servidor."));
      refresh();
    } finally {
      setBusy(null);
    }
  }

  const join = (event: EventDto, role: RoleView) =>
    void act(`${event.id}:${role.slotId}`, () => api.joinEvent(event.id, role.slotId), (signup) =>
      signup.status === "confirmed"
        ? { title: `Vaga garantida em ${role.name}`, description: event.name }
        : { title: `Você entrou na espera de ${role.name}`, description: `Posição ${signup.position}. Se abrir vaga, você sobe sozinho.` },
    );

  const leave = (event: EventDto) =>
    void act(`${event.id}:leave`, () => api.leaveEvent(event.id), () => ({ title: "Você saiu do evento", description: event.name }));

  return (
    <>
      <PageHeader
        title="Eventos"
        description="Escolha uma role e garanta sua vaga. Role lotada entra na lista de espera e sobe sozinha quando alguém sai."
        action={<Freshness updatedAt={updatedAt} error={error} />}
      />

      {error && !data && (
        <div role="alert" className="mb-4 rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm">
          {error}
          <Button variant="outline" className="mt-3 block" onClick={refresh}>
            Tentar de novo
          </Button>
        </div>
      )}

      {loading && <Skeleton className="h-40 w-full" aria-label="Carregando eventos…" />}

      {data && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              label="Inscrições abertas"
              icon={<DoorOpen />}
              emphasis
              value={<span className="num">{groups.open.length}</span>}
              hint={groups.open.length > 0 ? "entre antes de lotar" : "nenhuma agora"}
            />
            <StatCard label="Minhas inscrições" icon={<Ticket />} value={<span className="num">{mine.length}</span>} hint="eventos em que você está" />
            <StatCard label="Acontecendo agora" icon={<CircleDot />} value={<span className="num">{groups.running.length}</span>} hint="já começaram" />
            <StatCard label="Em breve" icon={<CalendarRange />} value={<span className="num">{groups.upcoming.length}</span>} hint="ainda sem inscrição" />
          </div>

          <div className="space-y-4">
            {groups.running.length > 0 && (
              <Panel title="Acontecendo agora" titleId="events-running">
                <ul className="divide-y">
                  {groups.running.map((event) => (
                    <EventRow key={event.id} event={event} board={board} busy={busy} onJoin={join} onLeave={leave} />
                  ))}
                </ul>
              </Panel>
            )}

            <Panel title="Inscrições abertas" titleId="events-open">
              {groups.open.length === 0 ? (
                <div className="p-4">
                  <EmptyState
                    icon={<DoorOpen />}
                    title="Nenhum evento com inscrição aberta."
                    description="Quando um caller abrir as inscrições, o evento aparece aqui e no canal de eventos do Discord."
                  />
                </div>
              ) : (
                <ul className="divide-y">
                  {groups.open.map((event) => (
                    <EventRow key={event.id} event={event} board={board} busy={busy} onJoin={join} onLeave={leave} />
                  ))}
                </ul>
              )}
            </Panel>

            {groups.upcoming.length > 0 && (
              <Panel title="Em breve" titleId="events-upcoming">
                <ul className="divide-y">
                  {groups.upcoming.map((event) => (
                    <EventRow key={event.id} event={event} board={board} busy={busy} onJoin={join} onLeave={leave} />
                  ))}
                </ul>
              </Panel>
            )}

            {groups.done.length > 0 && (
              <Panel title="Encerrados, cancelados e arquivados" titleId="events-done">
                <ul className="divide-y">
                  {groups.done.slice(0, 5).map((event) => (
                    <li key={event.id} className="px-4 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                        <div className="min-w-0">
                          <p className="truncate font-medium">{event.name}</p>
                          <EventMeta event={event} />
                        </div>
                        <EventStatusPill status={event.status} />
                      </div>
                      {/* AC#4: quem estava inscrito descobre aqui que o evento caiu, e por quê. */}
                      <EventCancelledNote event={event} className="mt-2" />
                      <EventArchivedNote event={event} className="mt-2" />
                    </li>
                  ))}
                </ul>
              </Panel>
            )}
          </div>
        </>
      )}
    </>
  );
}

function EventRow({
  event,
  board,
  busy,
  onJoin,
  onLeave,
}: {
  event: EventDto;
  board: EventBoard;
  busy: string | null;
  onJoin: (event: EventDto, role: RoleView) => void;
  onLeave: (event: EventDto) => void;
}) {
  const signup = mySignupFor(event.id, board.mySignups);
  const roles = roleViews(event, board.occupancy, signup);
  const fill = eventFill(roles);
  const label = mySignupLabel(signup);
  const open = canJoinEvent(event);

  return (
    <li className="px-4 py-(--row-py)">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate font-medium">{event.name}</p>
            <EventStatusPill status={event.status} />
            {label && (
              <Pill tone="info" icon={<Ticket aria-hidden />}>
                {label}
              </Pill>
            )}
          </div>
          <EventMeta event={event} className="mt-0.5" />
          {event.description && <p className="mt-1 text-sm text-muted-foreground">{event.description}</p>}
          <EventCancelledNote event={event} className="mt-2" />
          <EventArchivedNote event={event} className="mt-2" />
        </div>
        <div className="w-full sm:w-52">
          <FillMeter {...fill} />
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {/* Inscrição fechada não vira fileira de botões desligados: vira placar, que é o que ainda informa. */}
        {open
          ? roles.map((role) => (
              <RoleButton key={role.slotId} role={role} busy={busy === `${event.id}:${role.slotId}`} onClick={() => onJoin(event, role)} />
            ))
          : roles.map((role) => (
              <span
                key={role.slotId}
                className={cn(
                  "flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-sm text-muted-foreground",
                  role.mine && "border-foreground/40 text-foreground",
                )}
              >
                {role.name}
                <span className="num">
                  {role.confirmed}/{role.slots}
                </span>
              </span>
            ))}
        {signup && open && (
          <Button variant="ghost" size="sm" disabled={busy === `${event.id}:leave`} onClick={() => onLeave(event)}>
            <LogOut />
            Sair do evento
          </Button>
        )}
      </div>

      <RoleGuide roles={roles} />
    </li>
  );
}

/**
 * Botão de role: mostra ocupação, destaca a minha e avisa antes do clique quando a role está lotada
 * ("entrar na espera"), pra ninguém clicar achando que garantiu vaga.
 */
function RoleButton({ role, busy, onClick }: { role: RoleView; busy: boolean; onClick: () => void }) {
  const mineLabel = role.mine === "confirmed" ? "sua role" : role.mine === "waitlist" ? `espera ${role.myPosition}º` : null;
  return (
    <Button
      variant={role.mine ? "default" : "outline"}
      size="sm"
      disabled={busy || role.mine === "confirmed"}
      onClick={onClick}
      aria-label={`${role.name}, ${role.confirmed} de ${role.slots} vagas${role.full ? ", lotada" : ""}${role.description ? `. ${role.description}` : ""}`}
      className={cn("gap-1.5", role.full && !role.mine && "border-dashed text-muted-foreground")}
    >
      <span className="truncate">{role.name}</span>
      <span className="num tabular-nums">
        {role.confirmed}/{role.slots}
      </span>
      {mineLabel && <span className="text-xs opacity-80">· {mineLabel}</span>}
      {!role.mine && role.full && <span className="text-xs">· espera</span>}
    </Button>
  );
}

/**
 * O que se espera de cada role (TASK-039), no lugar onde a decisão acontece: logo abaixo dos botões
 * de inscrição. Fica fechado porque quem já sabe a role só quer clicar; `details` abre no toque e no
 * teclado, então funciona no celular — que é onde a galera se inscreve — sem depender de hover.
 */
function RoleGuide({ roles }: { roles: readonly RoleView[] }) {
  const described = roles.filter((r) => r.description);
  if (described.length === 0) return null;
  return (
    <details className="group mt-2">
      <summary className="inline-flex w-fit cursor-pointer list-none items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none">
        <ChevronRight className="size-3.5 transition-transform duration-150 ease-out group-open:rotate-90" aria-hidden />
        O que cada role faz
      </summary>
      <dl className="mt-1.5 grid gap-1 border-l pl-3 text-xs sm:grid-cols-2">
        {described.map((role) => (
          <div key={role.slotId} className="flex gap-1.5">
            <dt className="shrink-0 font-medium">{role.name}</dt>
            <dd className="min-w-0 text-muted-foreground">{role.description}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
