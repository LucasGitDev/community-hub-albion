import "reflect-metadata";
import { describe, expect, it, vi } from "vitest";
import { FakeTimelinePublisher } from "../timeline/fake-timeline.publisher.js";
import { MemberBanService } from "./member-ban.service.js";

vi.mock("@albion-hub/db", () => ({
  banUser: vi.fn(),
  unbanUser: vi.fn(),
  getBanStatus: vi.fn(),
  addUserNote: vi.fn().mockResolvedValue({ id: "n1" }),
  listTimelineUsers: vi.fn(async (_db: unknown, ids: string[]) => new Map(ids.map((id) => [id, { id, name: `nick-${id}`, discordId: `d-${id}` }]))),
}));

const db = await import("@albion-hub/db");
const mocked = db as unknown as {
  banUser: ReturnType<typeof vi.fn>;
  unbanUser: ReturnType<typeof vi.fn>;
  getBanStatus: ReturnType<typeof vi.fn>;
  addUserNote: ReturnType<typeof vi.fn>;
};

const ROLE = "323456789012345678";
const handle = { db: {} } as never;

/**
 * Orquestração do banimento (TASK-050): banco primeiro, Discord depois e só o cargo Membro.
 * O teste existe sobretudo para travar o que o serviço **não** faz: nada de kick, nada de guild ban.
 */
describe("MemberBanService (TASK-050)", () => {
  function setup(gateway: Partial<Record<"removeRole" | "addRole" | "setNickname", unknown>> | null = { removeRole: vi.fn().mockResolvedValue(undefined) }) {
    mocked.banUser.mockReset();
    mocked.unbanUser.mockReset();
    mocked.getBanStatus.mockReset().mockResolvedValue(null);
    mocked.addUserNote.mockClear();
    const timeline = new FakeTimelinePublisher();
    const service = new MemberBanService(handle, timeline, gateway as never, gateway ? ROLE : null);
    return { service, gateway, timeline };
  }

  it("banimento ok: remove só o cargo Membro e grava a nota de histórico", async () => {
    const { service, gateway } = setup();
    mocked.banUser.mockResolvedValue({ ok: true, discordId: "400000000000000001", sessionsRevoked: 2 });

    const result = await service.ban("u1", "actor", "roubou o loot do split");
    expect(result).toMatchObject({ ok: true });
    expect(gateway!.removeRole).toHaveBeenCalledWith("400000000000000001", ROLE, "Banido no painel: roubou o loot do split");
    // Nenhum kick e nenhum ban de guild existem na porta: o que não está aqui não pode ser chamado.
    expect(Object.keys(gateway!)).toEqual(["removeRole"]);
    expect(mocked.addUserNote).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ kind: "system", body: "Banido. Motivo: roubou o loot do split" }));
  });

  it("recusa do banco não vira nota nem chamada ao Discord", async () => {
    const { service, gateway, timeline } = setup();
    mocked.banUser.mockResolvedValue({ ok: false, reason: "last_admin" });
    expect(await service.ban("u1", "actor", "motivo")).toEqual({ ok: false, reason: "last_admin" });
    expect(timeline.entries).toEqual([]);
    expect(gateway!.removeRole).not.toHaveBeenCalled();
    expect(mocked.addUserNote).not.toHaveBeenCalled();
  });

  it("Discord fora do ar não derruba o banimento: o acesso já foi cortado no banco", async () => {
    const { service, gateway } = setup({ removeRole: vi.fn().mockRejectedValue(new Error("Missing Permissions")) });
    mocked.banUser.mockResolvedValue({ ok: true, discordId: "400000000000000001", sessionsRevoked: 1 });
    await expect(service.ban("u1", "actor", "motivo suficiente")).resolves.toMatchObject({ ok: true });
    expect(gateway!.removeRole).toHaveBeenCalled();
  });

  it("sem bot ligado não há o que sincronizar e o banimento vale igual", async () => {
    const { service } = setup(null);
    mocked.banUser.mockResolvedValue({ ok: true, discordId: "400000000000000001", sessionsRevoked: 0 });
    await expect(service.ban("u1", "actor", "motivo suficiente")).resolves.toMatchObject({ ok: true });
  });

  it("desbanir grava o motivo antigo na nota e não devolve cargo nenhum", async () => {
    const { service, gateway } = setup();
    mocked.getBanStatus.mockResolvedValue({ bannedAt: new Date(), banReason: "roubou o loot", bannedBy: "actor" });
    mocked.unbanUser.mockResolvedValue({ ok: true, discordId: "400000000000000001" });

    expect(await service.unban("u1", "actor")).toMatchObject({ ok: true });
    expect(mocked.addUserNote).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ body: "Desbanido. O banimento era por: roubou o loot" }));
    expect(gateway!.removeRole).not.toHaveBeenCalled();
  });

  it("desbanir quem não está banido não grava nada", async () => {
    const { service, timeline } = setup();
    mocked.unbanUser.mockResolvedValue({ ok: false, reason: "not_banned" });
    expect(await service.unban("u1", "actor")).toEqual({ ok: false, reason: "not_banned" });
    expect(timeline.entries).toEqual([]);
    expect(mocked.addUserNote).not.toHaveBeenCalled();
  });

  it("timeline: banimento publica ator, alvo, motivo e sessões depois do banco (TASK-077)", async () => {
    const { service, timeline } = setup();
    mocked.banUser.mockResolvedValue({ ok: true, discordId: "400000000000000001", sessionsRevoked: 2 });
    await service.ban("u1", "actor", "roubou o loot do split");
    expect(timeline.only("account.banned")).toEqual({
      action: "account.banned",
      summary: "Banido: nick-u1",
      actor: { kind: "user", userId: "actor", name: "nick-actor", discordId: "d-actor" },
      target: { name: "nick-u1", id: "u1", discordId: "d-u1" },
      details: [
        { name: "Motivo", value: "roubou o loot do split" },
        { name: "Sessões revogadas", value: "2" },
      ],
    });
  });

  it("timeline: desbanimento publica com o motivo antigo (TASK-077)", async () => {
    const { service, timeline } = setup();
    mocked.getBanStatus.mockResolvedValue({ bannedAt: new Date(), banReason: "roubou o loot", bannedBy: "actor" });
    mocked.unbanUser.mockResolvedValue({ ok: true, discordId: "400000000000000001" });
    await service.unban("u1", "actor");
    expect(timeline.only("account.unbanned")).toMatchObject({
      summary: "Desbanido: nick-u1",
      actor: { kind: "user", userId: "actor" },
      target: { id: "u1" },
      details: [{ name: "Motivo do banimento", value: "roubou o loot" }],
    });
  });

  it("timeline: falha ao montar o registro não derruba o banimento", async () => {
    const { service, timeline } = setup();
    (db as unknown as { listTimelineUsers: ReturnType<typeof vi.fn> }).listTimelineUsers.mockRejectedValueOnce(new Error("conexão caiu"));
    vi.spyOn(service["logger"], "warn").mockImplementation(() => {});
    mocked.banUser.mockResolvedValue({ ok: true, discordId: "400000000000000001", sessionsRevoked: 0 });
    await expect(service.ban("u1", "actor", "motivo suficiente")).resolves.toMatchObject({ ok: true });
    expect(timeline.entries).toEqual([]);
  });
});
