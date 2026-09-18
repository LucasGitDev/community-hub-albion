import { formatAmount, type Currency } from "@albion-hub/shared";

/**
 * Timeline da plataforma (TASK-076, decisões T1 a T14 do doc-005): uma linha por operação que muda
 * estado, publicada num canal do Discord só de admins. Este arquivo é o **contrato** que os serviços
 * usam — nada aqui conhece Discord (T3). Quando a gravação em banco entrar, ela entra atrás de
 * `TimelinePublisher` sem mexer em serviço nenhum.
 */

/** Token de injeção do publicador. Sempre existe na aplicação: sem canal configurado, é o no-op (T6). */
export const TIMELINE_PUBLISHER = Symbol("TIMELINE_PUBLISHER");

/** Área da plataforma. Dá a cor do embed e o prefixo da ação. */
export type TimelineDomain = "account" | "event" | "economy" | "shop" | "referral" | "maintenance";

/**
 * Ação estável, em `dominio.verbo` (ex.: `event.signups_closed`, `economy.withdrawal_approved`).
 * É a chave que os testes afirmam e, no futuro, a coluna do banco — não é texto para humano.
 */
export type TimelineAction = `${TimelineDomain}.${string}`;

/**
 * Quem fez. `maintenance` é o ator das rotas `/api/maintenance` (T9): elas não têm usuário, e o canal
 * precisa mostrá-las sempre. `system` é o que roda sozinho (limpeza diária, pagamento automático).
 */
export type TimelineActor =
  | { kind: "user"; userId: string; name: string; discordId?: string | null }
  | { kind: "maintenance" }
  | { kind: "system"; name: string };

/** Sobre quem ou o quê. `name` é o que aparece; `id` e `discordId` ajudam a achar o registro. */
export interface TimelineTarget {
  name: string;
  id?: string | null;
  discordId?: string | null;
}

/** Valor sempre inteiro (`bigint`, Q20) e sempre com moeda: prata e Buffunfa nunca se confundem. */
export interface TimelineAmount {
  value: bigint;
  currency: Currency;
  /** Rótulo opcional quando há mais de um valor (ex.: "Taxa", "Total do split"). */
  label?: string;
}

export interface TimelineDetail {
  name: string;
  value: string;
}

/** Lista longa (inscritos no fechamento, T8; pagos de um lote). Uma linha por item. */
export interface TimelineList {
  title: string;
  items: readonly string[];
}

export interface TimelineEntry {
  action: TimelineAction;
  /** Frase curta para o humano, vira o título do embed (ex.: "Inscrições fechadas: Raid T8 Avalon"). */
  summary: string;
  actor: TimelineActor;
  target?: TimelineTarget;
  amounts?: readonly TimelineAmount[];
  /** ID do registro principal (pedido, saque, evento…). O embed mostra a forma curta e o ID inteiro no rodapé. */
  recordId?: string;
  /** Campos extras: motivo informado, status anterior e novo, item da loja. */
  details?: readonly TimelineDetail[];
  list?: TimelineList;
  /** Hora da operação. Padrão: o momento do `publish`, que acontece logo depois do commit (T5). */
  at?: Date;
}

/**
 * Porta de publicação. Regras do contrato:
 * - chame **depois do commit**, nunca dentro da transação (T5);
 * - `publish` é síncrono, **nunca lança e nunca espera o Discord** (T6): a entrega é em segundo plano.
 */
export interface TimelinePublisher {
  publish(entry: TimelineEntry): void;
}

/** Forma neutra do embed da timeline (sem discord.js). O gateway só traduz para a API. */
export interface TimelineEmbed {
  title: string;
  description?: string;
  color: number;
  fields: { name: string; value: string; inline: boolean }[];
  footer: string;
  /** ISO 8601: o Discord mostra na hora local de quem lê. */
  timestamp: string;
}

const COLORS: Record<TimelineDomain, number> = {
  account: 0x5865f2,
  event: 0x3ba55d,
  economy: 0xf1c40f,
  shop: 0xe67e22,
  referral: 0x9b59b6,
  maintenance: 0xed4245,
};

/** Limites do Discord por embed; a soma de todos os embeds de uma mensagem cabe em 6000. */
export const DISCORD_EMBED_LIMITS = { title: 256, description: 4096, fieldName: 256, fieldValue: 1024, footer: 2048, fields: 25, total: 6000 } as const;
/** Teto da lista: deixa folga para os campos e para um vizinho no mesmo lote. */
const LIST_BUDGET = 3000;
const MAX_DETAILS = 15;

/** ID curto para leitura rápida (os 8 primeiros caracteres de um UUID bastam para achar no painel). */
export function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

