import { expect, test, type Page } from "@playwright/test";
import { login, ORIGIN, snap } from "./session";

/**
 * Filtros da lista de membros em dois níveis (TASK-054).
 *
 * O banco do e2e não é limpo entre rodadas e desktop e mobile rodam em paralelo contra ele, então cada
 * teste semeia usuários com um prefixo único e **deixa a busca ligada nesse prefixo**. Isso não é só
 * higiene: a busca também recorta as contagens no servidor, o que permite a asserção que importa aqui —
 * o número do chip é exatamente o número de linhas que o chip abre, com valores conhecidos.
 */
const RUN = String(Date.now()).slice(-7);
const u = (name: string) => `${name}-${RUN}${test.info().project.name === "mobile" ? "m" : "d"}`;

const chip = (page: Page, label: string) => page.getByRole("button", { name: new RegExp(`^${label}`) });

/** Lê a contagem grudada no chip; é o número que o teste confere contra as linhas da tabela. */
async function chipCount(page: Page, label: string): Promise<number> {
  // Nenhum rótulo de filtro tem dígito, então o que sobra ao tirar as letras é a contagem.
  return Number((await chip(page, label).innerText()).replace(/\D+/g, ""));
}

/** Linhas de membro na tabela (tira a linha de cabeçalho). */
const memberRows = (page: Page) => page.getByRole("row").filter({ has: page.getByRole("cell") });

/** Abre o chip e prova que contagem e lista dizem a mesma coisa. Devolve o número para asserções extras. */
async function openAndMatch(page: Page, label: string): Promise<number> {
  await chip(page, label).click();
  const count = await chipCount(page, label);
  if (count === 0) {
    await expect(page.getByText("Nenhum membro com esse filtro.")).toBeVisible();
  } else {
    await expect(memberRows(page)).toHaveCount(count);
  }
  return count;
}

/**
 * Semeia o cenário e devolve o prefixo de busca que o isola.
 *
 * `base` separa os testes: o id de dev-login é derivado do índice e do processo, então dois testes com o
 * mesmo índice reusariam as mesmas contas — e o banimento de um chegaria contaminado no outro.
 */
async function semear(page: Page, prefixo: string, base: number) {
  const busca = u(prefixo);
  const nome = (papel: string) => `${busca}-${papel}`;
  const id = (offset: number) => String(base + offset);

  // Continua no servidor, com nick: não é problema de ninguém.
  await login(page, id(0), nome("ok"), { gameNick: `Ok${busca.replace(/\D/g, "")}` });
  // Sem nick registrado.
  await login(page, id(1), nome("semnick"));
  // Saiu do servidor, mas tem nick: só a saída é o problema.
  await login(page, id(2), nome("saiu"), { gameNick: `Saiu${busca.replace(/\D/g, "")}`, leftGuild: true });
  // O caso combinado: banido **e** fora do servidor.
  await login(page, id(3), nome("banidosaiu"), { leftGuild: true });
  const { user } = await (await page.request.get("/api/auth/me")).json();
  return { busca, nome, banidoSaiuId: user.id as string };
}

