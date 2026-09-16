import { GUILD_TAG_MAX_LENGTH } from "./discord-nickname.js";

/**
 * Regras puras da edição de membro e das notas internas (TASK-045). Sem I/O: a API valida a entrada
 * com estas funções e o painel usa as mesmas para dizer o erro antes de gastar uma requisição.
 *
 * Nada aqui decide permissão: quem pode editar e quem pode ler nota é o CASL (`permissions.ts`).
 */

const GUILD_TAG_PATTERN = /^[A-Za-z0-9]+$/;

export type GuildTagValidation = { ok: true; guildTag: string | null } | { ok: false; error: string };

/**
 * Tag de guilda avulsa, do jeito que o admin digita no formulário: sem colchetes, letras e números.
 * Vazio é válido e significa "sem guilda" (`null`), porque sair da guilda é uma edição legítima —
 * não é um erro de preenchimento. A caixa é preservada: no jogo a tag é exibida como foi criada.
 */
export function validateGuildTag(input: unknown): GuildTagValidation {
  if (input === null || input === undefined) return { ok: true, guildTag: null };
  if (typeof input !== "string") return { ok: false, error: "Tag de guilda inválida." };
  const tag = input.trim().replace(/^\[|\]$/g, "").trim();
  if (!tag) return { ok: true, guildTag: null };
  if (!GUILD_TAG_PATTERN.test(tag) || tag.length > GUILD_TAG_MAX_LENGTH)
    return { ok: false, error: `Use de 1 a ${GUILD_TAG_MAX_LENGTH} letras ou números na tag, sem espaços nem símbolos.` };
  return { ok: true, guildTag: tag };
}

/** Nota interna é texto livre, mas com teto: o que não cabe numa nota vira várias (a lista é append-only). */
export const USER_NOTE_MAX_LENGTH = 1_000;

export type UserNoteValidation = { ok: true; body: string } | { ok: false; error: string };

/** Nota vazia não entra: uma linha em branco no histórico é só ruído para quem lê depois. */
export function validateUserNote(input: unknown): UserNoteValidation {
  const body = typeof input === "string" ? input.trim() : "";
  if (!body) return { ok: false, error: "Escreva a nota antes de salvar." };
  if (body.length > USER_NOTE_MAX_LENGTH) return { ok: false, error: `A nota tem no máximo ${USER_NOTE_MAX_LENGTH} caracteres.` };
  return { ok: true, body };
}

/**
 * Origem da nota. `staff` é o que uma pessoa escreveu; `system` é o registro automático de uma edição
 * (quem mudou o quê). Os dois vivem na mesma lista porque a pergunta de quem abre é uma só:
 * "o que já aconteceu com esse membro?".
 */
export const USER_NOTE_KINDS = ["staff", "system"] as const;
export type UserNoteKind = (typeof USER_NOTE_KINDS)[number];

export interface MemberProfileChange {
  nick: { from: string | null; to: string | null };
  guildTag: { from: string | null; to: string | null };
}

const showValue = (value: string | null) => value ?? "vazio";

/**
 * Texto da nota automática de edição (AC#2: "registrando quem editou"). Só entra o que mudou de fato,
 * para o histórico não encher de linhas dizendo que nada aconteceu. `null` = nada mudou, não grava nota.
 */
export function describeMemberProfileChange(change: MemberProfileChange): string | null {
  const parts: string[] = [];
  if (change.nick.from !== change.nick.to) parts.push(`nick ${showValue(change.nick.from)} → ${showValue(change.nick.to)}`);
  if (change.guildTag.from !== change.guildTag.to) parts.push(`tag de guilda ${showValue(change.guildTag.from)} → ${showValue(change.guildTag.to)}`);
  return parts.length > 0 ? `Editou ${parts.join(" e ")}.` : null;
}
