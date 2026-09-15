import { REJECTION_NOTE_MAX_LENGTH } from "@albion-hub/shared";

/**
 * Embed do pedido de nick no canal da staff (TASK-015, Q14/Q18/Q31). Funções puras: montam dados planos
 * (sem discord.js) que o gateway converte em mensagem. Copy PT-BR.
 */

export const NICK_APPROVE_BUTTON = "nick/approve/:id";
export const NICK_REJECT_BUTTON = "nick/reject/:id";
export const NICK_REJECT_MODAL = "nick/reject-modal/:id";
/** Campo de texto do modal de recusa. */
export const NICK_REJECT_NOTE_FIELD = "note";

const withId = (pattern: string, requestId: string) => pattern.replace(":id", requestId);
export const approveButtonId = (requestId: string) => withId(NICK_APPROVE_BUTTON, requestId);
export const rejectButtonId = (requestId: string) => withId(NICK_REJECT_BUTTON, requestId);
export const rejectModalId = (requestId: string) => withId(NICK_REJECT_MODAL, requestId);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** customId vem do cliente Discord: só aceita uuid antes de tocar o banco. */
export const isNickRequestId = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

export const NICK_EMBED_COLORS = { pending: 0xf1c40f, approved: 0x2ecc71, rejected: 0xe74c3c } as const;

/** Extensão TASK-016: resultado da busca do nick na API do Albion (ajuda, não bloqueio — Q14). */
export interface NickLookupView {
  /** Texto curto já em PT-BR, ex.: saída de describeAlbionLookup. */
  summary: string;
}

export interface NickEmbedInput {
  requestId: string;
  requesterDiscordId: string;
  /** Nick vigente de quem pediu (null = primeiro nick). */
  currentNick: string | null;
  nick: string;
  status: "pending" | "approved" | "rejected";
  createdAt: Date;
  decidedAt: Date | null;
  deciderDiscordId: string | null;
  decisionNote: string | null;
  lookup?: NickLookupView | null;
}

interface NickEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

interface NickEmbedButton {
  customId: string;
  label: string;
  style: "success" | "danger";
}

export interface NickEmbedView {
  title: string;
  color: number;
  fields: NickEmbedField[];
  /** Vazio depois da decisão: botões somem (AC#4). */
  buttons: NickEmbedButton[];
}

const mention = (discordId: string | null) => (discordId ? `<@${discordId}>` : "staff");
const when = (date: Date) => `<t:${Math.floor(date.getTime() / 1000)}:f>`;

export function buildNickEmbed(input: NickEmbedInput): NickEmbedView {
  const fields: NickEmbedField[] = [{ name: "Membro", value: `<@${input.requesterDiscordId}>`, inline: true }];
  if (input.status === "pending") {
    fields.push({ name: "Nick", value: input.currentNick ? `${input.currentNick} → ${input.nick}` : `Primeiro nick: ${input.nick}`, inline: true });
  } else {
    fields.push({ name: "Nick pedido", value: input.nick, inline: true });
  }
  fields.push({ name: "Pedido em", value: when(input.createdAt) });
  if (input.lookup) fields.push({ name: "Albion", value: input.lookup.summary });

  if (input.status === "pending") {
    fields.push({ name: "Status", value: "Aguardando staff" });
    return {
      title: "Novo pedido de nick",
      color: NICK_EMBED_COLORS.pending,
      fields,
      buttons: [
        { customId: approveButtonId(input.requestId), label: "Aprovar nick", style: "success" },
        { customId: rejectButtonId(input.requestId), label: "Recusar", style: "danger" },
      ],
    };
  }

  const decidedAt = input.decidedAt ? ` em ${when(input.decidedAt)}` : "";
  if (input.status === "approved") {
    fields.push({ name: "Status", value: `Aprovado por ${mention(input.deciderDiscordId)}${decidedAt}` });
    return { title: "Pedido de nick aprovado", color: NICK_EMBED_COLORS.approved, fields, buttons: [] };
  }
  fields.push({ name: "Status", value: `Recusado por ${mention(input.deciderDiscordId)}${decidedAt}` });
  fields.push({ name: "Motivo", value: input.decisionNote?.trim() || "Sem motivo registrado." });
  return { title: "Pedido de nick recusado", color: NICK_EMBED_COLORS.rejected, fields, buttons: [] };
}

/** Modal de recusa: motivo obrigatório com o mesmo limite do painel (validateRejectionNote). */
export function buildRejectModal(requestId: string, nick: string | null) {
  return {
    customId: rejectModalId(requestId),
    title: nick ? `Recusar nick ${nick}`.slice(0, 45) : "Recusar nick",
    field: { customId: NICK_REJECT_NOTE_FIELD, label: "Motivo da recusa (o membro vê)", minLength: 1, maxLength: REJECTION_NOTE_MAX_LENGTH },
  };
}

/** Respostas efêmeras para quem clica (PT-BR, Q18). */
export const NICK_BUTTON_REPLIES = {
  notRegistered: "Só a staff pode decidir pedidos de nick. Sua conta Discord não está no painel: entre no painel e peça acesso a um admin.",
  notStaff: "Só a staff pode aprovar ou recusar pedidos de nick.",
  invalid: "Pedido inválido. Use a fila em /staff/membros no painel.",
  notFound: "Pedido não encontrado. Ele pode ter sido removido.",
  alreadyDecided: "Esse pedido já foi decidido. Atualizei a mensagem com o resultado.",
  failed: "Não consegui registrar a decisão. Tente de novo ou use o painel.",
  approved: (nick: string) => `Nick ${nick} aprovado.`,
  rejected: (nick: string) => `Nick ${nick} recusado. O membro vê o motivo no painel.`,
} as const;
