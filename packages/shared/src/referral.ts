import { formatAmount } from "./currency.js";

/**
 * Indicação declarada (TASK-074, F11). O desenho **não tem link de convite**: o indicado *declara*
 * quem o indicou, digitando o nick, por dois caminhos que gravam a mesma coisa — a opção do
 * `/registrar` e o comando próprio. A chave ser digitada (e não clicada) é o que faz autoindicação,
 * nick inexistente e nick de quem saiu virarem casos de verdade, tratados aqui.
 *
 * Uma pessoa declara **uma vez só**, e o campo não se troca depois — a garantia é do banco
 * (trigger em `users`), não deste módulo. Por isso "declarar depois" é caso normal e não tem prazo:
 * sempre há espaço para indicação retroativa.
 */

/**
 * Bônus fixo em Buffunfa, decidido pelo usuário em 2026-09-17: **os dois lados recebem**, e os dois
 * créditos nascem do mesmo evento de pagamento (uma transação, dois lançamentos — ou os dois existem,
 * ou nenhum). Valor fixo de propósito: não existe tela de configuração, mudar é mudar esta constante.
 *
 * Assimetria proposital: o indicador leva mais porque o trabalho de trazer alguém é dele; o indicado
 * leva um agrado de boas-vindas, que é também o que faz valer a pena ele declarar.
 */
export const REFERRAL_BONUS = {
  /** Vai para quem indicou. Não é pago quando o teto mensal estourou, ou quando o indicador está banido/fora do servidor. */
  referrer: 10n,
  /** Vai para quem foi indicado. Pago **sempre** que a indicação é liquidada: ninguém é punido por limite alheio. */
  referred: 2n,
} as const;

/**
 * Teto de indicações **recompensadas por mês, por indicador** (F11). Da décima primeira em diante a
 * indicação continua sendo registrada e o indicado continua recebendo os dele — o que para é o crédito
 * do indicador. O mês é o mês civil em UTC, o mesmo corte usado para contar.
 */
export const REFERRAL_MONTHLY_REWARD_CAP = 10;

/** Por que o indicador não recebeu, mesmo com a indicação válida e liquidada. */
export type ReferrerSkipReason = "monthly_cap" | "unavailable";

/**
 * O que aconteceu com o dinheiro. `pending` é a indicação registrada antes da aprovação do nick: ela
 * fica esperando, e quem liquida é a aprovação (o que acontecer por último dispara o pagamento).
 */
export type ReferralReward =
  | { kind: "pending" }
  | { kind: "paid" }
  | { kind: "paid_referred_only"; reason: ReferrerSkipReason }
  /** Já tinha sido liquidada antes: nada foi lançado agora (idempotência do pagamento). */
  | { kind: "already_settled" };

/** Resultado da declaração, sem tipos de banco: serve ao bot e ao painel. */
export type ReferralDeclarationOutcome =
  | { kind: "invalid"; error: string }
  | { kind: "self" }
  | { kind: "already_declared"; referrerNick: string | null }
  | { kind: "referrer_not_found"; nick: string }
  /** Escolheu pelo @ alguém que existe no Discord mas nunca entrou no painel (TASK-075). */
  | { kind: "referrer_not_registered"; name: string }
  | { kind: "declared"; referrerNick: string; reward: ReferralReward };

const buf = (value: bigint) => formatAmount(value, "buffunfa");

/** Como a indicação aparece na listagem da staff e no motivo do estorno. */
export const REFERRAL_LEDGER_MEMO = {
  referrer: (referredNick: string) => `Indicação de ${referredNick}`,
  referred: (referrerNick: string) => `Bônus de boas-vindas: indicado por ${referrerNick}`,
} as const;

function rewardLine(reward: ReferralReward): string {
  switch (reward.kind) {
    case "pending":
      return `O bônus entra quando a staff aprovar seu nick: ${buf(REFERRAL_BONUS.referred)} para você e ${buf(REFERRAL_BONUS.referrer)} para quem indicou.`;
    case "paid":
      return `Você recebeu ${buf(REFERRAL_BONUS.referred)} e quem indicou recebeu ${buf(REFERRAL_BONUS.referrer)}.`;
    case "paid_referred_only":
      return reward.reason === "monthly_cap"
        ? `Você recebeu ${buf(REFERRAL_BONUS.referred)}. Quem indicou já bateu o teto de ${REFERRAL_MONTHLY_REWARD_CAP} indicações recompensadas neste mês, então desta vez não leva o bônus dele.`
        : `Você recebeu ${buf(REFERRAL_BONUS.referred)}. Quem indicou não está mais ativo no servidor, então o bônus dele não foi pago.`;
    case "already_settled":
      return "O bônus desta indicação já tinha sido pago.";
  }
}

