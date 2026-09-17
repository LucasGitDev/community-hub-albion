import {
  ATTENDANCE_SKIP_LABELS,
  formatBuffunfaRange,
  inBuffunfaRange,
  parseAmount,
  roleBuffunfaRange,
  type EventAttendanceDto,
  type EventAttendanceLineDto,
  type EventRoleSlotDto,
} from "@albion-hub/shared";

/**
 * Regras da tela de Buffunfa por presença (TASK-057). Tudo função pura: a tela desenha e o teste
 * cobre a regra sem navegador, igual em `lib/settlement`.
 *
 * Nada aqui recalcula quem recebe: o corte dos 90% e o valor por role vêm do servidor, que usa as
 * funções de `@albion-hub/shared`. O que mora aqui é só a leitura da tela — contagem, frases e
 * validação do campo antes de gastar uma request.
 */

export interface AttendanceSummary {
  /** Quantos recebem com os valores de agora. */
  paying: number;
  /** Quantos apareceram e ficam de fora — o caller precisa ver que eles existem. */
  skipped: number;
  total: bigint;
  paid: boolean;
}

export function attendanceSummary(dto: EventAttendanceDto): AttendanceSummary {
  const paying = dto.lines.filter((l) => l.skip === null).length;
  return { paying, skipped: dto.lines.length - paying, total: BigInt(dto.total), paid: dto.paidAt !== null };
}

/** Motivo pelo qual o botão de fechar não vai, ou `null` quando vai. Dito antes do clique, não num 409. */
export function attendanceBlockedReason(dto: EventAttendanceDto): string | null {
  if (dto.paidAt !== null) return "A Buffunfa deste evento já foi paga.";
  if (!dto.measured) return "Este evento não teve canal de voz carimbado: sem presença medida, ninguém recebe Buffunfa.";
  return null;
}

/** Frase do que o fechamento vai criar. É moeda nascendo do nada: o número aparece antes do clique. */
export function attendancePayoutText(dto: EventAttendanceDto): string {
  const { paying, total } = attendanceSummary(dto);
  if (!dto.measured) return "Nada a pagar: a presença deste evento não foi medida.";
  if (paying === 0) return "Ninguém bateu os 90% de presença: o fechamento não cria Buffunfa nenhuma.";
  return `${paying === 1 ? "1 pessoa recebe" : `${paying} pessoas recebem`} — ${total} de Buffunfa criada no fechamento.`;
}

/** Motivo de cada linha que fica de fora, em PT-BR. `null` para quem recebe. */
export const attendanceSkipText = (line: EventAttendanceLineDto): string | null => (line.skip ? ATTENDANCE_SKIP_LABELS[line.skip] : null);

/** `10 a 40 BUF` / `sem Buffunfa`: a faixa que o template impôs e da qual o caller não sai (F6-8). */
export const roleRangeText = (role: Pick<EventRoleSlotDto, "buffunfaMin" | "buffunfaMax">): string => formatBuffunfaRange(roleBuffunfaRange(role));

export type RoleValueCheck = { ok: true; value: bigint } | { ok: false; error: string };

/**
 * Valida o campo antes de mandar: Buffunfa é inteira, nunca abreviada (F6-5) e nunca fora da faixa.
 * A recusa do servidor continua existindo — isto só evita gastar uma request para ouvir o óbvio.
 */
export function checkRoleValue(text: string, role: Pick<EventRoleSlotDto, "buffunfaMin" | "buffunfaMax">): RoleValueCheck {
  const range = roleBuffunfaRange(role);
  const value = parseAmount(text.trim(), "buffunfa");
  if (value === null) return { ok: false, error: "Use um número inteiro de Buffunfa (ex: 25)." };
  if (!inBuffunfaRange(value, range)) return { ok: false, error: `O template deste evento permite de ${range.min} a ${range.max} de Buffunfa nesta role.` };
  return { ok: true, value };
}
