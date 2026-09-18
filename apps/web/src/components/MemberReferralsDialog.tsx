import { useEffect, useId, useState } from "react";
import { Clock, Loader2, RotateCcw, TriangleAlert, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";
import type { MemberReferralsDto, ReferralDto } from "@albion-hub/shared";
import { REFERRAL_BONUS, REFERRAL_MONTHLY_REWARD_CAP, REFERRAL_REVERSAL_REASON_MAX_LENGTH, validateReferralReversalReason } from "@albion-hub/shared";
import { fetchMemberReferrals, reverseMemberReferral } from "@/api/referrals";
import { errorText } from "@/api/http";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Amount, EmptyState, Pill } from "@/components/display";
import { formatDateTime } from "@/lib/format";

/**
 * Indicações de um membro para a staff (TASK-074, AC#8). Duas perguntas na mesma janela, porque quem
 * abre aqui está atrás de uma delas e quase sempre lê a outra em seguida: **quem indicou esta pessoa**
 * e **quem esta pessoa indicou**.
 *
 * A única escrita da tela é o estorno, e ele mora só no bloco de cima — a indicação declarada é a que
 * tem lançamento na linha deste membro. Estornar não apaga a indicação: ela aconteceu, o campo é
 * write-once no banco, e o que se desfaz é o pagamento. O texto diz isso, para ninguém abrir esperando
 * um botão de "desfazer indicação" que nunca vai existir.
 */
