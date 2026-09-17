/**
 * Regras puras da lista de membros do admin (TASK-043). Sem I/O: o servidor traduz para SQL e o painel para UI.
 *
 * A mesma normalização roda nos dois lados: o painel monta a query string, o servidor confere de novo
 * (parâmetro de URL é entrada de usuário, nunca confiável) e nenhum dos dois inventa um default diferente.
 */

/**
 * Filtros da tela; o valor vai cru na URL, então usa nome estável e sem acento.
 *
 * **São exclusivos**: um filtro por vez, nunca combinados. A lista é uma fila de trabalho — o admin abre
 * "quem precisa de atenção" e resolve, não monta interseções. Combinar viraria estado composto na URL e
 * uma contagem por chip que depende do que mais está ligado; exclusivo mantém a promessa simples de que o
 * número do chip é exatamente o número de linhas que ele devolve.
 *
 * Dois níveis, e não cinco chips soltos (TASK-054, decisão N6): `todos`, `atencao` e `banidos` são a
 * pergunta de cima ("tem trabalho aqui?"); `sem_nick`, `nao_encontrados` e `saiu` refinam a atenção.
 */
export const MEMBER_FILTERS = ["todos", "atencao", "sem_nick", "nao_encontrados", "saiu", "banidos"] as const;
export type MemberFilter = (typeof MEMBER_FILTERS)[number];

/** Linha de cima dos chips: sempre visível. */
export const MEMBER_FILTERS_PRIMARY = ["todos", "atencao", "banidos"] as const satisfies readonly MemberFilter[];

/**
 * Linha de refino, só aparece dentro da atenção. Os três podem se sobrepor entre si (quem não tem nick
 * também pode ter saído), então a soma deles pode passar do total de `atencao` — cada um continua honesto
 * sobre as próprias linhas, que é o que o chip promete.
 */
export const MEMBER_FILTERS_ATTENTION = ["sem_nick", "nao_encontrados", "saiu"] as const satisfies readonly MemberFilter[];

/** O filtro pertence à família "precisa de atenção"? É o que decide se a linha de refino fica na tela. */
export function isAttentionFilter(filter: MemberFilter): boolean {
  return filter === "atencao" || (MEMBER_FILTERS_ATTENTION as readonly MemberFilter[]).includes(filter);
}

export const MEMBER_FILTER_LABELS: Record<MemberFilter, string> = {
  todos: "Todos",
  atencao: "Precisam de atenção",
  sem_nick: "Sem nick",
  nao_encontrados: "Não encontrados no Albion",
  saiu: "Saiu do servidor",
  banidos: "Banidos",
};

/** Filtro desconhecido (URL editada à mão) cai em `todos`: a tela mostra tudo em vez de quebrar. */
export function parseMemberFilter(value: unknown): MemberFilter {
  return typeof value === "string" && (MEMBER_FILTERS as readonly string[]).includes(value) ? (value as MemberFilter) : "todos";
}

/** Busca longa demais só custa banco: o nick do Albion tem no máximo 16 caracteres e o usuário do Discord 32. */
export const MEMBER_SEARCH_MAX = 64;

/**
 * Busca normalizada: sem espaço nas pontas, sem caixa e limitada. `null` = sem busca (string vazia não filtra nada).
 */
export function normalizeMemberSearch(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, MEMBER_SEARCH_MAX);
  return trimmed ? trimmed.toLowerCase() : null;
}

/**
 * Escapa os curingas do `LIKE` para que a busca seja literal: quem digita `%` procura `%`, não "qualquer coisa".
 * Combina com `escape '\'` no SQL. Sem isso, um `%` sozinho varre a tabela inteira.
 */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export const MEMBER_PAGE_SIZE = 25;
export const MEMBER_PAGE_SIZE_MAX = 100;

export interface MemberPagination {
  page: number;
  pageSize: number;
  offset: number;
}

/** Página e tamanho saneados (inteiros, mínimo 1, teto no tamanho). Lixo na URL vira a primeira página padrão. */
export function parseMemberPagination(page: unknown, pageSize: unknown): MemberPagination {
  const size = clampInt(pageSize, MEMBER_PAGE_SIZE, 1, MEMBER_PAGE_SIZE_MAX);
  const current = clampInt(page, 1, 1, Number.MAX_SAFE_INTEGER);
  return { page: current, pageSize: size, offset: (current - 1) * size };
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), min), max);
}

/** Total de páginas (mínimo 1: lista vazia ainda é "página 1 de 1"). */
export const memberPageCount = (total: number, pageSize: number): number => Math.max(1, Math.ceil(total / pageSize));

/** O que a API guarda da última conferência do nick no Albion (TASK-042). */
export interface AlbionCheckView {
  status: string | null;
  guildName: string | null;
  checkedAt: string | null;
}

export type AlbionCheckKind = "found" | "not_found" | "unavailable" | "unchecked";

export interface AlbionCheckLabel {
  kind: AlbionCheckKind;
  label: string;
  /** Detalhe secundário (guilda no Albion), quando existe. */
  detail: string | null;
}

/**
 * Texto da pílula de status (AC#2). Nunca "sem informação" sozinho: quem nunca foi conferido aparece como
 * `Não conferido`, que é diferente de `Não encontrado` — um pede import, o outro pede correção de nick.
 */
export function describeAlbionCheck(check: AlbionCheckView): AlbionCheckLabel {
  switch (check.status) {
    case "found":
      return { kind: "found", label: "Encontrado", detail: check.guildName ? `Guilda ${check.guildName}` : "Sem guilda" };
    case "not_found":
      return { kind: "not_found", label: "Não encontrado", detail: null };
    case "unavailable":
      return { kind: "unavailable", label: "Consulta indisponível", detail: null };
    default:
      return { kind: "unchecked", label: "Não conferido", detail: null };
  }
}