test("os chips de dois níveis batem com a lista, e banido fica fora da fila de atenção (AC#1, AC#2, AC#3)", async ({ page }) => {
  const erros: string[] = [];
  page.on("console", (m) => m.type() === "error" && !m.text().includes("Failed to load resource") && erros.push(m.text()));

  const { busca, nome, banidoSaiuId } = await semear(page, "flt", 60);

  await login(page, "64", u("flt-chefe"), { roles: ["admin"] });
  const banido = await page.request.post(`/api/admin/members/${banidoSaiuId}/ban`, {
    data: { reason: "banido e fora do servidor, para o filtro" },
    headers: { Origin: ORIGIN },
  });
  expect(banido.status()).toBe(200);

  await page.goto("/admin/membros");
  await expect(page.getByRole("heading", { name: "Membros", exact: true })).toBeVisible();
  await page.getByLabel("Buscar por nick ou usuário do Discord").fill(busca);
  await expect(memberRows(page)).toHaveCount(4);

  // Nível de cima: três chips e nada de "Saiu do servidor" solto ao lado deles (AC#2).
  await expect(chip(page, "Todos")).toBeVisible();
  await expect(chip(page, "Precisam de atenção")).toBeVisible();
  await expect(chip(page, "Banidos")).toBeVisible();
  await expect(page.getByRole("group", { name: "Refinar quem precisa de atenção" })).toHaveCount(0);
  await snap(page, "filtros-nivel-de-cima");

  expect(await openAndMatch(page, "Todos")).toBe(4);

  // Dentro da atenção: 3 dos 4 (o banido não é pendência de ninguém), e o refino aparece.
  expect(await openAndMatch(page, "Precisam de atenção")).toBe(2);
  const refino = page.getByRole("group", { name: "Refinar quem precisa de atenção" });
  await expect(refino).toBeVisible();
  await expect(memberRows(page).filter({ hasText: `@${nome("semnick")}` })).toBeVisible();
  await expect(memberRows(page).filter({ hasText: `@${nome("saiu")}` })).toBeVisible();
  await expect(memberRows(page).filter({ hasText: `@${nome("banidosaiu")}` })).toHaveCount(0);
  await snap(page, "filtros-atencao-com-refino");

  // O filtro que a TASK-049 deixou de fora, agora com contagem própria (AC#1).
  expect(await openAndMatch(page, "Saiu do servidor")).toBe(1);
  const saiu = memberRows(page).filter({ hasText: `@${nome("saiu")}` });
  await expect(saiu).toBeVisible();
  await expect(saiu.getByText("Saiu do servidor")).toBeVisible();
  // Quem saiu **e** está banido não aparece aqui: ele está resolvido, não pendente.
  await expect(memberRows(page).filter({ hasText: `@${nome("banidosaiu")}` })).toHaveCount(0);
  await snap(page, "filtros-saiu-do-servidor");

  expect(await openAndMatch(page, "Sem nick")).toBe(1);
  expect(await openAndMatch(page, "Não encontrados no Albion")).toBe(0);

  // Banidos traz o combinado, uma vez só, ainda com o selo de saída na linha (AC#2).
  expect(await openAndMatch(page, "Banidos")).toBe(1);
  const combinado = memberRows(page).filter({ hasText: `@${nome("banidosaiu")}` });
  await expect(combinado.getByText("Banido", { exact: true })).toBeVisible();
  await expect(combinado.getByText("Saiu do servidor")).toBeVisible();
  // Sair de "Banidos" fecha o refino: ele pertence à atenção, não é uma barra fixa.
  await expect(page.getByRole("group", { name: "Refinar quem precisa de atenção" })).toHaveCount(0);
  await snap(page, "filtros-banidos-e-fora-do-servidor");

  // Nada estoura a largura, nem no celular de 400px.
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  expect(erros).toEqual([]);
});

