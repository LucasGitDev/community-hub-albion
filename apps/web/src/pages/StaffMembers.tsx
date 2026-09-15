import { REJECTION_NOTE_MAX_LENGTH, describeAlbionLookup, validateRejectionNote, type AlbionLookupResult } from "@albion-hub/shared";
import { ArrowRight, Check, CircleCheck, CircleHelp, CircleSlash, Clock, Inbox, Sparkles, UserPlus } from "lucide-react";
import { useCallback, useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { EmptyState, PageHeader, Pill, StatCard, type Tone } from "@/components/display";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/format";
import { useDecisionFeedback } from "@/theme/feedback";

interface StaffNickRequest {
  id: string;
  nick: string;
  createdAt: string;
  updatedAt: string;
  user: { id: string; displayName: string | null; discordUsername: string; gameNick: string | null };
  albion: AlbionLookupResult;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: "same-origin", ...init, headers: { Accept: "application/json", "Content-Type": "application/json", ...init?.headers } });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: unknown } | null;
    throw new Error(typeof body?.message === "string" ? body.message : `Falha na requisição (HTTP ${res.status})`);
  }
  return (await res.json()) as T;
}

const relFmt = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" });
function waitingFor(iso: string) {
  const hours = Math.round((Date.now() - new Date(iso).getTime()) / 3_600_000);
  return hours < 24 ? relFmt.format(-hours, "hour") : relFmt.format(-Math.round(hours / 24), "day");
}

