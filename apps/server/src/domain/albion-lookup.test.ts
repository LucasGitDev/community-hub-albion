import { describe, expect, it, vi } from "vitest";
import { FetchAlbionPlayerLookup } from "./albion-lookup.js";

const NOW = Date.parse("2026-09-15T12:00:00.000Z");
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const players = (...list: { Id: string; Name: string; GuildName: string }[]) => json({ guilds: [], players: list });

function make(fetchImpl: (url: string, init?: RequestInit) => Promise<Response>, extra: { now?: () => number; timeoutMs?: number } = {}) {
  const fetchMock = vi.fn(fetchImpl);
  const lookup = new FetchAlbionPlayerLookup({ region: "americas", fetch: fetchMock as unknown as typeof fetch, now: () => NOW, ...extra });
  return { lookup, fetchMock };
}

describe("FetchAlbionPlayerLookup (TASK-016, Q14/Q15)", () => {
  it("região ausente: disabled sem chamar a API", async () => {
    const fetchMock = vi.fn();
    const lookup = new FetchAlbionPlayerLookup({ region: undefined, fetch: fetchMock });
    expect(await lookup.lookup("Nick")).toEqual({ status: "disabled" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("found com id, grafia do jogo e guilda; URL da região com nick codificado", async () => {
    const { lookup, fetchMock } = make(async () => players({ Id: "p1", Name: "MeuNick", GuildName: "Guilda X" }));
    expect(await lookup.lookup("meunick")).toEqual({
      status: "found",
      region: "americas",
      playerId: "p1",
      name: "MeuNick",
      guildName: "Guilda X",
      checkedAt: "2026-09-15T12:00:00.000Z",
    });
    expect(fetchMock.mock.calls[0]![0]).toBe("https://gameinfo.albiononline.com/api/gameinfo/search?q=meunick");
  });

  it("sem jogador ou só nomes parecidos (busca aproximada): not_found", async () => {
    expect((await make(async () => players()).lookup.lookup("Nick")).status).toBe("not_found");
    const partial = make(async () => players({ Id: "a", Name: "Nick0", GuildName: "" }, { Id: "b", Name: "nickname", GuildName: "" }));
    expect((await partial.lookup.lookup("Nick")).status).toBe("not_found");
  });

  it("HTTP 500, JSON inválido, formato inesperado e erro de rede: unavailable", async () => {
    expect(await make(async () => json({}, 500)).lookup.lookup("Nick")).toEqual({ status: "unavailable", region: "americas", checkedAt: "2026-09-15T12:00:00.000Z" });
    expect((await make(async () => new Response("<html>", { status: 200 })).lookup.lookup("Nick")).status).toBe("unavailable");
    expect((await make(async () => json({ guilds: [] })).lookup.lookup("Nick")).status).toBe("unavailable");
    expect((await make(async () => Promise.reject(new TypeError("fetch failed"))).lookup.lookup("Nick")).status).toBe("unavailable");
  });

  it("informa o motivo da indisponibilidade pro log", async () => {
    const reasons: string[] = [];
    const lookup = new FetchAlbionPlayerLookup({ region: "asia", fetch: (async () => json({}, 502)) as typeof fetch, onUnavailable: (r) => reasons.push(r) });
    await lookup.lookup("Nick");
    expect(reasons).toEqual(["HTTP 502"]);
  });

  it("timeout aborta e vira unavailable", async () => {
    const hang = (_url: string, init?: RequestInit) =>
      new Promise<Response>((_, reject) => init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason)));
    const { lookup } = make(hang, { timeoutMs: 20 });
    expect((await lookup.lookup("Nick")).status).toBe("unavailable");
  });

  it("cache por nick sem caixa; consultas simultâneas viram uma chamada; expira pelo TTL", async () => {
    let now = NOW;
    const { lookup, fetchMock } = make(async () => players({ Id: "p1", Name: "Nick", GuildName: "" }), { now: () => now });
    await Promise.all([lookup.lookup("Nick"), lookup.lookup("NICK")]);
    await lookup.lookup("nick");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    now += 10 * 60_000 + 1;
    await lookup.lookup("Nick");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("unavailable fica em cache curto (sem tempestade) e limite de entradas descarta a mais antiga", async () => {
    let now = NOW;
    let status = 503;
    const fetchMock = vi.fn(async () => (status === 200 ? players() : json({}, status)));
    const lookup = new FetchAlbionPlayerLookup({ region: "europe", fetch: fetchMock as unknown as typeof fetch, now: () => now, maxEntries: 2 });
    await lookup.lookup("Nick");
    await lookup.lookup("Nick");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    now += 60_001;
    status = 200;
    expect((await lookup.lookup("Nick")).status).toBe("not_found");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await lookup.lookup("b");
    await lookup.lookup("c");
    await lookup.lookup("Nick");
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });
});
