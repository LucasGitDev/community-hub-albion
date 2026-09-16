import { useCallback, useEffect, useState } from "react";
import { Check, CircleDashed, CloudOff, Download, Loader2, RefreshCw, Search, SlidersHorizontal, UserRoundX, Users } from "lucide-react";
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
import { checkMemberAlbion, fetchAdminMembers, importDiscordMembers, type AdminMember, type AdminMembersPage, type MemberImportSummary } from "@/api/members";
import { errorText } from "@/api/http";
import { usePoll } from "@/api/use-poll";
import { MemberManageDialog } from "@/components/MemberManageDialog";
import { EmptyState, PageHeader, Panel, Pill, StatCard, type Tone } from "@/components/display";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
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
  const [managing, setManaging] = useState<string | null>(null);
  /**
   * O que a tela já sabe e o servidor ainda não repetiu: conferir o nick ou editar o membro troca só a linha,
   * sem recarregar a lista (AC#1/AC#2). O próximo carregamento traz o valor do servidor e o mapa é descartado.
   */
  const [edits, setEdits] = useState<Record<string, Partial<AdminMember>>>({});
  const debouncedSearch = useDebounced(search);

  // Trocar busca ou filtro volta pra primeira página: página 3 de um resultado com 2 páginas é uma tela vazia.
  // Feito no próprio handler (e não num efeito) para não disparar uma renderização em cascata.
  const changeSearch = (value: string) => {
    setSearch(value);
    setPage(1);
  };
  const changeFilter = (value: MemberFilter) => {
    setFilter(value);
    setPage(1);
  };

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
  const members = data?.members.map((m) => ({ ...m, ...edits[m.id] })) ?? [];
  const patch = (id: string, values: Partial<AdminMember>) => setEdits((prev) => ({ ...prev, [id]: { ...prev[id], ...values } }));

  return (
    <TooltipProvider>
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
              onChange={(e) => changeSearch(e.target.value)}
              placeholder="Buscar por nick ou usuário do Discord"
              aria-label="Buscar por nick ou usuário do Discord"
              className="pl-9"
            />
          </div>
          <div className="flex w-full flex-wrap gap-2 sm:w-auto" role="group" aria-label="Filtrar membros">
            {MEMBER_FILTERS.map((key) => {
              const on = filter === key;
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={on}
                  onClick={() => changeFilter(key)}
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

        {data && members.length === 0 && (
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
                      changeSearch("");
                      changeFilter("todos");
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

        {data && members.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Membro</TableHead>
                <TableHead className="hidden md:table-cell">Guilda</TableHead>
                <TableHead className="hidden sm:table-cell">Papéis</TableHead>
                <TableHead className="hidden lg:table-cell">Entrou</TableHead>
                <TableHead>Albion</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((m) => (
                <MemberRow key={m.id} member={m} onChecked={(albion) => patch(m.id, { albion })} onManage={() => setManaging(m.id)} />
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

      <MemberManageDialog
        member={members.find((m) => m.id === managing) ?? null}
        onClose={() => setManaging(null)}
        onSaved={(saved) => {
          // Nick trocado zera a conferência no servidor: a linha precisa refletir isso na hora, não mentir.
          if (managing) patch(managing, { gameNick: saved.nick, guildTag: saved.guildTag, albion: { status: null, playerId: null, guildName: null, checkedAt: null } });
        }}
      />
    </TooltipProvider>
  );
}

function MemberRow({ member, onChecked, onManage }: { member: AdminMember; onChecked: (albion: AdminMember["albion"]) => void; onManage: () => void }) {
  const name = member.gameNick || member.displayName || member.discordUsername;
  const albion = describeAlbionCheck({ status: member.albion.status, guildName: member.albion.guildName, checkedAt: member.albion.checkedAt });
  const meta = albionMeta[albion.kind];
  const roles = member.roles.map((r) => ROLE_LABELS[r]).join(", ") || "—";

  return (
    <TableRow>
      {/* No celular sobram duas colunas (Membro e Albion): guilda e papéis descem para dentro do nome. */}
      <TableCell className="max-w-[12rem] min-w-0 sm:max-w-[14rem]">
        <p className="truncate font-medium">{name}</p>
        <p className="truncate text-xs text-muted-foreground">
          @{member.discordUsername}
          <span className="md:hidden">{member.guildTag ? ` · [${member.guildTag}]` : ""}</span>
        </p>
        <p className="truncate text-xs text-muted-foreground sm:hidden">{roles}</p>
      </TableCell>
      <TableCell className="hidden md:table-cell">
        {member.guildTag ? <span className="num text-xs font-medium">[{member.guildTag}]</span> : <span className="text-xs text-muted-foreground">—</span>}
      </TableCell>
      <TableCell className="hidden text-xs sm:table-cell">{roles}</TableCell>
      <TableCell className="hidden text-xs text-muted-foreground lg:table-cell">{formatDateTime(member.createdAt)}</TableCell>
      <TableCell>
        <Pill tone={meta.tone} icon={meta.icon}>
          {albion.label}
        </Pill>
        {albion.detail && <p className="mt-0.5 truncate text-xs text-muted-foreground">{albion.detail}</p>}
        {member.albion.checkedAt && <p className="num mt-0.5 truncate text-xs text-muted-foreground">{formatDateTime(member.albion.checkedAt)}</p>}
      </TableCell>
      <TableCell>
        <MemberActions member={member} onChecked={onChecked} onManage={onManage} />
      </TableCell>
    </TableRow>
  );
}

/**
 * Ações da linha (AC#1/AC#2/AC#3). Botões de ícone com rótulo acessível e dica: a coluna precisa caber em
 * 400px de largura, e nome de ação por extenso em toda linha rouba o espaço do que o admin veio ler.
 */
function MemberActions({ member, onChecked, onManage }: { member: AdminMember; onChecked: (albion: AdminMember["albion"]) => void; onManage: () => void }) {
  const [checking, setChecking] = useState(false);
  const name = member.gameNick || member.discordUsername;

  async function check() {
    setChecking(true);
    try {
      const { albion } = await checkMemberAlbion(member.id);
      onChecked(albion);
      const message =
        albion.status === "found"
          ? `${name} encontrado no Albion`
          : albion.status === "not_found"
            ? `${name} não foi encontrado no Albion`
            : `A API do Albion não respondeu sobre ${name}`;
      // Achar é sucesso; não achar é o resultado acionável da tela, não uma falha da ferramenta: aviso, não erro.
      (albion.status === "found" ? toast.success : toast.warning)(message, {
        description: albion.status === "found" ? (albion.guildName ? `Guilda ${albion.guildName}` : "Sem guilda") : "Confira o nick com a pessoa.",
      });
    } catch (e) {
      toast.error(errorText(e, "Não foi possível conferir o nick no Albion"));
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="flex justify-end gap-1">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            className="press"
            disabled={checking || !member.gameNick}
            aria-label={`Conferir ${name} no Albion`}
            onClick={() => void check()}
          >
            {checking ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{member.gameNick ? "Conferir o nick na API do Albion agora" : "Sem nick registrado: não há o que conferir"}</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="outline" size="icon" className="press" aria-label={`Gerenciar ${name}`} onClick={onManage}>
            <SlidersHorizontal />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Editar nick e tag, ler e escrever notas</TooltipContent>
      </Tooltip>
    </div>
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
