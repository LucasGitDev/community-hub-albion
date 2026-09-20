import { useCallback, useEffect, useState } from "react";
import { Ban, Banknote, Check, CircleDashed, CloudOff, Download, Loader2, LogOut, MoreHorizontal, Receipt, RefreshCw, Search, ShieldCheck, SlidersHorizontal, TriangleAlert, UserPlus, UserRoundX, Users } from "lucide-react";
import { toast } from "sonner";
import {
  asSubject,
  describeAlbionCheck,
  isAttentionFilter,
  MEMBER_FILTER_LABELS,
  MEMBER_FILTERS_ATTENTION,
  MEMBER_FILTERS_PRIMARY,
  memberPageCount,
  ROLE_LABELS,
  type AlbionCheckKind,
  type MemberFilter,
} from "@albion-hub/shared";
import { checkMemberAlbion, fetchAdminMembers, importDiscordMembers, type AdminMember, type AdminMembersPage, type MemberImportSummary } from "@/api/members";
import { errorText } from "@/api/http";
import { usePoll } from "@/api/use-poll";
import { useCurrentUser } from "@/auth/AuthProvider";
import { MemberBanDialog } from "@/components/MemberBanDialog";
import { MemberLedgerDialog } from "@/components/MemberLedgerDialog";
import { MemberManageDialog } from "@/components/MemberManageDialog";
import { MemberReferralsDialog } from "@/components/MemberReferralsDialog";
import { StaffWithdrawDialog } from "@/components/StaffWithdrawDialog";
import { EmptyState, PageHeader, Panel, Pill, StatCard, type Tone } from "@/components/display";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TooltipProvider } from "@/components/ui/tooltip";
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
 * Lista de membros do painel para o admin (TASK-043, filtros revistos na TASK-054).
 *
 * A tela responde a uma pergunta: **quem precisa de atenção**. Quando eram quatro estados, cinco chips lado a
 * lado ainda cabiam; com "Saiu do servidor" viraria uma fileira de cinco rótulos longos em que o admin lê tudo
 * para descobrir onde tem trabalho. Então os chips têm dois níveis: em cima `Todos`, `Precisam de atenção` e
 * `Banidos` (tem trabalho aqui?), e dentro da atenção uma linha de refino com `Sem nick`, `Não encontrados` e
 * `Saiu do servidor` (que trabalho?). Os cartões de número acompanham: três, um por chip de cima, em vez de
 * quatro cartões repetindo os chips.
 *
 * Servidor é a autoridade: busca, filtro e paginação vão na query, nada é filtrado aqui — inclusive as
 * contagens dos chips, que saem do mesmo predicado SQL que monta a lista.
 */
