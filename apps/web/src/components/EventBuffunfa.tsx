import { formatPresence, formatShare, type EventAttendanceDto, type EventDto, type EventRoleSlotDto } from "@albion-hub/shared";
import { AlertTriangle, Check, Coins, Layers, Lock, Sparkles, Users } from "lucide-react";
import { useCallback, useEffect, useId, useState } from "react";
import { toast } from "sonner";
import * as attendanceApi from "@/api/attendance";
import { errorText } from "@/api/http";
import { Amount, Pill } from "@/components/display";
import { Step } from "@/components/settlement-step";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { attendanceBlockedReason, attendancePayoutText, attendanceSkipText, attendanceSummary, checkRoleValue, roleRangeText } from "@/lib/attendance";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Buffunfa por participação (TASK-057, F6-8 a F6-11): o passo do acerto em que o caller escolhe
 * quanto cada role paga e fecha.
 *
 * A ordem da tela é a ordem da decisão, como no loot split: primeiro **quanto vale cada role** (é o
 * que o caller mexe para preencher vaga escassa), depois **quem recebe** com esses valores, e só no
 * fim o botão que cria a moeda. O total aparece antes do clique de propósito — Buffunfa é criada do
 * nada, e o número que vai nascer é a informação mais importante da tela.
 *
 * Nada aqui recalcula o corte dos 90%: cada PATCH devolve a prévia recalculada pelo servidor, que é
 * quem vai gravar. O que o caller confere é o que vai para o extrato.
 */
export function EventBuffunfaStep({ event, n, open, onChanged }: { event: EventDto; n: number; open: boolean; onChanged: () => void }) {
  const [data, setData] = useState<EventAttendanceDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => setNonce((k) => k + 1), []);

  useEffect(() => {
    let alive = true;
    attendanceApi
      .fetchEventAttendance(event.id)
      .then((dto) => {
        if (!alive) return;
        setError(null);
        setData(dto);
      })
      .catch((e: unknown) => alive && setError(errorText(e, "Erro ao carregar a Buffunfa do evento.")));
    return () => {
      alive = false;
    };
  }, [event.id, nonce]);

  async function pay() {
    setBusy(true);
    try {
      const dto = await attendanceApi.payEventAttendance(event.id);
      setData(dto);
      setConfirming(false);
      // O evento também mudou (ganhou o carimbo do pagamento): quem manda na tela de fora relê.
      onChanged();
      toast.success("Buffunfa paga", { description: "Caiu no extrato de quem bateu a presença. Correção, agora, só por ajuste da staff." });
    } catch (e) {
      toast.error(errorText(e, "Não foi possível pagar a Buffunfa."));
      reload();
    } finally {
      setBusy(false);
    }
  }

  const paid = data?.paidAt ?? null;
  const summary = data ? attendanceSummary(data) : null;
  const blocked = data ? attendanceBlockedReason(data) : "carregando";

  return (
    <Step
      n={n}
      title="Buffunfa por presença"
      hint={
        paid
          ? "Pago: os lançamentos são definitivos e o valor por role não muda mais."
          : "Quem ficou 90% ou mais do tempo da call recebe o valor cheio da role dele. Abaixo disso, não recebe nada — e o valor que vale é o que estiver aqui no fechamento, para todos daquela role."
      }
      action={
        paid ? (
          <Pill tone="success" icon={<Lock aria-hidden />}>
            pago em <span className="num">{formatDateTime(paid)}</span>
          </Pill>
        ) : null
      }
    >
      {error && !data && (
        <div role="alert" className="text-sm">
          <p className="text-destructive">{error}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={reload}>
            Tentar de novo
          </Button>
        </div>
      )}

      {!data && !error && <Skeleton className="h-40 w-full" aria-label="Carregando a Buffunfa do evento…" />}

      {data && (
        <div className="space-y-4">
          {!data.measured && <NotMeasuredNote />}

          <RoleValues
            event={event}
            open={open && !paid}
            onChanged={(dto) => {
              setData(dto);
              onChanged();
            }}
          />

          <AttendanceTable dto={data} />

          {/* Rodapé do dinheiro, igual ao do split: o número-chave e, do lado dele, o botão. */}
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-xl border bg-muted/40 px-4 py-3">
            <p className="flex items-baseline gap-2">
              <Amount currency="buffunfa" value={summary!.total} className="text-3xl font-semibold" />
              <span className="text-sm text-muted-foreground">{attendancePayoutText(data)}</span>
            </p>
            {open && !paid && (
              <Button disabled={busy || blocked !== null} title={blocked ?? undefined} onClick={() => setConfirming(true)}>
                <Sparkles />
                Pagar Buffunfa
              </Button>
            )}
          </div>

          {open && !paid && blocked && (
            <p role="alert" className="flex items-start gap-2 text-sm text-muted-foreground">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
              <span>{blocked}</span>
            </p>
          )}

          {confirming && <ConfirmPayoutDialog dto={data} busy={busy} onClose={() => setConfirming(false)} onConfirm={() => void pay()} />}
        </div>
      )}
    </Step>
  );
}

