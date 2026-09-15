import { REJECTION_NOTE_MAX_LENGTH, validateRejectionNote } from "@albion-hub/shared";
import { ArrowRight } from "lucide-react";
import { useCallback, useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/display";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/format";

interface StaffNickRequest {
  id: string;
  nick: string;
  createdAt: string;
  updatedAt: string;
  user: { id: string; displayName: string | null; discordUsername: string; gameNick: string | null };
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: "same-origin", ...init, headers: { Accept: "application/json", "Content-Type": "application/json", ...init?.headers } });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: unknown } | null;
    throw new Error(typeof body?.message === "string" ? body.message : `Falha na requisição (HTTP ${res.status})`);
  }
  return (await res.json()) as T;
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

  return (
    <>
      <PageHeader
        title="Aprovação de nick"
        description="Confira o nick no jogo. Aprovar faz dele o nick vigente do membro; recusar mantém o anterior e mostra seu motivo pra ele."
      />
      {error && (
        <div role="alert" className="mb-6 rounded-md border border-oxblood/40 bg-oxblood/10 p-4 text-sm">
          {error}
          <Button variant="secondary" className="mt-3 block" onClick={load}>
            Tentar de novo
          </Button>
        </div>
      )}
      {!requests && !error && <p className="text-muted">Carregando solicitações…</p>}
      {requests && requests.length === 0 && <p className="text-muted">Nenhuma solicitação pendente.</p>}
      {requests && requests.length > 0 && (
        <>
          <p className="mb-3 text-sm text-faint">
            <span className="num text-parchment">{requests.length}</span> {requests.length === 1 ? "solicitação pendente" : "solicitações pendentes"}
          </p>
          <ul className="space-y-3">
            {requests.map((r) => (
              <RequestRow key={r.id} r={r} onDecided={remove} onStale={load} />
            ))}
          </ul>
        </>
      )}
    </>
  );
}

function RequestRow({ r, onDecided, onStale }: { r: StaffNickRequest; onDecided: (id: string) => void; onStale: () => void }) {
  const noteId = useId();
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
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
      if (action === "approve") toast.success("Nick aprovado", { description: `${name} agora é ${r.nick}.` });
      else toast("Nick recusado", { description: `${name} vê o motivo e pode enviar outro.` });
      onDecided(r.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível decidir agora. Tente de novo.");
      setBusy(false);
      onStale();
    }
  }

  return (
    <li className="rounded-lg border border-rule bg-stone p-4 md:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="min-w-0 font-medium break-words">
          {name} <span className="text-sm font-normal text-muted">@{r.user.discordUsername}</span>
        </p>
        <p className="text-sm text-faint">Pedido em {formatDateTime(r.updatedAt)}</p>
      </div>
      <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-display text-2xl">
        {r.user.gameNick ? (
          <>
            <span className="break-all text-muted line-through decoration-rule">{r.user.gameNick}</span>
            <ArrowRight className="size-5 text-faint" aria-label="para" />
          </>
        ) : (
          <span className="text-sm font-sans text-faint">Primeiro nick:</span>
        )}
        <span className="break-all text-parchment">{r.nick}</span>
      </p>

      <div className="mt-4 space-y-3">
        {rejecting && (
          <div>
            <label htmlFor={noteId} className="text-sm text-muted">
              Motivo da recusa (o membro vê essa mensagem)
            </label>
            <textarea
              id={noteId}
              autoFocus
              value={note}
              maxLength={REJECTION_NOTE_MAX_LENGTH}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Ex: não achei esse personagem no jogo"
              rows={2}
              className="mt-1.5 w-full rounded-md border border-rule bg-ink p-3 text-sm outline-none focus:border-brass"
            />
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {!rejecting ? (
            <>
              <Button disabled={busy} onClick={() => void decide("approve")}>
                Aprovar nick
              </Button>
              <Button variant="secondary" disabled={busy} onClick={() => setRejecting(true)}>
                Recusar
              </Button>
            </>
          ) : (
            <>
              <Button variant="destructive" disabled={busy || !note.trim()} onClick={() => void decide("reject")}>
                Confirmar recusa
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => setRejecting(false)}>
                Voltar
              </Button>
            </>
          )}
        </div>
      </div>
    </li>
  );
}
