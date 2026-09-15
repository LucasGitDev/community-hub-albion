import { describe, expect, it } from "vitest";
import { albionSearchUrl, describeAlbionLookup, matchAlbionPlayer } from "./albion.js";

const player = (Name: string, GuildName = "", Id = `id-${Name}`) => ({ Id, Name, GuildName, AllianceName: "" });

describe("matchAlbionPlayer (TASK-016, Q14)", () => {
  it("encontra nome exato sem diferenciar caixa e devolve a grafia do jogo", () => {
    expect(matchAlbionPlayer({ guilds: [], players: [player("Albion0"), player("ALBION", "Guilda X")] }, "albion")).toEqual({
      playerId: "id-ALBION",
      name: "ALBION",
      guildName: "Guilda X",
    });
  });

  it("busca aproximada com só nomes parecidos não conta como encontrado", () => {
    expect(matchAlbionPlayer({ players: [player("Albion0"), player("albion00")] }, "Albion")).toBeNull();
    expect(matchAlbionPlayer({ players: [] }, "Albion")).toBeNull();
  });

  it("guilda vazia vira null; itens malformados são ignorados; formato inválido é sinalizado", () => {
    expect(matchAlbionPlayer({ players: [null, { Name: "Nick" }, player("Nick", "  ")] }, "nick")).toEqual({ playerId: "id-Nick", name: "Nick", guildName: null });
    expect(matchAlbionPlayer({ guilds: [] }, "x")).toBe("invalid");
    expect(matchAlbionPlayer(null, "x")).toBe("invalid");
  });
});

describe("albionSearchUrl", () => {
  it("usa host fixo da região e codifica o nick", () => {
    expect(albionSearchUrl("americas", "a b&x=1")).toBe("https://gameinfo.albiononline.com/api/gameinfo/search?q=a%20b%26x%3D1");
    expect(albionSearchUrl("europe", "N")).toBe("https://gameinfo-ams.albiononline.com/api/gameinfo/search?q=N");
    expect(albionSearchUrl("asia", "N")).toBe("https://gameinfo-sgp.albiononline.com/api/gameinfo/search?q=N");
  });
});

describe("describeAlbionLookup", () => {
  const checkedAt = "2026-09-15T00:00:00.000Z";
  it("texto por status; desligado não mostra nada", () => {
    expect(describeAlbionLookup({ status: "found", region: "americas", playerId: "1", name: "N", guildName: "X", checkedAt })).toBe("Encontrado no Albion (Americas), guilda X");
    expect(describeAlbionLookup({ status: "found", region: "asia", playerId: "1", name: "N", guildName: null, checkedAt })).toBe("Encontrado no Albion (Asia), sem guilda");
    expect(describeAlbionLookup({ status: "not_found", region: "europe", checkedAt })).toBe("Não encontrado no Albion (Europe)");
    expect(describeAlbionLookup({ status: "unavailable", region: "europe", checkedAt })).toBe("API do Albion indisponível agora");
    expect(describeAlbionLookup({ status: "disabled" })).toBeNull();
  });
});
