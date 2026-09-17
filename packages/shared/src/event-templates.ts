import { z } from "zod";
import { amountSchema } from "./currency.js";
import { entryFeeSchema, NO_ENTRY_FEE } from "./entry-fee.js";

/**
 * Catálogo global de roles e templates de evento (TASK-020, Q8). Mesmos schemas na API e nos formulários do painel.
 * Mensagens PT-BR dizem como corrigir.
 */
export const EVENT_ROLE_NAME_MAX = 40;
export const EVENT_ROLE_DESCRIPTION_MAX = 200;
export const EVENT_TEMPLATE_NAME_MAX = 60;
export const EVENT_TEMPLATE_DESCRIPTION_MAX = 300;
/** Teto sanitário de pessoas/vagas (maior conteúdo conhecido é 20; roaming sem teto usa `null`). */
export const EVENT_PARTY_SIZE_MAX = 300;

/** Roles iniciais do catálogo (decisão do usuário). Seed único na migration; staff edita no painel. */
export const DEFAULT_EVENT_ROLES = ["Tank", "Healer", "DPS Melee", "DPS Range", "Support", "Scout"] as const;

const requiredText = (label: string, max: number) =>
  z
    .string({ error: `Digite ${label}.` })
    .trim()
    .min(1, `Digite ${label}.`)
    .max(max, `${label[0]!.toUpperCase()}${label.slice(1)} tem no máximo ${max} caracteres.`);

/** Texto opcional: vazio vira null. */
const optionalText = (label: string, max: number) =>
  z
    .string()
    .trim()
    .max(max, `${label} tem no máximo ${max} caracteres.`)
    .nullish()
    .transform((v) => (v ? v : null));

const count = (label: string) =>
  z
    .number({ error: `${label} precisa ser um número inteiro.` })
    .int(`${label} precisa ser um número inteiro.`)
    .min(1, `${label} precisa ser pelo menos 1.`)
    .max(EVENT_PARTY_SIZE_MAX, `${label} vai até ${EVENT_PARTY_SIZE_MAX}.`);

export const eventRoleInputSchema = z.object({
  name: requiredText("o nome da role", EVENT_ROLE_NAME_MAX),
  description: optionalText("A descrição", EVENT_ROLE_DESCRIPTION_MAX),
});
export type EventRoleInput = z.output<typeof eventRoleInputSchema>;

export const eventRolePatchSchema = eventRoleInputSchema.partial();
export type EventRolePatch = z.output<typeof eventRolePatchSchema>;

const uuid = z.uuid("Role inválida.");

/**
 * Teto da faixa de Buffunfa por role. Existe porque Buffunfa é criada do nada (F6-8): sem um teto no
 * schema, um zero a mais digitado no template viraria inflação que o ledger não desfaz.
 */
export const BUFFUNFA_ROLE_MAX = 10_000n;

const buffunfaValue = (label: string) =>
  amountSchema(label, " de Buffunfa").refine((v) => v <= BUFFUNFA_ROLE_MAX, `${label} vai até ${BUFFUNFA_ROLE_MAX} de Buffunfa.`);

/**
 * Role do template com vagas e **faixa obrigatória de Buffunfa** (TASK-057, F6-8). Os dois extremos
 * são exigidos: não existe faixa aberta, porque o caller ajusta o valor dentro dela até o fechamento
 * e o único freio contra o caller generoso demais é o teto que a staff escreveu aqui.
 */
export const eventTemplateRoleInputSchema = z
  .object({
    roleId: uuid,
    slots: count("Vagas"),
    buffunfaMin: buffunfaValue("O mínimo de Buffunfa"),
    buffunfaMax: buffunfaValue("O máximo de Buffunfa"),
  })
  .refine((r) => r.buffunfaMax >= r.buffunfaMin, { path: ["buffunfaMax"], message: "O máximo de Buffunfa não pode ser menor que o mínimo." });

/** Faixa de Buffunfa de uma role, já em bigint. */
export interface BuffunfaRange {
  min: bigint;
  max: bigint;
}

/** O valor cabe na faixa? É a mesma checagem no template, no evento e na tela (F6-8). */
export const inBuffunfaRange = (value: bigint, range: BuffunfaRange): boolean => value >= range.min && value <= range.max;

/** Faixa escrita para gente: `10 a 40 BUF`, ou `sem Buffunfa` quando a staff fechou em zero. */
export function formatBuffunfaRange(range: BuffunfaRange): string {
  if (range.max === 0n) return "sem Buffunfa";
  return range.min === range.max ? `${range.min} BUF` : `${range.min} a ${range.max} BUF`;
}

