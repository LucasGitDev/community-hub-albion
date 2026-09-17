import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MEMBER_FILTERS, type MemberFilter } from "@albion-hub/shared";
import { banUser, createDb, listAdminMembers, runMigrations, schema, upsertUserByDiscordId, type DbHandle } from "./index.js";

const baseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!baseUrl && process.env.CI) throw new Error("CI sem TEST_DATABASE_URL: os filtros da lista de membros não podem ser pulados");

/**
 * Filtros e contagens da lista de membros (TASK-054, AC#1/AC#2/AC#3) contra Postgres de verdade.
 *
 * A promessa que estes testes protegem é uma só: **o número do chip é o número de linhas que o chip
 * devolve**. Um chip que diz 3 e abre uma lista de 5 é pior do que não existir, e é exatamente o tipo de
 * divergência que aparece quando a contagem e o `where` são escritos em dois lugares.
 */
describe.skipIf(!baseUrl)("filtros da lista de membros (TASK-054, Postgres real)", () => {
  let handle: DbHandle;
  let seq = 0;
  const nextDiscordId = () => `9540000000000000${String(++seq).padStart(2, "0")}`;

  beforeAll(async () => {
    const target = new URL(baseUrl!);
    const name = `${target.pathname.slice(1)}_member_filters`;
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

  interface Seed {
    nick?: string | null;
    albionStatus?: "found" | "not_found";
    left?: boolean;
    banned?: boolean;
  }

  /** Cria um usuário no estado pedido. O ator do banimento é criado uma vez e fica fora das contagens pela busca. */
  async function user(seed: Seed = {}) {
    const discordId = nextDiscordId();
    const created = await upsertUserByDiscordId(handle.db, { discordId, discordUsername: `t054u${discordId.slice(-4)}` });
    const patch: Record<string, unknown> = {};
    if (seed.nick !== undefined) patch.gameNick = seed.nick;
    if (seed.albionStatus) patch.albionStatus = seed.albionStatus;
    if (seed.left) patch.leftGuildAt = new Date("2026-09-10T00:00:00.000Z");
    if (Object.keys(patch).length > 0) await handle.db.update(schema.users).set(patch).where(sql`${schema.users.id} = ${created.id}`);
    return created;
  }

  /**
   * Toda consulta usa a mesma busca (`t054u`), que é o prefixo dos usuários semeados aqui: o teste mede o
   * conjunto que ele mesmo montou, e o ator do banimento (criado com outro nome) não entra na conta.
   */
  const list = (filter: MemberFilter) => listAdminMembers(handle.db, { search: "t054u", filter, pageSize: 100, offset: 0 });

  let ids: Record<string, string>;

  beforeAll(async () => {
    const ator = await upsertUserByDiscordId(handle.db, { discordId: nextDiscordId(), discordUsername: "ator-do-banimento-054" });

    const semNick = await user({ nick: null });
    const naoEncontrado = await user({ nick: "NickErrado054", albionStatus: "not_found" });
    const saiu = await user({ nick: "Saiu054", albionStatus: "found", left: true });
    const semNickESaiu = await user({ nick: "", left: true });
    const ok = await user({ nick: "Regular054", albionStatus: "found" });
    const banido = await user({ nick: "Banido054", albionStatus: "found" });
    // O caso que a task pede explicitamente: banido **e** fora do servidor, com nick que também não confere.
    const banidoESaiu = await user({ nick: "BanidoSaiu054", albionStatus: "not_found", left: true });

    await banUser(handle.db, { userId: banido.id, actorId: ator.id, reason: "banido e dentro do servidor" });
    await banUser(handle.db, { userId: banidoESaiu.id, actorId: ator.id, reason: "banido e fora do servidor" });

    ids = { semNick: semNick.id, naoEncontrado: naoEncontrado.id, saiu: saiu.id, semNickESaiu: semNickESaiu.id, ok: ok.id, banido: banido.id, banidoESaiu: banidoESaiu.id };
  }, 60_000);

  it("a contagem de cada chip é exatamente o número de linhas que o chip devolve (AC#1)", async () => {
    for (const filter of MEMBER_FILTERS) {
      const page = await list(filter);
      expect.soft(page.total, `total de ${filter}`).toBe(page.counts[filter]);
      expect.soft(page.members.length, `linhas de ${filter}`).toBe(page.counts[filter]);
      // As contagens não mudam com o filtro escolhido: o chip mostra o que o admin ganha ao trocar.
      expect.soft(page.counts, `contagens vistas de ${filter}`).toEqual((await list("todos")).counts);
    }
  });

  it("'Saiu do servidor' traz quem a limpeza marcou, e só (AC#1)", async () => {
    const page = await list("saiu");
    expect(page.members.map((m) => m.id).sort()).toEqual([ids.saiu, ids.semNickESaiu].sort());
    expect(page.members.every((m) => m.leftGuildAt !== null)).toBe(true);
    expect(page.counts.saiu).toBe(2);
  });

  it("banido e fora do servidor aparece uma vez só, em 'Banidos', e nunca na fila de atenção (AC#2)", async () => {
    const banidos = await list("banidos");
    expect(banidos.members.map((m) => m.id).sort()).toEqual([ids.banido, ids.banidoESaiu].sort());
    // A linha continua contando a história inteira mesmo entrando por 'Banidos': o selo de saída não some.
    expect(banidos.members.find((m) => m.id === ids.banidoESaiu)!.leftGuildAt).not.toBeNull();

    for (const filter of ["atencao", "sem_nick", "nao_encontrados", "saiu"] as const) {
      const page = await list(filter);
      expect.soft(page.members.some((m) => m.ban !== null), `${filter} não pode conter conta banida`).toBe(false);
      expect.soft(page.members.map((m) => m.id), `${filter} não pode conter o banido que saiu`).not.toContain(ids.banidoESaiu);
    }
  });

  it("'Precisam de atenção' é a união exata dos três refinos (AC#2)", async () => {
    const [atencao, semNick, naoEncontrados, saiu] = await Promise.all([list("atencao"), list("sem_nick"), list("nao_encontrados"), list("saiu")]);
    const uniao = new Set([...semNick.members, ...naoEncontrados.members, ...saiu.members].map((m) => m.id));
    expect(atencao.members.map((m) => m.id).sort()).toEqual([...uniao].sort());
    expect(atencao.counts.atencao).toBe(uniao.size);
    // Quem está sem nick **e** saiu conta nos dois refinos, e uma vez só no grupo: a soma dos refinos passa do grupo.
    expect(semNick.total + naoEncontrados.total + saiu.total).toBeGreaterThan(atencao.total);
    // Ninguém regular entra na fila, e 'Todos' continua sendo o único filtro que não esconde ninguém.
    expect(atencao.members.map((m) => m.id)).not.toContain(ids.ok);
    expect((await list("todos")).members.map((m) => m.id)).toContain(ids.banidoESaiu);
  });

  it("a paginação anda dentro do filtro escolhido, sem repetir nem pular linha (AC#3)", async () => {
    const inteira = await listAdminMembers(handle.db, { search: "t054u", filter: "atencao", pageSize: 100, offset: 0 });
    expect(inteira.total).toBeGreaterThan(2);

    const vistas: string[] = [];
    for (let offset = 0; offset < inteira.total; offset += 2) {
      const pagina = await listAdminMembers(handle.db, { search: "t054u", filter: "atencao", pageSize: 2, offset });
      // Toda página do mesmo filtro repete o mesmo total: é dele que sai o "página X de Y" da tela.
      expect.soft(pagina.total, `total na página com offset ${offset}`).toBe(inteira.total);
      vistas.push(...pagina.members.map((m) => m.id));
    }
    expect(vistas).toEqual(inteira.members.map((m) => m.id));
    expect(new Set(vistas).size).toBe(vistas.length);
  });
});
