import {
  entryFeeLabel,
  eventCancelledText,
  eventJoinButtonId,
  eventLeaveButtonId,
  eventStatusLabel,
  formatAmount,
  freeSlots,
  insufficientEntryFeeMessage,
  MAX_EVENT_ROLE_BUTTONS,
  NO_ENTRY_FEE,
  roleButtonLabel,
  type EventStatus,
} from "@albion-hub/shared";
import type { EmbedButton, EmbedField, EmbedView } from "./embed-view.js";

/**
 * Embed de inscrição do evento no canal de eventos (TASK-022, Q27). Funções puras: montam dados planos
 * (sem discord.js) que o gateway vira mensagem. Copy PT-BR.
 *
 * O embed é a lista do evento: um botão por role com as vagas livres, quem está confirmado, quem está
 * na espera e um "Sair". Fora de `open` os botões aparecem desabilitados — a lista continua visível
 * (a galera confere onde ficou), mas ninguém entra nem sai (AC#5).
 *
 * Cancelado (TASK-025, AC#4) e arquivado (TASK-044, AC#3) são os estados sem botão nenhum: a mensagem
 * vira um aviso de fim. Deixar botões cinza ali faria a mensagem parecer um evento que ainda vai
 * acontecer; no cancelado as inscrições já caíram todas, e no arquivado nada mais muda.
 */

export const EVENT_EMBED_COLORS: Record<EventStatus, number> = {
  draft: 0x95a5a6,
  open: 0x2ecc71,
  closed: 0xf1c40f,
  running: 0x3498db,
  finished: 0x7f8c8d,
  cancelled: 0xe74c3c,
  archived: 0x34495e,
};

export interface EventEmbedMember {
  discordId: string;
  /** Nick do Albion quando já aprovado; só enfeita a menção. */
  gameNick: string | null;
}

export interface EventEmbedRole {
  slotId: string;
  name: string;
  /** O que se espera de quem pega a role (TASK-039); null quando ninguém escreveu. */
  description: string | null;
  slots: number;
  confirmed: EventEmbedMember[];
  waitlist: EventEmbedMember[];
}

export interface EventEmbedInput {
  eventId: string;
  name: string;
  description: string | null;
  templateName: string | null;
  status: EventStatus;
  startsAt: Date | null;
  roles: EventEmbedRole[];
  /** Motivo do cancelamento (TASK-025); só aparece com o evento cancelado. */
  cancelReason?: string | null;
  /**
   * Taxa de entrada em Buffunfa (TASK-058, F6-12). Vai no embed porque é cobrada **no clique**: quem
   * descobre o preço depois de pagar não teve escolha nenhuma. Zero não aparece — evento gratuito é o normal.
   */
  entryFee?: bigint;
}

const when = (date: Date) => `<t:${Math.floor(date.getTime() / 1000)}:f>`;
const member = (m: EventEmbedMember) => (m.gameNick ? `<@${m.discordId}> (${m.gameNick})` : `<@${m.discordId}>`);
/** Campo do Discord aceita 1024 caracteres; corta na linha para não partir uma menção no meio. */
const lines = (values: string[], empty: string) => {
  if (values.length === 0) return empty;
  const kept: string[] = [];
  let size = 0;
  for (const value of values) {
    if (size + value.length + 1 > 1000) {
      kept.push(`… e mais ${values.length - kept.length}`);
      break;
    }
    kept.push(value);
    size += value.length + 1;
  }
  return kept.join("\n");
};

/** Teto de campos do embed no Discord. O guia de roles só entra se ainda couber. */
const MAX_EMBED_FIELDS = 25;
/** A descrição inteira (200) espicharia a mensagem com 6 roles; o guia é chamada, não manual. */
const ROLE_GUIDE_DESCRIPTION_MAX = 120;

