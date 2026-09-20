import { useEffect, useState, type FormEvent } from "react";
import { Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { checkWithdrawalRequest, formatAmount, formatAmountShort, parseAmount, type WithdrawalDto } from "@albion-hub/shared";
import { errorText } from "@/api/http";
import { fetchAdminMembers, type AdminMember } from "@/api/members";
import { fetchMemberLedger } from "@/api/member-ledger";
import { openWithdrawalForMember } from "@/api/withdrawals-queue";
import { Amount } from "@/components/display";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { Balance } from "@/api/wallet";
import { cn } from "@/lib/utils";

/**
 * Staff abre um saque **para um membro** (TASK-083, SS1–SS4): ele pediu no Discord ou no jogo e não usa
 * o painel.
 *
 * O mesmo diálogo serve os dois lugares de SS5. Na lista de jogadores o membro já está escolhido (veio da
 * linha); na fila de saques não há linha nenhuma, então o primeiro passo é achar quem é — por isso o
 * `member` pode chegar nulo e a busca aparece.
 *
 * O teto que aparece na tela é o **disponível** lido do servidor (o mesmo `available` do saque normal, já
 * sem o reservado). A conferência local é só para evitar uma ida óbvia ao servidor: quem decide continua
 * sendo a API, dentro da transação, e é a frase dela que vai para o toast.
 */
export interface StaffWithdrawTarget {
  id: string;
  name: string;
}

export function StaffWithdrawDialog({
  open,
  member,
  onClose,
  onOpened,
}: {
  open: boolean;
  /** Membro já escolhido (lista de jogadores). Null na fila de saques: o diálogo pergunta quem é. */
  member: StaffWithdrawTarget | null;
  onClose: () => void;
  onOpened: (withdrawal: WithdrawalDto) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogTitle className="text-xl">Abrir saque para um membro</DialogTitle>
        <DialogDescription>
          Para quem pediu no Discord ou no jogo. O saque entra na fila como qualquer outro e ainda precisa de aprovação — a não ser que você já tenha pago no jogo.
        </DialogDescription>
        {/* Remontar por `key` em vez de zerar campo por campo num efeito: abrir o diálogo é sempre
            começar do zero, e um valor digitado para outro membro seria prata errada. */}
        {open && <StaffWithdrawBody key={member?.id ?? "sem-membro"} member={member} onClose={onClose} onOpened={onOpened} />}
      </DialogContent>
    </Dialog>
  );
}

function StaffWithdrawBody({ member, onClose, onOpened }: { member: StaffWithdrawTarget | null; onClose: () => void; onOpened: (withdrawal: WithdrawalDto) => void }) {
  const [picked, setPicked] = useState<StaffWithdrawTarget | null>(member);
  /** `undefined` = ainda lendo do servidor; `null` = não deu para ler. */
  const [balance, setBalance] = useState<Balance | null | undefined>(member ? undefined : null);
  const [input, setInput] = useState("");
  const [reason, setReason] = useState("");
  const [paidInGame, setPaidInGame] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  // O disponível vem do servidor, não da tela: é o mesmo número que a API vai conferir na transação.
  useEffect(() => {
    if (!picked) return;
    let alive = true;
    fetchMemberLedger(picked.id, { limit: 1 })
      .then((page) => alive && setBalance(page.balance))
      .catch(() => alive && setBalance(null));
    return () => {
      alive = false;
    };
  }, [picked]);

  const loadingBalance = balance === undefined;
  const available = balance?.available ?? 0n;
  const amount = parseAmount(input, "silver");

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (sending || !picked) return;
    if (amount === null) return setError("Digite um valor em prata, ex: 1.500.000 ou 1,5M.");
    if (!reason.trim()) return setError("Escreva o motivo: é ele que explica um saque que o membro não pediu pelo painel.");
    const refusal = balance ? checkWithdrawalRequest(amount, balance.balance, balance.reserved) : null;
    if (refusal)
      return setError(
        refusal.reason === "insufficient"
          ? `Esse membro tem ${formatAmount(refusal.available, "silver")} de prata disponível.`
          : refusal.reason === "negative_balance"
            ? "O saldo desse membro está negativo. Acerte a conta antes de abrir um saque por ele."
            : "Informe um valor maior que zero.",
      );
    setSending(true);
    try {
      const withdrawal = await openWithdrawalForMember({ userId: picked.id, amount, reason: reason.trim(), paidInGame });
      onOpened(withdrawal);
      toast.success(paidInGame ? "Saque registrado como pago" : "Saque aberto", {
        description: paidInGame
          ? `${formatAmount(amount, "silver")} debitados de ${picked.name}. Não entra na fila.`
          : `${formatAmount(amount, "silver")} de ${picked.name} reservados até alguém aprovar.`,
      });
      onClose();
    } catch (err) {
      const message = errorText(err, "Não foi possível abrir o saque agora. Tente de novo em instantes.");
      setError(message);
      toast.error("Saque não aberto", { description: message });
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      {!picked ? (
        <MemberPicker
          onPick={(m) => {
            setPicked(m);
            setBalance(undefined);
          }}
        />
      ) : (
        <form onSubmit={(e) => void submit(e)} className="space-y-4">
          <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/40 px-3 py-2">
            <div className="min-w-0">
              <p className="truncate font-medium">{picked.name}</p>
              <p className="text-xs text-muted-foreground">
                {loadingBalance ? (
                  "Lendo o saldo…"
                ) : balance ? (
                  <>
                    <Amount currency="silver" value={available} className="font-medium text-foreground" /> disponível
                    {balance.reserved > 0n && (
                      <>
                        {" · "}
                        <Amount currency="silver" value={balance.reserved} /> já reservados
                      </>
                    )}
                  </>
                ) : (
                  "Não foi possível ler o saldo agora."
                )}
              </p>
            </div>
            {!member && (
              <Button type="button" variant="ghost" size="sm" onClick={() => setPicked(null)}>
                Trocar
              </Button>
            )}
          </div>

          <div>
            <label htmlFor="staff-withdraw-amount" className="text-sm font-medium">
              Valor
            </label>
            <div className="mt-2 flex items-center gap-2 rounded-lg border border-input bg-background px-3 transition-colors duration-150 focus-within:border-ring">
              <input
                id="staff-withdraw-amount"
                autoFocus
                inputMode="decimal"
                autoComplete="off"
                placeholder={formatAmount(available, "silver")}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  setError(null);
                }}
                aria-invalid={!!error}
                className="num h-14 w-full bg-transparent text-2xl font-semibold outline-none placeholder:text-muted-foreground/50"
              />
              <span className="text-sm text-muted-foreground">prata</span>
            </div>
            {available > 0n && (
              <button
                type="button"
                className="mt-2 text-xs font-medium text-primary underline-offset-4 hover:underline"
                onClick={() => setInput(formatAmount(available, "silver"))}
              >
                Usar tudo ({formatAmountShort(available, "silver")})
              </button>
            )}
          </div>

          <div>
            <label htmlFor="staff-withdraw-reason" className="text-sm font-medium">
              Motivo <span className="font-normal text-muted-foreground">(obrigatório)</span>
            </label>
            <Textarea
              id="staff-withdraw-reason"
              rows={2}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                setError(null);
              }}
              placeholder="Ex: pediu no chat da guilda e não usa o painel"
              className="mt-2 min-h-16 text-sm"
            />
            <p className="mt-1 text-xs text-muted-foreground">Fica no histórico do saque e na timeline: é a explicação de um saque que o dono não pediu.</p>
          </div>

          {/* Atalho de SS2: a prata já saiu no jogo, então o saque nasce liquidado e pula a fila. */}
          <label
            className={cn(
              "press flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm",
              paidInGame ? "border-warning/60 bg-warning/10" : "hover:bg-accent",
            )}
          >
            <input
              type="checkbox"
              checked={paidInGame}
              onChange={(e) => setPaidInGame(e.target.checked)}
              className="mt-0.5 size-4 accent-[var(--primary)]"
            />
            <span>
              <span className="font-medium">Já paguei no jogo</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                A prata já mudou de mão: o saque nasce entregue, debita na hora e não passa pela fila. Sem aprovação de ninguém — confira o valor.
              </span>
            </span>
          </label>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={sending || !reason.trim() || !input.trim()}>
              {sending ? "Enviando…" : paidInGame ? "Registrar saque pago" : "Abrir saque"}
            </Button>
          </div>
        </form>
      )}
    </>
  );
}

