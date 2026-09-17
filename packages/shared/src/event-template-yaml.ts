import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { z } from "zod";
import { EVENT_PARTY_SIZE_MAX, EVENT_ROLE_DESCRIPTION_MAX, EVENT_ROLE_NAME_MAX, EVENT_TEMPLATE_DESCRIPTION_MAX, EVENT_TEMPLATE_NAME_MAX, checkPartySize, type EventTemplateDto } from "./event-templates.js";

/**
 * Import/export de template em YAML (TASK-038; doc-001: DB é fonte de verdade, YAML é só transporte).
 *
 * Tudo aqui é função pura: a API e o painel usam o mesmo parser, e nada no arquivo vira código
 * (a lib `yaml` não executa nada; aliases/âncoras ficam desligados pra não abrir "YAML bomb").
 *
 * Formato (version 1):
 * ```yaml
 * version: 1
 * name: DG de grupo
 * description: Dungeon em grupo   # opcional
 * minParty: 4
 * maxParty: 9                     # null = sem teto
 * active: true                    # opcional, default true
 * roles:
 *   - name: Tank
 *     slots: 1
 *     description: segura o dano  # opcional
 * ```
 */

/** Versão do formato. Arquivo de versão maior é recusado com mensagem clara em vez de ser lido pela metade. */
export const EVENT_TEMPLATE_YAML_VERSION = 1;

/** Teto do arquivo importado: template maior que isso é erro de uso, não template. */
export const EVENT_TEMPLATE_YAML_MAX_BYTES = 64 * 1024;

/** Cabeçalho do arquivo exportado: quem abrir o .yaml sabe o que pode editar sem ler doc nenhum. */
const HEADER = [
  "# albion-hub — template de evento (formato version 1).",
  "# Edite à vontade e importe em qualquer servidor: as roles são casadas pelo nome",
  "# (sem diferenciar maiúsculas) e as que não existirem no catálogo são criadas na importação.",
  "# maxParty: null = sem teto. A soma das vagas precisa caber entre minParty e maxParty.",
].join("\n");

const trimmed = (label: string, max: number) =>
  z
    .string({ error: `${label} precisa ser texto.` })
    .trim()
    .min(1, `${label} não pode ficar em branco.`)
    .max(max, `${label} tem no máximo ${max} caracteres.`);

const optional = (label: string, max: number) =>
  z
    .string({ error: `${label} precisa ser texto.` })
    .trim()
    .max(max, `${label} tem no máximo ${max} caracteres.`)
    .nullish()
    .transform((v) => (v ? v : null))
    .optional()
    .transform((v) => v ?? null);

const size = (label: string) =>
  z
    .number({ error: `${label} precisa ser um número inteiro.` })
    .int(`${label} precisa ser um número inteiro.`)
    .min(1, `${label} precisa ser pelo menos 1.`)
    .max(EVENT_PARTY_SIZE_MAX, `${label} vai até ${EVENT_PARTY_SIZE_MAX}.`);

const yamlRoleSchema = z
  .object({
    name: trimmed("O nome da role", EVENT_ROLE_NAME_MAX),
    slots: size("Vagas"),
    description: optional("A descrição da role", EVENT_ROLE_DESCRIPTION_MAX),
  })
  // `strict()` sem mensagem: a tradução PT-BR da chave desconhecida vive em `yamlIssueMessage`.
  .strict();

/**
 * `strict()` nos dois níveis: chave desconhecida vira erro em vez de sumir calada — um typo
 * (`minparty`) não pode virar um template com tamanho errado.
 */
const eventTemplateYamlSchema = z
  .object({
    version: z
      .number({ error: "Falta o campo version no arquivo." })
      .int("O campo version precisa ser um número inteiro.")
      .min(1, "O campo version precisa ser pelo menos 1.")
      .max(EVENT_TEMPLATE_YAML_VERSION, `Esse arquivo é de um formato mais novo (version acima de ${EVENT_TEMPLATE_YAML_VERSION}). Atualize o painel para importar.`),
    name: trimmed("O nome do template", EVENT_TEMPLATE_NAME_MAX),
    description: optional("A descrição", EVENT_TEMPLATE_DESCRIPTION_MAX),
    minParty: size("Mínimo de pessoas"),
    maxParty: size("Máximo de pessoas").nullish().transform((v) => v ?? null),
    active: z.boolean({ error: "O campo active precisa ser true ou false." }).optional().transform((v) => v ?? true),
    roles: z.array(yamlRoleSchema, { error: "Falta a lista roles no arquivo." }).min(1, "Adicione pelo menos uma role com vagas.").max(30, "Use no máximo 30 roles."),
  })
  .strict()
  .superRefine((t, ctx) => {
    const seen = new Set<string>();
    t.roles.forEach((r, i) => {
      const key = r.name.toLocaleLowerCase("pt-BR");
      if (seen.has(key)) ctx.addIssue({ code: "custom", path: ["roles", i, "name"], message: `A role "${r.name}" aparece duas vezes: some as vagas numa linha só.` });
      seen.add(key);
    });
    const party = checkPartySize({ minPartySize: t.minParty, maxPartySize: t.maxParty, roles: t.roles });
    if (!party.ok) ctx.addIssue({ code: "custom", path: ["roles"], message: party.error });
  });