export function MemberReferralsDialog({ member, onClose, canReverse }: { member: { id: string; name: string } | null; onClose: () => void; canReverse: boolean }) {
  return (
    <Dialog open={member !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        {member && <MemberReferrals key={member.id} member={member} canReverse={canReverse} />}
      </DialogContent>
    </Dialog>
  );
}

function MemberReferrals({ member, canReverse }: { member: { id: string; name: string }; canReverse: boolean }) {
  const [data, setData] = useState<MemberReferralsDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchMemberReferrals(member.id)
      .then((r) => alive && setData(r))
      .catch((e: unknown) => alive && setError(errorText(e, "Não foi possível carregar as indicações")));
    return () => {
      alive = false;
    };
  }, [member.id]);

  const capLeft = data ? Math.max(0, REFERRAL_MONTHLY_REWARD_CAP - data.rewardedThisMonth) : 0;

  return (
    <>
      <DialogHeader className="shrink-0 border-b px-5 pt-5 pr-12 pb-4 text-left">
        <DialogTitle className="flex items-center gap-2">
          <UserPlus className="size-4 text-muted-foreground" aria-hidden />
          Indicações de {member.name}
        </DialogTitle>
        <DialogDescription>
          Cada pessoa declara quem a indicou uma vez só, e isso não muda depois. O bônus é de <Amount value={REFERRAL_BONUS.referrer} currency="buffunfa" /> para quem indica e{" "}
          <Amount value={REFERRAL_BONUS.referred} currency="buffunfa" /> para quem foi indicado, pago quando o nick do indicado é aprovado.
        </DialogDescription>
      </DialogHeader>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {error ? (
          <p role="alert" className="px-5 py-10 text-center text-sm text-destructive">
            {error}
          </p>
        ) : !data ? (
          <div className="space-y-3 p-5" aria-busy>
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : (
          <div className="divide-y">
            <section className="px-5 py-4">
              <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Quem indicou {member.name}</h3>
              {data.declared ? (
                <DeclaredCard
                  referral={data.declared}
                  memberId={member.id}
                  canReverse={canReverse}
                  onReversed={(next) => setData(next)}
                />
              ) : (
                <EmptyState
                  icon={<UserPlus />}
                  title="Ninguém declarado."
                  description={`${member.name} não disse quem o trouxe para a guilda. Dá para declarar a qualquer momento pelo comando /indicacao no Discord — não há prazo.`}
                />
              )}
            </section>

            <section className="px-5 py-4">
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  Quem {member.name} indicou <span className="num text-foreground">{data.made.length}</span>
                </h3>
                {/* O teto é do indicador, e é aqui que ele conta: a staff pergunta "ainda cabe?" olhando esta lista. */}
                <p className="num text-xs text-muted-foreground">
                  {data.rewardedThisMonth} de {REFERRAL_MONTHLY_REWARD_CAP} recompensadas neste mês
                  {capLeft === 0 ? " · teto batido" : ` · cabem mais ${capLeft}`}
                </p>
              </div>
              {data.made.length === 0 ? (
                <EmptyState icon={<Users />} title="Nenhuma ainda." description="Ninguém declarou este membro como quem o indicou." />
              ) : (
                <ul className="divide-y rounded-md border">
                  {data.made.map((referral) => (
                    <li key={referral.referred.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{referral.referred.gameNick || referral.referred.name}</p>
                        <p className="num truncate text-xs text-muted-foreground">Declarada em {formatDateTime(referral.declaredAt)}</p>
                      </div>
                      <RewardPill referral={referral} side="referrer" />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </div>
    </>
  );
}

/** Estado do dinheiro da indicação, do ponto de vista de um dos dois lados. Nunca só cor: ícone + texto. */
function RewardPill({ referral, side }: { referral: ReferralDto; side: "referrer" | "referred" }) {
  if (referral.reversed)
    return (
      <Pill tone="destructive" icon={<RotateCcw strokeWidth={2.25} />}>
        Estornada
      </Pill>
    );
  if (!referral.rewardedAt)
    return (
      <Pill tone="warning" icon={<Clock strokeWidth={2.25} />}>
        Esperando o nick ser aprovado
      </Pill>
    );
  if (side === "referrer" && !referral.referrerPaid)
    return (
      <Pill tone="neutral" icon={<TriangleAlert strokeWidth={2.25} />}>
        Registrada sem pagar
      </Pill>
    );
  return (
    <Pill tone="brand" icon={<UserPlus strokeWidth={2.25} />}>
      <Amount value={side === "referrer" ? REFERRAL_BONUS.referrer : REFERRAL_BONUS.referred} currency="buffunfa" /> paga
    </Pill>
  );
}

/** A indicação declarada por este membro: a única com estorno, porque é nela que os lançamentos moram. */
function DeclaredCard({
  referral,
  memberId,
  canReverse,
  onReversed,
}: {
  referral: ReferralDto;
  memberId: string;
  canReverse: boolean;
  onReversed: (next: MemberReferralsDto) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-md border">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{referral.referrer.gameNick || referral.referrer.name}</p>
          <p className="num truncate text-xs text-muted-foreground">
            Declarada em {formatDateTime(referral.declaredAt)}
            {referral.rewardedAt ? ` · paga em ${formatDateTime(referral.rewardedAt)}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <RewardPill referral={referral} side="referred" />
          {canReverse && referral.rewardedAt && !referral.reversed && (
            <Button variant="outline" size="sm" className="press" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
              <RotateCcw />
              Estornar
            </Button>
          )}
        </div>
      </div>
      {open && <ReverseForm memberId={memberId} onCancel={() => setOpen(false)} onReversed={onReversed} />}
    </div>
  );
}

/**
 * Estorno da indicação. A confirmação é o próprio motivo digitado — sem motivo válido o botão não liga —
 * porque o motivo é o que fica no extrato dos dois lados e explica o buraco para quem ler depois.
 */
function ReverseForm({ memberId, onCancel, onReversed }: { memberId: string; onCancel: () => void; onReversed: (next: MemberReferralsDto) => void }) {
  const reasonId = useId();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const check = validateReferralReversalReason(reason);
  const error = reason.trim() && !check.ok ? check.error : null;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!check.ok || busy) return;
    setBusy(true);
    const id = toast.loading("Estornando a indicação…");
    try {
      onReversed(await reverseMemberReferral(memberId, check.reason));
      toast.success("Indicação estornada", { id, description: "Os dois lançamentos ganharam um estorno. A indicação continua registrada." });
      onCancel();
    } catch (e) {
      toast.error(errorText(e, "Não foi possível estornar a indicação"), { id });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-2 border-t bg-muted/30 px-3 py-3">
      <Label htmlFor={reasonId}>Motivo do estorno</Label>
      <Textarea
        id={reasonId}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={REFERRAL_REVERSAL_REASON_MAX_LENGTH}
        rows={2}
        autoFocus
        placeholder="Ex.: o indicado declarou o nick errado e o bônus foi para outra pessoa."
        aria-invalid={error ? true : undefined}
      />
      <p className={error ? "text-xs text-destructive" : "text-xs text-muted-foreground"} role={error ? "alert" : undefined}>
        {error ?? "Estorna os dois lançamentos, de uma vez. O campo de quem indicou continua gravado: a indicação aconteceu."}
      </p>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
          Cancelar
        </Button>
        <Button type="submit" variant="destructive" size="sm" className="press" disabled={!check.ok || busy}>
          {busy ? <Loader2 className="animate-spin" /> : <RotateCcw />}
          Estornar bônus
        </Button>
      </div>
    </form>
  );
}
