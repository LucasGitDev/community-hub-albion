/**
 * Consulta de nick na API pública do Albion (TASK-016, Q14/Q15). Ajuda pra staff, nunca bloqueia registro nem aprovação.
 * Endpoint conferido em 2026-09: GET https://<host>/api/gameinfo/search?q=<nick> → { guilds: [...], players: [{ Id, Name, GuildName, ... }] }.
 * A busca é por prefixo/aproximada; só conta como encontrado o jogador com Name igual ao nick (sem caixa).
 */
export const ALBION_REGIONS = ["americas", "europe", "asia"] as const;
export type AlbionRegion = (typeof ALBION_REGIONS)[number];

/** Hosts fixos por região: a URL de saída só é montada daqui + nick codificado (sem SSRF). */
export const ALBION_GAMEINFO_HOSTS: Record<AlbionRegion, string> = {
  americas: "https://gameinfo.albiononline.com",
  europe: "https://gameinfo-ams.albiononline.com",
  asia: "https://gameinfo-sgp.albiononline.com",
};

export const ALBION_REGION_LABELS: Record<AlbionRegion, string> = { americas: "Americas", europe: "Europe", asia: "Asia" };

export type AlbionLookupResult =
  | { status: "found"; region: AlbionRegion; playerId: string; name: string; guildName: string | null; checkedAt: string }
  | { status: "not_found"; region: AlbionRegion; checkedAt: string }
  | { status: "unavailable"; region: AlbionRegion; checkedAt: string }
  | { status: "disabled" };

export function albionSearchUrl(region: AlbionRegion, nick: string): string {
  return `${ALBION_GAMEINFO_HOSTS[region]}/api/gameinfo/search?q=${encodeURIComponent(nick)}`;
}

export interface AlbionPlayerMatch {
  playerId: string;
  name: string;
  guildName: string | null;
}

/** Acha o jogador com nome exato (sem caixa) na resposta da busca. null = não achou; "invalid" = resposta fora do formato (quem chama trata como indisponível). */
export function matchAlbionPlayer(body: unknown, nick: string): AlbionPlayerMatch | null | "invalid" {
  const players = typeof body === "object" && body !== null ? (body as { players?: unknown }).players : undefined;
  if (!Array.isArray(players)) return "invalid";
  const target = nick.toLowerCase();
  for (const p of players as unknown[]) {
    if (typeof p !== "object" || p === null) continue;
    const { Id, Name, GuildName } = p as { Id?: unknown; Name?: unknown; GuildName?: unknown };
    if (typeof Id === "string" && typeof Name === "string" && Name.toLowerCase() === target)
      return { playerId: Id, name: Name, guildName: typeof GuildName === "string" && GuildName.trim() ? GuildName : null };
  }
  return null;
}

/** Texto PT-BR do resultado pro painel e (TASK-015) pro embed. null = consulta desligada, não mostrar nada. */
export function describeAlbionLookup(result: AlbionLookupResult): string | null {
  switch (result.status) {
    case "disabled":
      return null;
    case "found": {
      const where = `Encontrado no Albion (${ALBION_REGION_LABELS[result.region]})`;
      return result.guildName ? `${where}, guilda ${result.guildName}` : `${where}, sem guilda`;
    }
    case "not_found":
      return `Não encontrado no Albion (${ALBION_REGION_LABELS[result.region]})`;
    case "unavailable":
      return "API do Albion indisponível agora";
  }
}