/** Texto da resposta efêmera da declaração (bot). Toda recusa diz o que fazer a seguir (Q18). */
export function buildReferralReply(outcome: ReferralDeclarationOutcome): string {
  switch (outcome.kind) {
    case "invalid":
      return `Nick de quem indicou inválido: ${outcome.error}`;
    case "self":
      return "Você não pode indicar a si mesmo. Coloque o nick de quem te trouxe para a guilda.";
    case "already_declared":
      return outcome.referrerNick
        ? `Você já declarou **${outcome.referrerNick}** como quem te indicou, e isso não muda mais. Se estiver errado, fale com a staff.`
        : "Você já declarou quem te indicou, e isso não muda mais. Se estiver errado, fale com a staff.";
    case "referrer_not_found":
      return `Não achei ninguém com o nick **${outcome.nick}** no painel. Confira a grafia e peça para essa pessoa registrar o nick dela com \`/registrar\` — depois disso você declara de novo.`;
    case "referrer_not_registered":
      return `**${outcome.name}** ainda não entrou no painel, então não dá para registrar a indicação. Peça para essa pessoa entrar no painel ou usar \`/registrar\` — depois disso você declara de novo.`;
    case "declared":
      return `Indicação registrada: **${outcome.referrerNick}** te indicou. ${rewardLine(outcome.reward)}`;
  }
}

/** Uma indicação como a API devolve para a staff (TASK-074, AC#8). */
export interface ReferralDto {
  /** Quem foi indicado: é na linha dele que o campo write-once mora. */
  referred: { id: string; name: string; gameNick: string | null };
  referrer: { id: string; name: string; gameNick: string | null };
  declaredAt: string;
  /** Quando os lançamentos nasceram; null enquanto o nick do indicado não foi aprovado. */
  rewardedAt: string | null;
  /** false quando o indicador não levou o bônus dele (teto do mês, banido ou fora do servidor). */
  referrerPaid: boolean;
  /** true depois que a staff estornou: os lançamentos continuam lá, com o estorno ao lado. */
  reversed: boolean;
}

export interface MemberReferralsDto {
  /** Quem indicou este membro; null quando ele nunca declarou. */
  declared: ReferralDto | null;
  /** Indicações feitas por ele, da mais nova para a mais antiga. */
  made: ReferralDto[];
  /** Quantas das dele foram recompensadas no mês civil corrente (para a staff ver o teto de perto). */
  rewardedThisMonth: number;
}

export const REFERRAL_REVERSAL_REASON_MAX_LENGTH = 300;

export type ReferralReversalReasonValidation = { ok: true; reason: string } | { ok: false; error: string };

/** Estorno de indicação exige motivo: é a única correção possível num ledger append-only, então precisa explicar. */
export function validateReferralReversalReason(input: unknown): ReferralReversalReasonValidation {
  const reason = typeof input === "string" ? input.trim() : "";
  if (!reason) return { ok: false, error: "Escreva o motivo do estorno: ele fica no extrato dos dois lados." };
  if (reason.length > REFERRAL_REVERSAL_REASON_MAX_LENGTH)
    return { ok: false, error: `O motivo tem no máximo ${REFERRAL_REVERSAL_REASON_MAX_LENGTH} caracteres.` };
  return { ok: true, reason };
}

/** Nome do comando próprio, e da opção que o `/registrar` ganha (AC#1 e AC#2). */
export const REFERRAL_COMMAND = {
  name: "indicacao",
  description: "Declara quem te indicou para a guilda (uma vez só, não muda depois)",
  option: {
    name: "indicado_por",
    // Opção do tipo usuário (TASK-075): o Discord abre o seletor de membros ao digitar @.
    description: "Quem te indicou (digite @ e escolha). Uma vez declarado não muda.",
  },
} as const;
