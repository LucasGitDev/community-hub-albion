import { useCallback, type ReactNode } from "react";
import { Link } from "react-router";
import { ArrowDownLeft, ArrowUpRight, CalendarDays, Check, Coins, Lock, Receipt, RefreshCw, RotateCcw, Scissors, SlidersHorizontal, Swords, TriangleAlert } from "lucide-react";
import { LEDGER_ENTRY_KIND_LABELS, type LedgerEntryKind } from "@albion-hub/shared";
import { usePoll } from "@/api/use-poll";
import { useWallet } from "@/api/WalletProvider";
import { fetchMyStatement, type LedgerEntry, type Statement } from "@/api/wallet";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader, Panel, Pill, Silver, StatCard, StatusBadge, type Tone } from "@/components/display";
import { WithdrawDialog } from "@/components/WithdrawDialog";
import { ErrorState } from "@/pages/MyWithdrawals";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/format";
import { lastSplit, monthEarnings } from "@/lib/wallet";
import { useMyNick } from "@/nick/api";

const monthFmt = new Intl.DateTimeFormat("pt-BR", { month: "long" });

/**
 * Carteira do membro (TASK-031, Q3/Q10): saldo, o que está reservado em saques pendentes e o extrato
 * real do ledger. Tudo vem da API — saldo e saques de `/api/me/withdrawals` (via `WalletProvider`) e o
 * extrato de `/api/me/ledger`, ambos amarrados à sessão (AC#2).
 *
 * Saldo negativo é permitido (estorno depois de um saque) e bloqueia pedido novo (Q24); reserva é só o
 * que está `pending`, porque a partir de `approved` o débito já está no ledger (Q25).
 */
