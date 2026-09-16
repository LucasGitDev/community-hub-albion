import {
  EVENT_TEMPLATE_NAME_MAX,
  feeFromDto,
  formatEventFee,
  formatPresence,
  formatShare,
  formatSilver,
  parsePercentBp,
  parseSilver,
  type EventDto,
  type EventFee,
  type LootSplitDto,
  type SplitPresenceDto,
} from "@albion-hub/shared";
import { AlertTriangle, Archive, Calculator, Check, Coins, Crown, Lock, Pencil, RotateCcw, Save, Users } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import * as eventsApi from "@/api/events";
import { errorText } from "@/api/http";
import * as splitsApi from "@/api/splits";
import { Silver } from "@/components/display";
import { Pill } from "@/components/display";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime } from "@/lib/format";
import {
  confirmBlockedReason,
  eventFee,
  isSettlementOpen,
  rowsFromPresence,
  rowsFromSplit,
  settlementTotals,
  shareSum,
  shareSumText,
  withAmounts,
  type SettlementRow,
} from "@/lib/settlement";
import { cn } from "@/lib/utils";

/**
 * Acerto do evento finalizado (TASK-029): dados, taxa e loot split, na ordem da decisão.
 *
 * Mora dentro do painel de detalhe do evento e não numa rota própria porque quem acabou de finalizar
 * já está aqui, com a lista de quem jogou na tela. A ordem de cima para baixo é a ordem em que o
 * caller decide: arruma o que ficou errado, define quanto fica retido e só então divide o resto —
 * mexer na taxa depois de olhar os percentuais mudaria todas as linhas de uma vez.
 *
 * Nada aqui recalcula prata por conta própria: as contas vêm de `lib/settlement`, que usa as mesmas
 * funções do servidor. O número conferido na tela é o número creditado no ledger.
 */

interface SettlementData {
  present: SplitPresenceDto[];
  splits: LootSplitDto[];
}

/** Passo do acerto. O número é informação, não enfeite: isto é uma sequência, e ela tem ordem. */
function Step({ n, title, hint, action, children }: { n: number; title: string; hint?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} className="border-b last:border-b-0">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 pt-4">
        <h3 className="flex min-w-0 items-center gap-2.5 text-lg font-semibold">
          <span className="num grid size-6 shrink-0 place-items-center rounded-md border bg-muted text-xs font-semibold text-muted-foreground">{n}</span>
          <span className="truncate">{title}</span>
        </h3>
        {action}
      </div>
      {hint && <p className="mt-1 px-4 pl-[3.125rem] text-sm text-muted-foreground">{hint}</p>}
      <div className="px-4 py-4">{children}</div>
    </section>
  );
}

export function EventSettlement({ event, onChanged, onDraftChange }: { event: EventDto; onChanged: () => void; onDraftChange: (hasDraft: boolean) => void }) {
  const [data, setData] = useState<SettlementData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const open = isSettlementOpen(event);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let alive = true;
    Promise.all([splitsApi.fetchEventPresence(event.id), splitsApi.fetchEventSplits(event.id)])
      .then(([presence, splits]) => {
        if (!alive) return;
        setError(null);
        setData({ present: presence.present, splits: splits.splits });
        // Avisa o painel de fora na mesma resposta que trouxe o dado: é ele que desliga o arquivamento (AC#10).
        onDraftChange(splits.splits.some((s) => s.status === "draft"));
      })
      .catch((e: unknown) => alive && setError(errorText(e, "Erro ao carregar o acerto do evento.")));
    return () => {
      alive = false;
    };
  }, [event.id, nonce, onDraftChange]);

  const draft = data?.splits.find((s) => s.status === "draft") ?? null;

  if (error && !data)
    return (
      <div role="alert" className="px-4 py-6 text-sm">
        <p className="text-destructive">{error}</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={reload}>
          Tentar de novo
        </Button>
      </div>
    );

  if (!data)
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-24 w-full" aria-label="Carregando o acerto…" />
        <Skeleton className="h-40 w-full" />
      </div>
    );

  const confirmed = data.splits.filter((s) => s.status === "confirmed");

  return (
    <div className="divide-y">
      <EventDetailsStep event={event} open={open} onChanged={onChanged} />
      <FeeStep event={event} open={open && draft === null} hasDraft={draft !== null} onChanged={onChanged} />
      <SplitStep
        event={event}
        open={open}
        present={data.present}
        draft={draft}
        confirmed={confirmed}
        onChanged={() => {
          reload();
          onChanged();
        }}
      />
    </div>
  );
}

