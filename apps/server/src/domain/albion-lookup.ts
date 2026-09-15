import { albionSearchUrl, matchAlbionPlayer, type AlbionLookupResult, type AlbionRegion } from "@albion-hub/shared";

/** Porta da consulta de jogador no Albion (TASK-016). Nunca lança: falha vira `unavailable`. */
export interface AlbionPlayerLookup {
  lookup(nick: string): Promise<AlbionLookupResult>;
}

export interface FetchAlbionPlayerLookupOptions {
  /** undefined = consulta desligada (ALBION_REGION ausente). */
  region: AlbionRegion | undefined;
  fetch?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
  /** TTL de found/not_found. */
  ttlMs?: number;
  /** TTL de unavailable: curto, mas evita tempestade de chamadas com a API fora. */
  unavailableTtlMs?: number;
  maxEntries?: number;
  /** Motivo da indisponibilidade (log operacional; sem corpo da resposta). */
  onUnavailable?: (reason: string) => void;
}

/**
 * Cliente HTTP da busca gameinfo: timeout curto, sem retry, cache em memória por nick (sem caixa)
 * e deduplicação de consultas simultâneas do mesmo nick.
 */
export class FetchAlbionPlayerLookup implements AlbionPlayerLookup {
  private readonly cache = new Map<string, { result: AlbionLookupResult; expiresAt: number }>();
  private readonly inFlight = new Map<string, Promise<AlbionLookupResult>>();
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly ttlMs: number;
  private readonly unavailableTtlMs: number;
  private readonly maxEntries: number;

  constructor(private readonly options: FetchAlbionPlayerLookupOptions) {
    this.fetchFn = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
    this.timeoutMs = options.timeoutMs ?? 5_000;
    this.ttlMs = options.ttlMs ?? 10 * 60_000;
    this.unavailableTtlMs = options.unavailableTtlMs ?? 60_000;
    this.maxEntries = options.maxEntries ?? 1_000;
  }

  lookup(nick: string): Promise<AlbionLookupResult> {
    const region = this.options.region;
    if (!region) return Promise.resolve({ status: "disabled" });
    const key = nick.toLowerCase();
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > this.now()) return Promise.resolve(cached.result);
    const pending = this.inFlight.get(key);
    if (pending) return pending;
    const promise = this.request(region, nick).then((result) => {
      this.inFlight.delete(key);
      this.store(key, result);
      return result;
    });
    this.inFlight.set(key, promise);
    return promise;
  }

  private store(key: string, result: AlbionLookupResult) {
    this.cache.delete(key);
    if (this.cache.size >= this.maxEntries) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(key, { result, expiresAt: this.now() + (result.status === "unavailable" ? this.unavailableTtlMs : this.ttlMs) });
  }

  private async request(region: AlbionRegion, nick: string): Promise<AlbionLookupResult> {
    const unavailable = (reason: string): AlbionLookupResult => {
      this.options.onUnavailable?.(reason);
      return { status: "unavailable", region, checkedAt: new Date(this.now()).toISOString() };
    };
    const checkedAt = () => new Date(this.now()).toISOString();
    try {
      const res = await this.fetchFn(albionSearchUrl(region, nick), {
        headers: { Accept: "application/json" },
        redirect: "error",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!res.ok) return unavailable(`HTTP ${res.status}`);
      const match = matchAlbionPlayer(await res.json(), nick);
      if (match === "invalid") return unavailable("resposta fora do formato");
      if (!match) return { status: "not_found", region, checkedAt: checkedAt() };
      return { status: "found", region, ...match, checkedAt: checkedAt() };
    } catch (error) {
      return unavailable(error instanceof Error ? error.name : "erro de rede");
    }
  }
}