const templateFields = {
  name: requiredText("o nome do template", EVENT_TEMPLATE_NAME_MAX),
  description: optionalText("A descrição", EVENT_TEMPLATE_DESCRIPTION_MAX),
  minPartySize: count("Mínimo de pessoas"),
  /** null = sem teto (ex: PvP Roaming 2-∞). */
  maxPartySize: count("Máximo de pessoas").nullable(),
  active: z.boolean().default(true),
  /**
   * Taxa de entrada default herdada pelo evento criado deste template (TASK-058, F6-12). **Nasce
   * zerada**: o template não decide quanto custa entrar, quem decide é o caller, evento a evento, até
   * fechar a inscrição. Omitir o campo é o mesmo que zero, para o template antigo continuar válido.
   */
  defaultEntryFee: z.optional(entryFeeSchema("A taxa de entrada do template")).transform((v) => v ?? NO_ENTRY_FEE),
  roles: z.array(eventTemplateRoleInputSchema).min(1, "Adicione pelo menos uma role com vagas.").max(30, "Use no máximo 30 roles."),
};

export const totalSlots = (roles: readonly { slots: number }[]) => roles.reduce((sum, r) => sum + r.slots, 0);

export type PartySizeCheck = { ok: true } | { ok: false; error: string };

/**
 * Regra do template: mínimo ≤ máximo; total de vagas cabe na party (≤ máximo) e alcança o mínimo
 * (senão o evento nunca teria gente suficiente pelas vagas).
 */
export function checkPartySize(t: { minPartySize: number; maxPartySize: number | null; roles: readonly { slots: number }[] }): PartySizeCheck {
  if (t.maxPartySize !== null && t.minPartySize > t.maxPartySize) return { ok: false, error: "O mínimo de pessoas não pode passar do máximo." };
  const total = totalSlots(t.roles);
  if (t.maxPartySize !== null && total > t.maxPartySize) return { ok: false, error: `As vagas somam ${total}, acima do máximo de ${t.maxPartySize} pessoas.` };
  if (total < t.minPartySize) return { ok: false, error: `As vagas somam ${total}, abaixo do mínimo de ${t.minPartySize} pessoas.` };
  return { ok: true };
}

export const eventTemplateInputSchema = z.object(templateFields).superRefine((t, ctx) => {
  const seen = new Set<string>();
  t.roles.forEach((r, i) => {
    if (seen.has(r.roleId)) ctx.addIssue({ code: "custom", path: ["roles", i, "roleId"], message: "Cada role aparece uma vez no template: some as vagas numa linha só." });
    seen.add(r.roleId);
  });
  const party = checkPartySize(t);
  if (!party.ok) ctx.addIssue({ code: "custom", path: ["roles"], message: party.error });
});
export type EventTemplateInput = z.output<typeof eventTemplateInputSchema>;

/** PATCH: campos parciais; a API junta com o template atual e valida o resultado com `eventTemplateInputSchema`. */
export const eventTemplatePatchSchema = z.object(templateFields).partial();
export type EventTemplatePatch = z.output<typeof eventTemplatePatchSchema>;

/** Primeira mensagem de erro (toast/400). */
export function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Dados inválidos.";
}

/** Faixa de pessoas legível: "4–9", "2+", "5". */
export function formatPartySize(min: number, max: number | null): string {
  if (max === null) return `${min}+`;
  return min === max ? String(min) : `${min}–${max}`;
}

export interface EventRoleDto {
  id: string;
  name: string;
  description: string | null;
  sortOrder: number;
  /** Quantos templates usam a role (apagar só com 0, AC#3). */
  templateCount: number;
}

/** Role dentro do template, com a descrição do catálogo (TASK-039) pra tela dizer o que se espera dela. */
export interface EventTemplateRoleDto {
  roleId: string;
  name: string;
  description: string | null;
  slots: number;
  /** Faixa de Buffunfa por presença (F6-8), como string: bigint não existe em JSON (Q20). */
  buffunfaMin: string;
  buffunfaMax: string;
}

export interface EventTemplateDto {
  id: string;
  name: string;
  description: string | null;
  minPartySize: number;
  maxPartySize: number | null;
  active: boolean;
  /** Taxa de entrada default em Buffunfa, em string (Q20). `"0"` é o normal: template nasce zerado. */
  defaultEntryFee: string;
  roles: EventTemplateRoleDto[];
  totalSlots: number;
  updatedAt: string;
}
