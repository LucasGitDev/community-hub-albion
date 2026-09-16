import {
  eventCreateSchema,
  EVENT_CANCEL_REASON_MAX,
  EVENT_TEMPLATE_NAME_MAX,
  firstIssue,
  type EventDto,
  type EventMemberDto,
  type EventSignupDto,
  type EventTemplateDto,
  type EventTransition,
} from "@albion-hub/shared";
import { Archive, CalendarPlus, CircleDot, Coins, Crown, DoorOpen, Flag, ListOrdered, Lock, Play, Users, X } from "lucide-react";
import { useCallback, useEffect, useId, useState } from "react";
import { toast } from "sonner";
import * as api from "@/api/events";
import { errorText } from "@/api/http";
import { usePoll } from "@/api/use-poll";
import { EventArchivedNote, EventCancelledNote, EventMeta, EventStatusPill, FillMeter, Freshness, eventStatusText } from "@/components/events";
import { DraftBlocksArchiveNote, EventSettlement } from "@/components/EventSettlement";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { canSettle, showsSettlement, toSettle } from "@/lib/settlement";
import { EmptyState, PageHeader, Panel, Pill, StatCard } from "@/components/display";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useCurrentUser } from "@/auth/AuthProvider";
import {
  availableTransitions,
  canManageRoster,
  canTransferOwner,
  eventFill,
  groupEvents,
  nickOf,
  roleViews,
  type EventBoard,
  type RoleView,
} from "@/lib/events";
import { fetchEventTemplates } from "@/templates/api";
import { cn } from "@/lib/utils";

/** Rótulo e ícone de cada ação de estado, na ordem em que o caller usa (Q26). */
const TRANSITION_META: Record<EventTransition, { label: string; icon: typeof Play; variant: "default" | "outline" | "destructive" }> = {
  open: { label: "Abrir inscrições", icon: DoorOpen, variant: "default" },
  close: { label: "Fechar inscrições", icon: Lock, variant: "outline" },
  start: { label: "Iniciar evento", icon: Play, variant: "default" },
  finish: { label: "Finalizar evento", icon: Flag, variant: "default" },
  cancel: { label: "Cancelar evento", icon: X, variant: "destructive" },
  archive: { label: "Arquivar evento", icon: Archive, variant: "outline" },
};

/**
 * Central de eventos do caller e da staff (TASK-023, AC#2/AC#3): cria a partir de template (Q9),
 * conduz a máquina de estados (Q26) e organiza a lista de inscritos por role (Q27). Só aparece o que
 * o papel pode fazer naquele evento e naquele estado; a API continua sendo a autoridade.
 */
