import { formatAmount } from "@albion-hub/shared";

/**
 * Emoji da Buffunfa no Discord (F6-28, doc-009).
 *
 * O id **nunca** fica fixo no código: emoji é por servidor, então um id chumbado quebra em qualquer
 * outra instalação e vira mentira silenciosa se o emoji for recriado. Ele vem do env, ou de uma busca
 * pelo nome na guild — e, quando não há nenhum, a saída cai para o texto puro (`340 BUF`), nunca para
 * um emoji quebrado.
 */
export const BUFFUNFA_EMOJI_NAME = "buffunfa";

/** `<:buffunfa:ID>`, o formato que o Discord renderiza. Null quando não há emoji configurado. */
export const buffunfaEmojiMention = (emojiId: string | null): string | null => (emojiId ? `<:${BUFFUNFA_EMOJI_NAME}:${emojiId}>` : null);

/**
 * Valor de Buffunfa como o bot escreve: `340 <:buffunfa:ID>` (doc-009) ou `340 BUF` sem emoji.
 *
 * Nunca abrevia (F6-5) porque quem formata é o `formatAmount` compartilhado com o painel — a regra mora
 * num lugar só, e bot e tela não podem divergir sobre quanto alguém tem.
 */
export function formatBuffunfa(value: bigint, emojiId: string | null): string {
  const mention = buffunfaEmojiMention(emojiId);
  return mention ? `${formatAmount(value, "buffunfa").replace(/ BUF$/, "")} ${mention}` : formatAmount(value, "buffunfa");
}
