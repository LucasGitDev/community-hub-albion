import { useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { checkWithdrawalRequest, formatAmount, formatAmountShort, parseAmount, withdrawalRefusalMessage } from "@albion-hub/shared";
import { errorText } from "@/api/http";
import { useWallet } from "@/api/WalletProvider";
import { requestWithdrawal } from "@/api/wallet";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Amount } from "@/components/display";

/**
 * Pedido de saque contra a API real (TASK-031, AC#3). Sem valor mínimo e sem taxa (Q12): só recusa valor
 * não positivo, acima do disponível, ou saldo negativo (Q24).
 *
 * A checagem local (`checkWithdrawalRequest`, a mesma função do servidor) só evita um round-trip óbvio;
 * quem decide continua sendo a API, dentro da transação — e é a frase dela que vai pro toast.
 */
export function WithdrawDialog({ trigger }: { trigger: ReactNode }) {
  const { balance, apply } = useWallet();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const available = balance?.available ?? 0n;
  const negative = (balance?.balance ?? 0n) < 0n;
  const amount = parseAmount(input, "silver");

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (sending) return;
    if (amount === null) return setError("Digite um valor em prata, ex: 1.500.000 ou 1,5M.");
    const refusal = balance ? checkWithdrawalRequest(amount, balance.balance, balance.reserved) : null;
    if (refusal) return setError(withdrawalRefusalMessage(refusal));
    setSending(true);
    try {
      apply(await requestWithdrawal(amount));
      toast.success("Saque pedido", { description: `${formatAmount(amount, "silver")} de prata reservados até a staff analisar.` });
      setOpen(false);
      setInput("");
      setError(null);
    } catch (err) {
      const message = errorText(err, "Não foi possível pedir o saque agora. Tente de novo em instantes.");
      setError(message);
      toast.error("Saque não enviado", { description: message });
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setError(null);
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogTitle className="text-xl">Pedir saque</DialogTitle>
        <DialogDescription>A staff entrega a prata in-game depois de aprovar. O valor fica reservado enquanto isso.</DialogDescription>

        {negative ? (
          <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">
            Seu saldo está negativo (<Amount currency="silver" value={balance?.balance ?? 0n} className="font-semibold" />). Fale com a staff para acertar a conta antes de pedir um saque.
          </p>
        ) : available <= 0n ? (
          <p className="rounded-lg border bg-muted p-4 text-sm text-muted-foreground">
            Você não tem prata disponível agora. Participe de um evento com loot split para receber sua parte.
          </p>
        ) : (
          <form onSubmit={(e) => void submit(e)}>
            <label htmlFor="amount" className="text-sm font-medium">
              Valor
            </label>
            <div className="mt-2 flex items-center gap-2 rounded-lg border border-input bg-background px-3 transition-colors duration-150 focus-within:border-ring">
              <input
                id="amount"
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
                aria-describedby="amount-help"
                className="num h-14 w-full bg-transparent text-2xl font-semibold outline-none placeholder:text-muted-foreground/50"
                style={{ outline: "none" }}
              />
              <span className="text-sm text-muted-foreground">prata</span>
            </div>
            <div id="amount-help" className="mt-2 flex flex-wrap justify-between gap-2 text-xs" aria-live="polite">
              {error ? (
                <span className="text-destructive">{error}</span>
              ) : (
                <span className="text-muted-foreground">
                  Sem valor mínimo
                  {amount !== null && amount > 0n && `, você digitou ${formatAmount(amount, "silver")}`}
                </span>
              )}
              <button type="button" className="font-medium text-primary underline-offset-4 hover:underline" onClick={() => setInput(formatAmount(available, "silver"))}>
                Usar tudo ({formatAmountShort(available, "silver")})
              </button>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <DialogClose asChild>
                <Button type="button" variant="ghost">
                  Cancelar
                </Button>
              </DialogClose>
              <Button type="submit" disabled={sending}>
                {sending ? "Enviando…" : "Pedir saque"}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