export function AdminMembers() {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<MemberFilter>("todos");
  const [page, setPage] = useState(1);
  const [importing, setImporting] = useState(false);
  const [summary, setSummary] = useState<MemberImportSummary | null>(null);
  const [managing, setManaging] = useState<string | null>(null);
  const [banning, setBanning] = useState<string | null>(null);
  const [statement, setStatement] = useState<string | null>(null);
  const [referrals, setReferrals] = useState<string | null>(null);
  const [withdrawing, setWithdrawing] = useState<string | null>(null);
  const { user, ability } = useCurrentUser();
  // Conferir o nick, editar nick/tag e as notas: admin e staff (TASK-047, G3).
  const canManage = ability.can("update", "MemberProfile");
  const canBan = ability.can("ban", "Ban");
  // Abrir saque no nome de outro (TASK-083, SS3): staff e admin. Membro comum não vê nem consegue.
  const canOpenWithdrawal = ability.can("createFor", "Withdrawal");
  // Importar do Discord continua exigindo `manage`/`all` na API: o botão fica escondido para a staff em
  // vez de aparecer e devolver 403 no clique.
  const canImport = ability.can("manage", "all");
  /**
   * Extrato alheio (TASK-051, G10): a mesma pergunta que a API faz, com a condição de dono junto —
   * `read Wallet` sem condição é de staff e admin; a regra do membro é presa ao próprio id. Perguntar
   * pelo tipo só (`ability.can("read", "UserRole")`) esconderia a ação do staff, e perguntar por
   * `read Wallet` cru a mostraria pra todo membro logado: é o erro da TASK-027.
   */
  const canReadLedger = (userId: string) => ability.can("read", asSubject("Wallet", { userId }));
  /**
   * Indicações (TASK-074, AC#8): subject próprio, sem condição de dono — a indicação mora na linha de
   * uma pessoa mas paga duas, então não existe "a minha". Ler é de staff e admin; estornar é a mesma
   * permissão da API (`reverse`), perguntada aqui para o botão não aparecer e devolver 403 no clique.
   */
  const canReadReferrals = ability.can("read", "Referral");
  const canReverseReferral = ability.can("reverse", "Referral");
  // Staff bane quem está abaixo dela; banir staff ou admin é coisa de admin (a API recusa igual).
  const isAdmin = user.roles.includes("admin");
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
  /**
   * Clicar de novo no refino já ligado volta para o grupo inteiro: dentro da atenção o chip funciona como
   * alternador, e desmarcar sem ter que mirar no chip de cima é o gesto que o admin tenta primeiro.
   */
  const toggleRefine = (value: MemberFilter) => changeFilter(filter === value ? "atencao" : value);

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

  const counts: Record<MemberFilter, number> = data?.counts ?? { todos: 0, atencao: 0, sem_nick: 0, nao_encontrados: 0, saiu: 0, banidos: 0 };
  const refining = isAttentionFilter(filter);
  const pageCount = data ? memberPageCount(data.total, data.pageSize) : 1;
  const members = data?.members.map((m) => ({ ...m, ...edits[m.id] })) ?? [];
  const patch = (id: string, values: Partial<AdminMember>) => setEdits((prev) => ({ ...prev, [id]: { ...prev[id], ...values } }));

  return (
    <TooltipProvider>
      <PageHeader
        title="Membros"
        description="Quem já tem conta no painel, com o nick conferido na API do Albion. Importar traz de novo quem tem cargo Membro e apelido no Discord."
        action={
          canImport ? (
            <Button onClick={() => void runImport()} disabled={importing}>
              <Download />
              {importing ? "Importando…" : "Importar membros do Discord"}
            </Button>
          ) : undefined
        }
      />

      {/* Um cartão por chip de cima. O detalhe (sem nick, não encontrado, saiu) mora no refino, não em mais cartões. */}
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
        <StatCard
          label="Precisam de atenção"
          icon={<TriangleAlert />}
          value={counts.atencao}
          hint={`Sem nick ${counts.sem_nick} · não encontrados ${counts.nao_encontrados} · saíram ${counts.saiu}`}
        />
        <StatCard label="Banidos" icon={<Ban />} value={counts.banidos} hint="Sem acesso ao painel, a evento e a saque. O saldo fica congelado." />
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
            {MEMBER_FILTERS_PRIMARY.map((key) => (
              <FilterChip
                key={key}
                filter={key}
                count={counts[key]}
                // "Precisam de atenção" fica aceso também quando o refino está ligado: o refino está dentro dele.
                on={key === "atencao" ? isAttentionFilter(filter) : filter === key}
                onClick={() => changeFilter(key)}
              />
            ))}
          </div>
        </div>

        {/* Refino só existe dentro da atenção: fora dela seriam três chips sem pergunta que respondam. */}
        {refining && (
          <div className="refine-in flex flex-wrap items-center gap-2 border-b bg-muted/30 px-3 py-2 sm:pl-6">
            <p className="text-xs text-muted-foreground">O que precisa de atenção</p>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Refinar quem precisa de atenção">
              {MEMBER_FILTERS_ATTENTION.map((key) => (
                <FilterChip key={key} filter={key} count={counts[key]} on={filter === key} small onClick={() => toggleRefine(key)} />
              ))}
            </div>
          </div>
        )}

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
                ) : canImport ? (
                  <Button onClick={() => void runImport()} disabled={importing}>
                    <Download />
                    Importar membros do Discord
                  </Button>
                ) : undefined
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
                <MemberRow
                  key={m.id}
                  member={m}
                  isSelf={m.id === user.id}
                  canManage={canManage}
                  canBan={canBan && (isAdmin || !m.roles.some((r) => r === "staff" || r === "admin"))}
                  canReadLedger={canReadLedger(m.id)}
                  canReadReferrals={canReadReferrals}
                  onChecked={(albion) => patch(m.id, { albion })}
                  onManage={() => setManaging(m.id)}
                  onBan={() => setBanning(m.id)}
                  onStatement={() => setStatement(m.id)}
                  onReferrals={() => setReferrals(m.id)}
                  canOpenWithdrawal={canOpenWithdrawal}
                  onWithdraw={() => setWithdrawing(m.id)}
                />
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

      <MemberBanDialog
        member={members.find((m) => m.id === banning) ?? null}
        onClose={() => setBanning(null)}
        // A linha muda na hora pelo `patch`; o `refresh` é pelos números (cartão e chip "Banidos"),
        // que são contagem do servidor e mentiriam se ficassem para o próximo ciclo do polling.
        onBanned={(ban) => {
          if (banning) patch(banning, { ban });
          refresh();
        }}
        onUnbanned={() => {
          if (banning) patch(banning, { ban: null });
          refresh();
        }}
      />

      <MemberLedgerDialog
        member={(() => {
          const m = members.find((x) => x.id === statement);
          return m ? { id: m.id, name: m.gameNick || m.displayName || m.discordUsername } : null;
        })()}
        onClose={() => setStatement(null)}
      />

      <MemberReferralsDialog
        member={(() => {
          const m = members.find((x) => x.id === referrals);
          return m ? { id: m.id, name: m.gameNick || m.displayName || m.discordUsername } : null;
        })()}
        canReverse={canReverseReferral}
        onClose={() => setReferrals(null)}
      />

      <StaffWithdrawDialog
        open={withdrawing !== null}
        member={(() => {
          const m = members.find((x) => x.id === withdrawing);
          return m ? { id: m.id, name: m.gameNick || m.displayName || m.discordUsername } : null;
        })()}
        onClose={() => setWithdrawing(null)}
        onOpened={() => setWithdrawing(null)}
      />

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

/**
 * Chip de filtro (TASK-054). Rótulo + contagem do servidor; o estado ligado é preenchido (fundo sólido),
 * não só colorido, porque o painel é B&W e "cor mais escura" não é estado legível.
 *
 * `small` é a linha de refino: mesma forma, um degrau menor, para ler como subordinada à linha de cima
 * sem virar outro componente.
 */
function FilterChip({ filter, count, on, small, onClick }: { filter: MemberFilter; count: number; on: boolean; small?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "press inline-flex items-center gap-1.5 rounded-full border font-medium whitespace-nowrap",
        small ? "h-7 px-2.5 text-xs" : "h-8 px-3 text-sm",
        on ? "border-foreground bg-foreground text-background" : "border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      {MEMBER_FILTER_LABELS[filter]}
      <span className={cn("num text-xs", on ? "opacity-70" : "opacity-60")}>{count}</span>
    </button>
  );
}

interface RowActions {
  isSelf: boolean;
  canManage: boolean;
  canBan: boolean;
  canReadLedger: boolean;
  canReadReferrals: boolean;
  onChecked: (albion: AdminMember["albion"]) => void;
  onManage: () => void;
  onBan: () => void;
  onStatement: () => void;
  onReferrals: () => void;
  /** Abrir saque pelo membro (TASK-083, SS3): só quem tem `createFor` em Withdrawal. */
  canOpenWithdrawal: boolean;
  onWithdraw: () => void;
}

function MemberRow({ member, ...actions }: { member: AdminMember } & RowActions) {
  const name = member.gameNick || member.displayName || member.discordUsername;
  const albion = describeAlbionCheck({ status: member.albion.status, guildName: member.albion.guildName, checkedAt: member.albion.checkedAt });
  const meta = albionMeta[albion.kind];
  const roles = member.roles.map((r) => ROLE_LABELS[r]).join(", ") || "—";

  return (
    // A linha do banido fica atenuada, mas o selo e o motivo ficam em contraste cheio: o apagado diz
    // "esta conta não está ativa" sem esconder justamente o que a pessoa precisa ler.
    <TableRow className={cn(member.ban && "bg-destructive/5", !member.ban && member.leftGuildAt && "bg-muted/40")}>
      {/* No celular sobram duas colunas (Membro e Albion): guilda e papéis descem para dentro do nome. */}
      <TableCell className="max-w-[12rem] min-w-0 sm:max-w-[14rem]">
        <p className={cn("truncate font-medium", member.ban && "text-muted-foreground line-through decoration-destructive/60")}>{name}</p>
        <p className="truncate text-xs text-muted-foreground">
          @{member.discordUsername}
          <span className="md:hidden">{member.guildTag ? ` · [${member.guildTag}]` : ""}</span>
        </p>
        <p className="truncate text-xs text-muted-foreground sm:hidden">{roles}</p>
        {member.ban && (
          <div className="mt-1 border-l-2 border-destructive/60 pl-2">
            <Pill tone="destructive" icon={<Ban strokeWidth={2.25} />}>
              Banido
            </Pill>
            <p className="mt-0.5 line-clamp-2 text-xs break-words text-foreground/90" title={member.ban.reason}>
              {member.ban.reason}
            </p>
            <p className="num truncate text-xs text-muted-foreground">
              {formatDateTime(member.ban.bannedAt)}
              {member.ban.byName ? ` · ${member.ban.byName}` : ""}
            </p>
          </div>
        )}
        {member.leftGuildAt && (
          <div className="mt-1 border-l-2 border-warning/60 pl-2">
            <Pill tone="warning" icon={<LogOut strokeWidth={2.25} />}>
              Saiu do servidor
            </Pill>
            {/* Sem `truncate`: no celular a coluna é estreita e a autoria ("limpeza automática") é justamente a parte que não pode sumir. */}
            <p className="num text-xs break-words text-muted-foreground">{formatDateTime(member.leftGuildAt)} · limpeza automática</p>
          </div>
        )}
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
        <MemberActions member={member} {...actions} />
      </TableCell>
    </TableRow>
  );
}

/**
 * Ações da linha, num **menu** (TASK-083, SS6). Antes eram quatro botões de ícone lado a lado, cada um
 * explicado só por tooltip; com o saque seriam cinco, e em 400px a coluna já era a mais apertada da
 * tela. O menu troca cinco ícones mudos por uma lista com o nome da ação escrito — e é a convenção que
 * as próximas telas seguem.
 */
function MemberActions({
  member,
  isSelf,
  canManage,
  canBan,
  canReadLedger,
  canReadReferrals,
  canOpenWithdrawal,
  onChecked,
  onManage,
  onBan,
  onStatement,
  onReferrals,
  onWithdraw,
}: { member: AdminMember } & RowActions) {
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

  const nothing = !canManage && !canReadLedger && !canReadReferrals && !canOpenWithdrawal && (!canBan || isSelf);
  if (nothing) return <div className="flex justify-end text-xs text-muted-foreground">—</div>;

  return (
    <div className="flex justify-end">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon" className="press" aria-label={`Ações de ${name}`}>
            {checking ? <Loader2 className="animate-spin" /> : <MoreHorizontal />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel className="truncate">{name}</DropdownMenuLabel>
          {canManage && (
            <>
              <DropdownMenuItem
                disabled={checking || !member.gameNick}
                // `preventDefault` segura o menu aberto enquanto a chamada corre: fechar e só depois
                // avisar por toast tira do admin a noção de que ele apertou alguma coisa.
                onSelect={(e) => {
                  e.preventDefault();
                  void check();
                }}
              >
                {checking ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                {member.gameNick ? "Conferir no Albion" : "Sem nick para conferir"}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onManage}>
                <SlidersHorizontal />
                Gerenciar nick, tag e notas
              </DropdownMenuItem>
            </>
          )}

          {/* Extrato vem antes do resto: é a ação que a staff mais usa aqui e a única que não muda nada. */}
          {canReadLedger && (
            <DropdownMenuItem onSelect={onStatement}>
              <Receipt />
              Ver o extrato
            </DropdownMenuItem>
          )}

          {canOpenWithdrawal && (
            <DropdownMenuItem onSelect={onWithdraw}>
              <Banknote />
              Abrir saque por ele
            </DropdownMenuItem>
          )}

          {canReadReferrals && (
            <DropdownMenuItem onSelect={onReferrals}>
              <UserPlus />
              Ver as indicações
            </DropdownMenuItem>
          )}

          {/* Banir a si mesmo é sempre engano: o item não aparece na própria linha, e a API recusa de qualquer jeito. */}
          {canBan && !isSelf && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant={member.ban ? "default" : "destructive"} onSelect={onBan}>
                {member.ban ? <ShieldCheck /> : <Ban />}
                {member.ban ? "Desbanir" : "Banir"}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
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
