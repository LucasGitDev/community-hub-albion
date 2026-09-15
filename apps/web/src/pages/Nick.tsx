import { NICK_MAX_LENGTH, validateNick } from "@albion-hub/shared";
import { Check, Hourglass, ShieldCheck, UserPen, X } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { PageHeader, Panel, Pill } from "@/components/display";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/format";
import { submitNick, useMyNick, type MyNick } from "@/nick/api";

/**
 * Registro e troca de nick (TASK-012, Q14/Q31). Um estado por vez, um CTA principal por estado:
 * sem nick → enviar; pendente → esperar (corrigir é secundário); aprovado → pedir troca.
 * TASK-036: estado à esquerda, trilha "como funciona" à direita marcando em que passo o membro está.
 */
export function Nick() {
  const { state, reload, set } = useMyNick();

  if (state.status === "loading")
    return (
      <div className="space-y-4" aria-label="Carregando seu nick…">
        <Skeleton className="h-12 w-72" />
        <Skeleton className="h-40 w-full max-w-2xl" />
      </div>
    );
  if (state.status === "error")
    return (
      <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 p-4">
        <p>{state.message}</p>
        <Button variant="outline" className="mt-3" onClick={reload}>
          Tentar de novo
        </Button>
      </div>
    );

  const { gameNick, pending } = state.data;
  const step = gameNick && !pending ? 3 : pending ? 2 : 1;
  return (
    <>
      <PageHeader
        title="Seu nick do Albion"
        badge={
          pending ? (
            <Pill tone="warning" icon={<Hourglass />}>
              Em análise
            </Pill>
          ) : gameNick ? (
            <Pill tone="success" icon={<Check />}>
              Aprovado
            </Pill>
          ) : null
        }
        description={
          gameNick
            ? "É o nome que a staff aprovou e que aparece pra comunidade."
            : "A staff confere o nick do seu personagem antes de liberar sua entrada como membro."
        }
      />
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-4">
          {gameNick && <CurrentNick nick={gameNick} />}
          {!pending && state.data.lastRejection && <LastRejection rejection={state.data.lastRejection} />}
          {pending ? (
            <PendingRequest data={state.data} onSaved={set} />
          ) : gameNick ? (
            <ChangeNick onSaved={set} />
          ) : (
            <section className="rounded-xl border bg-card p-5">
              <NickForm submitLabel="Enviar para aprovação" onSaved={set} autoFocus />
            </section>
          )}
        </div>
        <HowItWorks step={step} />
      </div>
    </>
  );
}

