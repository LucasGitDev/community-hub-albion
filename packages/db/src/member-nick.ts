import { sql, type Column, type SQL } from "drizzle-orm";

/** Só as colunas de nome: aceita a tabela `users` e também um apelido dela (`alias`). */
type NamedUser = { gameNick: Column; displayName: Column; discordUsername: Column };

/**
 * Como o painel chama uma pessoa (TASK-023): nick do Albion aprovado pela staff (Q14/Q31) e, enquanto
 * ele não existe, o nome do Discord. `nullif` cobre a coluna vazia, que é tão inútil quanto nula.
 * Fica num arquivo só para os repos de evento e inscrição mostrarem exatamente o mesmo nome.
 */
export const memberNick = (t: NamedUser): SQL<string | null> =>
  sql`coalesce(nullif(${t.gameNick}, ''), nullif(${t.displayName}, ''), ${t.discordUsername})`;