/** Nome vindo de usuário não vira formatação nem bloco de código no canal. */
export function escapeMarkdown(text: string): string {
  return text.replace(/([\\*_~`|>[\]()#-])/g, "\\$1");
}

/** Trecho em bloco de código: sem crase dentro, o bloco nunca quebra. */
function code(text: string): string {
  return `\`${text.replace(/`/g, "")}\``;
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

export function describeActor(actor: TimelineActor): string {
  if (actor.kind === "maintenance") return "Manutenção (/api/maintenance)";
  if (actor.kind === "system") return `Sistema: ${escapeMarkdown(actor.name)}`;
  return withDiscord(escapeMarkdown(actor.name), actor.discordId);
}

function describeTarget(target: TimelineTarget): string {
  const base = withDiscord(escapeMarkdown(target.name), target.discordId);
  return target.id ? `${base}\n${code(shortId(target.id))}` : base;
}

// Menção só identifica: a mensagem sai com allowed_mentions vazio, ninguém é notificado.
function withDiscord(name: string, discordId?: string | null): string {
  return discordId && /^\d{17,20}$/.test(discordId) ? `${name} (<@${discordId}>)` : name;
}

function describeAmount(amount: TimelineAmount): TimelineEmbed["fields"][number] {
  const name = amount.label ? `${amount.label}` : amount.currency === "silver" ? "Prata" : "Buffunfa";
  return { name: clip(name, DISCORD_EMBED_LIMITS.fieldName), value: formatAmount(amount.value, amount.currency), inline: true };
}

/** Lista cortada no orçamento com "… e mais N", para o embed nunca ser recusado. */
function describeList(list: TimelineList): string {
  const header = `**${escapeMarkdown(list.title)}** (${list.items.length})`;
  const lines: string[] = [];
  let used = header.length;
  for (let i = 0; i < list.items.length; i++) {
    const line = `• ${clip(escapeMarkdown(list.items[i]), 200)}`;
    const rest = list.items.length - i;
    if (used + line.length + 1 > LIST_BUDGET - 20) {
      lines.push(`… e mais ${rest}`);
      break;
    }
    lines.push(line);
    used += line.length + 1;
  }
  return lines.length ? `${header}\n${lines.join("\n")}` : `${header}\n(vazia)`;
}

/** Monta o embed de um registro (T2, T10): ator, alvo, valores na moeda certa, ID curto e hora. */
export function renderTimelineEmbed(entry: TimelineEntry, now: Date = new Date()): TimelineEmbed {
  const domain = entry.action.split(".")[0] as TimelineDomain;
  const fields: TimelineEmbed["fields"] = [{ name: "Ator", value: clip(describeActor(entry.actor), DISCORD_EMBED_LIMITS.fieldValue), inline: true }];
  if (entry.target) fields.push({ name: "Alvo", value: clip(describeTarget(entry.target), DISCORD_EMBED_LIMITS.fieldValue), inline: true });
  if (entry.recordId) fields.push({ name: "ID", value: code(shortId(entry.recordId)), inline: true });
  for (const amount of entry.amounts ?? []) fields.push(describeAmount(amount));
  for (const detail of (entry.details ?? []).slice(0, MAX_DETAILS)) {
    fields.push({
      name: clip(escapeMarkdown(detail.name), DISCORD_EMBED_LIMITS.fieldName),
      value: clip(escapeMarkdown(detail.value) || "—", DISCORD_EMBED_LIMITS.fieldValue),
      inline: false,
    });
  }
  const footer = entry.recordId ? `${entry.action} · ${entry.recordId}` : entry.action;
  return fitEmbed({
    title: clip(escapeMarkdown(entry.summary), DISCORD_EMBED_LIMITS.title),
    ...(entry.list ? { description: describeList(entry.list) } : {}),
    color: COLORS[domain] ?? 0x99aab5,
    fields: fields.slice(0, DISCORD_EMBED_LIMITS.fields),
    footer: clip(footer, DISCORD_EMBED_LIMITS.footer),
    timestamp: (entry.at ?? now).toISOString(),
  });
}

/** Garante que um embed sozinho caiba numa mensagem: corta a lista e, se ainda faltar, os últimos campos. */
function fitEmbed(embed: TimelineEmbed): TimelineEmbed {
  const over = () => embedSize(embed) - DISCORD_EMBED_LIMITS.total;
  if (over() > 0 && embed.description) embed.description = clip(embed.description, Math.max(1, embed.description.length - over()));
  while (over() > 0 && embed.fields.length > 1) embed.fields.pop();
  return embed;
}

/** Caracteres que o Discord conta no limite de 6000 por mensagem. */
export function embedSize(embed: TimelineEmbed): number {
  return embed.title.length + (embed.description?.length ?? 0) + embed.footer.length + embed.fields.reduce((sum, f) => sum + f.name.length + f.value.length, 0);
}
