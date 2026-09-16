import { validateNick } from "./nick.js";

/**
 * Apelido do Discord → tag de guilda + nick do Albion (TASK-042, AC#3/AC#6).
 *
 * O servidor já usa o padrão `[TAG] Nick` (ex.: `[GENEI] Erijj`). A tag é da guilda no jogo, não do nick,
 * então é separada e guardada à parte (decisão de 2026-09-16: manter a tag, não jogar fora).
 *
 * Regras (função pura, sem I/O):
 * - só `[...]` **no início** conta como tag; qualquer outro delimitador (`(TAG)`, `「TAG」`, `-TAG-`) fica no nick
 *   e, como o nick do Albion só aceita letras e números, o apelido cai em conflito em vez de virar nick errado;
 * - espaços repetidos, NBSP e afins são normalizados antes de separar (`[GENEI]   Erijj` = `[GENEI] Erijj`);
 * - a tag aceita de 1 a {@link GUILD_TAG_MAX_LENGTH} letras/números (o jogo não permite mais que isso);
 * - o nick restante passa pelo `validateNick` (Q14): 3 a 16 letras ou números.
 *
 * Nada aqui lança: apelido problemático vira `{ ok: false, error }` e o import lista como conflito sem parar.
 */
export const GUILD_TAG_MAX_LENGTH = 10;

const GUILD_TAG_PATTERN = /^[A-Za-z0-9]{1,10}$/;
/** Tag no começo: `[` ... `]` e o resto. `[^\]]*` impede casar além do primeiro fechamento. */
const LEADING_TAG = /^\[([^\]]*)\]\s*(.*)$/;
/** Qualquer espaço unicode (inclui NBSP U+00A0 e figure space) vira espaço simples. */
const WHITESPACE = /\s+/gu;

export type ParsedDiscordNickname = { ok: true; guildTag: string | null; nick: string } | { ok: false; error: string };

/** Normaliza o apelido cru do Discord: trim + espaços colapsados. */
export function normalizeDiscordNickname(input: unknown): string {
  return typeof input === "string" ? input.replace(WHITESPACE, " ").trim() : "";
}

export function parseDiscordNickname(input: unknown): ParsedDiscordNickname {
  const normalized = normalizeDiscordNickname(input);
  if (!normalized) return { ok: false, error: "Apelido vazio no Discord." };

  const match = LEADING_TAG.exec(normalized);
  let guildTag: string | null = null;
  let rest = normalized;
  if (match) {
    const tag = match[1]!.trim();
    if (!GUILD_TAG_PATTERN.test(tag))
      return { ok: false, error: `Tag de guilda inválida: use de 1 a ${GUILD_TAG_MAX_LENGTH} letras ou números entre colchetes.` };
    guildTag = tag;
    rest = match[2]!.trim();
    if (!rest) return { ok: false, error: "Apelido só tem a tag da guilda, sem nick." };
  }

  const nick = validateNick(rest);
  if (!nick.ok) return { ok: false, error: nick.error };
  return { ok: true, guildTag, nick: nick.nick };
}
