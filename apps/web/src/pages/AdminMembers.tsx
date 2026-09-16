import { useCallback, useEffect, useState } from "react";
import { Check, CircleDashed, CloudOff, Download, Search, UserRoundX, Users } from "lucide-react";
import { toast } from "sonner";
import {
  describeAlbionCheck,
  MEMBER_FILTER_LABELS,
  MEMBER_FILTERS,
  memberPageCount,
  ROLE_LABELS,
  type AlbionCheckKind,
  type MemberFilter,
} from "@albion-hub/shared";
import { fetchAdminMembers, importDiscordMembers, type AdminMember, type AdminMembersPage, type MemberImportSummary } from "@/api/members";
import { errorText } from "@/api/http";
import { usePoll } from "@/api/use-poll";
import { EmptyState, PageHeader, Panel, Pill, StatCard, type Tone } from "@/components/display";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Estado do Albion: ícone + texto + cor, nunca só cor (o admin daltônico lê a pílula igual). */
const albionMeta: Record<AlbionCheckKind, { tone: Tone; icon: React.ReactNode }> = {
  found: { tone: "success", icon: <Check strokeWidth={2.5} /> },
  not_found: { tone: "destructive", icon: <UserRoundX strokeWidth={2.25} /> },
  unavailable: { tone: "warning", icon: <CloudOff strokeWidth={2.25} /> },
  unchecked: { tone: "neutral", icon: <CircleDashed strokeWidth={2.25} /> },
};

/** Espera o admin parar de digitar antes de ir ao servidor: busca por letra é requisição jogada fora. */
function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/**
 * Lista de membros do painel para o admin (TASK-043).
 *
 * A tela responde a uma pergunta: quem está no painel e de quem o nick não bate com o Albion. Por isso o número
 * em destaque é o total de membros, os outros dois cartões são os problemas acionáveis, e a única ação primária
 * é importar do Discord. Servidor é a autoridade: busca, filtro e paginação vão na query, nada é filtrado aqui.
 */
export function AdminMembers() {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<MemberFilter>("todos");
  const [page, setPage] = useState(1);
  const [importing, setImporting] = useState(false);
  const [summary, setSummary] = useState<MemberImportSummary | null>(null);
  const debouncedSearch = useDebounced(search);

  // Trocar busca ou filtro volta pra primeira página: página 3 de um resultado com 2 páginas é uma tela vazia.
  useEffect(() => setPage(1), [debouncedSearch, filter]);

  const load = useCallback(() => fetchAdminMembers({ search: debouncedSearch, filter, page }), [debouncedSearch, filter, page]);
  const { data, error, loading, refresh } = usePoll<AdminMembersPage>(load, "Erro ao carregar os membros");

  async function runImport() {
    setImporting(true);
    const toastId = toast.loading("Importando membros do Discord…");
    try {
      const result = await importDiscordMembers();
      toast.success(`${result.created} criados, ${result.updated} atualizados`, {
        id: toastId,
        description: `${result.skipped} ignorados, ${result.conflicts.length} conflitos.`,
      });
      setSummary(result);
      refresh();
    } catch (e) {
      toast.error(errorText(e, "Não foi possível importar os membros"), { id: toastId, duration: 10_000 });
    } finally {
      setImporting(false);
    }
  }

  const counts = data?.counts ?? { todos: 0, nao_encontrados: 0, sem_nick: 0 };
  const pageCount = data ? memberPageCount(data.total, data.pageSize) : 1;

  return (
    <>
      <PageHeader
        title="Membros"
        description="Quem já tem conta no painel, com o nick conferido na API do Albion. Importar traz de novo quem tem cargo Membro e apelido no Discord."
        action={
          <Button onClick={() => void runImport()} disabled={importing}>
            <Download />
            {importing ? "Importando…" : "Importar membros do Discord"}
          </Button>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard
          emphasis
          label="Membros no painel"
          labelId="stat-membros"
          icon={<Users />}
          value={counts.todos}
          hint={data ? `${counts.todos - counts.sem_nick} com nick registrado` : "Carregando…"}
          className="col-span-2 lg:col-span-1"
        />
        <StatCard label="Não encontrados no Albion" icon={<UserRoundX />} value={counts.nao_encontrados} hint="Nick provavelmente errado: confira com a pessoa." />
        <StatCard label="Sem nick" icon={<CircleDashed />} value={counts.sem_nick} hint="Ainda não registrou o nick do personagem." />
      </div>

      <Panel title="Lista de membros" titleId="lista-membros" className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b px-3 py-3">
          <div className="relative min-w-0 flex-1 basis-56">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nick ou usuário do Discord"
              aria-label="Buscar por nick ou usuário do Discord"
              className="pl-9"
            />
          </div>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar membros">
            {MEMBER_FILTERS.map((key) => {
              const on = filter === key;
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setFilter(key)}
                  className={cn(
                    "press inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm font-medium",
                    on ? "border-foreground bg-foreground text-background" : "text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  {MEMBER_FILTER_LABELS[key]}
                  <span className={cn("num text-xs", on ? "opacity-70" : "opacity-60")}>{counts[key]}</span>
                </button>
              );
            })}
          </div>
        </div>

        {error && (
          <p role="alert" className="border-b border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
            {error}
          </p>
        )}

        {loading && <p className="px-4 py-6 text-sm text-muted-foreground">Carregando membros…</p>}

        {data && data.members.length === 0 && (
          <div className="p-4">
            <EmptyState
              icon={<Users />}
              title={search || filter !== "todos" ? "Nenhum membro com esse filtro." : "Nenhum membro no painel ainda."}
              description={
                search || filter !== "todos"
                  ? "Troque o filtro ou limpe a busca para ver a lista inteira."
                  : "Importe do Discord para trazer quem já tem cargo Membro e apelido no servidor."
              }
              action={
                search || filter !== "todos" ? (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setSearch("");
                      setFilter("todos");
                    }}
                  >
                    Limpar filtros
                  </Button>
                ) : (
                  <Button onClick={() => void runImport()} disabled={importing}>
                    <Download />
                    Importar membros do Discord
                  </Button>
                )
              }
            />
          </div>
        )}

        {data && data.members.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Membro</TableHead>
                <TableHead className="hidden md:table-cell">Guilda</TableHead>
                <TableHead>Papéis</TableHead>
                <TableHead className="hidden lg:table-cell">Entrou</TableHead>
                <TableHead>Albion</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.members.map((m) => (
                <MemberRow key={m.id} member={m} />
              ))}
            </TableBody>
          </Table>
        )}

        {data && data.total > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-sm text-muted-foreground">
            <p>
              <span className="num font-medium text-foreground">{data.total}</span> {data.total === 1 ? "membro" : "membros"} · página{" "}
              <span className="num">{data.page}</span> de <span className="num">{pageCount}</span>
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={data.page <= 1} onClick={() => setPage((p) => p - 1)}>
                Anterior
              </Button>
              <Button variant="outline" size="sm" disabled={data.page >= pageCount} onClick={() => setPage((p) => p + 1)}>
                Próxima
              </Button>
            </div>
          </div>
        )}
      </Panel>

      <ImportSummaryDialog summary={summary} onClose={() => setSummary(null)} />
    </>
  );
}

