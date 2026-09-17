import { expect, test } from "@playwright/test";
import { login as signIn, snap, type LedgerSeed } from "./session";

/**
 * Carteira do membro contra a API real (TASK-031, Q3/Q10/Q12/Q20/Q24/Q25): saldo, reserva, extrato do
 * ledger e pedido de saque. Nada de dados de demonstração aqui — a prata é semeada no ledger pelo
 * dev-login (só com AUTH_DEV_LOGIN). O login e o id por rodada vivem em `./session`.
 */
const login = (page: Parameters<typeof signIn>[0], index: string, username: string, ledger: LedgerSeed[] = []) => signIn(page, index, username, { ledger });

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
  await expect(page.getByRole("link", { name: "Meus saldos" })).toContainText("3,21M");
});

test("as duas moedas convivem: chip, saldos separados, moeda por linha e filtro do extrato (TASK-056, F6-26/F6-27)", async ({ page }) => {
  await login(page, "007", "buffunfa", [
    { amount: "2000000", kind: "split_payout", memo: "Raid do Dragão — Martlock" },
    { amount: "340", currency: "buffunfa", kind: "split_payout", memo: "Presença na call do evento" },
    { amount: "-20", currency: "buffunfa", kind: "adjustment", memo: "Taxa de entrada do evento" },
  ]);
  await page.goto("/carteira");

  // Chip do header mostra as duas, Buffunfa em destaque e nunca somadas (F6-26).
  const chip = page.getByRole("link", { name: "Meus saldos" });
  await expect(chip).toContainText("320 BUF");
  await expect(chip).toContainText("2M");

  // TASK-071: a Buffunfa leva o ícone da moeda junto do número (doc-009) e a prata não leva nenhum.
  // O chip mostra as duas lado a lado, então **um** ícone aqui prova as duas metades: a Buffunfa
  // ganhou o ícone e a prata continua neutra, sem depender de cor pra se distinguir (AC#1, AC#4).
  await expect(chip.locator('img[src*="buffunfa"]')).toHaveCount(1);

  // A aba é a Toca da Turma, não o placeholder (AC#3).
  await expect(page).toHaveTitle("Toca da Turma");
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute("href", "/favicon.png");

  // Cabeçalho do extrato: um saldo por moeda, lado a lado (F6-27).
  await expect(page.getByText("Disponível pra saque")).toBeVisible();
  await expect(page.getByText("Buffunfa", { exact: true }).first()).toBeVisible();
  // Buffunfa nunca abrevia (F6-5): 320 BUF, não 0,3K.
  await expect(page.getByText("320 BUF").first()).toBeVisible();

  // Um extrato só, com as duas moedas na ordem cronológica e cada linha marcando a sua.
  await expect(page.getByRole("heading", { name: "Extrato" })).toBeVisible();
  await expect(page.getByText("Presença na call do evento")).toBeVisible();
  await expect(page.getByText("Raid do Dragão — Martlock")).toBeVisible();
  await snap(page, "carteira-duas-moedas");

  // Filtro recorta o mesmo extrato, sem virar outra tela.
  await page.getByRole("button", { name: "Buffunfa", exact: true }).click();
  await expect(page.getByText("Raid do Dragão — Martlock")).toHaveCount(0);
  await expect(page.getByText("Presença na call do evento")).toBeVisible();
  await page.getByRole("button", { name: "Prata", exact: true }).click();
  await expect(page.getByText("Presença na call do evento")).toHaveCount(0);
  await expect(page.getByText("Raid do Dragão — Martlock")).toBeVisible();
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
  await expect(page.getByRole("row").filter({ hasText: "Loot split" })).toHaveCount(1);

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