function HowItWorks({ step }: { step: 1 | 2 | 3 }) {
  const steps = [
    { title: "Envie o nick do personagem", detail: "Igual aparece no jogo." },
    { title: "A staff confere no Albion", detail: "Você continua com o acesso atual enquanto isso." },
    { title: "Apelido no Discord atualizado", detail: "Seu nome no servidor passa a ser o novo nick." },
  ];
  return (
    <Panel title="Como funciona">
      <ol className="space-y-1 p-3">
        {steps.map((s, i) => {
          const n = i + 1;
          const done = n < step || step === 3;
          const current = n === step && step !== 3;
          return (
            <li key={s.title} className={cn("flex gap-3 rounded-lg p-2", current && "bg-muted")} aria-current={current ? "step" : undefined}>
              <span
                className={cn(
                  "num grid size-6 shrink-0 place-items-center rounded-full border text-xs font-semibold",
                  done && "border-success bg-success text-background",
                  current && "border-foreground bg-foreground text-background",
                  !done && !current && "text-muted-foreground",
                )}
                aria-hidden
              >
                {done ? <Check className="size-3.5" strokeWidth={3} /> : n}
              </span>
              <div className="min-w-0">
                <p className={cn("text-sm font-medium", !done && !current && "text-muted-foreground")}>{s.title}</p>
                <p className="text-xs text-muted-foreground">{s.detail}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}

function CurrentNick({ nick }: { nick: string }) {
  return (
    <section aria-labelledby="current-nick" className="flex items-center gap-4 rounded-xl border bg-card p-5">
      <span className="grid size-12 shrink-0 place-items-center rounded-full bg-success/15 text-success">
        <ShieldCheck className="size-6" aria-hidden />
      </span>
      <div className="min-w-0">
        <p id="current-nick" className="flex items-center gap-1.5 text-sm text-success">
          <Check className="size-4" strokeWidth={2.5} aria-hidden />
          Nick aprovado
        </p>
        <p className="text-2xl font-semibold break-all">{nick}</p>
      </div>
    </section>
  );
}

function LastRejection({ rejection }: { rejection: NonNullable<MyNick["lastRejection"]> }) {
  return (
    <section aria-labelledby="rejected-nick" className="rounded-xl border border-destructive/40 bg-destructive/10 p-5">
      <p id="rejected-nick" className="flex items-center gap-1.5 text-sm font-medium text-destructive">
        <X className="size-4" strokeWidth={2.5} aria-hidden />
        A staff recusou o nick {rejection.nick}
      </p>
      {rejection.note && <p className="mt-2 border-l-2 border-destructive/50 pl-3">{rejection.note}</p>}
      <p className="mt-2 text-xs text-muted-foreground">Em {formatDateTime(rejection.decidedAt)}. Você pode enviar outro nick quando quiser.</p>
    </section>
  );
}

function PendingRequest({ data, onSaved }: { data: MyNick; onSaved: (d: MyNick) => void }) {
  const [editing, setEditing] = useState(false);
  const pending = data.pending!;
  return (
    <section aria-labelledby="pending-nick" className="rounded-xl border border-warning/50 bg-card p-5">
      <div className="flex items-start gap-4">
        <span className="grid size-12 shrink-0 place-items-center rounded-full bg-warning/15 text-warning">
          <Hourglass className="size-6" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p id="pending-nick" className="text-sm font-medium text-warning">
            Aguardando aprovação da staff
          </p>
          <p className="text-2xl font-semibold break-all">{pending.nick}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Enviado em {formatDateTime(pending.updatedAt)}.{" "}
            {data.gameNick ? `Até lá, você continua como ${data.gameNick}, com o mesmo acesso.` : "Quando a staff aprovar, seu apelido no Discord passa a ser esse nick."}
          </p>
        </div>
      </div>
      {editing ? (
        <div className="mt-5 border-t pt-5">
          <NickForm
            initial={pending.nick}
            submitLabel="Atualizar solicitação"
            autoFocus
            onCancel={() => setEditing(false)}
            onSaved={(d) => {
              setEditing(false);
              onSaved(d);
            }}
          />
        </div>
      ) : (
        <div className="mt-4 flex justify-end border-t pt-4">
          <Button variant="outline" onClick={() => setEditing(true)}>
            <UserPen />
            Corrigir nick enviado
          </Button>
        </div>
      )}
    </section>
  );
}

function ChangeNick({ onSaved }: { onSaved: (d: MyNick) => void }) {
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4">
        <p className="text-sm text-muted-foreground">Mudou o nome no jogo? A staff aprova a troca.</p>
        <Button onClick={() => setOpen(true)}>Pedir troca de nick</Button>
      </div>
    );
  return (
    <section aria-labelledby="change-nick" className="rounded-xl border bg-card p-5">
      <h2 id="change-nick" className="text-lg font-semibold">
        Trocar nick
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">Seu nick atual e seu acesso continuam valendo até a staff aprovar o novo.</p>
      <div className="mt-4">
        <NickForm submitLabel="Pedir troca" autoFocus onCancel={() => setOpen(false)} onSaved={onSaved} />
      </div>
    </section>
  );
}

function NickForm({
  initial = "",
  submitLabel,
  autoFocus,
  onCancel,
  onSaved,
}: {
  initial?: string;
  submitLabel: string;
  autoFocus?: boolean;
  onCancel?: () => void;
  onSaved: (d: MyNick) => void;
}) {
  const id = useId();
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = validateNick(value);
    if (!parsed.ok) return setError(parsed.error);
    setSaving(true);
    try {
      const data = await submitNick(parsed.nick);
      toast.success("Nick enviado pra staff", { description: `${parsed.nick} fica em análise até a aprovação.` });
      onSaved(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível enviar agora. Tente de novo.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} noValidate>
      <Label htmlFor={id}>Nick do personagem</Label>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <Input
          id={id}
          autoFocus={autoFocus}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          maxLength={NICK_MAX_LENGTH + 4}
          placeholder="Ex: Ravenmoor"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
          aria-invalid={!!error}
          aria-describedby={`${id}-help`}
          className="h-10 text-lg font-medium sm:flex-1"
        />
        <Button type="submit" disabled={saving} className="h-10">
          {saving ? "Enviando…" : submitLabel}
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel} className="h-10">
            Cancelar
          </Button>
        )}
      </div>
      <p id={`${id}-help`} className="mt-2 text-xs" aria-live="polite">
        {error ? <span className="text-destructive">{error}</span> : <span className="text-muted-foreground">Igual aparece no jogo: 3 a 16 letras ou números.</span>}
      </p>
    </form>
  );
}
