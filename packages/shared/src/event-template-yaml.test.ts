import { describe, expect, it } from "vitest";
import {
  EVENT_TEMPLATE_YAML_MAX_BYTES,
  EVENT_TEMPLATE_YAML_VERSION,
  eventTemplateYamlFilename,
  parseEventTemplateYaml,
  serializeEventTemplateYaml,
} from "./event-template-yaml.js";

/** Import/export de template em YAML (TASK-038). doc-001: YAML é só transporte; o DB continua sendo a verdade. */

const dgDeGrupo = {
  name: "DG de grupo",
  description: "Dungeon em grupo, saída pelo portal",
  minPartySize: 4,
  maxPartySize: 9,
  active: true,
  roles: [
    { roleId: "a", name: "Tank", description: null, slots: 1 },
    { roleId: "b", name: "Healer", description: null, slots: 1 },
    { roleId: "c", name: "DPS Melee", description: null, slots: 5 },
  ],
};

const ok = (source: string) => {
  const result = parseEventTemplateYaml(source);
  if (!result.ok) throw new Error(`esperava YAML válido, veio: ${result.error}`);
  return result.template;
};

const err = (source: string) => {
  const result = parseEventTemplateYaml(source);
  if (result.ok) throw new Error("esperava erro, o YAML passou");
  return result.error;
};

describe("serializeEventTemplateYaml", () => {
  it("escreve cabeçalho explicativo, version e os campos do formato", () => {
    const yaml = serializeEventTemplateYaml(dgDeGrupo);
    expect(yaml.startsWith("# albion-hub — template de evento (formato version 1).")).toBe(true);
    expect(yaml).toContain(`version: ${EVENT_TEMPLATE_YAML_VERSION}`);
    expect(yaml).toContain("name: DG de grupo");
    expect(yaml).toContain("minParty: 4");
    expect(yaml).toContain("maxParty: 9");
    expect(yaml).toContain("slots: 5");
    // Ids não viajam: o arquivo vai pra outro servidor, onde nenhum id local significa nada.
    expect(yaml).not.toContain("roleId");
    expect(yaml).not.toContain("id:");
  });

  it("omite descrição vazia e escreve maxParty null quando não há teto", () => {
    const yaml = serializeEventTemplateYaml({ name: "PvP Roaming", description: null, minPartySize: 2, maxPartySize: null, active: false, roles: [{ roleId: "a", name: "DPS Range", description: null, slots: 5 }] });
    expect(yaml).not.toContain("description");
    expect(yaml).toContain("maxParty: null");
    expect(yaml).toContain("active: false");
  });

  it("descrição da role faz round-trip: o import cria a role do catálogo com ela (TASK-039)", () => {
    const yaml = serializeEventTemplateYaml({
      ...dgDeGrupo,
      roles: [{ roleId: "a", name: "Tank", description: "Segura a frente e chama o engage.", slots: 1 }, { roleId: "b", name: "Healer", description: null, slots: 3 }],
    });
    expect(yaml).toContain("description: Segura a frente e chama o engage.");
    expect(ok(yaml).roles).toEqual([{ name: "Tank", slots: 1, description: "Segura a frente e chama o engage." }, { name: "Healer", slots: 3, description: null }]);
  });

  it("round-trip: o que sai do banco volta igual depois de reler", () => {
    const parsed = ok(serializeEventTemplateYaml(dgDeGrupo));
    expect(parsed).toEqual({
      version: 1,
      name: "DG de grupo",
      description: "Dungeon em grupo, saída pelo portal",
      minParty: 4,
      maxParty: 9,
      active: true,
      roles: [{ name: "Tank", slots: 1, description: null }, { name: "Healer", slots: 1, description: null }, { name: "DPS Melee", slots: 5, description: null }],
    });
  });

  it("round-trip aguenta nome com dois-pontos, acento e emoji sem quebrar o YAML", () => {
    const tricky = { name: "Raid: Dragão #1 🐉", description: "linha 1\nlinha 2", minPartySize: 15, maxPartySize: 20, active: true, roles: [{ roleId: "a", name: "Tank: frente", description: null, slots: 20 }] };
    const parsed = ok(serializeEventTemplateYaml(tricky));
    expect(parsed.name).toBe("Raid: Dragão #1 🐉");
    expect(parsed.description).toBe("linha 1\nlinha 2");
    expect(parsed.roles[0]!.name).toBe("Tank: frente");
  });
});

