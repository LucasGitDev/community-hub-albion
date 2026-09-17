import { z } from "zod";
import { amountSchema } from "./currency.js";
import { BUFFUNFA_ROLE_MAX, type BuffunfaRange } from "./event-templates.js";
import { type SplitPresenceDto } from "./loot-split.js";

/**
 * Ganho de Buffunfa por participação em evento (TASK-057, F6-8 a F6-11).
 *
 * Tudo aqui é função pura, e é a **mesma** função que o servidor usa para gravar no ledger e que a
 * tela de fechamento usa para mostrar quem recebe — pelo mesmo motivo do loot split: o número
 * conferido na tela precisa ser o número creditado, inclusive no corte dos 90%.
 *
 * As três regras que este módulo faz valer:
 * - o valor é **por role** e vale o do fechamento para todos daquela role (F6-9), então nada aqui
 *   olha para o instante da inscrição — só para a role;
 * - presença é **binária**: 90% ou mais do tempo de vida da call paga cheio, abaixo disso paga nada
 *   (F6-10). Não existe proporcional. "Tempo de vida da call" é medido a partir da **primeira entrada
 *   no canal** (TASK-073), não do início do evento: entre um e outro o bot ainda está criando o canal
 *   e arrastando gente, e contar esse intervalo derrubava quem ficou o evento inteiro. Quem monta a
 *   janela é `eventCallWindowMs`, no repo — aqui ela chega pronta;
 * - evento sem canal de voz carimbado não paga a ninguém (F6-11), e o motivo aparece linha a linha
 *   em vez de a tabela vir vazia sem explicação.
 */

/** Corte de presença em basis points do tempo de vida da call: 90% (F6-10). */
export const ATTENDANCE_MIN_PRESENCE_BP = 9000;

/** Presença em basis points da janela; 0 quando não houve janela medida. */
export function attendancePresenceBp(presenceMs: number, windowMs: number): number {
  if (windowMs <= 0) return 0;
  return Math.min(10_000, Math.floor((presenceMs * 10_000) / windowMs));
}

/**
 * Bateu o corte? Comparação em inteiros (`presenceMs * 10000 >= windowMs * 9000`) de propósito: com
 * divisão em ponto flutuante, quem ficou exatamente 90% cairia ou não conforme o arredondamento.
 */
export function meetsAttendance(presenceMs: number, windowMs: number): boolean {
  if (windowMs <= 0) return false;
  return presenceMs * 10_000 >= windowMs * ATTENDANCE_MIN_PRESENCE_BP;
}

/** Por que uma pessoa que esteve no evento não recebe. Um motivo por linha, sempre o primeiro que bate. */
export type AttendanceSkipReason = "no_channel" | "not_signed_up" | "no_account" | "below_presence" | "zero_value";

/** Frase curta do motivo, para a tabela do fechamento. */
export const ATTENDANCE_SKIP_LABELS: Record<AttendanceSkipReason, string> = {
  no_channel: "evento sem canal medido",
  not_signed_up: "não estava inscrito",
  no_account: "sem conta no painel",
  below_presence: "presença abaixo de 90%",
  zero_value: "role sem valor definido",
};

/** Uma linha do pagamento de Buffunfa: quem, por qual role, quanto e — quando não recebe — por quê. */
export interface AttendanceRow {
  /** `discordUserId`: existe com ou sem conta no painel, igual à tabela do split. */
  key: string;
  userId: string | null;
  /** Já resolvido: quem não tem conta aparece como "Discord 1234", nunca como linha sem nome. */
  nick: string;
  roleName: string | null;
  presenceMs: number;
  presenceBp: number;
  /** Valor da role no fechamento, mesmo quando a linha não recebe: é o que explica o número. */
  roleValue: bigint;
  amount: bigint;
  skip: AttendanceSkipReason | null;
}

export interface AttendanceInput {
  /** Tempo de vida da call em ms. */
  windowMs: number;
  /** Evento tem `presence_channel_id`? Sem ele ninguém recebe (F6-11). */
  measured: boolean;
  /** Valor vigente por nome de role, no fechamento (F6-9). */
  valueByRole: ReadonlyMap<string, bigint>;
}

const nickOf = (nick: string | null, discordUserId: string): string => nick ?? `Discord ${discordUserId.slice(-4)}`;

/**
 * Transforma a presença medida do evento nas linhas do pagamento, na ordem "quem recebe primeiro,
 * maior presença antes". Quem não recebe continua na lista com o motivo — o caller precisa ver que a
 * pessoa apareceu e ficou de fora, senão o "não recebi" vira conversa sem registro.
 */