/** Evento sem canal medido (F6-11): dito no alto, antes de o caller procurar por que a tabela está vazia. */
function NotMeasuredNote() {
  return (
    <p role="alert" className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
      <span>
        Este evento não teve canal de voz carimbado, então a presença nunca foi medida: <strong>ninguém recebe Buffunfa aqui</strong>. O loot split e a taxa continuam
        valendo — só o prêmio de comparecimento é que não tem como ser provado.
      </span>
    </p>
  );
}

/**
 * Quanto cada role paga (AC#1, AC#2, AC#3). A tela começa pelo gesto que o caller repete — **todas
 * as roles recebem X** — porque é assim que o evento nasce ("no geral todas ganham X desde o
 * início"); a grade por role fica logo abaixo, para a exceção que vem depois, e vale por cima do
 * lote, na ordem em que foi aplicada.
 *
 * A faixa do template continua escrita ao lado de cada role, mas como **sugestão**: ela orienta e
 * não recusa mais nada (revisão da F6-8 na TASK-072). O que ainda recusa é o teto do sistema.
 */
function RoleValues({ event, open, onChanged }: { event: EventDto; open: boolean; onChanged: (dto: EventAttendanceDto) => void }) {
  return (
    <div className="space-y-2">
      {open && event.roles.length > 1 && <AllRolesField eventId={event.id} roles={event.roles} onChanged={onChanged} />}
      {/* A `key` leva o valor: depois do lote o evento é relido e cada campo volta a mostrar o que o servidor tem. */}
      <div className="grid gap-2 sm:grid-cols-2">
        {event.roles.map((role) => (
          <RoleValueField key={`${role.id}:${role.buffunfaValue}`} eventId={event.id} role={role} open={open} onChanged={onChanged} />
        ))}
      </div>
    </div>
  );
}

/**
 * Ajuste em lote. Nasce vazio, e não com o valor de alguma role, de propósito: preencher sozinho
 * daria a impressão de que já está aplicado a todas, quando o que está na tela é o valor de uma.
 */
