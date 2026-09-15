import { NICK_MAX_LENGTH, NICK_MIN_LENGTH } from "@albion-hub/shared";

/**
 * Slash command `/registrar nick:<nick>` (TASK-035, Q14/Q18/Q31). Funções puras: nome/descrição PT-BR e texto das
 * respostas efêmeras. A regra (validação, pendência única, 409) vive no NickRegistrationService, igual ao painel.
 */
export const REGISTER_COMMAND = {
  name: "registrar",
  description: "Registra ou troca o nick do seu personagem do Albion (vai para aprovação da staff)",
  option: {
    name: "nick",
    description: `Nick exato do personagem: ${NICK_MIN_LENGTH} a ${NICK_MAX_LENGTH} letras ou números`,
    minLength: NICK_MIN_LENGTH,
    maxLength: NICK_MAX_LENGTH,
  },
} as const;

/** Resultado do registro de nick, sem tipos de banco (compartilhado com o painel). */
export type RegisterNickOutcome =
  | { kind: "invalid"; error: string }
  | { kind: "same_nick"; gameNick: string }
  | { kind: "requested"; created: boolean; nick: string; gameNick: string | null };

export const REGISTER_REPLIES = {
  wrongGuild: "Esse comando só funciona no servidor da guilda.",
  failed: "Não consegui registrar seu nick agora. Tente de novo em instantes ou use o painel.",
} as const;

/** Texto da resposta efêmera para cada resultado. */
export function buildRegisterReply(outcome: RegisterNickOutcome): string {
  switch (outcome.kind) {
    case "invalid":
      return `Nick inválido: ${outcome.error} O nick tem de ${NICK_MIN_LENGTH} a ${NICK_MAX_LENGTH} caracteres, só letras e números.`;
    case "same_nick":
      return `**${outcome.gameNick}** já é o seu nick atual. Nada foi enviado.`;
    case "requested": {
      const head = outcome.created
        ? `Pedido do nick **${outcome.nick}** enviado para aprovação da staff.`
        : `Seu pedido pendente foi corrigido para **${outcome.nick}**. A staff vai avaliar o nick novo.`;
      const tail = outcome.gameNick
        ? ` Até a aprovação você continua como **${outcome.gameNick}**, com o mesmo acesso.`
        : " Quando aprovarem, seu apelido no servidor muda e você recebe o cargo Membro.";
      return head + tail;
    }
  }
}

/** Comando só vale na guild configurada (Q4): DM ou outro servidor é recusado antes de tocar o banco. */
export const isConfiguredGuild = (guildId: string | null | undefined, expected: string): boolean => !!guildId && guildId === expected;