/**
 * Achar o membro quando o diálogo é aberto da fila, onde não existe linha de onde tirar o nome. Usa a
 * mesma busca da lista de jogadores (servidor é a autoridade; nada é filtrado aqui).
 */
function MemberPicker({ onPick }: { onPick: (member: StaffWithdrawTarget) => void }) {
  const [search, setSearch] = useState("");
  /** Resultado do termo que o servidor respondeu: guardar o termo junto evita mostrar a lista antiga. */
  const [found, setFound] = useState<{ term: string; members: AdminMember[] } | null>(null);
  const term = search.trim();

  useEffect(() => {
    if (term.length < 2) return;
    let alive = true;
    // Espera o staff parar de digitar: busca por letra é requisição jogada fora.
    const timer = setTimeout(() => {
      fetchAdminMembers({ search: term, filter: "todos", page: 1 })
        .then((page) => alive && setFound({ term, members: page.members.slice(0, 6) }))
        .catch(() => alive && setFound({ term, members: [] }));
    }, 300);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [term]);

  const results = found?.term === term ? found.members : null;
  const loading = term.length >= 2 && results === null;

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nick ou usuário do Discord" className="pl-9" aria-label="Buscar membro" />
      </div>
      {loading ? (
        <p className="flex items-center gap-2 px-1 py-3 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Procurando…
        </p>
      ) : term.length < 2 ? (
        <p className="px-1 py-3 text-sm text-muted-foreground">Digite pelo menos duas letras do nick.</p>
      ) : results!.length === 0 ? (
        <p className="px-1 py-3 text-sm text-muted-foreground">Ninguém encontrado com esse nome.</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {results!.map((m) => {
            const name = m.gameNick || m.displayName || m.discordUsername;
            return (
              <li key={m.id}>
                <button
                  type="button"
                  className="press flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm hover:bg-accent"
                  onClick={() => onPick({ id: m.id, name })}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{m.discordUsername}</span>
                  </span>
                  <span className="text-xs text-muted-foreground">Escolher</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