export function attendanceRows(present: readonly SplitPresenceDto[], input: AttendanceInput): AttendanceRow[] {
  const rows = present.map((p): AttendanceRow => {
    const roleValue = (p.roleName && input.valueByRole.get(p.roleName)) || 0n;
    const presenceBp = attendancePresenceBp(p.presenceMs, input.windowMs);
    const skip: AttendanceSkipReason | null = !input.measured
      ? "no_channel"
      : !p.signedUp || !p.roleName
        ? "not_signed_up"
        : p.userId === null
          ? "no_account"
          : !meetsAttendance(p.presenceMs, input.windowMs)
            ? "below_presence"
            : roleValue <= 0n
              ? "zero_value"
              : null;
    return {
      key: p.discordUserId,
      userId: p.userId,
      nick: nickOf(p.nick, p.discordUserId),
      roleName: p.roleName,
      presenceMs: p.presenceMs,
      presenceBp,
      roleValue,
      amount: skip === null ? roleValue : 0n,
      skip,
    };
  });
  return rows.sort((a, b) => (a.skip === null ? 0 : 1) - (b.skip === null ? 0 : 1) || b.presenceMs - a.presenceMs || a.nick.localeCompare(b.nick, "pt-BR"));
}

/** Total de Buffunfa que o fechamento vai criar. É criação do nada: quem olha isto precisa do número. */
export function attendanceTotal(rows: readonly AttendanceRow[]): bigint {
  return rows.reduce((sum, row) => sum + row.amount, 0n);
}

/** Memo do lançamento: o extrato do membro precisa dizer de qual evento e de qual role veio. */
export function attendanceMemo(eventName: string, roleName: string): string {
  return `Presença em ${eventName} (${roleName})`;
}

/* ------------------------------------------------------------------- dtos */

/**
 * Troca do valor de Buffunfa do evento, em lote ou por role (TASK-072): qualquer inteiro de zero ao
 * teto do sistema, só até o fechamento. O mesmo corpo serve às duas rotas — o alvo está na URL, não
 * no JSON, então não existe um jeito de pedir o lote "sem querer".
 */
export const eventRoleBuffunfaSchema = z.object({
  value: amountSchema("O valor de Buffunfa", " de Buffunfa").refine((v) => v <= BUFFUNFA_ROLE_MAX, `O valor de Buffunfa vai até ${BUFFUNFA_ROLE_MAX}.`),
});
export type EventRoleBuffunfaInput = z.output<typeof eventRoleBuffunfaSchema>;

/** Linha do pagamento como a API devolve. Valores em string (Q20). */
export interface EventAttendanceLineDto {
  key: string;
  userId: string | null;
  nick: string;
  roleName: string | null;
  presenceMs: number;
  presenceBp: number;
  roleValue: string;
  amount: string;
  skip: AttendanceSkipReason | null;
}

/** Prévia (antes) e recibo (depois) do pagamento: mesma forma, para a tela não ter dois desenhos. */
export interface EventAttendanceDto {
  /** Tempo de vida da call em ms; 0 quando o evento não tem janela medida. */
  windowMs: number;
  /** Evento tem canal de presença carimbado? False = ninguém recebe (F6-11). */
  measured: boolean;
  /** Já pago? A partir daqui nada muda: o ledger é imutável (AC#6). */
  paidAt: string | null;
  lines: EventAttendanceLineDto[];
  /** Soma do que vai ser (ou foi) criado, como string. */
  total: string;
}

export const attendanceLineToDto = (row: AttendanceRow): EventAttendanceLineDto => ({
  key: row.key,
  userId: row.userId,
  nick: row.nick,
  roleName: row.roleName,
  presenceMs: row.presenceMs,
  presenceBp: row.presenceBp,
  roleValue: row.roleValue.toString(),
  amount: row.amount.toString(),
  skip: row.skip,
});

export const attendanceLineFromDto = (dto: EventAttendanceLineDto): AttendanceRow => ({
  key: dto.key,
  userId: dto.userId,
  nick: dto.nick,
  roleName: dto.roleName,
  presenceMs: dto.presenceMs,
  presenceBp: dto.presenceBp,
  roleValue: BigInt(dto.roleValue),
  amount: BigInt(dto.amount),
  skip: dto.skip,
});

/** Faixa da role do evento, já em bigint, para a tela e o servidor checarem a mesma coisa. */
export const roleBuffunfaRange = (role: { buffunfaMin: string; buffunfaMax: string }): BuffunfaRange => ({ min: BigInt(role.buffunfaMin), max: BigInt(role.buffunfaMax) });
