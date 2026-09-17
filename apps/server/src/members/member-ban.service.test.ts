import "reflect-metadata";
import { describe, expect, it, vi } from "vitest";
import { MemberBanService } from "./member-ban.service.js";

vi.mock("@albion-hub/db", () => ({
  banUser: vi.fn(),
  unbanUser: vi.fn(),
  getBanStatus: vi.fn(),
  addUserNote: vi.fn().mockResolvedValue({ id: "n1" }),
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
    const service = new MemberBanService(handle, gateway as never, gateway ? ROLE : null);
    return { service, gateway };
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
    const { service, gateway } = setup();
    mocked.banUser.mockResolvedValue({ ok: false, reason: "last_admin" });
    expect(await service.ban("u1", "actor", "motivo")).toEqual({ ok: false, reason: "last_admin" });
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
    const { service } = setup();
    mocked.unbanUser.mockResolvedValue({ ok: false, reason: "not_banned" });
    expect(await service.unban("u1", "actor")).toEqual({ ok: false, reason: "not_banned" });
    expect(mocked.addUserNote).not.toHaveBeenCalled();
  });
});
