/**
 * Regras puras do banimento de jogador (TASK-050). Sem I/O: a API valida a entrada com estas
 * funções e o painel usa as mesmas para avisar antes de gastar uma requisição.
 *
 * O banimento é *soft delete*: a conta continua na lista de membros, marcada, com motivo, autor e
 * data, e o nick continua ocupado — liberar o nick embaralharia o histórico de quem jogou o quê.
 * Nada aqui decide permissão: quem pode banir é o CASL (`permissions.ts`).
 */

export const BAN_REASON_MIN_LENGTH = 5;
export const BAN_REASON_MAX_LENGTH = 500;

export type BanReasonValidation = { ok: true; reason: string } | { ok: false; error: string };

/**
 * Motivo é obrigatório: banir é destrutivo e quem lê a lista depois precisa saber por quê.
 * O mínimo existe para barrar "x" — não para julgar o texto.
 */
export function validateBanReason(input: unknown): BanReasonValidation {
  const reason = typeof input === "string" ? input.trim() : "";
  if (!reason) return { ok: false, error: "Escreva o motivo do banimento." };
  if (reason.length < BAN_REASON_MIN_LENGTH)
    return { ok: false, error: `O motivo precisa de pelo menos ${BAN_REASON_MIN_LENGTH} caracteres.` };
  if (reason.length > BAN_REASON_MAX_LENGTH)
    return { ok: false, error: `O motivo tem no máximo ${BAN_REASON_MAX_LENGTH} caracteres.` };
  return { ok: true, reason };
}

/** Estado de banimento como a API devolve e o painel desenha. `null` = conta ativa. */
export interface BanView {
  bannedAt: string;
  banReason: string;
  bannedByName: string | null;
}

/**
 * O que o banimento faz e o que ele **não** faz. A lista vive aqui (e não no JSX) porque a tela de
 * confirmação e a mensagem do bot precisam dizer exatamente a mesma coisa.
 */
export const BAN_EFFECTS = [
  "Corta o acesso ao painel na hora e bloqueia novo login.",
  "Remove o cargo Membro no Discord.",
  "Recusa inscrição em evento, pelo painel e pelo bot.",
  "Congela o saldo: sem pedir saque e sem aprovar saque pendente.",
] as const;

export const BAN_NON_EFFECTS = [
  "Não expulsa nem bane do servidor do Discord — isso continua sendo feito no Discord.",
  "Não apaga o saldo nem mexe no extrato: nenhum lançamento é criado.",
  "Não libera o nick para outra pessoa.",
  "Não apaga a conta: ela continua na lista, marcada como banida, e dá para desbanir.",
] as const;

/** Texto efêmero que o bot responde a quem tenta se inscrever banido. */
export const bannedSignupReply = (reason: string) =>
  `Sua conta está banida da comunidade e não pode se inscrever em eventos.\nMotivo: ${reason}\nFale com a staff no Discord se achar que é engano.`;
