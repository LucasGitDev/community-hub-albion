import { expect, test, type Page } from "@playwright/test";

/**
 * Carteira do membro contra a API real (TASK-031, Q3/Q10/Q12/Q20/Q24/Q25): saldo, reserva, extrato do
 * ledger e pedido de saque. Nada de dados de demonstração aqui — a prata é semeada no ledger pelo
 * dev-login (só com AUTH_DEV_LOGIN).
 *
 * Discord ID por teste **e** por projeto: desktop e mobile rodam em paralelo contra o mesmo banco.
 */
const ORIGIN = "http://localhost:4173";

type Silver = { amount: string; kind?: "split_payout" | "split_fee" | "withdrawal" | "adjustment"; memo?: string };

/**
 * Membro novo a cada execução. O id carrega o timestamp do processo porque a prata semeada fica no
 * ledger append-only: reusar o mesmo Discord ID somaria os lançamentos da rodada anterior e mudaria o
 * saldo esperado. O índice separa os testes e o sufixo separa desktop de mobile, que rodam em paralelo.
 */
const RUN = String(Date.now());

async function login(page: Page, index: string, username: string, silver: Silver[] = []) {
  const suffix = test.info().project.name === "mobile" ? "9" : "8";
  const res = await page.request.post("/api/auth/dev-login", {
    data: { discordId: `7${RUN}${index}${suffix}`, username, roles: [], ...(silver.length ? { silver } : {}) },
    headers: { Origin: ORIGIN },
  });
  expect(res.status()).toBe(204);
}

async function snap(page: Page, name: string) {
  await test.info().attach(name, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
}

test("membro vê saldo, reserva e extrato do ledger com a origem de cada lançamento (AC#1)", async ({ page }) => {
  await login(page, "001", "carteira", [
    { amount: "2000000", kind: "split_payout", memo: "Raid do Dragão — Martlock" },
    { amount: "-100000", kind: "split_fee", memo: "Taxa do evento (5%)" },
    { amount: "1318750", kind: "split_payout", memo: "DG de grupo — Roads" },
  ]);
  await page.goto("/carteira");

  await expect(page.getByText("Disponível pra saque")).toBeVisible();
  await expect(page.getByText("3.218.750").first()).toBeVisible();
  await expect(page.getByText("Reservado em saques")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Extrato" })).toBeVisible();
  await expect(page.getByText("Pagamento de split").first()).toBeVisible();
  await expect(page.getByText("Taxa do evento").first()).toBeVisible();
  await expect(page.getByText("Raid do Dragão — Martlock")).toBeVisible();
  await snap(page, "carteira-membro");

  // Saldo do header lê o mesmo número da carteira (AC#1).
  await expect(page.getByRole("link", { name: "Saldo disponível" })).toContainText("3.218.750");
});

test("pedido de saque sem mínimo: recusa acima do disponível e reserva o valor pedido (AC#3, Q12/Q25)", async ({ page }) => {
  await login(page, "002", "saque", [{ amount: "1500000", kind: "split_payout", memo: "Loot split" }]);
  await page.goto("/carteira");
  await expect(page.getByText("1.500.000").first()).toBeVisible();

  await page.getByRole("button", { name: "Pedir saque" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Pedir saque" });
  await expect(dialog.getByText("Sem valor mínimo")).toBeVisible();
  await dialog.getByLabel("Valor").fill("5M");
  await dialog.getByRole("button", { name: "Pedir saque" }).click();
  await expect(dialog.getByText(/disponível para saque/i)).toBeVisible();
  await snap(page, "saque-erro");

  // Sem mínimo (Q12): 300 mil passa.
  await dialog.getByLabel("Valor").fill("300k");
  await dialog.getByRole("button", { name: "Pedir saque" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Saque pedido")).toBeVisible();
  await expect(page.getByText("1.200.000").first()).toBeVisible();
  await expect(page.getByText("1 saque em análise")).toBeVisible();

  // `pending` reserva sem lançar no ledger (Q25): o extrato continua com um lançamento só.
  await expect(page.getByText("1 lançamentos")).toBeVisible();

  await page.getByRole("link", { name: "Meus saques" }).first().click();
  await expect(page.getByRole("heading", { name: "Meus saques" })).toBeVisible();
  await expect(page.getByText("Em análise").first()).toBeVisible();
  await expect(page.getByText("300.000").first()).toBeVisible();
  await snap(page, "meus-saques");
});

test("saldo negativo bloqueia novo saque (Q24)", async ({ page }) => {
  await login(page, "003", "negativo", [
    { amount: "500000", kind: "split_payout", memo: "Loot split" },
    { amount: "-800000", kind: "adjustment", memo: "Acerto: saque pago a mais" },
  ]);
  await page.goto("/carteira");
  await expect(page.getByRole("alert")).toContainText(/saldo ficou negativo/i);
  await expect(page.getByText("−300.000").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Pedir saque" }).first()).toBeDisabled();
  await expect(page.getByText("Ajuste").first()).toBeVisible();
  await snap(page, "carteira-negativa");
});

test("membro sem prata vê os próximos passos, não uma tela vazia", async ({ page }) => {
  await login(page, "004", "novo");
  await page.goto("/carteira");
  await expect(page.getByText("Seu extrato ainda não tem lançamento nenhum.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Extrato" })).toBeVisible();
  await expect(page.getByText("Conta ativada")).toBeVisible();
  await snap(page, "carteira-vazia");

  await page.goto("/saques");
  await expect(page.getByText("Você ainda não pediu nenhum saque.")).toBeVisible();
  await expect(page.getByText("Não existe valor mínimo")).toBeVisible();
  await snap(page, "meus-saques-vazio");
});

test("membro só enxerga a própria prata: o dono vem da sessão (AC#2)", async ({ page }) => {
  await login(page, "005", "outro", [{ amount: "9876543", kind: "split_payout", memo: "Prata do outro" }]);
  const outro = await page.request.get("/api/me/ledger");
  const outroId = ((await outro.json()) as { entries: { id: string }[] }).entries[0]!.id;

  await login(page, "006", "eu", [{ amount: "1234", kind: "split_payout", memo: "Minha prata" }]);
  await page.goto("/carteira");
  await expect(page.getByText("1.234").first()).toBeVisible();
  await expect(page.getByText("9.876.543")).toHaveCount(0);
  await expect(page.getByText("Prata do outro")).toHaveCount(0);

  // Mandar o id do outro na query não muda nada: a rota nem olha.
  const forged = await page.request.get(`/api/me/ledger?userId=${outroId}&limit=50`);
  expect(forged.status()).toBe(200);
  const body = (await forged.json()) as { entries: { amount: string }[] };
  expect(body.entries.map((e) => e.amount)).toEqual(["1234"]);

  const mine = await page.request.get("/api/me/withdrawals");
  expect(((await mine.json()) as { balance: { balance: string } }).balance.balance).toBe("1234");
});