export type EventTemplateYaml = z.output<typeof eventTemplateYamlSchema>;

export type ParseEventTemplateYamlResult = { ok: true; template: EventTemplateYaml } | { ok: false; error: string };

/** Nome do arquivo exportado: só ASCII seguro, sem separador de caminho nem ponto inicial. */
export function eventTemplateYamlFilename(name: string): string {
  const slug = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .toLowerCase();
  return `${slug || "template"}.yaml`;
}

/** Template do banco → YAML com cabeçalho explicativo. Só os campos do formato; ids ficam de fora de propósito (o destino é outro servidor). */
export function serializeEventTemplateYaml(template: Pick<EventTemplateDto, "name" | "description" | "minPartySize" | "maxPartySize" | "active" | "roles">): string {
  const body = stringifyYaml(
    {
      version: EVENT_TEMPLATE_YAML_VERSION,
      name: template.name,
      ...(template.description ? { description: template.description } : {}),
      minParty: template.minPartySize,
      maxParty: template.maxPartySize,
      active: template.active,
      // A descrição da role já entra no import (cria a role do catálogo com ela); exportar fecha o
      // round-trip, senão mandar o template pra outro servidor perde o que a staff escreveu (TASK-039).
      roles: template.roles.map((r) => ({ name: r.name, slots: r.slots, ...(r.description ? { description: r.description } : {}) })),
    },
    { lineWidth: 0, nullStr: "null" },
  );
  return `${HEADER}\n${body}`;
}

/**
 * Primeira mensagem PT-BR do zod, com tradução da chave desconhecida (o zod reporta em inglês) e o
 * caminho da role para a staff saber qual linha do arquivo corrigir.
 */
function yamlIssueMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Arquivo inválido.";
  const where = typeof issue.path[0] === "string" && issue.path[0] === "roles" && typeof issue.path[1] === "number" ? ` (role ${issue.path[1] + 1})` : "";
  if (issue.code === "unrecognized_keys") {
    const keys = issue.keys.map((k) => `"${k}"`).join(", ");
    return where
      ? `A role ${issue.path[1] !== undefined ? (issue.path[1] as number) + 1 : 1} tem campo que o formato não conhece: ${keys}. Use só name, slots e description.`
      : `O arquivo tem campo que o formato não conhece: ${keys}. Use só version, name, description, minParty, maxParty, active e roles.`;
  }
  return `${issue.message}${where}`;
}

/**
 * YAML → template validado, ou mensagem PT-BR dizendo o que corrigir. Nunca lança:
 * quem chama decide se vira 400 ou toast.
 */
export function parseEventTemplateYaml(source: string): ParseEventTemplateYamlResult {
  if (typeof source !== "string") return { ok: false, error: "Envie o conteúdo do arquivo YAML." };
  if (source.trim() === "") return { ok: false, error: "O arquivo está vazio. Cole o conteúdo do YAML exportado." };
  const bytes = new TextEncoder().encode(source).length;
  if (bytes > EVENT_TEMPLATE_YAML_MAX_BYTES) return { ok: false, error: `O arquivo tem ${Math.ceil(bytes / 1024)} KB e o limite é ${EVENT_TEMPLATE_YAML_MAX_BYTES / 1024} KB.` };

  let data: unknown;
  try {
    // `maxAliasCount: 0` recusa âncora/alias: é o que evita a "billion laughs" (um alias repetido
    // que explode em memória). Nenhum template legítimo precisa de alias.
    data = parseYaml(source, { maxAliasCount: 0, prettyErrors: false, version: "1.2" });
  } catch (error) {
    return { ok: false, error: `O arquivo não é um YAML válido: ${error instanceof Error ? error.message.split("\n")[0] : "erro de leitura"}.` };
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) return { ok: false, error: "O arquivo precisa ter os campos do template (version, name, minParty, roles)." };

  const parsed = eventTemplateYamlSchema.safeParse(data);
  if (!parsed.success) return { ok: false, error: yamlIssueMessage(parsed.error) };
  return { ok: true, template: parsed.data };
}

/** Resultado da importação: o template criado e as roles que não existiam e foram criadas (AC#4). */
export interface EventTemplateImportResult {
  template: EventTemplateDto;
  createdRoles: string[];
  /**
   * Roles cuja `description` do arquivo foi **ignorada** porque a role já tinha outra descrição no
   * catálogo global (TASK-065). A descrição vive uma vez por role, não por template: sobrescrever
   * aqui apagaria o texto que os outros templates mostram.
   */
  ignoredDescriptions: string[];
}