export function StaffEvents() {
  const { user, ability } = useCurrentUser();
  const load = useCallback(() => api.fetchEventBoard(), []);
  const { data, error, updatedAt, loading, refresh } = usePoll<EventBoard>(load, "Erro ao carregar os eventos");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [cancelling, setCancelling] = useState<EventDto | null>(null);
  const [archiving, setArchiving] = useState<EventDto | null>(null);
  const [busy, setBusy] = useState(false);

  const board = data ?? { events: [], occupancy: [], mySignups: [] };
  const groups = groupEvents(board.events);
  const live = [...groups.running, ...groups.open, ...groups.upcoming];
  const mine = board.events.filter((e) => e.ownerUserId === user.id && !["cancelled", "archived"].includes(e.status));
  /**
   * Fila do acerto (AC#1): o evento finalizado **é** pendência, não histórico, e antes desta task ele
   * sumia da conta de "meus eventos" no instante em que o caller terminava o jogo — justo quando a
   * prata ainda não tinha sido dividida. Some daqui quando arquiva, que é o fim de fato (Q26).
   */
  const settling = toSettle(board.events, ability);
  const settlingIds = new Set(settling.map((e) => e.id));
  // Sem escolha ainda, o acerto pendente ganha do evento vivo: é a única coisa aqui com prazo e prata parada.
  const selected =
    board.events.find((e) => e.id === selectedId) ?? settling.find((e) => e.ownerUserId === user.id) ?? live.find((e) => e.ownerUserId === user.id) ?? live[0] ?? board.events[0] ?? null;

  async function transition(event: EventDto, action: EventTransition, reason?: string) {
    setBusy(true);
    try {
      const updated = await api.transitionEvent(event.id, action, reason);
      toast.success(`${event.name}: ${eventStatusText(updated.status).toLowerCase()}`, {
        description:
          action === "open"
            ? "O embed foi publicado no canal de eventos."
            : action === "cancel"
              ? "As inscrições foram canceladas e o aviso foi para o canal de eventos."
              : action === "archive"
                ? "Os dados, a taxa e os splits deste evento não mudam mais."
                : undefined,
      });
      setCancelling(null);
      setArchiving(null);
      refresh();
    } catch (e) {
      toast.error(errorText(e, "Não foi possível mudar o estado do evento."));
      refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Central de eventos"
        description="Crie o evento a partir de um template, abra as inscrições e organize quem joga em cada role."
        action={
          <div className="flex flex-wrap items-center gap-3">
            <Freshness updatedAt={updatedAt} error={error} />
            <Button onClick={() => setCreating(true)}>
              <CalendarPlus />
              Criar evento
            </Button>
          </div>
        }
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
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
            <StatCard label="Inscrições abertas" icon={<DoorOpen />} emphasis value={<span className="num">{groups.open.length}</span>} hint="aceitando gente agora" />
            <StatCard label="Acontecendo agora" icon={<CircleDot />} value={<span className="num">{groups.running.length}</span>} hint="já iniciados" />
            <StatCard label="Aguardando início" icon={<Lock />} value={<span className="num">{groups.upcoming.length}</span>} hint="rascunho ou lista fechada" />
            <StatCard label="Meus eventos" icon={<Crown />} value={<span className="num">{mine.length}</span>} hint="você é o caller" />
            <StatCard
              label="A acertar"
              icon={<Coins />}
              value={<span className="num">{settling.length}</span>}
              hint={settling.length === 0 ? "nenhuma prata em aberto" : "finalizados sem a conta fechada"}
            />
          </div>

          <div className="grid items-start gap-4 lg:grid-cols-[22rem_1fr]">
            <Panel title="Eventos" titleId="staff-events-list">
              {board.events.length === 0 ? (
                <div className="p-4">
                  <EmptyState
                    icon={<CalendarPlus />}
                    title="Nenhum evento ainda."
                    description="Crie o primeiro a partir de um template: as roles e vagas já vêm prontas."
                    action={
                      <Button onClick={() => setCreating(true)}>
                        <CalendarPlus />
                        Criar evento
                      </Button>
                    }
                  />
                </div>
              ) : (
                <div className="max-h-[32rem] overflow-y-auto">
                  {/* A acertar vem primeiro e separado: é dívida em aberto, não histórico (AC#1). */}
                  {settling.length > 0 && (
                    <>
                      <h3 className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b bg-card px-4 py-2 text-xs font-semibold text-brand">
                        <span className="flex items-center gap-1.5">
                          <Coins className="size-3.5" aria-hidden />A acertar
                        </span>
                        <span className="num">{settling.length}</span>
                      </h3>
                      <ul className="divide-y border-b">
                        {settling.map((event) => (
                          <EventListItem
                            key={event.id}
                            event={event}
                            board={board}
                            selected={selected?.id === event.id}
                            userId={user.id}
                            onSelect={() => setSelectedId(event.id)}
                          />
                        ))}
                      </ul>
                    </>
                  )}
                  <ul className="divide-y">
                    {board.events
                      .filter((event) => !settlingIds.has(event.id))
                      .map((event) => (
                        <EventListItem
                          key={event.id}
                          event={event}
                          board={board}
                          selected={selected?.id === event.id}
                          userId={user.id}
                          onSelect={() => setSelectedId(event.id)}
                        />
                      ))}
                  </ul>
                </div>
              )}
            </Panel>

            {selected ? (
              <EventDetail
                key={selected.id}
                event={selected}
                board={board}
                busy={busy}
                onTransition={(action) => {
                  if (action === "cancel") setCancelling(selected);
                  else if (action === "archive") setArchiving(selected);
                  else void transition(selected, action);
                }}
                onChanged={refresh}
              />
            ) : (
              <Panel title="Detalhes" titleId="staff-events-detail">
                <div className="p-4">
                  <EmptyState icon={<Users />} title="Escolha um evento na lista." description="A lista de inscritos e as ações aparecem aqui." />
                </div>
              </Panel>
            )}
          </div>
        </>
      )}

      {creating && (
        <CreateEventDialog
          onClose={() => setCreating(false)}
          onCreated={(event) => {
            setCreating(false);
            setSelectedId(event.id);
            refresh();
          }}
        />
      )}

      {cancelling && (
        <CancelEventDialog event={cancelling} busy={busy} onClose={() => setCancelling(null)} onConfirm={(reason) => void transition(cancelling, "cancel", reason)} />
      )}

      {archiving && <ArchiveEventDialog event={archiving} busy={busy} onClose={() => setArchiving(null)} onConfirm={() => void transition(archiving, "archive")} />}
    </>
  );
}