test("trocar de filtro volta para a página 1 e a paginação continua do servidor (AC#3)", async ({ page }) => {
  const { busca } = await semear(page, "pag", 70);
  await login(page, "74", u("pag-chefe"), { roles: ["admin"] });

  await page.goto("/admin/membros");
  await page.getByLabel("Buscar por nick ou usuário do Discord").fill(busca);
  await expect(memberRows(page)).toHaveCount(4);

  /**
   * Página 2 de verdade: com `pageSize` pequeno a lista dos 4 semeados vira duas páginas. O parâmetro vai
   * na URL da API, não no cliente — é o servidor que corta.
   */
  const pagina = async (page1: number, filtro: string) => {
    const res = await page.request.get(`/api/admin/members?search=${busca}&filter=${filtro}&page=${page1}&pageSize=2`);
    expect(res.status()).toBe(200);
    return res.json();
  };
  const p1 = await pagina(1, "todos");
  const p2 = await pagina(2, "todos");
  expect(p1.total).toBe(4);
  expect(p2.total).toBe(4);
  expect(p1.members).toHaveLength(2);
  expect(p2.members).toHaveLength(2);
  // Sem repetição entre as páginas: a ordenação é estável (nick, depois id).
  expect(new Set([...p1.members, ...p2.members].map((m: { id: string }) => m.id)).size).toBe(4);
  // O filtro vai junto e o total acompanha: 3 dos 4 semeados precisam de atenção (ninguém está banido aqui).
  expect((await pagina(1, "atencao")).total).toBe(3);
  expect((await pagina(1, "atencao")).members).toHaveLength(2);
  expect((await pagina(2, "atencao")).members).toHaveLength(1);
  // Página além do fim devolve lista vazia com o mesmo total, não erro nem a última página de novo.
  const alem = await pagina(3, "atencao");
  expect(alem.members).toHaveLength(0);
  expect(alem.total).toBe(3);

  // Na tela: trocar o filtro tem que voltar para a página 1, nunca para uma tela vazia.
  await expect(page.getByText(/página\s*1\s*de/)).toBeVisible();
  await chip(page, "Precisam de atenção").click();
  await expect(page.getByText(/página\s*1\s*de/)).toBeVisible();
  await expect(memberRows(page)).toHaveCount(3);
});

test("staff vê os mesmos filtros e as ações que já tinha; o import continua só do admin (AC#4)", async ({ page }) => {
  const erros: string[] = [];
  page.on("console", (m) => m.type() === "error" && !m.text().includes("Failed to load resource") && erros.push(m.text()));

  const { busca, nome } = await semear(page, "stf", 80);
  await login(page, "84", u("stf-oficial"), { roles: ["staff"] });

  await page.goto("/admin/membros");
  await expect(page.getByRole("heading", { name: "Membros", exact: true })).toBeVisible();
  // Import é de admin (`manage all`): a staff não vê o botão, aqui e antes desta task.
  await expect(page.getByRole("button", { name: "Importar membros do Discord" })).toHaveCount(0);

  await page.getByLabel("Buscar por nick ou usuário do Discord").fill(busca);
  await expect(memberRows(page)).toHaveCount(4);
  await snap(page, "filtros-staff-nivel-de-cima");

  expect(await openAndMatch(page, "Precisam de atenção")).toBe(3);
  await expect(page.getByRole("group", { name: "Refinar quem precisa de atenção" })).toBeVisible();
  await snap(page, "filtros-staff-atencao-com-refino");

  // Sem ninguém banido neste cenário, os dois que saíram continuam sendo pendência.
  expect(await openAndMatch(page, "Saiu do servidor")).toBe(2);
  await expect(memberRows(page).filter({ hasText: `@${nome("saiu")}` }).getByText("Saiu do servidor")).toBeVisible();
  // A staff continua com as ações da linha que a TASK-047 deu: conferir, gerenciar, extrato e banir.
  // As ações da linha vivem no menu desde a TASK-083 (SS6): a staff continua com as mesmas.
  await page.getByRole("button", { name: /^Ações de / }).first().click();
  await expect(page.getByRole("menuitem", { name: "Gerenciar nick, tag e notas" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Ver o extrato" })).toBeVisible();
  await page.keyboard.press("Escape");
  await snap(page, "filtros-staff-saiu-do-servidor");

  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  expect(erros).toEqual([]);
});

test("membro e caller continuam sem a lista e sem a API (segurança inalterada)", async ({ page }) => {
  await login(page, "94", u("flt-curioso"));
  await page.goto("/admin/membros");
  await expect(page.getByRole("heading", { name: "Acesso negado" })).toBeVisible();
  // Inclusive com os filtros novos na query: o portão é a permissão, não o parâmetro.
  for (const filtro of ["todos", "atencao", "saiu", "banidos"]) {
    expect((await page.request.get(`/api/admin/members?filter=${filtro}`)).status()).toBe(403);
  }

  await login(page, "95", u("flt-caller"), { roles: ["caller"] });
  expect((await page.request.get("/api/admin/members?filter=saiu")).status()).toBe(403);
});
