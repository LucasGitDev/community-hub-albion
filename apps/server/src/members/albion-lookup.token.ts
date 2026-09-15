/**
 * Token Nest do AlbionPlayerLookup (TASK-016). Painel (fila staff) e embed (TASK-015) injetam e chamam `lookup(nick)`;
 * resultado em cache, nunca lança e nunca bloqueia decisão.
 */
export const ALBION_PLAYER_LOOKUP = Symbol("ALBION_PLAYER_LOOKUP");
