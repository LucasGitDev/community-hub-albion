/**
 * Nick de personagem do Albion Online (TASK-012, Q14). Regra do jogo na criação de personagem:
 * 3 a 16 caracteres, só letras ASCII e dígitos (sem espaço, acento ou símbolo). Unicidade é
 * por servidor do jogo, então aqui só validamos formato; a conferência na API Albion é ajuda (TASK-016).
 */
export const NICK_MIN_LENGTH = 3;
export const NICK_MAX_LENGTH = 16;
const NICK_PATTERN = /^[A-Za-z0-9]+$/;

export const NICK_REQUEST_STATUSES = ["pending", "approved", "rejected"] as const;
export type NickRequestStatus = (typeof NICK_REQUEST_STATUSES)[number];

export type NickValidation = { ok: true; nick: string } | { ok: false; error: string };

/** Normaliza (trim) e valida. Mensagens PT-BR dizem como corrigir (Q18). */
export function validateNick(input: unknown): NickValidation {
  if (typeof input !== "string") return { ok: false, error: "Digite o nick do seu personagem." };
  const nick = input.trim();
  if (!nick) return { ok: false, error: "Digite o nick do seu personagem." };
  if (!NICK_PATTERN.test(nick)) return { ok: false, error: "Use só letras e números, sem espaços, acentos ou símbolos." };
  if (nick.length < NICK_MIN_LENGTH || nick.length > NICK_MAX_LENGTH)
    return { ok: false, error: `O nick tem de ${NICK_MIN_LENGTH} a ${NICK_MAX_LENGTH} caracteres.` };
  return { ok: true, nick };
}

/** Nicks do Albion não diferenciam maiúsculas na unicidade: compara sem caixa. */
export const sameNick = (a: string | null | undefined, b: string | null | undefined): boolean =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase();
