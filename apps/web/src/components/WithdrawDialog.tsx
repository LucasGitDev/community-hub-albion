import { useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { formatSilver, formatSilverShort, parseSilver } from "@albion-hub/shared";
import { useCurrentUser } from "@/auth/AuthProvider";
import { MIN_WITHDRAWAL, useStore } from "@/mock/store";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Silver } from "@/components/display";

export function WithdrawDialog({ trigger }: { trigger: ReactNode }) {
  const { user } = useCurrentUser();
  const { balanceFor, requestWithdrawal } = useStore();
  const { available } = balanceFor(user.discordId);
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  const amount = parseSilver(input);
  const blocked = available < MIN_WITHDRAWAL;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (amount === null) return setError("Digite um valor em prata, ex: 1.500.000 ou 1,5M.");
    const res = requestWithdrawal(amount);
    if (!res.ok) return setError(res.error);
    toast.success("Saque pedido", { description: `${formatSilver(amount)} de prata reservados até a staff analisar.` });
    setOpen(false);
    setInput("");
    setError(null);
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
          <DialogDescription>
            A staff entrega a prata in-game depois de aprovar. O valor fica reservado enquanto isso.
          </DialogDescription>

          {blocked ? (
            <p className="rounded-lg border bg-muted p-4 text-sm text-muted-foreground">
              Você precisa de pelo menos <Silver value={MIN_WITHDRAWAL} className="text-foreground" /> disponíveis. Hoje tem{" "}
              <Silver value={available} className="text-foreground" />.
            </p>
          ) : (
            <form onSubmit={submit}>
              <label htmlFor="amount" className="text-sm font-medium">
                Valor
              </label>
              <div className="mt-2 flex items-center gap-2 rounded-lg border border-input bg-background px-3 transition-colors duration-150 focus-within:border-ring">
                <input
                  id="amount"
                  autoFocus
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder={formatSilver(MIN_WITHDRAWAL)}
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
                    Mínimo {formatSilverShort(MIN_WITHDRAWAL)}
                    {amount !== null && amount > 0n && `, você digitou ${formatSilver(amount)}`}
                  </span>
                )}
                <button type="button" className="font-medium text-brand underline-offset-4 hover:underline" onClick={() => setInput(formatSilver(available))}>
                  Usar tudo ({formatSilverShort(available)})
                </button>
              </div>
              <div className="mt-6 flex justify-end gap-2">
                <DialogClose asChild>
                  <Button type="button" variant="ghost">
                    Cancelar
                  </Button>
                </DialogClose>
                <Button type="submit">Pedir saque</Button>
              </div>
            </form>
          )}
      </DialogContent>
    </Dialog>
  );
}
