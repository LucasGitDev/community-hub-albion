import { NICK_MAX_LENGTH, ROLE_LABELS, validateNick, type Role } from "@albion-hub/shared";
import { Check, Hourglass, IdCard, ShieldCheck, UserPen, Wallet, X } from "lucide-react";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { PageHeader, Panel, Pill, Silver } from "@/components/display";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useCurrentUser } from "@/auth/AuthProvider";
import { useWallet } from "@/api/WalletProvider";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/format";
import { submitNick, useMyNick, type MyNick, type MyNickState } from "@/nick/api";

/**
 * Perfil do membro (TASK-041): identidade na comunidade — nick aprovado, conta do Discord e papéis no
 * painel — no mesmo lugar onde o nick é registrado e trocado. Sucessora da página "Meu nick"; o fluxo de
 * registro/troca (TASK-012, Q14/Q31) continua idêntico, só ganhou contexto em volta.
 *
 * Tudo sai da sessão: identidade de `/api/auth/me` (`useCurrentUser`) e saldo do `WalletProvider`, que
 * lê rotas amarradas ao usuário logado. Nenhum id de usuário vem do cliente, então não há perfil de
 * terceiro pra acessar por aqui.
 */
export function Profile() {
  const { user } = useCurrentUser();
  const { state, reload, set } = useMyNick();
  const nick = state.status === "ready" ? state.data : null;

  return (
    <>
      <PageHeader
        title="Meu perfil"
        description="Quem você é na comunidade: o nick que a staff aprovou, a conta do Discord que usa pra entrar e o que seus papéis liberam no painel."
      />
      <Identity user={user} state={state} />
      <div className="mt-4 grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-4">
          <NickSection state={state} reload={reload} set={set} />
          <HowItWorks step={nick?.gameNick && !nick.pending ? 3 : nick?.pending ? 2 : 1} />
        </div>
        <div className="space-y-4">
          <DiscordAccount user={user} />
          <Roles roles={user.roles} />
        </div>
      </div>
    </>
  );
}

/** Faixa de identidade: avatar + nick + estado do nick à esquerda, saldo (âncora da carteira) à direita. */
function Identity({ user, state }: { user: ReturnType<typeof useCurrentUser>["user"]; state: MyNickState }) {
  const { balance } = useWallet();
  const nick = state.status === "ready" ? state.data : null;
  const approved = nick?.gameNick ?? null;
  return (
    <section aria-labelledby="profile-identity" className="rounded-xl border bg-card">
      <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        <div className="flex min-w-0 items-center gap-4">
          <Avatar user={user} />
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2">
              <span id="profile-identity" className="text-2xl font-semibold break-all sm:text-3xl">
                {approved ?? user.nick}
              </span>
              <NickPill state={state} />
            </p>
            <p className="mt-0.5 truncate text-sm text-muted-foreground">
              {approved ? "Seu personagem no Albion Online" : "Nome do Discord, até a staff aprovar seu nick"}
            </p>
          </div>
        </div>
        <dl className="grid shrink-0 grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border sm:w-72">
          <div className="bg-card p-3">
            <dt className="text-xs text-muted-foreground">Disponível pra saque</dt>
            <dd className="mt-1 text-xl font-semibold text-brand">
              {balance ? <Silver value={balance.available} /> : <Skeleton className="h-6 w-20" />}
            </dd>
          </div>
          <div className="bg-card p-3">
            <dt className="text-xs text-muted-foreground">Reservado</dt>
            <dd className="mt-1 text-xl font-semibold">{balance ? <Silver value={balance.reserved} /> : <Skeleton className="h-6 w-20" />}</dd>
          </div>
        </dl>
      </div>
      <Link
        to="/carteira"
        className="press flex items-center gap-2 border-t px-5 py-2.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <Wallet className="size-4" aria-hidden />
        Extrato completo e pedidos de saque na carteira
      </Link>
    </section>
  );
}

function Avatar({ user }: { user: ReturnType<typeof useCurrentUser>["user"] }) {
  const [broken, setBroken] = useState(false);
  const src = user.avatar && !broken ? `https://cdn.discordapp.com/avatars/${user.discordId}/${user.avatar}.png?size=128` : null;
  return src ? (
    <img src={src} alt="" onError={() => setBroken(true)} className="size-14 shrink-0 rounded-full border object-cover" width={56} height={56} />
  ) : (
    <span className="grid size-14 shrink-0 place-items-center rounded-full bg-secondary text-lg font-semibold text-secondary-foreground" aria-hidden>
      {user.initials}
    </span>
  );
}

function NickPill({ state }: { state: MyNickState }) {
  if (state.status !== "ready") return null;
  if (state.data.pending)
    return (
      <Pill tone="warning" icon={<Hourglass />}>
        Nick em análise
      </Pill>
    );
  if (state.data.gameNick)
    return (
      <Pill tone="success" icon={<Check />}>
        Nick aprovado
      </Pill>
    );
  return (
    <Pill tone="neutral" icon={<IdCard />}>
      Sem nick registrado
    </Pill>
  );
}