function AllRolesField({ eventId, roles, onChanged }: { eventId: string; roles: readonly EventRoleSlotDto[]; onChanged: (dto: EventAttendanceDto) => void }) {
  const fieldId = useId();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const check = text.trim() === "" ? null : checkRoleValue(text);

  async function save() {
    if (!check?.ok) return;
    setBusy(true);
    try {
      onChanged(await attendanceApi.setAllRolesBuffunfa(eventId, check.value));
      setText("");
      toast.success(`${roles.length} roles a ${check.value} de Buffunfa`, { description: "Dá para ajustar uma role específica por cima disso, logo abaixo." });
    } catch (e) {
      toast.error(errorText(e, "Não foi possível aplicar o valor a todas as roles."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="flex flex-wrap items-end justify-between gap-3 rounded-xl border border-brand/40 bg-brand/5 px-3 py-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="min-w-0">
        <Label htmlFor={fieldId} className="flex items-center gap-1.5">
          <Layers className="size-3.5 text-brand" aria-hidden />
          Todas as roles
        </Label>
        <p className="mt-0.5 text-xs text-muted-foreground">Mesmo valor para as {roles.length} roles do evento, de uma vez.</p>
      </div>
      <div className="flex items-end gap-2">
        <Input
          id={fieldId}
          inputMode="numeric"
          placeholder="25"
          aria-label="Buffunfa por presença em todas as roles"
          aria-invalid={check ? !check.ok : undefined}
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="num w-20 text-right"
        />
        <Button type="submit" size="sm" disabled={busy || !check?.ok}>
          <Check />
          Aplicar a todas
        </Button>
      </div>
      {check && !check.ok && (
        <p role="alert" className="w-full text-xs text-destructive">
          {check.error}
        </p>
      )}
    </form>
  );
}

/**
 * Valor de **uma** role, por cima do lote (AC#2). O campo aceita qualquer inteiro até o teto do
 * sistema, inclusive em evento cujo template veio com faixa 0 a 0 (F6-51) — é o caso que antes
 * travava o campo e deixava o evento sem pagar nada (AC#6).
 */
function RoleValueField({
  eventId,
  role,
  open,
  onChanged,
}: {
  eventId: string;
  role: EventRoleSlotDto;
  open: boolean;
  onChanged: (dto: EventAttendanceDto) => void;
}) {
  const fieldId = useId();
  const [text, setText] = useState(role.buffunfaValue);
  /** Último valor que o servidor aceitou. Evita o botão "Aplicar" continuar aceso depois de aplicar. */
  const [applied, setApplied] = useState(role.buffunfaValue);
  const [busy, setBusy] = useState(false);
  const check = checkRoleValue(text);
  const dirty = !check.ok || check.value !== BigInt(applied);

  async function save() {
    if (!check.ok) return;
    setBusy(true);
    try {
      onChanged(await attendanceApi.setRoleBuffunfa(eventId, role.id, check.value));
      setApplied(check.value.toString());
      toast.success(`${role.name}: ${check.value} de Buffunfa`, { description: "Vale para todos dessa role no fechamento." });
    } catch (e) {
      toast.error(errorText(e, "Não foi possível mudar o valor desta role."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl border bg-muted/40 px-3 py-2.5">
      <div className="min-w-0">
        <Label htmlFor={fieldId} className="truncate">
          {role.name}
        </Label>
        <p className="num mt-0.5 text-xs text-muted-foreground">{roleRangeText(role)}</p>
      </div>
      {open ? (
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <Input
            id={fieldId}
            inputMode="numeric"
            aria-label={`Buffunfa por presença na role ${role.name}`}
            aria-invalid={!check.ok}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="num w-20 text-right"
          />
          <Button type="submit" size="sm" variant="outline" disabled={busy || !check.ok || !dirty}>
            <Check />
            Aplicar
          </Button>
        </form>
      ) : (
        <Amount currency="buffunfa" value={BigInt(applied)} className="text-lg font-semibold" />
      )}
      {!check.ok && (
        <p role="alert" className="w-full text-xs text-destructive">
          {check.error}
        </p>
      )}
    </div>
  );
}

/**
 * Quem recebe e quem não recebe, com o motivo. Quem ficou de fora continua na lista de propósito: o
 * caller precisa ver que a pessoa apareceu e não bateu o tempo, senão o "não recebi" vira conversa
 * sem registro.
 */
function AttendanceTable({ dto }: { dto: EventAttendanceDto }) {
  if (dto.lines.length === 0)
    return (
      <div className="rounded-xl border border-dashed px-4 py-8 text-center">
        <Users className="mx-auto mb-2 size-5 text-muted-foreground" aria-hidden />
        <p className="font-medium">Ninguém foi medido na call deste evento.</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">Sem gente na call não há comparecimento a premiar.</p>
      </div>
    );

  return (
    <div className="overflow-hidden rounded-xl border">
      <Table>
        <caption className="sr-only">Quem recebe Buffunfa por presença neste evento</caption>
        <TableHeader>
          <TableRow className="bg-muted/40 hover:bg-muted/40">
            <TableHead className="w-full">Participante</TableHead>
            <TableHead className="hidden text-right sm:table-cell">Tempo na call</TableHead>
            <TableHead className="text-right">Presença</TableHead>
            <TableHead className="text-right">Buffunfa</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {dto.lines.map((line) => {
            const skip = attendanceSkipText(line);
            return (
              <TableRow key={line.key}>
                <TableCell className="w-full whitespace-normal">
                  <span className="font-medium">{line.nick}</span>
                  {line.roleName && <span className="ml-2 text-xs text-muted-foreground">{line.roleName}</span>}
                  {skip && <span className="ml-2 inline-flex align-middle"><Pill tone="neutral">{skip}</Pill></span>}
                  <span className="num block text-xs text-muted-foreground sm:hidden">
                    {line.presenceMs > 0 ? `${formatPresence(line.presenceMs)} na call` : "não entrou na call"}
                  </span>
                </TableCell>
                <TableCell className="num hidden text-right text-muted-foreground sm:table-cell">{formatPresence(line.presenceMs)}</TableCell>
                <TableCell className={cn("num text-right font-medium", line.skip === "below_presence" && "text-warning")}>{formatShare(line.presenceBp)}</TableCell>
                <TableCell className="px-2 text-right sm:px-3">
                  <Amount currency="buffunfa" value={BigInt(line.amount)} className={cn("font-semibold", line.amount === "0" && "text-muted-foreground")} />
                </TableCell>
              </TableRow>
            );
          })}
          <TableRow className="bg-muted/60 hover:bg-muted/60">
            <TableCell className="font-semibold">Total do fechamento</TableCell>
            <TableCell className="hidden sm:table-cell" />
            <TableCell />
            <TableCell className="text-right">
              <Amount currency="buffunfa" value={BigInt(dto.total)} className="text-lg font-semibold" />
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}

/**
 * Última tela antes de a Buffunfa existir. Diz o que a do split não precisa dizer: esta moeda é
 * **criada** aqui, e o ledger não volta atrás.
 */
function ConfirmPayoutDialog({ dto, busy, onClose, onConfirm }: { dto: EventAttendanceDto; busy: boolean; onClose: () => void; onConfirm: () => void }) {
  const paying = dto.lines.filter((l) => l.skip === null);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Pagar a Buffunfa deste evento?</DialogTitle>
          <DialogDescription>
            A Buffunfa é criada agora e cai no extrato de cada um. Lançamento não se apaga nem se edita: se o valor estiver errado, a correção depois é um ajuste feito
            pela staff.
          </DialogDescription>
        </DialogHeader>

        <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-2 rounded-xl border p-3 text-sm">
          <dt>Recebem</dt>
          <dd className="num font-semibold">{paying.length === 1 ? "1 pessoa" : `${paying.length} pessoas`}</dd>
          <dt className="text-muted-foreground">Ficam de fora (abaixo dos 90%, sem inscrição ou sem conta)</dt>
          <dd className="num text-muted-foreground">{dto.lines.length - paying.length}</dd>
          <dt className="border-t pt-2">Buffunfa criada</dt>
          <dd className="border-t pt-2">
            <Amount currency="buffunfa" value={BigInt(dto.total)} className="font-semibold" />
          </dd>
        </dl>

        <ul className="max-h-56 divide-y overflow-y-auto rounded-xl border text-sm">
          {paying.map((line) => (
            <li key={line.key} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="min-w-0 truncate">
                {line.nick} <span className="text-muted-foreground">{line.roleName}</span>
              </span>
              <Amount currency="buffunfa" value={BigInt(line.amount)} className="font-semibold" />
            </li>
          ))}
          {paying.length === 0 && <li className="px-3 py-2 text-muted-foreground">Ninguém recebe Buffunfa neste evento.</li>}
        </ul>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Voltar
          </Button>
          <Button autoFocus disabled={busy} onClick={onConfirm}>
            <Coins />
            Pagar Buffunfa
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