export function Wallet() {
  const { balance, withdrawals, loading, error, refresh } = useWallet();
  const load = useCallback(() => fetchMyStatement(), []);
  const statement = usePoll<Statement>(load, "Não foi possível carregar o extrato.");

  const entries = statement.data?.entries ?? [];
  const open = withdrawals.filter((w) => w.status === "pending" || w.status === "approved");
  const pendingCount = withdrawals.filter((w) => w.status === "pending").length;

  const now = new Date();
  const month = monthEarnings(entries, now);
  const last = lastSplit(entries);
  const total = balance?.balance ?? 0n;
  const reserved = balance?.reserved ?? 0n;
  const available = balance?.available ?? 0n;
  const negative = total < 0n;
  const canWithdraw = !!balance && !negative && available > 0n;
  const ready = !!balance && statement.data !== null;

  const reloadAll = () => {
    refresh();
    statement.refresh();
  };

  if (error) return <WalletError message={error} onRetry={reloadAll} />;

  return (
    <>
      <PageHeader
        title="Carteira"
        description="Sua prata dos loot splits da comunidade. Cada evento vira uma linha no extrato."
        action={
          <>
            <Button variant="outline" asChild>
              <Link to="/saques">Meus saques</Link>
            </Button>
            <WithdrawDialog
              trigger={
                <Button disabled={!canWithdraw}>
                  <ArrowUpRight />
                  Pedir saque
                </Button>
              }
            />
          </>
        }
      />

      {negative && (
        <p role="alert" className="mb-4 flex items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
          Seu saldo ficou negativo por um estorno. Novos saques ficam bloqueados até ele voltar a zero (fale com a staff para acertar a conta).
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard
          emphasis
          labelId="balance-label"
          label="Disponível pra saque"
          icon={<Coins />}
          className="col-span-2 xl:col-span-1"
          value={balance ? <Silver value={available} className={negative ? "text-destructive" : undefined} /> : <Skeleton className="h-8 w-40" />}
          hint={
            !balance ? (
              " "
            ) : negative ? (
              "Saques bloqueados até o saldo voltar a zero"
            ) : (
              <>
                Saldo total <Silver value={total} className="text-foreground" />
                {reserved > 0n && " (reserva já descontada)"}
              </>
            )
          }
        />
        <StatCard
          label="Reservado em saques"
          icon={<Lock />}
          value={balance ? <Silver value={reserved} /> : <Skeleton className="h-7 w-28" />}
          hint={pendingCount === 0 ? "Nenhum saque em análise" : `${pendingCount} ${pendingCount === 1 ? "saque em análise" : "saques em análise"}`}
        />
        <StatCard
          label={`Ganhos em ${monthFmt.format(now)}`}
          icon={<CalendarDays />}
          value={statement.data ? <Silver value={month.total} signed={month.total > 0n} className={month.total > 0n ? "text-success" : undefined} /> : <Skeleton className="h-7 w-28" />}
          hint={month.splits === 0 ? "Nenhum split neste mês ainda" : `${month.splits} ${month.splits === 1 ? "split recebido" : "splits recebidos"}`}
        />
        <StatCard
          label="Último split"
          className="col-span-2 xl:col-span-1"
          icon={<Swords />}
          value={!statement.data ? <Skeleton className="h-7 w-28" /> : last ? <Silver value={last.amount} signed /> : <span className="text-muted-foreground">—</span>}
          hint={last ? <span className="block truncate">{formatDateTime(last.createdAt)}</span> : "Participe de um evento pra receber"}
        />
      </div>

      {ready && <ReservedBar total={total} reserved={reserved} />}

      <div className="mt-4 grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Panel
          title="Extrato"
          titleId="extrato"
          action={
            <span className="flex items-center gap-3">
              {entries.length > 0 && <span className="num text-xs text-muted-foreground">{entries.length} lançamentos</span>}
              <button onClick={reloadAll} className="press rounded-md p-1 text-muted-foreground hover:text-foreground" aria-label="Atualizar extrato">
                <RefreshCw className="size-4" />
              </button>
            </span>
          }
        >
          {statement.error && !statement.data ? (
            <div className="p-4">
              <ErrorState message={statement.error} onRetry={statement.refresh} />
            </div>
          ) : !statement.data || loading ? (
            <StatementSkeleton />
          ) : entries.length > 0 ? (
            <Statement entries={entries} hasMore={!!statement.data.nextCursor} />
          ) : (
            <FirstSteps />
          )}
        </Panel>

        <div className="grid gap-4">
          <Panel
            title="Saques em andamento"
            action={
              <Link to="/saques" className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
                Ver todos
              </Link>
            }
          >
            {open.length === 0 ? (
              <p className="px-4 py-5 text-sm text-muted-foreground">
                {canWithdraw ? "Nenhum saque aberto. Seu disponível já pode ser sacado." : "Nenhum saque aberto."}
              </p>
            ) : (
              <ul className="divide-y">
                {open.map((w) => (
                  <li key={w.id} className="flex flex-col gap-1.5 px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <Silver value={w.amount} className="text-lg font-semibold" />
                      <StatusBadge status={w.status} />
                    </div>
                    <span className="text-xs text-muted-foreground">Pedido em {formatDateTime(w.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <WithdrawalSummary />
        </div>
      </div>
    </>
  );
}

function WalletError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <>
      <PageHeader title="Carteira" description="Sua prata dos loot splits da comunidade." />
      <ErrorState message={message} onRetry={onRetry} />
    </>
  );
}

function StatementSkeleton() {
  return (
    <div className="divide-y" aria-busy>
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="flex items-center justify-between gap-6 px-4 py-4">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-4 w-24" />
        </div>
      ))}
    </div>
  );
}

/** Histórico de saques em números: dá contexto ao "Pedir saque" sem abrir outra tela. */
function WithdrawalSummary() {
  const { withdrawals } = useWallet();
  const settled = withdrawals.filter((w) => w.status === "settled");
  if (withdrawals.length === 0) return null;
  const rows: { label: string; value: ReactNode }[] = [
    { label: "Pedidos", value: <span className="num">{withdrawals.length}</span> },
    { label: "Entregues", value: <span className="num">{settled.length}</span> },
    { label: "Recusados", value: <span className="num">{withdrawals.filter((w) => w.status === "rejected").length}</span> },
    { label: "Prata já sacada", value: <Silver value={settled.reduce((s, w) => s + w.amount, 0n)} /> },
  ];
  return (
    <Panel title="Histórico de saques">
      <dl className="divide-y text-sm">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between px-4 py-2.5">
            <dt className="text-muted-foreground">{r.label}</dt>
            <dd className="font-semibold">{r.value}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}

/** Barra disponível vs reservado: mostra de onde vem a diferença entre total e disponível. */
function ReservedBar({ total, reserved }: { total: bigint; reserved: bigint }) {
  if (total <= 0n || reserved <= 0n) return null;
  const reservedPermille = Number((reserved * 1000n) / total);
  return (
    <div className="mt-3 flex items-center gap-3 rounded-xl border bg-card px-4 py-3 text-xs text-muted-foreground" aria-hidden>
      <span className="shrink-0">Disponível</span>
      <div className="flex h-2 flex-1 overflow-hidden rounded-full bg-muted">
        <div className="bg-foreground/80" style={{ width: `${100 - reservedPermille / 10}%` }} />
        <div className="bg-warning" style={{ width: `${reservedPermille / 10}%` }} />
      </div>
      <span className="shrink-0">Reservado {Math.round(reservedPermille / 10)}%</span>
    </div>
  );
}

/** Origem do lançamento (AC#1): ícone + rótulo PT-BR + tom, nunca só cor. */
const kindMeta: Record<LedgerEntryKind, { icon: ReactNode; tone: Tone }> = {
  split_payout: { icon: <ArrowDownLeft />, tone: "neutral" },
  split_fee: { icon: <Scissors />, tone: "neutral" },
  withdrawal: { icon: <ArrowUpRight />, tone: "info" },
  reversal: { icon: <RotateCcw />, tone: "destructive" },
  adjustment: { icon: <SlidersHorizontal />, tone: "warning" },
};

function Statement({ entries, hasMore }: { entries: LedgerEntry[]; hasMore: boolean }) {
  const reversed = new Set(entries.map((e) => e.reversalOf).filter((id): id is string => !!id));
  return (
    <>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="hidden sm:table-cell">Data</TableHead>
            <TableHead>Lançamento</TableHead>
            <TableHead className="hidden md:table-cell">Origem</TableHead>
            <TableHead className="text-right">Valor</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.map((e) => {
            const isReversed = reversed.has(e.id);
            const meta = kindMeta[e.kind];
            const label = LEDGER_ENTRY_KIND_LABELS[e.kind];
            return (
              <TableRow key={e.id}>
                <TableCell className="num hidden text-sm text-muted-foreground sm:table-cell">{formatDateTime(e.createdAt)}</TableCell>
                <TableCell className="w-full max-w-0 whitespace-normal">
                  <p className={cn("truncate font-medium", isReversed && "text-muted-foreground line-through")}>{e.memo ?? label}</p>
                  <p className={cn("truncate text-xs", e.kind === "reversal" ? "text-destructive" : "text-muted-foreground")}>
                    <span className="sm:hidden">{formatDateTime(e.createdAt)} · </span>
                    {e.memo ? label : "Sem descrição"}
                    {isReversed && " · estornado depois"}
                  </p>
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  <Pill tone={meta.tone} icon={meta.icon}>
                    {label}
                  </Pill>
                </TableCell>
                <TableCell className="text-right">
                  <Silver
                    value={e.amount}
                    signed
                    className={cn("font-semibold", isReversed ? "text-muted-foreground line-through" : e.amount > 0n ? "text-success" : "text-foreground")}
                  />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {hasMore && (
        <p className="border-t px-4 py-3 text-xs text-muted-foreground">
          Mostrando os 50 lançamentos mais recentes. Peça o histórico completo à staff.
        </p>
      )}
    </>
  );
}

/**
 * Estado vazio com um próximo passo (revenue-centric-design, "Never ship a blank dashboard"):
 * checklist com progresso já começado (conta ativada conta como feito) e um único CTA por passo.
 */
function FirstSteps() {
  const { state } = useMyNick();
  const nick = state.status === "ready" ? state.data : null;
  const nickStep = nick?.gameNick
    ? { done: true, title: "Nick aprovado", detail: `A staff aprovou ${nick.gameNick}.` }
    : nick?.pending
      ? { done: false, title: "Nick aguardando a staff", detail: `${nick.pending.nick} está em análise.`, link: { to: "/perfil", label: "Ver solicitação" } }
      : { done: false, title: "Registre seu nick do Albion", detail: "A staff confere o nick do personagem pra liberar sua entrada.", link: { to: "/perfil", label: "Registrar nick" } };
  const steps: { done: boolean; title: string; detail: string; link?: { to: string; label: string } }[] = [
    { done: true, title: "Conta ativada", detail: "Você entrou com o Discord e já pode receber prata." },
    nickStep,
    { done: false, title: "Participe de um evento com loot split", detail: "Entre na call do evento pelo Discord quando o caller chamar. Seu tempo na call define sua parte." },
    { done: false, title: "Receba sua parte aqui", detail: "Quando a staff confirmar a divisão, o valor aparece neste extrato e pode ser sacado." },
  ];
  const done = steps.filter((s) => s.done).length;
  return (
    <div className="p-4">
      <div className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
        <Receipt className="size-4" aria-hidden />
        Seu extrato ainda não tem lançamento nenhum.
      </div>
      <div className="mb-4 flex items-center gap-3">
        <Progress value={(done / steps.length) * 100} className="h-2 flex-1" aria-label="Progresso até a primeira prata" />
        <span className="num text-xs text-muted-foreground">
          {done} de {steps.length}
        </span>
      </div>
      <ol className="space-y-1" aria-label="Como receber sua primeira prata">
        {steps.map((step, i) => (
          <li key={step.title} className={cn("flex gap-3 rounded-lg p-3", !step.done && step.link && "bg-muted")}>
            <span
              className={cn(
                "num grid size-6 shrink-0 place-items-center rounded-full border text-xs font-semibold",
                step.done ? "border-success bg-success text-background" : "text-muted-foreground",
              )}
              aria-hidden
            >
              {step.done ? <Check className="size-3.5" strokeWidth={3} /> : i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className={cn("font-medium", step.done && "text-muted-foreground")}>
                {step.title}
                {step.done && <span className="sr-only"> (feito)</span>}
              </p>
              <p className="text-sm text-muted-foreground">{step.detail}</p>
            </div>
            {step.link && (
              <Button size="sm" asChild className="self-center">
                <Link to={step.link.to}>{step.link.label}</Link>
              </Button>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