function DiscordAccount({ user }: { user: ReturnType<typeof useCurrentUser>["user"] }) {
  return (
    <Panel title="Conta do Discord" titleId="discord-account">
      <dl className="divide-y text-sm">
        <Row label="Usuário" value={<span className="truncate font-medium">@{user.username}</span>} />
        <Row label="Nome exibido" value={<span className="truncate font-medium">{user.nick}</span>} />
        <Row label="ID" value={<span className="num truncate text-muted-foreground">{user.discordId}</span>} />
      </dl>
      <p className="border-t px-4 py-3 text-xs text-muted-foreground">
        Você entra no painel sempre por esta conta. Pra trocar, saia e entre com outro Discord.
      </p>
    </Panel>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-4 py-2.5">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right">{value}</dd>
    </div>
  );
}

const ROLE_HINTS: Record<Role, string> = {
  member: "Recebe prata dos splits, participa de eventos e pede saque.",
  caller: "Cria eventos, chama a galera e confirma a divisão do loot.",
  staff: "Aprova nicks e entrega os saques da comunidade.",
  admin: "Administra papéis e configurações do painel.",
};

function Roles({ roles }: { roles: Role[] }) {
  const list = roles.length > 0 ? roles : (["member"] as Role[]);
  return (
    <Panel title="Seus papéis" titleId="profile-roles">
      <ul className="divide-y">
        {list.map((role) => (
          <li key={role} className="flex gap-3 px-4 py-3">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            <div className="min-w-0">
              <p className="text-sm font-medium">{ROLE_LABELS[role]}</p>
              <p className="text-xs text-muted-foreground">{ROLE_HINTS[role]}</p>
            </div>
          </li>
        ))}
      </ul>
      <p className="border-t px-4 py-3 text-xs text-muted-foreground">Quem muda papel é a staff do painel, não o seu cargo no Discord.</p>
    </Panel>
  );
}

/** Bloco de nick: mesmo fluxo da antiga página "Meu nick" (TASK-012), agora dentro do perfil. */
function NickSection({ state, reload, set }: { state: MyNickState; reload: () => void; set: (d: MyNick) => void }) {
  if (state.status === "loading")
    return (
      <div className="space-y-3" aria-label="Carregando seu nick…">
        <Skeleton className="h-10 w-56" />
        <Skeleton className="h-32 w-full" />
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
  return (
    <>
      {!pending && state.data.lastRejection && <LastRejection rejection={state.data.lastRejection} />}
      {pending ? (
        <PendingRequest data={state.data} onSaved={set} />
      ) : gameNick ? (
        <ChangeNick onSaved={set} />
      ) : (
        <section aria-labelledby="register-nick" className="rounded-xl border bg-card p-5">
          <h2 id="register-nick" className="text-lg font-semibold">
            Registre seu nick do Albion
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">A staff confere o nick do seu personagem antes de liberar sua entrada como membro.</p>
          <div className="mt-4">
            <NickForm submitLabel="Enviar para aprovação" onSaved={set} autoFocus />
          </div>
        </section>
      )}
    </>
  );
}

/** Trilha do registro; com o nick já aprovado ela explica o que acontece numa troca (marclou-review #6). */
function HowItWorks({ step }: { step: 1 | 2 | 3 }) {
  const steps = [
    { title: "Envie o nick do personagem", detail: "Igual aparece no jogo." },
    { title: "A staff confere no Albion", detail: "Você continua com o acesso atual enquanto isso." },
    { title: "Apelido no Discord atualizado", detail: "Seu nome no servidor passa a ser o novo nick." },
  ];
  return (
    <Panel title={step === 3 ? "Como funciona a troca de nick" : "Como funciona"}>
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

/** Estado aprovado: o nick vigente, o que ele já garante e o caminho pra trocar (Q31). */
function ChangeNick({ onSaved }: { onSaved: (d: MyNick) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Panel
      title="Nick do Albion"
      titleId="game-nick"
      action={
        !open && (
          <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
            <UserPen />
            Pedir troca de nick
          </Button>
        )
      }
    >
      <div className="flex items-center gap-4 border-b p-4">
        <span className="grid size-11 shrink-0 place-items-center rounded-full bg-success/15 text-success">
          <ShieldCheck className="size-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 font-medium text-success">
            <Check className="size-4" strokeWidth={2.5} aria-hidden />
            Aprovado pela staff
          </p>
          <p className="text-sm text-muted-foreground">Vale enquanto você não pedir uma troca.</p>
        </div>
      </div>
      {open ? (
        <div className="p-4">
          <p className="mb-3 text-sm text-muted-foreground">Seu nick atual e seu acesso continuam valendo até a staff aprovar o novo.</p>
          <NickForm submitLabel="Pedir troca" autoFocus onCancel={() => setOpen(false)} onSaved={onSaved} />
        </div>
      ) : (
        <ul className="divide-y text-sm">
          <li className="flex gap-2.5 px-4 py-2.5">
            <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
            É o seu apelido no Discord do servidor.
          </li>
          <li className="flex gap-2.5 px-4 py-2.5">
            <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
            É o nome que aparece nas inscrições de evento e na divisão do loot.
          </li>
          <li className="flex gap-2.5 px-4 py-2.5 text-muted-foreground">
            <UserPen className="mt-0.5 size-4 shrink-0" aria-hidden />
            Mudou o nome no jogo? Peça a troca: a staff aprova e o apelido acompanha.
          </li>
        </ul>
      )}
    </Panel>
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
