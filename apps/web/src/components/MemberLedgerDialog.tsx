import { useEffect, useState } from "react";
import { Coins, Loader2, Lock, Receipt, RefreshCw, TriangleAlert, Wallet } from "lucide-react";
import { fetchMemberLedger, type MemberLedgerEntry, type MemberLedgerPage } from "@/api/member-ledger";
import { errorText } from "@/api/http";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, Silver } from "@/components/display";
import { LedgerTable } from "@/components/ledger";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 25;

/**
 * Extrato de um jogador para staff e admin (TASK-051, G10). Abre da linha da lista de membros porque é
 * de lá que a pergunta nasce — "cadê minha prata?" chega com um nome, e a staff já está olhando esse nome.
 *
 * **Leitura apenas.** Ajustar prata continua existindo só no namespace de manutenção (TASK-048, G5): não
 * há nesta janela nenhum botão que escreva no ledger, de propósito.
 */
export function MemberLedgerDialog({ member, onClose }: { member: { id: string; name: string } | null; onClose: () => void }) {
  return (
    <Dialog open={member !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        {member && <MemberLedger key={member.id} member={member} />}
      </DialogContent>
    </Dialog>
  );
}

function MemberLedger({ member }: { member: { id: string; name: string } }) {
  const [page, setPage] = useState<MemberLedgerPage | null>(null);
  const [entries, setEntries] = useState<MemberLedgerEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const [attempt, setAttempt] = useState(0);

  // Primeira página. Trocar de membro remonta o componente inteiro (`key`), então o estado já nasce
  // vazio e não há o que zerar aqui; quem zera é o `retry`, que é o único caminho que reaproveita a tela.
  useEffect(() => {
    let alive = true;
    fetchMemberLedger(member.id, { limit: PAGE_SIZE })
      .then((result) => {
        if (!alive) return;
        setPage(result);
        setEntries(result.entries);
        setError(null);
      })
      .catch((e: unknown) => alive && setError(errorText(e, "Não foi possível carregar o extrato")));
    return () => {
      alive = false;
    };
  }, [member.id, attempt]);

  function retry() {
    setError(null);
    setPage(null);
    setEntries([]);
    setAttempt((n) => n + 1);
  }

  async function loadMore() {
    if (!page?.nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const next = await fetchMemberLedger(member.id, { limit: PAGE_SIZE, cursor: page.nextCursor });
      // Só o cursor e o saldo avançam; os lançamentos já lidos ficam na tela (paginação é acúmulo, não troca).
      setPage(next);
      setEntries((prev) => [...prev, ...next.entries]);
      setError(null);
    } catch (e) {
      setError(errorText(e, "Não foi possível carregar mais lançamentos"));
    } finally {
      setLoadingMore(false);
    }
  }

  const balance = page?.balance;
  const negative = (balance?.balance ?? 0n) < 0n;

  return (
    <>
      <DialogHeader className="shrink-0 border-b px-5 pt-5 pr-12 pb-4 text-left">
        <DialogTitle className="flex items-center gap-2">
          <Receipt className="size-4 text-muted-foreground" aria-hidden />
          Extrato de {member.name}
        </DialogTitle>
        <DialogDescription>Só leitura: cada linha diz de onde veio a prata, quem lançou e por quê. Ajuste de saldo é feito pela manutenção.</DialogDescription>
      </DialogHeader>

      <div className="grid shrink-0 grid-cols-3 divide-x border-b">
        <Figure
          label="Disponível"
          icon={<Coins />}
          emphasis
          value={balance ? <Silver value={balance.available} className={cn(negative && "text-destructive")} /> : <Skeleton className="h-6 w-24" />}
        />
        <Figure label="Reservado" icon={<Lock />} value={balance ? <Silver value={balance.reserved} /> : <Skeleton className="h-6 w-20" />} hint="Em análise" />
        <Figure label="Saldo total" icon={<Wallet />} value={balance ? <Silver value={balance.balance} /> : <Skeleton className="h-6 w-20" />} />
      </div>

      {negative && (
        <p role="alert" className="flex items-start gap-2 border-b border-destructive/40 bg-destructive/10 px-5 py-2.5 text-xs">
          <TriangleAlert className="mt-px size-3.5 shrink-0 text-destructive" aria-hidden />
          Saldo negativo: um estorno passou do que a pessoa tinha. Saques ficam bloqueados até voltar a zero.
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {error && entries.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <p role="alert" className="mb-3 text-sm text-destructive">
              {error}
            </p>
            <Button variant="outline" size="sm" onClick={retry}>
              <RefreshCw />
              Tentar de novo
            </Button>
          </div>
        ) : !page ? (
          <StatementSkeleton />
        ) : entries.length === 0 ? (
          <div className="p-5">
            <EmptyState
              icon={<Receipt />}
              title="Nenhum lançamento ainda."
              description={`${member.name} ainda não recebeu prata de nenhum loot split, nem teve ajuste ou saque. Não é um erro: a conta existe e está zerada.`}
            />
          </div>
        ) : (
          <>
            <LedgerTable entries={entries} showAuthor />
            {error && (
              <p role="alert" className="border-t border-destructive/40 bg-destructive/10 px-5 py-2.5 text-xs text-destructive">
                {error}
              </p>
            )}
          </>
        )}
      </div>

      {page && entries.length > 0 && (
        <div className="flex items-center justify-between gap-3 border-t px-5 py-3 text-xs text-muted-foreground">
          <span className="num">
            {entries.length} {entries.length === 1 ? "lançamento" : "lançamentos"}
            {page.nextCursor ? " carregados" : " no total"}
          </span>
          {page.nextCursor && (
            <Button variant="outline" size="sm" className="press" onClick={() => void loadMore()} disabled={loadingMore}>
              {loadingMore ? <Loader2 className="animate-spin" /> : null}
              {loadingMore ? "Carregando…" : "Carregar mais"}
            </Button>
          )}
        </div>
      )}
    </>
  );
}

/** Número do cabeçalho: rótulo curto, valor grande, dica só quando ela responde alguma coisa. */
function Figure({ label, icon, value, hint, emphasis }: { label: string; icon: React.ReactNode; value: React.ReactNode; hint?: string; emphasis?: boolean }) {
  return (
    <div className={cn("px-4 py-3", emphasis && "bg-muted/40")}>
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground [&_svg]:size-3.5">
        {icon}
        {label}
      </p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
      {hint && <p className="mt-0.5 truncate text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function StatementSkeleton() {
  return (
    <div className="divide-y" aria-busy>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="flex items-center justify-between gap-6 px-5 py-3.5">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-4 w-20" />
        </div>
      ))}
    </div>
  );
}
