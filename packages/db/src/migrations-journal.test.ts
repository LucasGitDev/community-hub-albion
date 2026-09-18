import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * O journal das migrations é lido pelo migrator do Drizzle, que aplica só as migrations cujo `when`
 * é **maior** que o da última aplicada no banco. Carimbo fora de ordem não dá erro: a migration é
 * pulada em silêncio.
 *
 * Aconteceu em produção (2026-09-18): a 0024 entrou com um `when` escrito à mão, maior que o da 0025
 * gerada depois. A 0025 nunca rodou, o código novo passou a ler `users.referred_by`, e o login caiu
 * para todo mundo. Os testes de integração não pegaram porque sobem banco novo, onde tudo é aplicado
 * de uma vez — só um banco que já tinha a 0024 revelava o salto.
 */
const dir = new URL("../migrations/", import.meta.url);
const journal = JSON.parse(readFileSync(new URL("meta/_journal.json", dir), "utf8")) as {
  entries: { idx: number; when: number; tag: string }[];
};

describe("journal das migrations", () => {
  it("os carimbos crescem estritamente, na ordem dos índices", () => {
    const fora = journal.entries.slice(1).filter((e, i) => e.when <= journal.entries[i]!.when);
    expect(fora.map((e) => e.tag)).toEqual([]);
  });

  it("índices são contíguos e batem com o prefixo do nome", () => {
    journal.entries.forEach((e, i) => {
      expect(e.idx).toBe(i);
      expect(e.tag.startsWith(String(i).padStart(4, "0") + "_")).toBe(true);
    });
  });

  it("todo arquivo .sql está no journal e vice-versa", () => {
    const arquivos = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => f.replace(/\.sql$/, ""))
      .sort();
    expect(arquivos).toEqual(journal.entries.map((e) => e.tag).sort());
  });
});
