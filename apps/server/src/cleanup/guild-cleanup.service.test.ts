import { createDb, createSession, findValidSession, getLedgerBalance, getLeftGuildAt, grantRole, insertLedgerEntry, listRoles, listUserNotes, runMigrations, upsertUserByDiscordId, type DbHandle } from "@albion-hub/db";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { GuildMemberSnapshot } from "../domain/member-import.js";
import { GuildCleanupService } from "./guild-cleanup.service.js";

const baseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!baseUrl && process.env.CI) throw new Error("CI sem TEST_DATABASE_URL: testes da limpeza diária não podem ser pulados");

const snapshot = (discordId: string): GuildMemberSnapshot => ({ discordId, username: `u${discordId.slice(-4)}`, globalName: null, nickname: null, avatar: null, roleIds: [], bot: false });

/**
 * Banco que explode ao primeiro toque. É a prova de AC#5 que importa: quando a consulta ao Discord
 * falha, a limpeza não chega nem a abrir uma consulta — ela não tem como derrubar ninguém por engano.
 */
const forbiddenDb = new Proxy({} as never, {
  get() {
    throw new Error("a limpeza tocou o banco depois de falhar ao ler o Discord");
  },
});

describe("limpeza diária: falha do Discord (TASK-049, AC#5)", () => {
  const clock = () => new Date("2026-09-18T04:00:00.000Z");

  it("consulta que falha aborta a passada sem alterar ninguém e registra o motivo", async () => {
    const members = { listMembers: vi.fn(async () => Promise.reject(new Error("504 Gateway Timeout"))) };
    const service = new GuildCleanupService({ db: forbiddenDb } as unknown as DbHandle, members, clock);
    const erro = vi.spyOn(service["logger"], "error").mockImplementation(() => {});

    const result = await service.run();

    expect(result).toMatchObject({ aborted: 1, deactivated: 0, sessionsRevoked: 0, rolesRemoved: 0 });
    expect(erro).toHaveBeenCalledWith(expect.stringContaining("504 Gateway Timeout"));
    expect(erro).toHaveBeenCalledWith(expect.stringContaining("Nenhuma conta foi alterada"));
  });

  it("duas chamadas ao mesmo tempo viram uma passada só (idempotência sob disparo manual + agendador)", async () => {
    const members = { listMembers: vi.fn(async () => Promise.reject(new Error("timeout"))) };
    const service = new GuildCleanupService({ db: forbiddenDb } as unknown as DbHandle, members, clock);
    vi.spyOn(service["logger"], "error").mockImplementation(() => {});

    await Promise.all([service.run(), service.run()]);

    expect(members.listMembers).toHaveBeenCalledTimes(1);
  });
});

/** O caminho feliz contra Postgres de verdade: a nota de autoria e o dinheiro intocado (AC#2/AC#4). */
describe.skipIf(!baseUrl)("limpeza diária: passada completa (TASK-049, Postgres real)", () => {
  let handle: DbHandle;
  let seq = 0;
  const NOW = new Date("2026-09-18T04:00:00.000Z");
  const nextDiscordId = () => `9500000000000000${String(++seq).padStart(2, "0")}`;

  beforeAll(async () => {
    const target = new URL(baseUrl!);
    const name = `${target.pathname.slice(1)}_server_cleanup`;
    target.pathname = `/${name}`;
    const admin = createDb(baseUrl!, { max: 1 });
    await admin.db.execute(sql.raw(`drop database if exists "${name}" with (force)`));
    await admin.db.execute(sql.raw(`create database "${name}"`));
    await admin.close();
    await runMigrations(target.toString());
    handle = createDb(target.toString());
  }, 60_000);

  afterAll(async () => {
    await handle?.close();
  });

  const user = async (roles: ("member" | "staff" | "admin")[] = ["member"]) => {
    const discordId = nextDiscordId();
    const created = await upsertUserByDiscordId(handle.db, { discordId, discordUsername: `u${discordId.slice(-4)}` });
    for (const role of roles) await grantRole(handle.db, created.id, role);
    return { ...created, discordId };
  };

  it("desativa quem saiu, deixa a nota assinada pela limpeza automática e não encosta no saldo", async () => {
    const admin = await user(["admin"]);
    const ficou = await user();
    const saiu = await user(["member", "staff"]);
    const sessao = await createSession(handle.db, saiu.id, new Date(Date.now() + 3_600_000));
    await insertLedgerEntry(handle.db, { userId: saiu.id, amount: 750_000n, kind: "adjustment", memo: "split", createdBy: admin.id });

    const members = { listMembers: vi.fn(async () => [snapshot(admin.discordId), snapshot(ficou.discordId)]) };
    const service = new GuildCleanupService(handle, members, () => NOW);

    const result = await service.run();

    expect(result).toMatchObject({ aborted: 0, deactivated: 1, sessionsRevoked: 1, rolesRemoved: 2 });
    expect(await findValidSession(handle.db, sessao.token)).toBeNull();
    expect(await listRoles(handle.db, saiu.id)).toEqual([]);
    expect(await getLeftGuildAt(handle.db, saiu.id)).toEqual(NOW);
    expect(await getLeftGuildAt(handle.db, ficou.id)).toBeNull();

    // Saldo intacto: sair do Discord não cancela a dívida da comunidade (G6, AC#4).
    expect(await getLedgerBalance(handle.db, saiu.id)).toBe(750_000n);

    // Autoria: o job não tem usuário logado, então a nota é `system`, sem autor, e diz o que ele fez.
    const notas = await listUserNotes(handle.db, saiu.id);
    expect(notas).toHaveLength(1);
    expect(notas[0]).toMatchObject({ kind: "system", author: null });
    expect(notas[0]!.body).toContain("Limpeza automática");
    expect(notas[0]!.body).toContain("Saldo, extrato e saques não foram tocados");

    // Segunda passada idêntica: nada novo acontece e nenhuma nota é duplicada (AC#1).
    const segunda = await service.run();
    expect(segunda).toMatchObject({ deactivated: 0 });
    expect(await listUserNotes(handle.db, saiu.id)).toHaveLength(1);
  });
});