const truncate = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`);

/**
 * "O que cada role faz" (TASK-039): um campo só, antes da lista, em vez de uma linha dentro de cada
 * role. Os campos de role são `inline` (três colunas estreitas) e a descrição ali viraria uma parede
 * de texto que empurra o roster pra baixo. Os botões continuam só nome + vagas: o label do Discord
 * tem 80 caracteres e é a contagem que muda a cada clique.
 */
function roleGuideField(input: EventEmbedInput): EmbedField | null {
  const described = input.roles.filter((r) => r.description);
  if (described.length === 0) return null;
  return { name: "O que cada role faz", value: lines(described.map((r) => `**${r.name}** — ${truncate(r.description!, ROLE_GUIDE_DESCRIPTION_MAX)}`), "—") };
}

/** Quem ficou em cada role e quem está na espera: a lista do evento, sem nenhuma ação. */
function roleFields(input: EventEmbedInput): EmbedField[] {
  const fields: EmbedField[] = input.roles.map((role) => ({
    name: `${role.name} (${role.confirmed.length}/${role.slots})`,
    value: lines(role.confirmed.map(member), freeSlots({ slots: role.slots, confirmed: role.confirmed.length }) > 0 ? "Vaga livre" : "—"),
    inline: true,
  }));
  const waiting = input.roles.flatMap((role) => role.waitlist.map((m, i) => `${i + 1}. ${member(m)} — ${role.name}`));
  if (waiting.length > 0) fields.push({ name: "Lista de espera", value: lines(waiting, "—") });
  if (input.roles.length === 0) fields.push({ name: "Roles", value: "Esse evento não tem nenhuma role configurada." });
  return fields;
}

/** Guia de roles + lista, respeitando o teto de campos do embed. */
function pushRoleFields(fields: EmbedField[], input: EventEmbedInput): void {
  const guide = roleGuideField(input);
  const list = roleFields(input);
  if (guide && fields.length + list.length < MAX_EMBED_FIELDS) fields.push(guide);
  fields.push(...list);
}

function archivedFields(base: EmbedField[], input: EventEmbedInput): EmbedField[] {
  const fields = [...base, { name: "Situação", value: "Evento arquivado. Acabou e já foi fechado: os dados, a taxa e os splits não mudam mais." }];
  pushRoleFields(fields, input);
  return fields;
}

export function buildEventEmbed(input: EventEmbedInput): EmbedView {
  const open = input.status === "open";
  const cancelled = input.status === "cancelled";
  const archived = input.status === "archived";
  const fields: EmbedField[] = [];
  const header = [
    input.templateName ? `Template: ${input.templateName}` : null,
    input.startsAt ? `Início: ${when(input.startsAt)}` : "Sem horário marcado",
    input.entryFee && input.entryFee > NO_ENTRY_FEE ? entryFeeLabel(input.entryFee) : null,
  ].filter(Boolean);
  fields.push({ name: "Evento", value: header.join(" · ") });
  if (cancelled)
    return {
      title: input.name,
      description: input.description ?? undefined,
      color: EVENT_EMBED_COLORS.cancelled,
      fields: [...fields, { name: "Situação", value: `${eventCancelledText(input.cancelReason)} Todas as inscrições foram canceladas.` }],
      buttons: [],
    };
  if (archived)
    return {
      title: input.name,
      description: input.description ?? undefined,
      color: EVENT_EMBED_COLORS.archived,
      // A lista fica: o arquivamento fecha o evento, não apaga quem jogou. O que some é a ação.
      fields: archivedFields(fields, input),
      buttons: [],
    };
  if (!open) fields.push({ name: "Situação", value: `Evento ${eventStatusLabel(input.status)}. As inscrições não estão abertas.` });

  pushRoleFields(fields, input);

  const buttons: EmbedButton[] = input.roles.slice(0, MAX_EVENT_ROLE_BUTTONS).map((role) => ({
    customId: eventJoinButtonId(role.slotId),
    label: roleButtonLabel({ name: role.name, slots: role.slots, confirmed: role.confirmed.length }),
    style: freeSlots({ slots: role.slots, confirmed: role.confirmed.length }) > 0 ? ("primary" as const) : ("secondary" as const),
    disabled: !open,
  }));
  buttons.push({ customId: eventLeaveButtonId(input.eventId), label: "Sair", style: "danger", disabled: !open });

  return {
    title: input.name,
    description: input.description ?? undefined,
    color: EVENT_EMBED_COLORS[input.status],
    fields,
    buttons,
  };
}

/** Respostas efêmeras dos botões (PT-BR). Nunca dizem nada sobre quem clicou além do que ele já sabe. */
export const EVENT_BUTTON_REPLIES = {
  accountCreated: "Criamos sua conta no painel a partir do seu Discord. Use /registrar quando quiser cadastrar seu nick do Albion (ele só é necessário quando entrar a prata dos eventos).",
  notMember: "Você ainda não tem acesso de membro. Peça seu nick com /registrar e espere a staff aprovar.",
  invalid: "Botão inválido. Atualize a mensagem do evento e tente de novo.",
  notFound: "Esse evento não existe mais.",
  unknownRole: "Essa role não é mais desse evento. A mensagem foi atualizada.",
  notOpen: (status: EventStatus) => `As inscrições não estão abertas: o evento está ${eventStatusLabel(status)}.`,
  alreadyInRole: (role: string) => `Você já está em ${role}.`,
  notSignedUp: "Você não está inscrito neste evento.",
  confirmed: (role: string) => `Inscrição confirmada em ${role}.`,
  /** Cobrança feita: o membro vê o que saiu da conta dele no mesmo instante em que entra na lista (F6-13). */
  charged: (fee: bigint) => `Taxa de entrada: ${formatAmount(fee, "buffunfa")} debitados da sua carteira. Saindo antes do evento começar, a gente devolve.`,
  refunded: (fee: bigint) => `Taxa de entrada devolvida: ${formatAmount(fee, "buffunfa")}.`,
  insufficientFunds: (fee: bigint, balance: bigint) => insufficientEntryFeeMessage(fee, balance),
  waitlisted: (role: string, position: number) => `${role} está lotada: você entrou na lista de espera, na posição ${position}. Se abrir vaga, você sobe automaticamente.`,
  left: "Você saiu do evento.",
  failed: "Não consegui registrar sua inscrição. Tente de novo em instantes.",
} as const;
