import { eventCancelledText, eventJoinButtonId, eventLeaveButtonId, eventStatusLabel, freeSlots, MAX_EVENT_ROLE_BUTTONS, roleButtonLabel, type EventStatus } from "@albion-hub/shared";
import type { EmbedButton, EmbedField, EmbedView } from "./embed-view.js";

/**
 * Embed de inscrição do evento no canal de eventos (TASK-022, Q27). Funções puras: montam dados planos
 * (sem discord.js) que o gateway vira mensagem. Copy PT-BR.
 *
 * O embed é a lista do evento: um botão por role com as vagas livres, quem está confirmado, quem está
 * na espera e um "Sair". Fora de `open` os botões aparecem desabilitados — a lista continua visível
 * (a galera confere onde ficou), mas ninguém entra nem sai (AC#5).
 *
 * Cancelado (TASK-025, AC#4) é o único estado sem botão nenhum: a mensagem vira o aviso "Evento
 * cancelado" com o motivo. Deixar botões cinza ali faria a mensagem parecer um evento que ainda vai
 * acontecer, e as inscrições já foram todas canceladas — não há lista para conferir.
 */

export const EVENT_EMBED_COLORS: Record<EventStatus, number> = {
  draft: 0x95a5a6,
  open: 0x2ecc71,
  closed: 0xf1c40f,
  running: 0x3498db,
  finished: 0x7f8c8d,
  cancelled: 0xe74c3c,
};

export interface EventEmbedMember {
  discordId: string;
  /** Nick do Albion quando já aprovado; só enfeita a menção. */
  gameNick: string | null;
}

export interface EventEmbedRole {
  slotId: string;
  name: string;
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

export function buildEventEmbed(input: EventEmbedInput): EmbedView {
  const open = input.status === "open";
  const cancelled = input.status === "cancelled";
  const fields: EmbedField[] = [];
  const header = [input.templateName ? `Template: ${input.templateName}` : null, input.startsAt ? `Início: ${when(input.startsAt)}` : "Sem horário marcado"].filter(Boolean);
  fields.push({ name: "Evento", value: header.join(" · ") });
  if (cancelled)
    return {
      title: input.name,
      description: input.description ?? undefined,
      color: EVENT_EMBED_COLORS.cancelled,
      fields: [...fields, { name: "Situação", value: `${eventCancelledText(input.cancelReason)} Todas as inscrições foram canceladas.` }],
      buttons: [],
    };
  if (!open) fields.push({ name: "Situação", value: `Evento ${eventStatusLabel(input.status)}. As inscrições não estão abertas.` });

  for (const role of input.roles) {
    fields.push({
      name: `${role.name} (${role.confirmed.length}/${role.slots})`,
      value: lines(role.confirmed.map(member), freeSlots({ slots: role.slots, confirmed: role.confirmed.length }) > 0 ? "Vaga livre" : "—"),
      inline: true,
    });
  }

  const waiting = input.roles.flatMap((role) => role.waitlist.map((m, i) => `${i + 1}. ${member(m)} — ${role.name}`));
  if (waiting.length > 0) fields.push({ name: "Lista de espera", value: lines(waiting, "—") });
  if (input.roles.length === 0) fields.push({ name: "Roles", value: "Esse evento não tem nenhuma role configurada." });

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
  notRegistered: "Sua conta Discord ainda não está no painel. Use /registrar para pedir seu nick e entrar na comunidade.",
  notMember: "Você ainda não tem acesso de membro. Peça seu nick com /registrar e espere a staff aprovar.",
  invalid: "Botão inválido. Atualize a mensagem do evento e tente de novo.",
  notFound: "Esse evento não existe mais.",
  unknownRole: "Essa role não é mais desse evento. A mensagem foi atualizada.",
  notOpen: (status: EventStatus) => `As inscrições não estão abertas: o evento está ${eventStatusLabel(status)}.`,
  alreadyInRole: (role: string) => `Você já está em ${role}.`,
  notSignedUp: "Você não está inscrito neste evento.",
  confirmed: (role: string) => `Inscrição confirmada em ${role}.`,
  waitlisted: (role: string, position: number) => `${role} está lotada: você entrou na lista de espera, na posição ${position}. Se abrir vaga, você sobe automaticamente.`,
  left: "Você saiu do evento.",
  failed: "Não consegui registrar sua inscrição. Tente de novo em instantes.",
} as const;
