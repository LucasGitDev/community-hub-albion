import type { ReactNode } from "react";
import { ArrowDownLeft, ArrowUpRight, RotateCcw, Scissors, SlidersHorizontal, Wrench } from "lucide-react";
import { CURRENCY_LABELS, describeLedgerAuthor, isMaintenanceLedgerEntry, LEDGER_ENTRY_KIND_LABELS, LEDGER_CURRENCY_FILTERS, type Currency, type LedgerCurrencyFilter, type LedgerEntryKind, type MemberLedgerEntryDto } from "@albion-hub/shared";
import { Pill, Amount, type Tone } from "@/components/display";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Origem do lançamento: ícone + rótulo PT-BR + tom, nunca só cor. */
const LEDGER_KIND_META: Record<LedgerEntryKind, { icon: ReactNode; tone: Tone }> = {
  split_payout: { icon: <ArrowDownLeft />, tone: "neutral" },
  split_fee: { icon: <Scissors />, tone: "neutral" },
  withdrawal: { icon: <ArrowUpRight />, tone: "info" },
  reversal: { icon: <RotateCcw />, tone: "destructive" },
  adjustment: { icon: <SlidersHorizontal />, tone: "warning" },
};

/** O mínimo que a tabela precisa saber de um lançamento. Valor é bigint: nunca `number` (Q20). */
export interface LedgerRow extends Omit<MemberLedgerEntryDto, "amount" | "author"> {
  amount: bigint;
  author?: MemberLedgerEntryDto["author"];
}

/**
 * Tabela do extrato (TASK-031/TASK-051). Uma só, porque a carteira do membro e o extrato que a staff
 * abre para responder "cadê minha prata" precisam dizer a mesma coisa da mesma forma — duas tabelas
 * divergiriam na primeira mudança e a conversa entre staff e membro passaria a ter duas versões.
 *
 * `showAuthor` é a única diferença: quem lê o próprio extrato não pergunta quem lançou.
 */
export function LedgerTable({ entries, showAuthor = false }: { entries: LedgerRow[]; showAuthor?: boolean }) {
  // Estorno lançado na mesma página: risca o original em vez de deixar duas linhas que parecem contradição.
  const reversed = new Set(entries.map((e) => e.reversalOf).filter((id): id is string => !!id));
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="hidden sm:table-cell">Data</TableHead>
          <TableHead>Lançamento</TableHead>
          <TableHead className="hidden sm:table-cell">Moeda</TableHead>
          <TableHead className="hidden md:table-cell">Origem</TableHead>
          {showAuthor && <TableHead className="hidden lg:table-cell">Autor</TableHead>}
          <TableHead className="text-right">Valor</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map((e) => {
          const isReversed = reversed.has(e.id);
          const meta = LEDGER_KIND_META[e.kind];
          const label = LEDGER_ENTRY_KIND_LABELS[e.kind];
          const maintenance = isMaintenanceLedgerEntry(e);
          // Só faz sentido com `author` presente; a carteira do membro não passa a coluna e nem o texto.
          const author = showAuthor ? describeLedgerAuthor({ ...e, amount: "0", author: e.author ?? null }) : null;
          return (
            <TableRow key={e.id}>
              <TableCell className="num hidden text-sm text-muted-foreground sm:table-cell">{formatDateTime(e.createdAt)}</TableCell>
              <TableCell className="w-full max-w-0 whitespace-normal">
                {/* O motivo é justamente o que alguém vai questionar: deixa quebrar em duas linhas em vez de cortar. */}
                <p className={cn("line-clamp-2 font-medium break-words", isReversed && "text-muted-foreground line-through")}>{e.memo ?? label}</p>
                <p className={cn("text-xs break-words", e.kind === "reversal" ? "text-destructive" : "text-muted-foreground")}>
                  <span className="sm:hidden">{formatDateTime(e.createdAt)} · </span>
                  {e.memo ? label : "Sem descrição"}
                  {/* No celular as colunas Moeda e Autor não existem: descem pra cá em vez de sumir. */}
                  <span className="sm:hidden"> · {CURRENCY_LABELS[e.currency]}</span>
                  {author && <span className="lg:hidden"> · {author}</span>}
                  {isReversed && " · estornado depois"}
                </p>
              </TableCell>
              {/* A moeda é coluna própria, não só a cor do número: cor sozinha não é rótulo (F6-27). */}
              <TableCell className="hidden sm:table-cell">
                <CurrencyTag currency={e.currency} />
              </TableCell>
              <TableCell className="hidden md:table-cell">
                <Pill tone={maintenance ? "warning" : meta.tone} icon={maintenance ? <Wrench /> : meta.icon}>
                  {maintenance ? "Ajuste da manutenção" : label}
                </Pill>
              </TableCell>
              {showAuthor && (
                <TableCell className="hidden max-w-[9rem] truncate text-sm lg:table-cell">
                  <span className={cn(e.author ? "text-foreground" : "text-muted-foreground")}>{author}</span>
                </TableCell>
              )}
              <TableCell className="text-right">
                <Amount
                  value={e.amount}
                  currency={e.currency}
                  signed
                  className={cn(
                    "font-semibold",
                    isReversed
                      ? "text-muted-foreground line-through"
                      : e.currency === "buffunfa"
                        ? "text-brand"
                        : e.amount > 0n
                          ? "text-success"
                          : "text-foreground",
                  )}
                />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

/** Rótulo da moeda da linha. Buffunfa leva o ouro do `--brand` (doc-009); prata fica neutra. */
export function CurrencyTag({ currency }: { currency: Currency }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 w-fit shrink-0 items-center rounded-full border px-2 text-xs font-medium whitespace-nowrap",
        currency === "buffunfa" ? "border-brand/40 bg-brand/10 text-brand" : "border-border bg-muted text-muted-foreground",
      )}
    >
      {CURRENCY_LABELS[currency]}
    </span>
  );
}

const FILTER_LABELS: Record<LedgerCurrencyFilter, string> = { all: "Todas", silver: CURRENCY_LABELS.silver, buffunfa: CURRENCY_LABELS.buffunfa };

/**
 * Filtro de moeda do extrato (F6-27). É **um** extrato com recorte, não duas telas: o default é "Todas"
 * porque a ordem cronológica das duas juntas é o que conta a história — pagou 20 na inscrição, recebeu 15
 * no fim, e a prata do split no meio.
 *
 * Sem animação de propósito: é um controle de uso repetido, e movimento aqui só atrasaria a leitura.
 */
export function CurrencyFilterTabs({ value, onChange }: { value: LedgerCurrencyFilter; onChange: (next: LedgerCurrencyFilter) => void }) {
  return (
    <div role="group" aria-label="Filtrar extrato por moeda" className="flex items-center gap-1 rounded-full border bg-muted/50 p-0.5">
      {LEDGER_CURRENCY_FILTERS.map((filter) => {
        const active = filter === value;
        return (
          <button
            key={filter}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(filter)}
            className={cn(
              "press rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
              active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              active && filter === "buffunfa" && "text-brand",
            )}
          >
            {FILTER_LABELS[filter]}
          </button>
        );
      })}
    </div>
  );
}
