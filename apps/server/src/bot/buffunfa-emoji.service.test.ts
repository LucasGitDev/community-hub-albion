import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BuffunfaEmojiService, type GuildEmojiGateway } from "./buffunfa-emoji.service.js";

function gateway(overrides: Partial<GuildEmojiGateway> = {}) {
  return {
    list: vi.fn(async () => [] as { id: string; name: string | null }[]),
    create: vi.fn(async () => ({ id: "criado" })),
    ...overrides,
  };
}

async function pngPath() {
  const dir = await mkdtemp(join(tmpdir(), "buffunfa-"));
  const file = join(dir, "buffunfa.png");
  await writeFile(file, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  return file;
}

describe("BuffunfaEmojiService (TASK-056, F6-28)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("env ganha de tudo: nem procura nem cria", async () => {
    const emojis = gateway();
    const service = new BuffunfaEmojiService(emojis, "999888777666555444", await pngPath());
    await service.onReady();
    expect(service.emojiId).toBe("999888777666555444");
    expect(emojis.list).not.toHaveBeenCalled();
    expect(emojis.create).not.toHaveBeenCalled();
  });

  it("sem env, usa o emoji já existente na guild em vez de criar outro", async () => {
    const emojis = gateway({ list: vi.fn(async () => [{ id: "outro", name: "prata" }, { id: "achado", name: "buffunfa" }]) });
    const service = new BuffunfaEmojiService(emojis, null, await pngPath());
    await service.onReady();
    expect(service.emojiId).toBe("achado");
    expect(emojis.create).not.toHaveBeenCalled();
  });

  it("cria a partir do PNG versionado quando não existe nenhum", async () => {
    const emojis = gateway();
    const service = new BuffunfaEmojiService(emojis, null, await pngPath());
    await service.onReady();
    expect(service.emojiId).toBe("criado");
    expect(emojis.create).toHaveBeenCalledWith("buffunfa", expect.any(Buffer));
  });

  it("falha de permissão ou de slot vira aviso e texto puro, sem derrubar o bot", async () => {
    const emojis = gateway({ create: vi.fn(async () => { throw Object.assign(new Error("Missing Permissions"), { code: 50013 }); }) });
    const service = new BuffunfaEmojiService(emojis, null, await pngPath());
    await expect(service.onReady()).resolves.toBeUndefined();
    expect(service.emojiId).toBeNull();
  });

  it("PNG ausente também só vira aviso", async () => {
    const service = new BuffunfaEmojiService(gateway(), null, "/caminho/que/nao/existe.png");
    await expect(service.onReady()).resolves.toBeUndefined();
    expect(service.emojiId).toBeNull();
  });
});