/** Linha da lista de eventos: nome, ocupação e o que ele é agora. */
function EventListItem({
  event,
  board,
  selected,
  userId,
  onSelect,
}: {
  event: EventDto;
  board: EventBoard;
  selected: boolean;
  userId: string;
  onSelect: () => void;
}) {
  const fill = eventFill(roleViews(event, board.occupancy, null));
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected}
        className={cn("press w-full px-4 py-3 text-left transition-colors hover:bg-accent/60", selected && "bg-accent")}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="truncate font-medium">{event.name}</span>
          <span className="num shrink-0 text-sm text-muted-foreground">
            {fill.confirmed}/{fill.total}
          </span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <EventStatusPill status={event.status} />
          {event.ownerUserId === userId && (
            <Pill tone="neutral" icon={<Crown aria-hidden />}>
              seu
            </Pill>
          )}
        </div>
      </button>
    </li>
  );
}

/** Evento selecionado: ações de estado permitidas agora e a lista de inscritos por role. */
function EventDetail({
  event,
  board,
  busy,
  onTransition,
  onChanged,
}: {
  event: EventDto;
  board: EventBoard;
  busy: boolean;
  onTransition: (action: EventTransition) => void;
  onChanged: () => void;
}) {
  const { ability } = useCurrentUser();
  const load = useCallback(() => api.fetchEventRoster(event.id), [event.id]);
  const roster = usePoll<{ signups: EventSignupDto[]; members: EventMemberDto[] }>(load, "Erro ao carregar os inscritos");
  const actions = availableTransitions(event, ability);
  const roles = roleViews(event, board.occupancy, null);
  const fill = eventFill(roles);
  const canMove = canManageRoster(event, ability);
  const canTransfer = canTransferOwner(event, ability);
  /** Só quem responde pela distribuição vê o acerto: `distribute` no evento, nunca `read` (AC#12). */
  const settlement = showsSettlement(event) && canSettle(event, ability);
  // Finalizado abre direto no acerto: quem vem parar aqui acabou de terminar o jogo e tem prata para dividir.
  const [tab, setTab] = useState(event.status === "finished" ? "settlement" : "roster");
  const [hasDraft, setHasDraft] = useState(false);
  const onDraftChange = useCallback((draft: boolean) => setHasDraft(draft), []);

  const refreshAll = () => {
    roster.refresh();
    onChanged();
  };

  async function move(signup: EventSignupDto, target: { target: "waitlist" } | { target: "role"; slotId: string }, what: string) {
    try {
      await api.moveEventSignup(event.id, signup.userId, target);
      toast.success(`${nickOf(signup.userId, roster.data?.members ?? [])} foi para ${what}`);
      refreshAll();
    } catch (e) {
      toast.error(errorText(e, "Não foi possível mover o inscrito."));
      refreshAll();
    }
  }

  async function transferOwner(signup: EventSignupDto) {
    try {
      await api.transferEventOwner(event.id, signup.userId);
      toast.success(`${nickOf(signup.userId, roster.data?.members ?? [])} agora é o caller do evento`);
      refreshAll();
    } catch (e) {
      toast.error(errorText(e, "Não foi possível transferir o evento."));
      refreshAll();
    }
  }

  const active = (roster.data?.signups ?? []).filter((s) => s.status !== "cancelled");

  return (
    <Panel
      title={event.name}
      titleId="staff-events-detail"
      action={<EventStatusPill status={event.status} />}
      className="min-w-0"
    >
      <div className="space-y-4 border-b px-4 py-3">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            <EventMeta event={event} />
            {event.description && <p className="mt-1 text-sm text-muted-foreground">{event.description}</p>}
            <EventCancelledNote event={event} className="mt-2" />
            <EventArchivedNote event={event} className="mt-2" />
          </div>
          <div className="w-full sm:w-56">
            <FillMeter {...fill} />
          </div>
        </div>

        {/* AC#3: só aparece a ação que a máquina de estados permite agora e que o papel autoriza. */}
        {/* Finalizado tem uma ação só e ela é irreversível: a frase explica por que ainda não acabou. */}
        {event.status === "finished" && (
          <p className="text-sm text-muted-foreground">Evento finalizado. Quem conduz ainda acerta a taxa e os splits, e arquiva quando terminar.</p>
        )}
        {hasDraft && actions.includes("archive") && <DraftBlocksArchiveNote />}
        {actions.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {actions.map((action) => {
              const meta = TRANSITION_META[action];
              const Icon = meta.icon;
              // AC#10: arquivar com rascunho aberto trancaria prata que ninguém mais poderia distribuir.
              const blocked = action === "archive" && hasDraft;
              return (
                <Button
                  key={action}
                  variant={meta.variant}
                  size="sm"
                  disabled={busy || blocked}
                  title={blocked ? "Confirme ou apague o loot split em rascunho antes de arquivar." : undefined}
                  onClick={() => onTransition(action)}
                >
                  <Icon />
                  {meta.label}
                </Button>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {event.status === "archived"
              ? "Evento arquivado: nada mais muda por aqui."
              : event.status === "cancelled"
                ? "Evento cancelado: não há mais ação a tomar."
                : event.status === "finished"
                  ? "Evento finalizado, mas você não conduz este evento: quem acerta a taxa e arquiva é o caller dono ou a staff."
                  : "Você não conduz este evento. Fale com o caller dono ou com a staff."}
          </p>
        )}
      </div>

      {settlement ? (
        /* Finalizado ganha abas: o roster continua ali, e o acerto é onde a prata é decidida (AC#1/AC#2). */
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList variant="line" className="mx-4 mt-3">
            <TabsTrigger value="roster">
              <Users />
              Inscritos
            </TabsTrigger>
            <TabsTrigger value="settlement">
              <Coins />
              Acerto
            </TabsTrigger>
          </TabsList>
          <TabsContent value="roster">
            <>
      {roster.loading && (
        <div className="p-4">
          <Skeleton className="h-24 w-full" aria-label="Carregando inscritos…" />
        </div>
      )}
      {roster.error && !roster.data && (
        <p role="alert" className="px-4 py-3 text-sm text-destructive">
          {roster.error}
        </p>
      )}

      {roster.data && (
        <div className="divide-y">
          {roles.map((role) => (
            <RoleRoster
              key={role.slotId}
              role={role}
              roles={roles}
              signups={active.filter((s) => s.slotId === role.slotId)}
              members={roster.data!.members}
              ownerUserId={event.ownerUserId}
              canMove={canMove}
              canTransfer={canTransfer}
              onMove={move}
              onTransfer={transferOwner}
            />
          ))}
          {roles.length === 0 && <p className="px-4 py-3 text-sm text-muted-foreground">O template deste evento não tinha nenhuma role.</p>}
          {active.length === 0 && roles.length > 0 && (
            <p className="px-4 py-3 text-sm text-muted-foreground">
              {event.status === "draft"
                ? "Abra as inscrições para o pessoal entrar."
                : event.status === "cancelled"
                  ? "As inscrições caíram junto com o evento."
                  : "Ninguém se inscreveu ainda."}
            </p>
          )}
        </div>
      )}
            </>
          </TabsContent>
          <TabsContent value="settlement">
            <EventSettlement event={event} onChanged={onChanged} onDraftChange={onDraftChange} />
          </TabsContent>
        </Tabs>
      ) : (
        <>
      {roster.loading && (
        <div className="p-4">
          <Skeleton className="h-24 w-full" aria-label="Carregando inscritos…" />
        </div>
      )}
      {roster.error && !roster.data && (
        <p role="alert" className="px-4 py-3 text-sm text-destructive">
          {roster.error}
        </p>
      )}

      {roster.data && (
        <div className="divide-y">
          {roles.map((role) => (
            <RoleRoster
              key={role.slotId}
              role={role}
              roles={roles}
              signups={active.filter((s) => s.slotId === role.slotId)}
              members={roster.data!.members}
              ownerUserId={event.ownerUserId}
              canMove={canMove}
              canTransfer={canTransfer}
              onMove={move}
              onTransfer={transferOwner}
            />
          ))}
          {roles.length === 0 && <p className="px-4 py-3 text-sm text-muted-foreground">O template deste evento não tinha nenhuma role.</p>}
          {active.length === 0 && roles.length > 0 && (
            <p className="px-4 py-3 text-sm text-muted-foreground">
              {event.status === "draft"
                ? "Abra as inscrições para o pessoal entrar."
                : event.status === "cancelled"
                  ? "As inscrições caíram junto com o evento."
                  : "Ninguém se inscreveu ainda."}
            </p>
          )}
        </div>
      )}
        </>
      )}
    </Panel>
  );
}

/** Uma role do evento: confirmados nas vagas e, abaixo, a espera daquela role na ordem (Q27). */
function RoleRoster({
  role,
  roles,
  signups,
  members,
  ownerUserId,
  canMove,
  canTransfer,
  onMove,
  onTransfer,
}: {
  role: RoleView;
  roles: RoleView[];
  signups: EventSignupDto[];
  members: EventMemberDto[];
  ownerUserId: string;
  canMove: boolean;
  canTransfer: boolean;
  onMove: (signup: EventSignupDto, target: { target: "waitlist" } | { target: "role"; slotId: string }, what: string) => Promise<void>;
  onTransfer: (signup: EventSignupDto) => Promise<void>;
}) {
  const confirmed = signups.filter((s) => s.status === "confirmed");
  const waitlist = signups.filter((s) => s.status === "waitlist").sort((a, b) => a.position - b.position);

  return (
    <section className="px-4 py-3" aria-label={`Role ${role.name}`}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-medium">{role.name}</h3>
        <span className={cn("num text-sm", role.full ? "text-muted-foreground" : "font-semibold")}>
          {role.confirmed}/{role.slots}
        </span>
      </div>

      <ul className="mt-2 space-y-1.5">
        {confirmed.map((signup) => (
          <SignupRow
            key={signup.id}
            signup={signup}
            members={members}
            roles={roles}
            isOwner={signup.userId === ownerUserId}
            canMove={canMove}
            canTransfer={canTransfer}
            onMove={onMove}
            onTransfer={onTransfer}
          />
        ))}
        {confirmed.length === 0 && <li className="text-sm text-muted-foreground">Vaga livre.</li>}
      </ul>

      {waitlist.length > 0 && (
        <div className="mt-3 rounded-lg border border-dashed p-2">
          <p className="mb-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            <ListOrdered className="size-3.5" aria-hidden />
            Lista de espera desta role
          </p>
          <ul className="space-y-1.5">
            {waitlist.map((signup) => (
              <SignupRow
                key={signup.id}
                signup={signup}
                members={members}
                roles={roles}
                isOwner={signup.userId === ownerUserId}
                canMove={canMove}
                canTransfer={canTransfer}
                onMove={onMove}
                onTransfer={onTransfer}
              />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function SignupRow({
  signup,
  members,
  roles,
  isOwner,
  canMove,
  canTransfer,
  onMove,
  onTransfer,
}: {
  signup: EventSignupDto;
  members: EventMemberDto[];
  roles: RoleView[];
  isOwner: boolean;
  canMove: boolean;
  canTransfer: boolean;
  onMove: (signup: EventSignupDto, target: { target: "waitlist" } | { target: "role"; slotId: string }, what: string) => Promise<void>;
  onTransfer: (signup: EventSignupDto) => Promise<void>;
}) {
  const nick = nickOf(signup.userId, members);
  const others = roles.filter((r) => r.slotId !== signup.slotId);

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <span className="min-w-0 flex-1 truncate text-sm">
        {signup.status === "waitlist" && <span className="num mr-1.5 text-muted-foreground">{signup.position}º</span>}
        {nick}
        {isOwner && <Crown className="ml-1.5 inline size-3.5 text-brand" aria-label="caller do evento" />}
      </span>
      {canMove && (
        <span className="flex flex-wrap items-center gap-1">
          {signup.status === "confirmed" && (
            <Button variant="outline" size="xs" onClick={() => void onMove(signup, { target: "waitlist" }, "a lista de espera")}>
              ↓ espera
            </Button>
          )}
          {others.map((role) => (
            <Button
              key={role.slotId}
              variant="outline"
              size="xs"
              disabled={role.full}
              title={role.full ? `${role.name} está lotada` : undefined}
              onClick={() => void onMove(signup, { target: "role", slotId: role.slotId }, role.name)}
            >
              → {role.name}
            </Button>
          ))}
          {canTransfer && !isOwner && (
            <Button variant="ghost" size="xs" onClick={() => void onTransfer(signup)}>
              <Crown />
              Passar o comando
            </Button>
          )}
        </span>
      )}
    </li>
  );
}

/**
 * Cancelamento (TASK-025, Q26). Confirmação com motivo opcional: quem cancela escreve uma frase e ela
 * vira o aviso que o inscrito lê no embed do Discord e no painel — sem isso o evento só some da lista
 * e cada um inventa uma explicação. O botão destrutivo diz exatamente o que vai acontecer.
 */
function CancelEventDialog({ event, busy, onClose, onConfirm }: { event: EventDto; busy: boolean; onClose: () => void; onConfirm: (reason: string) => void }) {
  const id = useId();
  const [reason, setReason] = useState("");
  const confirmed = event.status === "running";

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancelar {event.name}?</DialogTitle>
          <DialogDescription>
            Não volta atrás: todas as inscrições são canceladas e o evento não aceita mais inscrição nem distribuição de loot.
            {confirmed && " O evento já começou, então a galera volta para Aguardando Evento e o canal de voz é apagado."}
          </DialogDescription>
        </DialogHeader>
        <div>
          <Label htmlFor={id}>Motivo (opcional)</Label>
          <Textarea
            id={id}
            autoFocus
            value={reason}
            rows={2}
            maxLength={EVENT_CANCEL_REASON_MAX}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Ex: não fechamos grupo, remarcado para amanhã 21h"
            className="mt-1.5 min-h-16"
          />
          <p className="mt-1.5 text-xs text-muted-foreground">Os inscritos leem isso no canal de eventos e no painel.</p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Voltar
          </Button>
          <Button variant="destructive" disabled={busy} onClick={() => onConfirm(reason.trim())}>
            <X />
            Cancelar evento
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Arquivamento (TASK-044, AC#3). Confirmação obrigatória e sem campo nenhum: o valor da tela é dizer
 * o que se perde. `finished` continua aceitando corrigir a taxa e os splits, e é justamente isso que
 * some aqui — quem clica precisa ler essa frase antes, não descobrir com um 409 depois.
 */
function ArchiveEventDialog({ event, busy, onClose, onConfirm }: { event: EventDto; busy: boolean; onClose: () => void; onConfirm: () => void }) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Arquivar {event.name}?</DialogTitle>
          <DialogDescription>
            Não volta atrás: depois de arquivado, os dados do evento, a taxa e os loot splits não podem mais ser editados. Confira o acerto da prata antes.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Voltar
          </Button>
          <Button autoFocus disabled={busy} onClick={onConfirm}>
            <Archive />
            Arquivar evento
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Criação de evento a partir de template (Q9): as roles e vagas são copiadas do template no ato. */
function CreateEventDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (event: EventDto) => void }) {
  const ids = { name: useId(), description: useId(), starts: useId(), closes: useId() };
  const [templates, setTemplates] = useState<EventTemplateDto[] | null>(null);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [signupsCloseAt, setSignupsCloseAt] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchEventTemplates()
      .then((list) => {
        const active = list.filter((t) => t.active);
        setTemplates(active);
        setTemplateId((current) => current ?? active[0]?.id ?? null);
      })
      .catch((e: unknown) => toast.error(errorText(e, "Erro ao carregar os templates.")));
  }, []);

  const template = templates?.find((t) => t.id === templateId) ?? null;
  const local = (value: string) => (value.trim() === "" ? null : new Date(value).toISOString());

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!templateId) return toast.error("Escolha um template para o evento.");
    const body = { templateId, name, description, startsAt: local(startsAt), signupsCloseAt: local(signupsCloseAt) };
    const parsed = eventCreateSchema.safeParse(body);
    if (!parsed.success) return toast.error(firstIssue(parsed.error));
    setBusy(true);
    try {
      const event = await api.createEvent(body);
      toast.success("Evento criado", { description: `${event.name}: ${event.totalSlots} vagas. Abra as inscrições quando quiser.` });
      onCreated(event);
    } catch (err) {
      toast.error(errorText(err, "Não foi possível criar o evento."));
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Novo evento</DialogTitle>
          <DialogDescription>O template define as roles e as vagas. O evento nasce em rascunho: ninguém entra até você abrir as inscrições.</DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => void submit(e)} className="space-y-4">
          <fieldset>
            <legend className="text-sm font-medium">Template</legend>
            {templates === null && <Skeleton className="mt-2 h-8 w-full" />}
            {templates?.length === 0 && (
              <p className="mt-2 text-sm text-muted-foreground">Nenhum template ativo. Crie um em Templates antes de abrir evento.</p>
            )}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {(templates ?? []).map((t) => (
                <Button key={t.id} type="button" variant={t.id === templateId ? "default" : "outline"} size="sm" onClick={() => setTemplateId(t.id)}>
                  {t.name}
                  <span className="num opacity-70">{t.totalSlots}</span>
                </Button>
              ))}
            </div>
            {template && (
              <p className="mt-2 text-xs text-muted-foreground">
                {template.roles.map((r) => `${r.slots} ${r.name}`).join(" · ")}
              </p>
            )}
          </fieldset>

          <div>
            <Label htmlFor={ids.name}>Nome do evento</Label>
            <Input
              id={ids.name}
              autoFocus
              value={name}
              maxLength={EVENT_TEMPLATE_NAME_MAX}
              onChange={(e) => setName(e.target.value)}
              placeholder={template ? `Ex: ${template.name} das 21h` : "Ex: DG das 21h"}
              className="mt-1.5"
            />
          </div>
          <div>
            <Label htmlFor={ids.description}>Observações (opcional)</Label>
            <Textarea
              id={ids.description}
              value={description}
              rows={2}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Ex: set de T7 pra cima, ponto de encontro em Martlock"
              className="mt-1.5 min-h-16"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor={ids.starts}>Início previsto (opcional)</Label>
              <Input id={ids.starts} type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} className="mt-1.5" />
            </div>
            <div>
              <Label htmlFor={ids.closes}>Fechar inscrições em (opcional)</Label>
              <Input id={ids.closes} type="datetime-local" value={signupsCloseAt} onChange={(e) => setSignupsCloseAt(e.target.value)} className="mt-1.5" />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={busy || !templateId}>
              <CalendarPlus />
              Criar evento
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