function MemberRow({ member }: { member: AdminMember }) {
  const name = member.gameNick || member.displayName || member.discordUsername;
  const albion = describeAlbionCheck({ status: member.albion.status, guildName: member.albion.guildName, checkedAt: member.albion.checkedAt });
  const meta = albionMeta[albion.kind];

  return (
    <TableRow>
      <TableCell className="max-w-[14rem] min-w-0">
        <p className="truncate font-medium">{name}</p>
        <p className="truncate text-xs text-muted-foreground">
          @{member.discordUsername}
          <span className="md:hidden">{member.guildTag ? ` · [${member.guildTag}]` : ""}</span>
        </p>
      </TableCell>
      <TableCell className="hidden md:table-cell">
        {member.guildTag ? <span className="num text-xs font-medium">[{member.guildTag}]</span> : <span className="text-xs text-muted-foreground">—</span>}
      </TableCell>
      <TableCell className="text-xs">{member.roles.map((r) => ROLE_LABELS[r]).join(", ") || "—"}</TableCell>
      <TableCell className="hidden text-xs text-muted-foreground lg:table-cell">{formatDateTime(member.createdAt)}</TableCell>
      <TableCell>
        <Pill tone={meta.tone} icon={meta.icon}>
          {albion.label}
        </Pill>
        {albion.detail && <p className="mt-0.5 truncate text-xs text-muted-foreground">{albion.detail}</p>}
      </TableCell>
    </TableRow>
  );
}

/** Resumo do import: o toast dá o número, o diálogo dá os conflitos (lista longa não cabe num toast). */
function ImportSummaryDialog({ summary, onClose }: { summary: MemberImportSummary | null; onClose: () => void }) {
  return (
    <Dialog open={summary !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Importação concluída</DialogTitle>
          <DialogDescription>Quem já tinha nick aprovado no painel não foi alterado.</DialogDescription>
        </DialogHeader>
        {summary && (
          <div className="space-y-4">
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ["Criados", summary.created],
                ["Atualizados", summary.updated],
                ["Ignorados", summary.skipped],
                ["Conflitos", summary.conflicts.length],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg border px-3 py-2">
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="num text-lg font-semibold">{value}</dd>
                </div>
              ))}
            </dl>
            {summary.albion.disabled > 0 ? (
              <p className="text-sm text-muted-foreground">Conferência no Albion desligada: nenhum nick foi verificado.</p>
            ) : (
              <p className="text-sm text-muted-foreground">
                Albion: {summary.albion.found} encontrados, {summary.albion.notFound} não encontrados, {summary.albion.unavailable} sem resposta da API.
              </p>
            )}
            {summary.conflicts.length > 0 && (
              <div>
                <p className="mb-2 text-sm font-medium">Apelidos que não viraram nick (ninguém foi alterado):</p>
                <ul className="max-h-48 space-y-1 overflow-y-auto text-sm text-muted-foreground">
                  {summary.conflicts.map((conflict) => (
                    <li key={conflict} className="border-l-2 pl-3">
                      {conflict.replaceAll("`", "")}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <Button onClick={onClose}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