/* ----------------------------------------------------------------- passo 1 */

/** Correção dos dados, discreta de propósito: é conserto, não criação (AC#2). */
function EventDetailsStep({ event, open, onChanged }: { event: EventDto; open: boolean; onChanged: () => void }) {
  const ids = { name: useId(), description: useId() };
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(event.name);
  const [description, setDescription] = useState(event.description ?? "");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const updated = await eventsApi.updateEvent(event.id, { name: name.trim(), description: description.trim() || null });
      toast.success("Dados do evento salvos", { description: updated.name });
      setEditing(false);
      onChanged();
    } catch (e) {
      toast.error(errorText(e, "Não foi possível salvar os dados do evento."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Step
      n={1}
      title="Dados do evento"
      hint={open ? "O nome e a observação ainda podem ser corrigidos; o resto é o registro do que aconteceu." : "Arquivado: os dados não mudam mais."}
      action={
        open && !editing ? (
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            <Pencil />
            Corrigir
          </Button>
        ) : null
      }
    >
      {editing ? (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div>
            <Label htmlFor={ids.name}>Nome do evento</Label>
            <Input id={ids.name} autoFocus value={name} maxLength={EVENT_TEMPLATE_NAME_MAX} onChange={(e) => setName(e.target.value)} className="mt-1.5" />
          </div>
          <div>
            <Label htmlFor={ids.description}>Observações</Label>
            <Textarea id={ids.description} value={description} rows={2} onChange={(e) => setDescription(e.target.value)} className="mt-1.5 min-h-16" />
          </div>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={busy || name.trim() === ""}>
              <Save />
              Salvar dados
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setName(event.name);
                setDescription(event.description ?? "");
                setEditing(false);
              }}
            >
              Descartar
            </Button>
          </div>
        </form>
      ) : (
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[8rem_1fr]">
          <dt className="text-sm text-muted-foreground">Nome</dt>
          <dd className="font-medium">{event.name}</dd>
          <dt className="text-sm text-muted-foreground">Observações</dt>
          <dd className={cn(event.description ? "" : "text-muted-foreground")}>{event.description ?? "sem observações"}</dd>
          <dt className="text-sm text-muted-foreground">Fim do evento</dt>
          <dd className="num">{event.finishedAt ? formatDateTime(event.finishedAt) : "—"}</dd>
        </dl>
      )}
    </Step>
  );
}

/* ----------------------------------------------------------------- passo 2 */

/**
 * Taxa do evento (AC#3, doc-005): percentual ou valor fixo, sem teto, retirada **antes** da divisão,
 * com o retido indo para o caller/dono. A frase embaixo do campo é o feedback — ela diz os três
 * números que importam (retém, para quem, sobra) enquanto o caller digita, em vez de um preview
 * separado que ele teria que ir procurar.
 */
