import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { createDb, createSession, grantRole, runMigrations, upsertUserByDiscordId, type DbHandle } from "@albion-hub/db";
import type { EventRoleDto, EventTemplateDto, Role } from "@albion-hub/shared";
import { sql } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule, configureApp } from "../app.module.js";
import { parseEnv } from "../config/env.js";

const baseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!baseUrl && process.env.CI) throw new Error("CI sem TEST_DATABASE_URL: testes HTTP de templates não podem ser pulados");

const PUBLIC_URL = "http://localhost:3000";
const MISSING = "00000000-0000-4000-8000-000000000000";

describe.skipIf(!baseUrl)("catálogo de roles e templates HTTP (TASK-020, Q8)", () => {
  let app: INestApplication;
  let handle: DbHandle;
  let staff: string;
  let caller: string;
  let member: string;

  beforeAll(async () => {
    const target = new URL(baseUrl!);
    const name = `${target.pathname.slice(1)}_server_templates`;
    target.pathname = `/${name}`;
    const admin = createDb(baseUrl!, { max: 1 });
    await admin.db.execute(sql.raw(`drop database if exists "${name}" with (force)`));
    await admin.db.execute(sql.raw(`create database "${name}"`));
    await admin.close();
    await runMigrations(target.toString());
    handle = createDb(target.toString());
    const parsed = parseEnv({
      DISCORD_TOKEN: "a.b.c",
      GUILD_ID: "123456789012345678",
      DATABASE_URL: target.toString(),
      NODE_ENV: "test",
      DISCORD_CLIENT_ID: "223456789012345678",
      DISCORD_CLIENT_SECRET: "secret",
      DISCORD_MEMBER_ROLE_ID: "323456789012345678",
      DISCORD_STAFF_CHANNEL_ID: "423456789012345678",
      DISCORD_EVENTS_CHANNEL_ID: "523456789012345678",
      DISCORD_WAITING_VOICE_CHANNEL_ID: "623456789012345678",
      DISCORD_EVENT_CATEGORY_ID: "723456789012345678",
      PUBLIC_URL,
    });
    if (!parsed.ok) throw new Error(parsed.message);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule.register(parsed.env, { bot: false })] }).compile();
    app = configureApp(moduleRef.createNestApplication({ logger: false }));
    await app.listen(0, "127.0.0.1");
    staff = await login("620000000000000001", ["member", "staff"]);
    caller = await login("620000000000000002", ["member", "caller"]);
    member = await login("620000000000000003", ["member"]);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await handle?.close();
  });

  async function login(discordId: string, roles: Role[]) {
    const user = await upsertUserByDiscordId(handle.db, { discordId, discordUsername: `u${discordId.slice(-3)}` });
    for (const role of roles) await grantRole(handle.db, user.id, role);
    const { token } = await createSession(handle.db, user.id, new Date(Date.now() + 3_600_000));
    return `ah_session=${token}`;
  }

  const http = () => request(app.getHttpServer());
  const send = (method: "post" | "patch" | "delete", path: string, cookie: string | null, body: object = {}, origin = PUBLIC_URL) => {
    const req = http()[method](path).set("Origin", origin);
    if (cookie) req.set("Cookie", cookie);
    return req.send(body);
  };
  const roles = async () => (await http().get("/api/event-roles").set("Cookie", staff)).body.roles as EventRoleDto[];
  const roleId = async (name: string) => (await roles()).find((r) => r.name === name)!.id;

  it("sem sessão 401 em leitura e escrita", async () => {
    expect((await http().get("/api/event-roles")).status).toBe(401);
    expect((await http().get("/api/event-templates")).status).toBe(401);
    expect((await send("post", "/api/event-roles", null, { name: "X" })).status).toBe(401);
    expect((await send("delete", `/api/event-templates/${MISSING}`, null)).status).toBe(401);
  });

  it("membro 403 em tudo; caller só lê (AC#4)", async () => {
    expect((await http().get("/api/event-roles").set("Cookie", member)).status).toBe(403);
    expect((await http().get("/api/event-templates").set("Cookie", member)).status).toBe(403);
    const tank = await roleId("Tank");
    const tpl = { name: "Proibido", minPartySize: 1, maxPartySize: null, roles: [{ roleId: tank, slots: 1 }] };
    for (const cookie of [member, caller]) {
      expect((await send("post", "/api/event-roles", cookie, { name: "Hacker" })).status).toBe(403);
      expect((await send("patch", `/api/event-roles/${tank}`, cookie, { name: "Hacker" })).status).toBe(403);
      // TASK-039: a descrição é escrita pela mesma permissão do resto do catálogo (update EventTemplate).
      expect((await send("patch", `/api/event-roles/${tank}`, cookie, { description: "vandalizado" })).status).toBe(403);
      expect((await send("delete", `/api/event-roles/${tank}`, cookie)).status).toBe(403);
      expect((await send("post", "/api/event-templates", cookie, tpl)).status).toBe(403);
      expect((await send("patch", `/api/event-templates/${MISSING}`, cookie, { active: false })).status).toBe(403);
      expect((await send("delete", `/api/event-templates/${MISSING}`, cookie)).status).toBe(403);
    }
    expect((await roles()).find((r) => r.name === "Tank")?.description).toBeNull();
    const read = await http().get("/api/event-roles").set("Cookie", caller);
    expect(read.status).toBe(200);
    expect(read.headers["cache-control"]).toBe("no-store");
    expect((read.body.roles as EventRoleDto[]).map((r) => r.name)).toEqual(["Tank", "Healer", "DPS Melee", "DPS Range", "Support", "Scout"]);
    expect((await http().get("/api/event-templates").set("Cookie", caller)).status).toBe(200);
    expect((await roles()).map((r) => r.name)).not.toContain("Hacker");
  });

  it("staff cria e edita role; duplicado 409, inválido 400, outra origem 403 (AC#1)", async () => {
    const created = await send("post", "/api/event-roles", staff, { name: "  Batedor ", description: "abre caminho" });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: "Batedor", description: "abre caminho", templateCount: 0 });
    const edited = await send("patch", `/api/event-roles/${created.body.id}`, staff, { name: "Batedor Rápido", description: "" });
    expect(edited.status).toBe(200);
    expect(edited.body).toMatchObject({ name: "Batedor Rápido", description: null });
    const dup = await send("post", "/api/event-roles", staff, { name: "tank" });
    expect(dup.status).toBe(409);
    expect(dup.body.message).toBe("Já existe uma role com esse nome.");
    expect((await send("patch", `/api/event-roles/${created.body.id}`, staff, { name: "HEALER" })).status).toBe(409);
    const blank = await send("post", "/api/event-roles", staff, { name: " " });
    expect(blank.status).toBe(400);
    expect(blank.body.message).toBe("Digite o nome da role.");
    expect((await send("patch", "/api/event-roles/nao-uuid", staff, { name: "X" })).status).toBe(400);
    expect((await send("patch", `/api/event-roles/${MISSING}`, staff, { name: "X" })).status).toBe(404);
    expect((await send("post", "/api/event-roles", staff, { name: "Evil" }, "https://evil.example")).status).toBe(403);
    expect((await roles()).map((r) => r.name)).not.toContain("Evil");
  });

  it("descrição da role acompanha o template e o YAML (TASK-039, AC#2/AC#3)", async () => {
    const yamlOf = (id: string) => http().get(`/api/event-templates/${id}/export`).set("Cookie", staff);
    const tank = await roleId("Tank");
    await send("patch", `/api/event-roles/${tank}`, staff, { description: "Segura a frente e chama o engage." });
    const created = await send("post", "/api/event-templates", staff, { name: "Com descrição", minPartySize: 1, maxPartySize: null, roles: [{ roleId: tank, slots: 1 }] });
    expect(created.status).toBe(201);
    expect((created.body as EventTemplateDto).roles).toEqual([{ roleId: tank, name: "Tank", description: "Segura a frente e chama o engage.", slots: 1 }]);

    const exported = await yamlOf(created.body.id);
    expect(exported.status).toBe(200);
    expect(exported.text).toContain("description: Segura a frente e chama o engage.");

    // AC#3: role sem descrição continua valendo, e o YAML não inventa campo.
    const bare = await send("post", "/api/event-templates", staff, { name: "Sem descrição", minPartySize: 1, maxPartySize: null, roles: [{ roleId: await roleId("Scout"), slots: 1 }] });
    expect((bare.body as EventTemplateDto).roles[0]!.description).toBeNull();
    expect((await yamlOf(bare.body.id)).text).not.toContain("description:");
    await send("patch", `/api/event-roles/${tank}`, staff, { description: "" });
  });

  it("staff cria template com roles e vagas, edita parcial e valida party (AC#2)", async () => {
    const [tank, healer, dps] = [await roleId("Tank"), await roleId("Healer"), await roleId("DPS Melee")];
    const body = { name: "DG de grupo", description: "Dungeon em grupo", minPartySize: 4, maxPartySize: 9, roles: [{ roleId: tank, slots: 1 }, { roleId: healer, slots: 1 }, { roleId: dps, slots: 5 }] };
    const created = await send("post", "/api/event-templates", staff, body);
    expect(created.status).toBe(201);
    const tpl = created.body as EventTemplateDto;
    expect(tpl).toMatchObject({ name: "DG de grupo", active: true, totalSlots: 7, roles: [{ name: "Tank", slots: 1 }, { name: "Healer", slots: 1 }, { name: "DPS Melee", slots: 5 }] });

    const over = await send("post", "/api/event-templates", staff, { ...body, name: "Cheio", roles: [{ roleId: dps, slots: 10 }] });
    expect(over.status).toBe(400);
    expect(over.body.message).toContain("acima do máximo de 9");
    expect((await send("post", "/api/event-templates", staff, { ...body, roles: [{ roleId: tank, slots: 0 }] })).status).toBe(400);
    expect((await send("post", "/api/event-templates", staff, { ...body, name: "dg DE GRUPO" })).status).toBe(409);
    expect((await send("post", "/api/event-templates", staff, { ...body, name: "Fantasma", roles: [{ roleId: MISSING, slots: 4 }] })).status).toBe(400);

    const patched = await send("patch", `/api/event-templates/${tpl.id}`, staff, { active: false, maxPartySize: null });
    expect(patched.status).toBe(200);
    expect(patched.body).toMatchObject({ active: false, maxPartySize: null, totalSlots: 7, name: "DG de grupo" });
    const badPatch = await send("patch", `/api/event-templates/${tpl.id}`, staff, { minPartySize: 8 });
    expect(badPatch.status).toBe(400);
    expect(badPatch.body.message).toContain("abaixo do mínimo de 8");
    expect((await send("patch", `/api/event-templates/${MISSING}`, staff, { active: true })).status).toBe(404);

    const list = await http().get("/api/event-templates").set("Cookie", caller);
    expect((list.body.templates as EventTemplateDto[]).find((t) => t.id === tpl.id)).toMatchObject({ totalSlots: 7, active: false });
  });

  it("taxa de entrada do template nasce zerada e sobrevive a um PATCH que não fala dela (TASK-058, AC#1)", async () => {
    const tank = await roleId("Tank");
    const body = { name: "Disputado", description: null, minPartySize: 1, maxPartySize: null, roles: [{ roleId: tank, slots: 1 }] };
    const created = await send("post", "/api/event-templates", staff, body);
    expect(created.status).toBe(201);
    // Nasce zerado: o template não decide quanto custa entrar (F6-12).
    expect((created.body as EventTemplateDto).defaultEntryFee).toBe("0");
    const id = (created.body as EventTemplateDto).id;

    expect((await send("patch", `/api/event-templates/${id}`, staff, { defaultEntryFee: "40" })).body.defaultEntryFee).toBe("40");
    // O PATCH de outro campo **não** zera a taxa: era o jeito mais fácil de perder a taxa em silêncio.
    expect((await send("patch", `/api/event-templates/${id}`, staff, { name: "Disputado v2" })).body).toMatchObject({ name: "Disputado v2", defaultEntryFee: "40" });
    expect((await send("patch", `/api/event-templates/${id}`, staff, { defaultEntryFee: "0" })).body.defaultEntryFee).toBe("0");
    expect((await send("patch", `/api/event-templates/${id}`, staff, { defaultEntryFee: "-1" })).status).toBe(400);
    expect((await send("patch", `/api/event-templates/${id}`, staff, { defaultEntryFee: 10 })).status).toBe(400);
  });

  it("role em uso por template não pode ser apagada: 409 PT-BR; depois de liberar, apaga (AC#3)", async () => {
    const created = await send("post", "/api/event-roles", staff, { name: "Arqueiro" });
    const tank = await roleId("Tank");
    const tpl = await send("post", "/api/event-templates", staff, { name: "Caçada", minPartySize: 3, maxPartySize: 7, roles: [{ roleId: created.body.id, slots: 2 }, { roleId: tank, slots: 1 }] });
    expect(tpl.status).toBe(201);
    expect((await roles()).find((r) => r.id === created.body.id)!.templateCount).toBe(1);

    const blocked = await send("delete", `/api/event-roles/${created.body.id}`, staff);
    expect(blocked.status).toBe(409);
    expect(blocked.body.message).toContain("em uso por um template");
    expect((await roles()).map((r) => r.id)).toContain(created.body.id);

    expect((await send("patch", `/api/event-templates/${tpl.body.id}`, staff, { roles: [{ roleId: tank, slots: 3 }] })).status).toBe(200);
    expect((await send("delete", `/api/event-roles/${created.body.id}`, staff)).status).toBe(204);
    expect((await send("delete", `/api/event-roles/${created.body.id}`, staff)).status).toBe(404);
    expect((await send("delete", `/api/event-templates/${tpl.body.id}`, staff)).status).toBe(204);
    expect((await send("delete", `/api/event-templates/${tpl.body.id}`, staff)).status).toBe(404);
    expect((await send("delete", "/api/event-templates/nao-uuid", staff)).status).toBe(400);
  });

  describe("import e export em YAML (TASK-038)", () => {
    const templateName = (suffix: string) => `YAML ${suffix}`;

    async function exportYaml(cookie: string, id: string) {
      return http().get(`/api/event-templates/${id}/export`).set("Cookie", cookie);
    }

    it("staff exporta o template como YAML com Content-Disposition e sem id (AC#1)", async () => {
      const [tank, healer] = [await roleId("Tank"), await roleId("Healer")];
      const created = await send("post", "/api/event-templates", staff, {
        name: templateName("export"),
        description: "levado pra outro servidor",
        minPartySize: 3,
        maxPartySize: 7,
        roles: [{ roleId: tank, slots: 2 }, { roleId: healer, slots: 2 }],
      });
      expect(created.status).toBe(201);

      const res = await exportYaml(staff, created.body.id);
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("text/yaml");
      expect(res.headers["content-disposition"]).toBe('attachment; filename="yaml-export.yaml"');
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(res.text).toContain("version: 1");
      expect(res.text).toContain(`name: ${templateName("export")}`);
      expect(res.text).toContain("minParty: 3");
      expect(res.text).toContain("maxParty: 7");
      expect(res.text).toContain("name: Tank");
      expect(res.text).not.toContain(created.body.id);

      expect((await exportYaml(staff, MISSING)).status).toBe(404);
      expect((await exportYaml(staff, "nao-uuid")).status).toBe(400);
    });

    it("staff importa o YAML exportado e o template nasce com roles e vagas (AC#2)", async () => {
      const [tank, scout] = [await roleId("Tank"), await roleId("Scout")];
      const origin = await send("post", "/api/event-templates", staff, { name: templateName("ida"), minPartySize: 4, maxPartySize: 9, roles: [{ roleId: tank, slots: 1 }, { roleId: scout, slots: 4 }] });
      const yaml = (await exportYaml(staff, origin.body.id)).text.replace(templateName("ida"), templateName("volta"));

      const imported = await send("post", "/api/event-templates/import", staff, { yaml });
      expect(imported.status).toBe(201);
      expect(imported.body.createdRoles).toEqual([]);
      expect(imported.body.template).toMatchObject({
        name: templateName("volta"),
        minPartySize: 4,
        maxPartySize: 9,
        totalSlots: 5,
        roles: [{ name: "Tank", slots: 1 }, { name: "Scout", slots: 4 }],
      });
      expect(imported.body.template.id).not.toBe(origin.body.id);

      // Reimportar o mesmo arquivo colide no nome: 409 com instrução, sem criar um segundo template.
      const again = await send("post", "/api/event-templates/import", staff, { yaml });
      expect(again.status).toBe(409);
      expect(again.body.message).toContain(`Já existe um template chamado "${templateName("volta")}"`);
      const list = (await http().get("/api/event-templates").set("Cookie", staff)).body.templates as EventTemplateDto[];
      expect(list.filter((t) => t.name === templateName("volta"))).toHaveLength(1);
    });

    it("YAML inválido é 400 legível e não grava nada (AC#3)", async () => {
      const before = (await http().get("/api/event-templates").set("Cookie", staff)).body.templates as EventTemplateDto[];
      const cases: [unknown, string][] = [
        ["name: [aberto\nroles:", "não é um YAML válido"],
        ["version: 1\nname: Quebrado\nminParty: 1\nminparty: 2\nroles:\n  - name: Tank\n    slots: 1", "campo que o formato não conhece"],
        ["version: 1\nname: Quebrado\nminParty: 1\nmaxParty: 4\nroles:\n  - name: Tank\n    slots: 9", "acima do máximo de 4"],
        ["version: 1\nname: Quebrado\nminParty: 1\nroles:\n  - name: Tank\n    slots: 0", "Vagas precisa ser pelo menos 1"],
        ["version: 9\nname: Quebrado\nminParty: 1\nroles:\n  - name: Tank\n    slots: 1", "formato mais novo"],
        ["version: 1\nname: &a Bomba\nminParty: 1\nroles:\n  - name: *a\n    slots: 1", "não é um YAML válido"],
        ["", "está vazio"],
        [42, "está vazio"],
        [undefined, "está vazio"],
      ];
      for (const [yaml, message] of cases) {
        const res = await send("post", "/api/event-templates/import", staff, { yaml });
        expect(res.status, JSON.stringify(yaml)).toBe(400);
        expect(res.body.message).toContain(message);
      }
      const after = (await http().get("/api/event-templates").set("Cookie", staff)).body.templates as EventTemplateDto[];
      expect(after.map((t) => t.id).sort()).toEqual(before.map((t) => t.id).sort());
      expect(after.map((t) => t.name)).not.toContain("Quebrado");
    });

    it("arquivo acima de 64 KB é recusado sem gravar", async () => {
      const yaml = `version: 1\nname: Gigante\nminParty: 1\nroles:\n  - name: Tank\n    slots: 1\n# ${"x".repeat(70_000)}`;
      const res = await send("post", "/api/event-templates/import", staff, { yaml });
      expect(res.status).toBe(400);
      expect(res.body.message).toContain("o limite é 64 KB");
      const list = (await http().get("/api/event-templates").set("Cookie", staff)).body.templates as EventTemplateDto[];
      expect(list.map((t) => t.name)).not.toContain("Gigante");
    });

    it("import não reescreve a descrição global da role e devolve ignoredDescriptions (TASK-065)", async () => {
      const yaml = (name: string, description: string) => ["version: 1", `name: ${templateName(name)}`, "minParty: 1", "maxParty: 6", "roles:", "  - name: Bastião", "    slots: 1", `    description: ${description}`].join("\n");

      const first = await send("post", "/api/event-templates/import", staff, { yaml: yaml("t065 zvz", "segura a linha de frente na ZvZ") });
      expect(first.status).toBe(201);
      expect(first.body.createdRoles).toEqual(["Bastião"]);
      expect(first.body.ignoredDescriptions).toEqual([]);

      const second = await send("post", "/api/event-templates/import", staff, { yaml: yaml("t065 dg", "puxa os mobs da dungeon") });
      expect(second.status).toBe(201);
      expect(second.body.ignoredDescriptions).toEqual(["Bastião"]);
      expect((await roles()).find((r) => r.name === "Bastião")).toMatchObject({ description: "segura a linha de frente na ZvZ", templateCount: 2 });
    });

    it("roles fora do catálogo são criadas e reportadas em createdRoles (AC#4)", async () => {
      const yaml = ["version: 1", `name: ${templateName("roles novas")}`, "minParty: 2", "maxParty: 6", "roles:", "  - name: Battlemount", "    slots: 2", "  - name: tank", "    slots: 2"].join("\n");
      const res = await send("post", "/api/event-templates/import", staff, { yaml });
      expect(res.status).toBe(201);
      expect(res.body.createdRoles).toEqual(["Battlemount"]);
      expect(res.body.template.roles).toEqual([
        { roleId: expect.any(String), name: "Battlemount", description: null, slots: 2 },
        { roleId: await roleId("Tank"), name: "Tank", description: null, slots: 2 },
      ]);
      const catalog = await roles();
      expect(catalog.find((r) => r.name === "Battlemount")).toMatchObject({ templateCount: 1 });
      // "tank" casou com a role existente em vez de criar uma duplicata de caixa diferente.
      expect(catalog.filter((r) => r.name.toLowerCase() === "tank")).toHaveLength(1);
    });

    it("sem sessão 401; membro e caller 403; outra origem 403 no import", async () => {
      const tank = await roleId("Tank");
      const tpl = await send("post", "/api/event-templates", staff, { name: templateName("acesso"), minPartySize: 1, maxPartySize: 4, roles: [{ roleId: tank, slots: 2 }] });
      const yaml = (await exportYaml(staff, tpl.body.id)).text.replace(templateName("acesso"), templateName("invasor"));

      expect((await http().get(`/api/event-templates/${tpl.body.id}/export`)).status).toBe(401);
      expect((await send("post", "/api/event-templates/import", null, { yaml })).status).toBe(401);
      for (const cookie of [member, caller]) {
        expect((await exportYaml(cookie, tpl.body.id)).status).toBe(403);
        expect((await send("post", "/api/event-templates/import", cookie, { yaml })).status).toBe(403);
      }
      expect((await send("post", "/api/event-templates/import", staff, { yaml }, "https://evil.example")).status).toBe(403);
      const list = (await http().get("/api/event-templates").set("Cookie", staff)).body.templates as EventTemplateDto[];
      expect(list.map((t) => t.name)).not.toContain(templateName("invasor"));
    });
  });
});