/** Fila de nick (TASK-013, Q14/Q31). A API decide e audita; a tela só remove a linha decidida. */
export function StaffMembers() {
  const [requests, setRequests] = useState<StaffNickRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<{ requests: StaffNickRequest[] }>("/api/staff/nick-requests")
      .then((data) => {
        setRequests(data.requests);
        setError(null);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Erro ao carregar a fila"));
  }, []);

  useEffect(load, [load]);

  const remove = useCallback((id: string) => setRequests((list) => list?.filter((r) => r.id !== id) ?? null), []);
  const firstTime = requests?.filter((r) => !r.user.gameNick).length ?? 0;
  const oldest = requests?.reduce<string | null>((min, r) => (!min || r.updatedAt < min ? r.updatedAt : min), null) ?? null;

  return (
    <>
      <PageHeader
        title="Aprovação de nick"
        description="Confira o nick no jogo. Aprovar faz dele o nick vigente do membro; recusar mantém o anterior e mostra seu motivo pra ele."
      />
      {error && (
        <div role="alert" className="mb-4 rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm">
          {error}
          <Button variant="outline" className="mt-3 block" onClick={load}>
            Tentar de novo
          </Button>
        </div>
      )}
      {!requests && !error && (
        <div className="space-y-2" aria-label="Carregando solicitações…">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      )}
      {requests && (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard label="Pendentes" icon={<Inbox />} value={<span className="num">{requests.length}</span>} hint={requests.length === 1 ? "solicitação pendente" : "solicitações pendentes"} />
          <StatCard label="Primeiro nick" icon={<UserPlus />} value={<span className="num">{firstTime}</span>} hint="entrada de membro novo" />
          <StatCard
            className="col-span-2 lg:col-span-1"
            label="Mais antiga"
            icon={<Clock />}
            value={oldest ? waitingFor(oldest) : "—"}
            hint={oldest ? `desde ${formatDateTime(oldest)}` : "fila zerada"}
          />
        </div>
      )}
      {requests && requests.length === 0 && (
        <EmptyState icon={<Sparkles />} title="Nenhuma solicitação pendente." description="Quando um membro enviar ou trocar o nick, ele aparece aqui pra você conferir." />
      )}
      {requests && requests.length > 0 && (
        <section className="overflow-hidden rounded-xl border bg-card">
          <div className="hidden grid-cols-[minmax(0,14rem)_minmax(0,1fr)_minmax(0,11rem)_auto] gap-4 border-b px-4 py-2 text-xs font-medium text-muted-foreground lg:grid">
            <span>Membro</span>
            <span>Nick pedido</span>
            <span>Pedido em</span>
            <span className="w-64 text-right">Decisão</span>
          </div>
          <ul className="divide-y">
            {requests.map((r) => (
              <RequestRow key={r.id} r={r} onDecided={remove} onStale={load} />
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function RequestRow({ r, onDecided, onStale }: { r: StaffNickRequest; onDecided: (id: string) => void; onStale: () => void }) {
  const noteId = useId();
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const { leaving, finish } = useDecisionFeedback();
  const name = r.user.displayName || r.user.discordUsername;

  async function decide(action: "approve" | "reject") {
    const body: { note?: string } = {};
    if (action === "reject") {
      const parsed = validateRejectionNote(note);
      if (!parsed.ok) return toast.error(parsed.error);
      body.note = parsed.note;
    }
    setBusy(true);
    try {
      await api(`/api/staff/nick-requests/${r.id}/${action}`, { method: "POST", body: JSON.stringify(body) });
      finish(
        action === "approve"
          ? { kind: "success", title: "Nick aprovado", description: `${name} agora é ${r.nick}.` }
          : { kind: "neutral", title: "Nick recusado", description: `${name} vê o motivo e pode enviar outro.` },
        () => onDecided(r.id),
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível decidir agora. Tente de novo.");
      setBusy(false);
      onStale();
    }
  }

  return (
    <li
      className={cn(
        "grid gap-x-4 gap-y-3 px-4 py-3 lg:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_minmax(0,11rem)_auto] lg:items-center lg:py-(--row-py)",
        leaving && "row-leave",
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground" aria-hidden>
          {name.slice(0, 2).toUpperCase()}
        </span>
        <p className="min-w-0 truncate font-medium">
          {name} <span className="block truncate text-xs font-normal text-muted-foreground">@{r.user.discordUsername}</span>
        </p>
      </div>

      <div className="min-w-0 space-y-1.5">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-lg font-semibold">
          {r.user.gameNick ? (
            <>
              <span className="break-all font-normal text-muted-foreground line-through">{r.user.gameNick}</span>
              <ArrowRight className="size-4 text-muted-foreground" aria-label="para" />
            </>
          ) : (
            <Pill tone="info">Primeiro nick</Pill>
          )}
          <span className="break-all">{r.nick}</span>
        </p>
        <AlbionStatus result={r.albion} />
      </div>

      <p className="text-sm text-muted-foreground">
        <span className="lg:hidden">Pedido em </span>
        {formatDateTime(r.updatedAt)}
      </p>

      <div className="space-y-2 lg:w-64">
        {rejecting && (
          <div>
            <Label htmlFor={noteId} className="text-xs text-muted-foreground">
              Motivo da recusa (o membro vê essa mensagem)
            </Label>
            <Textarea
              id={noteId}
              autoFocus
              value={note}
              maxLength={REJECTION_NOTE_MAX_LENGTH}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Ex: não achei esse personagem no jogo"
              rows={2}
              className="mt-1.5 min-h-16 text-sm"
            />
          </div>
        )}
        <div className="flex flex-wrap gap-2 lg:justify-end">
          {!rejecting ? (
            <>
              <Button variant="outline" disabled={busy} onClick={() => setRejecting(true)}>
                Recusar
              </Button>
              <Button disabled={busy} onClick={() => void decide("approve")}>
                <Check />
                Aprovar nick
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" disabled={busy} onClick={() => setRejecting(false)}>
                Voltar
              </Button>
              <Button variant="destructive" disabled={busy || !note.trim()} onClick={() => void decide("reject")}>
                Confirmar recusa
              </Button>
            </>
          )}
        </div>
      </div>
    </li>
  );
}

const ALBION_STATUS: Record<"found" | "not_found" | "unavailable", { Icon: typeof CircleCheck; tone: Tone }> = {
  found: { Icon: CircleCheck, tone: "success" },
  not_found: { Icon: CircleSlash, tone: "destructive" },
  unavailable: { Icon: CircleHelp, tone: "neutral" },
};

/** Conferência na API Albion (TASK-016, Q14): só ajuda a staff, não bloqueia os botões. Desligada → nada. */
function AlbionStatus({ result }: { result: AlbionLookupResult }) {
  const text = describeAlbionLookup(result);
  if (!text || result.status === "disabled") return null;
  const { Icon, tone } = ALBION_STATUS[result.status];
  return (
    <Pill tone={tone} icon={<Icon aria-hidden />} className="h-auto max-w-full py-0.5 whitespace-normal">
      <span className="min-w-0">{text}</span>
    </Pill>
  );
}
