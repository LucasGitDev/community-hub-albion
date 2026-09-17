import { expect, test, type Page } from "@playwright/test";
import { discordId, login, ORIGIN, snap } from "./session";

/**
 * Extrato de um jogador lido pela staff a partir da lista de membros (TASK-051, G10).
 *
 * Tudo contra a API real: a prata é semeada no ledger pelo dev-login e o ajuste com origem
 * `manual/maintenance` vem do namespace de manutenção (TASK-048) — é justamente a linha que alguém vai
 * questionar, então ela precisa aparecer na tela de verdade, não só no teste de unidade.
 */

const MAINTENANCE_TOKEN = "e2e-maintenance-token-com-32-caracteres";

/**
 * Nick único por rodada e por projeto, dentro dos 16 caracteres alfanuméricos que a regra aceita (G2:
 * nick é único, então um nick fixo quebraria da segunda execução em diante). Reusa o id da rodada.
 */
const nickFor = (index: string): string => `N${discordId(index).slice(-13)}`;

/** Id interno do membro, que é o que a rota do extrato usa. A staff lê da própria lista do painel. */
async function findUserId(page: Page, nick: string): Promise<string> {
  const res = await page.request.get(`/api/admin/members?search=${encodeURIComponent(nick)}`);
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { members: { id: string; gameNick: string | null }[] };
  const found = body.members.find((m) => m.gameNick === nick);
  expect(found, `membro ${nick} não veio na lista`).toBeTruthy();
  return found!.id;
}

test("staff abre o extrato de um jogador pela lista de membros e lê saldo, origem, autor e motivo (AC#1/AC#2/AC#4)", async ({ page }) => {
  const nick = nickFor("510");
  await login(page, "510", "alvo-extrato", {
    gameNick: nick,
    silver: [
      { amount: "2000000", kind: "split_payout", memo: "Raid do Dragão — Martlock" },
      { amount: "-100000", kind: "split_fee", memo: "Taxa do evento (5%)" },
      { amount: "750000", kind: "split_payout", memo: "DG de grupo — Roads" },
    ],
  });

  await login(page, "511", "staff-extrato", { roles: ["member", "staff"], gameNick: nickFor("511") });
  const userId = await findUserId(page, nick);

  // Ajuste de verdade pela manutenção: origem `manual/maintenance`, sem autor, com motivo (TASK-048, G5).
  const adjust = await page.request.post("/api/maintenance/silver", {
    headers: { "x-maintenance-token": MAINTENANCE_TOKEN, Origin: ORIGIN },
    data: { userId, amount: "-50000", reason: "acerto do split duplicado do dia 12" },
  });
  expect(adjust.status()).toBe(201);

  await page.goto("/admin/membros");
  await page.getByLabel("Buscar por nick ou usuário do Discord").fill(nick);
  await expect(page.getByRole("cell", { name: nick, exact: false }).first()).toBeVisible();

  await page.getByRole("button", { name: `Ver o extrato de ${nick}` }).click();
  const dialog = page.getByRole("dialog", { name: `Extrato de ${nick}` });
  await expect(dialog).toBeVisible();

  // Saldo em PT-BR: 2.000.000 − 100.000 + 750.000 − 50.000 = 2.600.000, nada reservado.
  await expect(dialog.getByText("Disponível")).toBeVisible();
  await expect(dialog.getByText("2.600.000").first()).toBeVisible();
  await expect(dialog.getByText("Reservado")).toBeVisible();

  // Cada lançamento com motivo e valor; o ajuste da manutenção se identifica pela origem e pelo motivo.
  await expect(dialog.getByText("Raid do Dragão — Martlock")).toBeVisible();
  await expect(dialog.getByText("Taxa do evento (5%)")).toBeVisible();
  await expect(dialog.getByText("Manutenção: acerto do split duplicado do dia 12")).toBeVisible();
  await expect(dialog.getByText("4 lançamentos")).toBeVisible();
  await snap(page, "extrato-do-jogador");
});

test("paginação: carrega mais lançamentos sem repetir nem trocar os que já estão na tela (AC#2)", async ({ page }) => {
  const nick = nickFor("512");
  // 30 lançamentos com a página de 25: a primeira leva 25 e sobra o botão.
  const silver = Array.from({ length: 30 }, (_, i) => ({ amount: "1000", kind: "split_payout" as const, memo: `Lançamento ${i + 1}` }));
  await login(page, "512", "alvo-pagina", { gameNick: nick, silver });

  await login(page, "513", "staff-pagina", { roles: ["member", "staff"], gameNick: nickFor("513") });
  await page.goto("/admin/membros");
  await page.getByLabel("Buscar por nick ou usuário do Discord").fill(nick);
  await page.getByRole("button", { name: `Ver o extrato de ${nick}` }).click();

  const dialog = page.getByRole("dialog", { name: `Extrato de ${nick}` });
  await expect(dialog.getByText("25 lançamentos carregados")).toBeVisible();
  await dialog.getByRole("button", { name: "Carregar mais" }).click();
  await expect(dialog.getByText("30 lançamentos no total")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Carregar mais" })).toBeHidden();
  // O primeiro lançamento continua lá: a segunda página soma, não troca.
  await expect(dialog.getByText("Lançamento 30", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Lançamento 1", { exact: true })).toBeVisible();
});

test("extrato vazio é um estado explicado, não um erro nem uma tabela em branco", async ({ page }) => {
  const nick = nickFor("514");
  await login(page, "514", "alvo-vazio", { gameNick: nick });
  await login(page, "515", "staff-vazio", { roles: ["member", "staff"], gameNick: nickFor("515") });

  await page.goto("/admin/membros");
  await page.getByLabel("Buscar por nick ou usuário do Discord").fill(nick);
  await page.getByRole("button", { name: `Ver o extrato de ${nick}` }).click();

  const dialog = page.getByRole("dialog", { name: `Extrato de ${nick}` });
  await expect(dialog.getByText("Nenhum lançamento ainda.")).toBeVisible();
  await expect(dialog.getByText("0").first()).toBeVisible();
  await snap(page, "extrato-vazio");
});

test("membro comum não lê extrato alheio: sem a tela e 403 na API (AC#3)", async ({ page }) => {
  const nick = nickFor("516");
  await login(page, "516", "alvo-privado", { gameNick: nick, silver: [{ amount: "9999999", kind: "split_payout", memo: "prata do outro" }] });

  // A staff só entra para descobrir o id do alvo; quem tenta o acesso é o membro, logo abaixo.
  await login(page, "517", "staff-privado", { roles: ["member", "staff"], gameNick: nickFor("517") });
  const userId = await findUserId(page, nick);

  await login(page, "518", "bisbilhoteiro", { roles: ["member"] });

  // UI: a lista de membros nem existe para ele.
  await page.goto("/admin/membros");
  await expect(page.getByRole("button", { name: /Ver o extrato de/ })).toHaveCount(0);
  await expect(page.getByText(nick)).toHaveCount(0);
  await snap(page, "extrato-membro-sem-acesso");

  // API: a rota recusa e não vaza um dígito da prata alheia.
  const forged = await page.request.get(`/api/admin/members/${userId}/ledger`);
  expect(forged.status()).toBe(403);
  expect(await forged.text()).not.toContain("9999999");
});