describe("parseEventTemplateYaml", () => {
  const base = ["version: 1", "name: Caçada", "minParty: 3", "maxParty: 7", "roles:", "  - name: Tank", "    slots: 2", "  - name: Scout", "    slots: 2"].join("\n");

  it("aceita o formato mínimo: sem description e sem active (default true)", () => {
    const t = ok(base);
    expect(t).toMatchObject({ name: "Caçada", minParty: 3, maxParty: 7, active: true, description: null });
    expect(t.roles).toEqual([{ name: "Tank", slots: 2, description: null }, { name: "Scout", slots: 2, description: null }]);
  });

  it("aceita maxParty ausente ou null como sem teto", () => {
    expect(ok("version: 1\nname: Roaming\nminParty: 2\nroles:\n  - name: DPS Range\n    slots: 4").maxParty).toBeNull();
    expect(ok("version: 1\nname: Roaming\nminParty: 2\nmaxParty: null\nroles:\n  - name: DPS Range\n    slots: 4").maxParty).toBeNull();
  });

  it("apara espaços do nome da role e do template", () => {
    const t = ok("version: 1\nname: '  Caçada  '\nminParty: 1\nroles:\n  - name: '  Tank  '\n    slots: 1");
    expect(t.name).toBe("Caçada");
    expect(t.roles[0]!.name).toBe("Tank");
  });

  it("recusa YAML sintaticamente inválido com mensagem legível (AC#3)", () => {
    expect(err("name: [aberto\nroles:")).toContain("não é um YAML válido");
  });

  it("recusa conteúdo que não é um mapa (lista, escalar, vazio)", () => {
    expect(err("- 1\n- 2")).toContain("precisa ter os campos do template");
    expect(err("apenas um texto")).toContain("precisa ter os campos do template");
    expect(err("   ")).toContain("está vazio");
  });

  it("recusa chave desconhecida no topo e dentro da role em vez de ignorar calado", () => {
    expect(err(`${base}\nminparty: 9`)).toBe('O arquivo tem campo que o formato não conhece: "minparty". Use só version, name, description, minParty, maxParty, active e roles.');
    expect(err("version: 1\nname: X\nminParty: 1\nroles:\n  - name: Tank\n    slots: 1\n    vagas: 3")).toBe('A role 1 tem campo que o formato não conhece: "vagas". Use só name, slots e description.');
  });

  it("recusa version ausente ou de formato mais novo", () => {
    expect(err("name: X\nminParty: 1\nroles:\n  - name: Tank\n    slots: 1")).toContain("Falta o campo version");
    expect(err("version: 2\nname: X\nminParty: 1\nroles:\n  - name: Tank\n    slots: 1")).toContain("formato mais novo");
  });

  it("aplica as mesmas regras do painel: vagas > 0, soma dentro da party, role única", () => {
    expect(err("version: 1\nname: X\nminParty: 1\nmaxParty: 5\nroles:\n  - name: Tank\n    slots: 0")).toContain("Vagas precisa ser pelo menos 1");
    expect(err("version: 1\nname: X\nminParty: 1\nmaxParty: 5\nroles:\n  - name: Tank\n    slots: 9")).toContain("acima do máximo de 5");
    expect(err("version: 1\nname: X\nminParty: 8\nmaxParty: 20\nroles:\n  - name: Tank\n    slots: 2")).toContain("abaixo do mínimo de 8");
    expect(err("version: 1\nname: X\nminParty: 4\nmaxParty: 9\nroles:\n  - name: Tank\n    slots: 2\n  - name: tank\n    slots: 2")).toContain("aparece duas vezes");
    expect(err("version: 1\nname: X\nminParty: 4\nmaxParty: 9\nroles:\n  - name: Tank\n    slots: 2\n  - name: tank\n    slots: 2")).toContain("(role 2)");
    expect(err("version: 1\nname: X\nminParty: 9\nmaxParty: 4\nroles:\n  - name: Tank\n    slots: 4")).toContain("não pode passar do máximo");
  });

  it("recusa tipos errados e nome em branco", () => {
    expect(err("version: 1\nname: X\nminParty: 4.5\nmaxParty: 9\nroles:\n  - name: Tank\n    slots: 5")).toContain("número inteiro");
    expect(err("version: 1\nname: X\nminParty: 1\nroles:\n  - name: Tank\n    slots: muitas")).toContain("número inteiro");
    expect(err("version: 1\nname: '  '\nminParty: 1\nroles:\n  - name: Tank\n    slots: 1")).toContain("não pode ficar em branco");
    expect(err("version: 1\nname: X\nminParty: 1\nactive: talvez\nroles:\n  - name: Tank\n    slots: 1")).toContain("true ou false");
    expect(err("version: 1\nname: X\nminParty: 1\nroles: []")).toContain("pelo menos uma role");
  });

  it("recusa âncora/alias: 'billion laughs' não passa do parser (security-review)", () => {
    const bomb = ["version: 1", "name: &a bomba", "minParty: 1", "roles:", "  - name: *a", "    slots: 1"].join("\n");
    expect(err(bomb)).toContain("não é um YAML válido");
    const nested = ["a: &x [1,1,1,1,1,1,1,1,1]", "b: &y [*x,*x,*x,*x,*x,*x,*x,*x,*x]", "c: [*y,*y,*y,*y,*y,*y,*y,*y,*y]"].join("\n");
    expect(err(nested)).toContain("não é um YAML válido");
  });

  it("recusa arquivo acima do teto de 64 KB antes de tentar interpretar", () => {
    const huge = `${base}\n# ${"x".repeat(EVENT_TEMPLATE_YAML_MAX_BYTES)}`;
    expect(err(huge)).toContain("o limite é 64 KB");
  });

  it("não constrói objeto do runtime a partir de tag customizada (security-review)", () => {
    // A lib não tem construtores por tag: `!!js/function` vira texto inerte, nunca uma função.
    const tagged = "version: 1\nname: !!js/function 'function(){}'\nminParty: 1\nroles:\n  - name: Tank\n    slots: 1";
    const t = ok(tagged);
    expect(typeof t.name).toBe("string");
    expect(t.name).toBe("function(){}");
  });
});

describe("eventTemplateYamlFilename", () => {
  it("vira slug ASCII e nunca carrega separador de caminho (security-review)", () => {
    expect(eventTemplateYamlFilename("DG de grupo")).toBe("dg-de-grupo.yaml");
    expect(eventTemplateYamlFilename("Caçada Ávalon")).toBe("cacada-avalon.yaml");
    expect(eventTemplateYamlFilename("../../etc/passwd")).toBe("etc-passwd.yaml");
    expect(eventTemplateYamlFilename('a"; rm -rf /')).toBe("a-rm-rf.yaml");
    expect(eventTemplateYamlFilename("🐉🐉")).toBe("template.yaml");
    expect(eventTemplateYamlFilename("x".repeat(200))).toBe(`${"x".repeat(60)}.yaml`);
  });
});
