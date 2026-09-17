import { useId, useState } from "react";
import { AlertTriangle, Ban, Check, Loader2, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";
import { BAN_EFFECTS, BAN_NON_EFFECTS, BAN_REASON_MAX_LENGTH, validateBanReason } from "@albion-hub/shared";
import { banMember, unbanMember, type AdminMember } from "@/api/members";
import { errorText } from "@/api/http";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime } from "@/lib/format";

/**
 * Banir e desbanir jogador (TASK-050).
 *
 * Banir é destrutivo e mal compreendido: quase todo mundo assume que "banir" tira a pessoa do Discord e
 * some com a prata dela. Por isso a janela é, antes de tudo, uma explicação — duas listas lado a lado, o
 * que acontece e o que **não** acontece, com o ícone e a cor dizendo qual é qual sem depender só da cor.
 *
 * A confirmação é o próprio motivo digitado: sem motivo válido o botão não liga. Não há segunda etapa de
 * "digite o nick": o motivo já obriga a parar e pensar, e fica no histórico para quem ler depois.
 */
export function MemberBanDialog({
  member,
  onClose,
  onBanned,
  onUnbanned,
}: {
  member: AdminMember | null;
  onClose: () => void;
  onBanned: (ban: AdminMember["ban"]) => void;
  onUnbanned: () => void;
}) {
  return (
    <Dialog open={member !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl">
        {member && (member.ban ? <Unban key={member.id} member={member} onClose={onClose} onUnbanned={onUnbanned} /> : <BanForm key={member.id} member={member} onClose={onClose} onBanned={onBanned} />)}
      </DialogContent>
    </Dialog>
  );
}

const memberName = (member: AdminMember) => member.gameNick || member.displayName || member.discordUsername;

function BanForm({ member, onClose, onBanned }: { member: AdminMember; onClose: () => void; onBanned: (ban: AdminMember["ban"]) => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const reasonId = useId();
  const name = memberName(member);
  const check = validateBanReason(reason);
  // Só reclama depois que a pessoa começou a escrever: erro em campo vazio recém-aberto é ruído.
  const error = reason.trim() && !check.ok ? check.error : null;

  async function submit() {
    if (!check.ok) return;
    setBusy(true);
    const id = toast.loading(`Banindo ${name}…`);
    try {
      const { ban } = await banMember(member.id, check.reason);
      toast.success(`${name} foi banido`, { id, description: "Acesso cortado, cargo Membro removido e saldo congelado." });
      onBanned({ bannedAt: ban.bannedAt, reason: ban.banReason, byName: ban.bannedByName });
      onClose();
    } catch (e) {
      toast.error(errorText(e, "Não foi possível banir esse membro"), { id, duration: 10_000 });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Ban className="size-5 shrink-0 text-destructive" aria-hidden />
          Banir {name}?
        </DialogTitle>
        <DialogDescription>
          A conta continua na lista, marcada como banida, com o motivo, quem baniu e quando. Dá para desbanir depois.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-3 sm:grid-cols-2">
        <Consequences tone="destructive" title="O que acontece" items={BAN_EFFECTS} />
        <Consequences tone="muted" title="O que não acontece" items={BAN_NON_EFFECTS} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={reasonId}>Motivo do banimento</Label>
        <Textarea
          id={reasonId}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={BAN_REASON_MAX_LENGTH}
          rows={3}
          placeholder="Ex.: roubou o loot do split de 12/09 e saiu do evento sem avisar."
          aria-describedby={`${reasonId}-help`}
          aria-invalid={error !== null}
        />
        <p id={`${reasonId}-help`} className={error ? "text-xs text-destructive" : "text-xs text-muted-foreground"} role={error ? "alert" : undefined}>
          {error ?? "Obrigatório. Fica no histórico do membro e é o que a staff vai ler daqui a três meses."}
        </p>
      </div>

      <DialogFooter>
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Voltar
        </Button>
        <Button variant="destructive" className="press" disabled={busy || !check.ok} onClick={() => void submit()}>
          {busy ? <Loader2 className="animate-spin" /> : <Ban />}
          Banir {name}
        </Button>
      </DialogFooter>
    </>
  );
}

function Unban({ member, onClose, onUnbanned }: { member: AdminMember; onClose: () => void; onUnbanned: () => void }) {
  const [busy, setBusy] = useState(false);
  const name = memberName(member);
  const ban = member.ban;

  async function submit() {
    setBusy(true);
    const id = toast.loading(`Desbanindo ${name}…`);
    try {
      await unbanMember(member.id);
      toast.success(`${name} foi desbanido`, { id, description: "Pode entrar no painel, se inscrever em evento e pedir saque de novo." });
      onUnbanned();
      onClose();
    } catch (e) {
      toast.error(errorText(e, "Não foi possível desbanir esse membro"), { id, duration: 10_000 });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <ShieldCheck className="size-5 shrink-0" aria-hidden />
          Desbanir {name}?
        </DialogTitle>
        <DialogDescription>O acesso volta na hora: login, inscrição em evento e pedido de saque liberados de novo.</DialogDescription>
      </DialogHeader>

      {ban && (
        <dl className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
            <div className="min-w-0">
              <dt className="text-xs font-medium text-muted-foreground">Motivo do banimento</dt>
              <dd className="break-words">{ban.reason}</dd>
            </div>
          </div>
          <div className="pl-6">
            <dt className="text-xs font-medium text-muted-foreground">Quando e por quem</dt>
            <dd className="num text-xs">
              {formatDateTime(ban.bannedAt)}
              {ban.byName ? ` · ${ban.byName}` : ""}
            </dd>
          </div>
        </dl>
      )}

      <p className="text-sm text-muted-foreground">
        O cargo Membro no Discord <strong className="font-medium text-foreground">não volta sozinho</strong>: ele é reposto na próxima aprovação de nick, ou à mão no Discord.
      </p>

      <DialogFooter>
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Voltar
        </Button>
        <Button className="press" disabled={busy} onClick={() => void submit()}>
          {busy ? <Loader2 className="animate-spin" /> : <ShieldCheck />}
          Desbanir {name}
        </Button>
      </DialogFooter>
    </>
  );
}

/** Lista de consequências: ícone + cor, nunca só cor, e nunca um parágrafo corrido que ninguém lê. */
function Consequences({ tone, title, items }: { tone: "destructive" | "muted"; title: string; items: readonly string[] }) {
  const bad = tone === "destructive";
  return (
    <div className={bad ? "rounded-lg border border-destructive/40 bg-destructive/10 p-3" : "rounded-lg border bg-muted/40 p-3"}>
      <p className="mb-2 text-xs font-semibold tracking-wide uppercase">{title}</p>
      <ul className="space-y-1.5 text-sm">
        {items.map((item) => (
          <li key={item} className="flex items-start gap-2">
            {bad ? <X className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden /> : <Check className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />}
            <span className="min-w-0">{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
