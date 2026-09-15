import { NICK_MAX_LENGTH, validateNick } from "@albion-hub/shared";
import { Check, Hourglass } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/display";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/format";
import { submitNick, useMyNick, type MyNick } from "@/nick/api";

/**
 * Registro e troca de nick (TASK-012, Q14/Q31). Um estado por vez, um CTA principal por estado:
 * sem nick → enviar; pendente → esperar (corrigir é secundário); aprovado → pedir troca.
 */
export function Nick() {
  const { state, reload, set } = useMyNick();

  if (state.status === "loading") return <p className="text-muted">Carregando seu nick…</p>;
  if (state.status === "error")
    return (
      <div>
        <p className="text-muted">{state.message}</p>
        <Button variant="secondary" className="mt-4" onClick={reload}>
          Tentar de novo
        </Button>
      </div>
    );

  const { gameNick, pending } = state.data;
  return (
    <>
      <PageHeader
        title="Seu nick do Albion"
        description={
          gameNick
            ? "É o nome que a staff aprovou e que aparece pra comunidade."
            : "A staff confere o nick do seu personagem antes de liberar sua entrada como membro."
        }
      />
      <div className="max-w-xl space-y-6">
        {gameNick && <CurrentNick nick={gameNick} />}
        {pending ? (
          <PendingRequest data={state.data} onSaved={set} />
        ) : gameNick ? (
          <ChangeNick onSaved={set} />
        ) : (
          <NickForm submitLabel="Enviar para aprovação" onSaved={set} autoFocus />
        )}
      </div>
    </>
  );
}

function CurrentNick({ nick }: { nick: string }) {
  return (
    <section aria-labelledby="current-nick" className="rounded-lg border border-rule bg-stone p-5">
      <p id="current-nick" className="flex items-center gap-1.5 text-sm text-verdigris">
        <Check className="size-4" strokeWidth={2.5} aria-hidden />
        Nick aprovado
      </p>
      <p className="mt-1 font-display text-3xl font-medium break-all text-parchment">{nick}</p>
    </section>
  );
}

function PendingRequest({ data, onSaved }: { data: MyNick; onSaved: (d: MyNick) => void }) {
  const [editing, setEditing] = useState(false);
  const pending = data.pending!;
  return (
    <section aria-labelledby="pending-nick" className="rounded-lg border border-dashed border-brass/60 p-5">
      <p id="pending-nick" className="flex items-center gap-1.5 text-sm text-brass">
        <Hourglass className="size-4" strokeWidth={2.25} aria-hidden />
        Aguardando aprovação da staff
      </p>
      <p className="mt-1 font-display text-3xl font-medium break-all text-parchment">{pending.nick}</p>
      <p className="mt-2 text-sm text-faint">
        Enviado em {formatDateTime(pending.updatedAt)}.{" "}
        {data.gameNick ? `Até lá, você continua como ${data.gameNick}, com o mesmo acesso.` : "Quando a staff aprovar, seu apelido no Discord passa a ser esse nick."}
      </p>
      {editing ? (
        <div className="mt-6 border-t border-rule pt-6">
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
        <Button variant="secondary" className="mt-5" onClick={() => setEditing(true)}>
          Corrigir nick enviado
        </Button>
      )}
    </section>
  );
}

function ChangeNick({ onSaved }: { onSaved: (d: MyNick) => void }) {
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <div>
        <Button onClick={() => setOpen(true)}>Pedir troca de nick</Button>
        <p className="mt-2 text-sm text-faint">Mudou o nome no jogo? A staff aprova a troca.</p>
      </div>
    );
  return (
    <section aria-labelledby="change-nick" className="rounded-lg border border-rule p-5">
      <h2 id="change-nick" className="font-display text-xl font-medium">
        Trocar nick
      </h2>
      <p className="mt-1 text-sm text-muted">Seu nick atual e seu acesso continuam valendo até a staff aprovar o novo.</p>
      <div className="mt-5">
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
      <label htmlFor={id} className="text-sm text-muted">
        Nick do personagem
      </label>
      <input
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
        className="mt-1.5 h-12 w-full rounded-md border border-rule bg-ink px-3 font-display text-xl text-parchment transition-colors duration-150 placeholder:text-faint focus:border-brass"
        style={{ outline: "none" }}
      />
      <p id={`${id}-help`} className="mt-2 text-xs" aria-live="polite">
        {error ? <span className="text-oxblood">{error}</span> : <span className="text-faint">Igual aparece no jogo: 3 a 16 letras ou números.</span>}
      </p>
      <div className="mt-5 flex flex-wrap gap-2">
        <Button type="submit" disabled={saving}>
          {saving ? "Enviando…" : submitLabel}
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancelar
          </Button>
        )}
      </div>
    </form>
  );
}
