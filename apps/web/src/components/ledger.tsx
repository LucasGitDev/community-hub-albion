import type { ReactNode } from "react";
import { ArrowDownLeft, ArrowUpRight, RotateCcw, Scissors, SlidersHorizontal, Wrench } from "lucide-react";
import { describeLedgerAuthor, isMaintenanceLedgerEntry, LEDGER_ENTRY_KIND_LABELS, type LedgerEntryKind, type MemberLedgerEntryDto } from "@albion-hub/shared";
import { Pill, Silver, type Tone } from "@/components/display";
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

/** O mínimo que a tabela precisa saber de um lançamento. Prata é bigint: nunca `number` (Q20). */
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
                  {/* No celular a coluna Autor não existe: o nome desce pra cá em vez de sumir. */}
                  {author && <span className="lg:hidden"> · {author}</span>}
                  {isReversed && " · estornado depois"}
                </p>
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
  );
}