function FeeStep({ event, open, hasDraft, onChanged }: { event: EventDto; open: boolean; hasDraft: boolean; onChanged: () => void }) {
  const fieldId = useId();
  const fee = eventFee(event);
  const [type, setType] = useState<EventFee["type"]>(fee.type);
  const [value, setValue] = useState(() => initialFeeText(fee));
  const [busy, setBusy] = useState(false);

  const parsed = type === "percent" ? parsePercentBp(value || "0") : parseSilver(value || "0");
  const pending: EventFee | null = parsed === null ? null : { type, value: BigInt(parsed) };
  const dirty = pending !== null && (pending.type !== fee.type || pending.value !== fee.value);

  async function save() {
    if (!pending) return;
    setBusy(true);
    try {
      await splitsApi.setEventFee(event.id, { type: pending.type, value: pending.value });
      toast.success(`Taxa do evento: ${formatEventFee(pending)}`, { description: `O valor retido vai para ${event.ownerNick ?? "o caller do evento"}.` });
      onChanged();
    } catch (e) {
      toast.error(errorText(e, "Não foi possível salvar a taxa."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Step
      n={2}
      title="Taxa do evento"
      hint={
        hasDraft
          ? "O rascunho abaixo congelou a taxa que estava valendo. Para trocar a taxa, apague ou confirme o rascunho primeiro."
          : `Retirada antes da divisão; o valor retido vai para ${event.ownerNick ?? "o caller do evento"}, junto com a sobra do arredondamento.`
      }
    >
      {open ? (
        <div className="flex flex-wrap items-end gap-3">
          <div role="group" aria-label="Tipo da taxa" className="flex rounded-lg border p-0.5">
            {(["percent", "fixed"] as const).map((t) => (
              <Button
                key={t}
                type="button"
                size="sm"
                variant={type === t ? "secondary" : "ghost"}
                aria-pressed={type === t}
                onClick={() => {
                  setType(t);
                  setValue("");
                }}
              >
                {t === "percent" ? "Porcentagem" : "Valor fixo"}
              </Button>
            ))}
          </div>
          <div className="min-w-40">
            <Label htmlFor={fieldId}>{type === "percent" ? "Percentual retido" : "Prata retida"}</Label>
            <div className="mt-1.5 flex items-center gap-2">
              <Input
                id={fieldId}
                inputMode="decimal"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={type === "percent" ? "10" : "1.000.000"}
                className="num w-40"
                aria-invalid={parsed === null && value.trim() !== ""}
              />
              <span className="text-sm text-muted-foreground">{type === "percent" ? "%" : "de prata"}</span>
            </div>
          </div>
          <Button size="sm" variant="outline" disabled={busy || !dirty} onClick={() => void save()}>
            <Save />
            Salvar taxa
          </Button>
        </div>
      ) : (
        <p className="text-lg font-semibold">{formatEventFee(fee)}</p>
      )}

      {parsed === null && value.trim() !== "" && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {type === "percent" ? "Percentual inválido: use de 0 a 100, com até duas casas (ex: 12,5)." : "Valor inválido: use prata inteira (ex: 1.000.000 ou 1,5M)."}
        </p>
      )}
    </Step>
  );
}

const initialFeeText = (fee: EventFee): string => {
  if (fee.value === 0n) return "";
  return fee.type === "percent" ? formatEventFee(fee).replace("%", "") : formatSilver(fee.value);
};

/* ----------------------------------------------------------------- passo 3 */

function SplitStep({
  event,
  open,
  present,
  draft,
  confirmed,
  onChanged,
}: {
  event: EventDto;
  open: boolean;
  present: SplitPresenceDto[];
  draft: LootSplitDto | null;
  confirmed: LootSplitDto[];
  onChanged: () => void;
}) {
  return (
    <Step
      n={3}
      title="Loot split"
      hint={
        draft
          ? "Ajuste o total e os percentuais. Confirmar credita a prata na carteira de cada um e não volta atrás."
          : "O tempo de call de cada um já está medido desde o fim do evento. Informe o total da leva para dividir."
      }
    >
      <div className="space-y-6">
        {confirmed.map((split, i) => (
          <ConfirmedSplit key={split.id} split={split} index={i + 1} ownerNick={event.ownerNick} />
        ))}
        {draft ? (
          <DraftEditor event={event} split={draft} open={open} onChanged={onChanged} />
        ) : (
          <NewSplit event={event} open={open} present={present} hasConfirmed={confirmed.length > 0} onChanged={onChanged} />
        )}
      </div>
    </Step>
  );
}

/** Sem rascunho: o campo do total é o CTA, e a presença já medida aparece embaixo como prévia. */
function NewSplit({
  event,
  open,
  present,
  hasConfirmed,
  onChanged,
}: {
  event: EventDto;
  open: boolean;
  present: SplitPresenceDto[];
  hasConfirmed: boolean;
  onChanged: () => void;
}) {
  const fieldId = useId();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const fee = eventFee(event);
  const rows = useMemo(() => rowsFromPresence(present), [present]);
  const total = parseSilver(text) ?? 0n;
  const totals = settlementTotals(total, fee, rows);
  // AC#8: taxa fixa maior que o total não chega na API — a frase é a mesma que ela devolveria.
  const blocked = total > 0n && totals.exceedsTotal ? confirmBlockedReason(total, fee, rows) : null;

  async function create() {
    setBusy(true);
    try {
      await splitsApi.createSplit(event.id, total);
      toast.success("Divisão calculada", { description: "Confira os percentuais e o que cada um recebe antes de confirmar." });
      onChanged();
    } catch (e) {
      toast.error(errorText(e, "Não foi possível calcular a divisão."));
    } finally {
      setBusy(false);
    }
  }

  if (present.length === 0)
    return (
      <div className="rounded-xl border border-dashed px-4 py-8 text-center">
        <Users className="mx-auto mb-2 size-5 text-muted-foreground" aria-hidden />
        <p className="font-medium">Ninguém foi medido na call deste evento.</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
          A presença é contada no canal do evento, entre o início e o fim. Sem ninguém lá, não há o que dividir — resta acertar a taxa e arquivar.
        </p>
      </div>
    );

  return (
    <div className="space-y-4">
      {open && (
        <div className="flex flex-wrap items-end gap-3 rounded-xl border bg-muted/40 p-3">
          <div>
            <Label htmlFor={fieldId}>{hasConfirmed ? "Total desta nova leva" : "Total arrecadado na leva"}</Label>
            <Input
              id={fieldId}
              inputMode="numeric"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="10.000.000"
              className="num mt-1.5 w-48 text-lg"
            />
          </div>
          <Button disabled={busy || total <= 0n || blocked !== null} onClick={() => void create()}>
            <Calculator />
            Calcular divisão
          </Button>
          {total > 0n && !blocked && (
            <p className="text-sm text-muted-foreground">
              Retém <Silver value={totals.feeSilver} className="font-medium text-foreground" /> de taxa, divide{" "}
              <Silver value={totals.distributable} className="font-medium text-foreground" />.
            </p>
          )}
        </div>
      )}

      {blocked && (
        <p role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
          <span>{blocked}</span>
        </p>
      )}

      <SettlementTable rows={rows} caption={open ? "Quem esteve na call — a divisão nasce desta lista" : "Quem esteve na call"} />
    </div>
  );
}

/* ------------------------------------------------------------ rascunho */

function DraftEditor({ event, split, open, onChanged }: { event: EventDto; split: LootSplitDto; open: boolean; onChanged: () => void }) {
  const totalId = useId();
  // A taxa do rascunho é a que ele congelou no momento em que nasceu, não a que está no evento agora.
  const fee = feeFromDto(split.fee);
  const [totalText, setTotalText] = useState(() => formatSilver(BigInt(split.totalSilver)));
  const [shares, setShares] = useState<Record<string, number>>(() => Object.fromEntries(split.lines.map((l) => [l.id, l.shareBp])));
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const total = parseSilver(totalText) ?? 0n;
  const base = useMemo(() => rowsFromSplit(split), [split]);
  const edited: SettlementRow[] = base.map((row) => ({ ...row, shareBp: shares[row.lineId!] ?? row.shareBp }));
  const totals = settlementTotals(total, fee, edited);
  const rows = withAmounts(edited, totals.distributable);
  const sum = shareSum(rows);
  const blocked = confirmBlockedReason(total, fee, rows);
  const dirty = total !== BigInt(split.totalSilver) || base.some((row) => rows.find((r) => r.lineId === row.lineId)!.shareBp !== row.shareBp);

  const payload = () => ({ totalSilver: total, lines: rows.map((r) => ({ id: r.lineId!, shareBp: r.shareBp })) });

  async function save(): Promise<boolean> {
    setBusy(true);
    try {
      await splitsApi.updateSplit(event.id, split.id, payload());
      return true;
    } catch (e) {
      toast.error(errorText(e, "Não foi possível salvar o rascunho."));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    setBusy(true);
    try {
      // Salva antes de confirmar: o que o caller está vendo na tela é o que tem que ser creditado.
      if (dirty) await splitsApi.updateSplit(event.id, split.id, payload());
      await splitsApi.confirmSplit(event.id, split.id);
      toast.success("Split confirmado", { description: `A prata caiu na carteira de quem participou. Correção, agora, só por estorno.` });
      setConfirming(false);
      onChanged();
    } catch (e) {
      toast.error(errorText(e, "Não foi possível confirmar o split."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Label htmlFor={totalId}>Total arrecadado na leva</Label>
          <Input
            id={totalId}
            inputMode="numeric"
            disabled={!open}
            value={totalText}
            onChange={(e) => setTotalText(e.target.value)}
            className="num mt-1.5 w-48 text-lg"
          />
        </div>
        <Pill tone={open ? "warning" : "neutral"} icon={<Pencil aria-hidden />}>
          rascunho{dirty ? " · alterado" : ""}
        </Pill>
      </div>

      <SettlementTable
        rows={rows}
        totals={totals}
        ownerNick={event.ownerNick}
        fee={fee}
        onShareChange={open ? (lineId, shareBp) => setShares((s) => ({ ...s, [lineId]: shareBp })) : undefined}
        caption="Participação de cada um nesta leva"
      />

      {/* Rodapé do dinheiro: a soma é o número-chave da tela, e o botão fica do lado dela. */}
      <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t bg-card/95 px-4 pt-3 backdrop-blur">
        <p className="flex items-baseline gap-2">
          <span className={cn("num text-3xl font-semibold", sum.ok ? "text-brand" : "text-foreground")}>{formatShare(sum.sumBp)}</span>
          <span className="text-sm text-muted-foreground">{sum.ok ? "a divisão fecha" : shareSumText(sum)}</span>
        </p>
        {open && (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" disabled={busy || !dirty} onClick={() => void save().then((ok) => ok && (toast.success("Rascunho salvo"), onChanged()))}>
              <Save />
              Salvar rascunho
            </Button>
            <Button disabled={busy || blocked !== null} onClick={() => setConfirming(true)} title={blocked ?? undefined}>
              <Check />
              Confirmar e creditar
            </Button>
          </div>
        )}
      </div>

      {open && blocked && (
        <p role="alert" className="flex items-start gap-2 text-sm text-muted-foreground">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          <span>{blocked}</span>
        </p>
      )}

      {confirming && (
        <ConfirmSplitDialog
          rows={rows}
          totals={totals}
          fee={fee}
          ownerNick={event.ownerNick}
          busy={busy}
          onClose={() => setConfirming(false)}
          onConfirm={() => void confirm()}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------ confirmado */

function ConfirmedSplit({ split, index, ownerNick }: { split: LootSplitDto; index: number; ownerNick: string | null }) {
  const fee = feeFromDto(split.fee);
  const rows = rowsFromSplit(split);
  const totals = {
    total: BigInt(split.totalSilver),
    feeSilver: BigInt(split.feeSilver),
    distributable: BigInt(split.distributableSilver),
    residual: BigInt(split.residualSilver),
    paid: rows.reduce((sum, r) => sum + r.amount, 0n),
    ownerSilver: BigInt(split.feeSilver) + BigInt(split.residualSilver),
    exceedsTotal: false,
  };

  return (
    <div className="rounded-xl border">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/40 px-3 py-2.5">
        <p className="flex items-center gap-2 font-medium">
          <Lock className="size-4 text-success" aria-hidden />
          Leva <span className="num">{index}</span> confirmada
          <span className="num text-sm font-normal text-muted-foreground">{split.confirmedAt ? formatDateTime(split.confirmedAt) : ""}</span>
        </p>
        <Silver value={totals.total} className="text-lg font-semibold" />
      </div>
      <div className="px-3 pb-3">
        <SettlementTable rows={rows} totals={totals} fee={fee} ownerNick={ownerNick} caption={`Leva ${index}: o que cada um recebeu`} />
        <p className="mt-3 flex items-start gap-2 rounded-lg border bg-muted px-3 py-2 text-sm">
          <RotateCcw className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span>
            Lançamentos no ledger são definitivos. Para corrigir esta leva, a staff estorna os lançamentos e você monta uma nova — nada aqui é reescrito.
          </span>
        </p>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- tabela */

/**
 * A tabela do dinheiro. Ela fecha de cima a baixo de propósito: as pessoas, depois a taxa e a sobra
 * (que têm dono e nome), depois o total. Quem confere a conta precisa ver a prata toda em um lugar só.
 */
function SettlementTable({
  rows,
  totals,
  fee,
  ownerNick,
  onShareChange,
  caption,
}: {
  rows: SettlementRow[];
  totals?: ReturnType<typeof settlementTotals>;
  fee?: EventFee;
  ownerNick?: string | null;
  onShareChange?: (lineId: string, shareBp: number) => void;
  caption: string;
}) {
  const owner = ownerNick ?? "o caller do evento";
  return (
    <div className="overflow-hidden rounded-xl border">
      <Table>
        <caption className="sr-only">{caption}</caption>
        <TableHeader>
          <TableRow className="bg-muted/40 hover:bg-muted/40">
            <TableHead className="w-full">Participante</TableHead>
            <TableHead className="text-right">Tempo na call</TableHead>
            <TableHead className="text-right">Participação</TableHead>
            <TableHead className="text-right">Prata</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.key}>
              <TableCell className="w-full whitespace-normal">
                <span className="font-medium">{row.nick}</span>
                {row.roleName && <span className="ml-2 text-xs text-muted-foreground">{row.roleName}</span>}
                <span className="ml-2 inline-flex flex-wrap gap-1.5 align-middle">
                  {!row.signedUp && <Pill tone="warning">apareceu sem inscrição</Pill>}
                  {!row.hasAccount && <Pill tone="neutral">sem conta no painel</Pill>}
                </span>
              </TableCell>
              <TableCell className="num text-right text-muted-foreground">{formatPresence(row.presenceMs)}</TableCell>
              <TableCell className="text-right">
                {onShareChange && row.lineId ? (
                  <ShareInput nick={row.nick} shareBp={row.shareBp} onChange={(bp) => onShareChange(row.lineId!, bp)} />
                ) : (
                  <span className="num font-medium">{formatShare(row.shareBp)}</span>
                )}
              </TableCell>
              <TableCell className="text-right">
                <Silver value={row.amount} className={cn("font-semibold", row.amount === 0n && "text-muted-foreground")} />
              </TableCell>
            </TableRow>
          ))}

          {totals && fee && (
            <>
              <TableRow className="border-t-2">
                <TableCell className="whitespace-normal">
                  <span className="flex items-center gap-1.5 font-medium">
                    <Crown className="size-3.5 text-brand" aria-hidden />
                    Taxa do evento
                  </span>
                  <span className="text-xs text-muted-foreground">{formatEventFee(fee)} retidos antes da divisão, para {owner}</span>
                </TableCell>
                <TableCell />
                <TableCell />
                <TableCell className="text-right">
                  <Silver value={totals.feeSilver} className="font-semibold" />
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="whitespace-normal">
                  <span className="flex items-center gap-1.5 font-medium">
                    <Crown className="size-3.5 text-brand" aria-hidden />
                    Sobra do arredondamento
                  </span>
                  <span className="text-xs text-muted-foreground">prata que não coube em nenhuma divisão exata, também para {owner}</span>
                </TableCell>
                <TableCell />
                <TableCell />
                <TableCell className="text-right">
                  <Silver value={totals.residual} className="font-semibold" />
                </TableCell>
              </TableRow>
              <TableRow className="bg-muted/60 hover:bg-muted/60">
                <TableCell className="font-semibold">Total da leva</TableCell>
                <TableCell />
                <TableCell />
                <TableCell className="text-right">
                  <Silver value={totals.total} className="text-lg font-semibold" />
                </TableCell>
              </TableRow>
            </>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

/** Percentual editável em basis points (0,01%): a granularidade que o caller vê é a que é creditada. */
function ShareInput({ nick, shareBp, onChange }: { nick: string; shareBp: number; onChange: (shareBp: number) => void }) {
  const [text, setText] = useState(() => (shareBp / 100).toString().replace(".", ","));
  const parsed = parsePercentBp(text || "0");

  return (
    <span className="inline-flex items-center gap-1">
      <Input
        aria-label={`Participação de ${nick} em porcentagem`}
        inputMode="decimal"
        value={text}
        aria-invalid={parsed === null}
        onChange={(e) => {
          setText(e.target.value);
          const bp = parsePercentBp(e.target.value || "0");
          if (bp !== null) onChange(bp);
        }}
        className="num h-8 w-20 text-right"
      />
      <span className="text-sm text-muted-foreground">%</span>
    </span>
  );
}

/* ------------------------------------------------------------- diálogo */

/**
 * Última tela antes da prata virar lançamento (AC#7). Mostra o antes-e-depois inteiro, porque é aqui
 * que o caller confere se o que ele digitou virou o que ele queria — e diz, sem rodeio, que não volta.
 */
function ConfirmSplitDialog({
  rows,
  totals,
  fee,
  ownerNick,
  busy,
  onClose,
  onConfirm,
}: {
  rows: SettlementRow[];
  totals: ReturnType<typeof settlementTotals>;
  fee: EventFee;
  ownerNick: string | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const paid = rows.filter((r) => r.amount > 0n);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Confirmar a divisão?</DialogTitle>
          <DialogDescription>
            A prata vira lançamento no extrato de cada um agora. Lançamento não se apaga nem se edita: se algo estiver errado, a correção depois é um estorno feito pela
            staff.
          </DialogDescription>
        </DialogHeader>

        <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-2 rounded-xl border p-3 text-sm">
          <dt>Total bruto da leva</dt>
          <dd>
            <Silver value={totals.total} className="font-semibold" />
          </dd>
          <dt className="text-muted-foreground">Taxa do evento ({formatEventFee(fee)})</dt>
          <dd className="text-muted-foreground">
            <Silver value={-totals.feeSilver} signed />
          </dd>
          <dt className="text-muted-foreground">Sobra do arredondamento</dt>
          <dd className="text-muted-foreground">
            <Silver value={-totals.residual} signed />
          </dd>
          <dt className="border-t pt-2">Dividido entre {paid.length} pessoas</dt>
          <dd className="border-t pt-2">
            <Silver value={totals.paid} className="font-semibold" />
          </dd>
          <dt className="flex items-center gap-1.5">
            <Crown className="size-3.5 text-brand" aria-hidden />
            {ownerNick ?? "Caller do evento"} recebe
          </dt>
          <dd>
            <Silver value={totals.ownerSilver} className="font-semibold" />
          </dd>
        </dl>

        <ul className="max-h-56 divide-y overflow-y-auto rounded-xl border text-sm">
          {paid.map((row) => (
            <li key={row.key} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="min-w-0 truncate">
                {row.nick} <span className="num text-muted-foreground">{formatShare(row.shareBp)}</span>
              </span>
              <Silver value={row.amount} className="font-semibold" />
            </li>
          ))}
          {paid.length === 0 && <li className="px-3 py-2 text-muted-foreground">Ninguém recebe prata nesta leva.</li>}
        </ul>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Voltar
          </Button>
          <Button autoFocus disabled={busy} onClick={onConfirm}>
            <Coins />
            Confirmar e creditar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Aviso de arquivamento bloqueado por rascunho (AC#10): dito antes do clique, não num 409 depois. */
export function DraftBlocksArchiveNote({ className }: { className?: string }) {
  return (
    <p className={cn("flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm", className)}>
      <Archive className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
      <span>Há um loot split em rascunho. Confirme a divisão antes de arquivar — depois de arquivado, essa prata não tem mais como ser distribuída.</span>
    </p>
  );
}
