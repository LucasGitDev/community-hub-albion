import { expect, test, type Page } from "@playwright/test";
import { discordId, login, ORIGIN, snap } from "./session";

/**
 * Saque aberto pela staff (TASK-083, SS1–SS6): o membro pediu no Discord ou no jogo e não usa o painel.
 *
 * Os dois lugares de SS5 são cobertos aqui: a fila de saques (onde a staff escolhe o membro pela busca)
 * e a lista de jogadores (onde a ação mora no **menu de ações** da linha, SS6).
 *
 * Nick sufixado pelo id da rodada porque a fila e a lista são globais: desktop e mobile rodam em
 * paralelo contra o mesmo banco.
 */
const rows = (page: Page) => page.getByRole("list", { name: "Pedidos de saque" }).getByRole("listitem");

/** Nick no formato que o Albion aceita (sem hífen, curto), único por rodada, teste e projeto. */
const nickFor = (index: string): string => `W${discordId(index).slice(-13)}`;

async function memberWithSilver(page: Page, index: string, silver: string) {
  const nick = nickFor(index);
  await login(page, index, `membro${index}`, { gameNick: nick, ledger: [{ amount: silver, kind: "split_payout", memo: "Loot split" }] });
  return nick;
}

test("staff abre um saque pela fila: nasce pending, na fila, marcado como aberto pela staff (AC#1, AC#2, AC#6)", async ({ page }) => {
  const nick = await memberWithSilver(page, "601", "3000000");
  await login(page, "602", "tesoureiro-083", { roles: ["staff"], gameNick: nickFor("602") });

  await page.goto("/staff/saques");
  await page.getByRole("button", { name: "Abrir saque por um membro" }).click();

  // Sem linha de onde tirar o nome: o diálogo começa pela busca.
  await page.getByLabel("Buscar membro").fill(nick);
  await page.getByRole("button", { name: new RegExp(nick) }).click();
  await expect(page.getByText("3.000.000 disponível")).toBeVisible();

  await page.getByRole("textbox", { name: "Valor" }).fill("1200000");
  await page.getByLabel(/Motivo/).fill("pediu no chat da guilda e não usa o painel");
  await snap(page, "abrir-saque-dialogo");
  await page.getByRole("button", { name: "Abrir saque" }).click();

  await expect(page.getByText("Saque aberto")).toBeVisible();
  const linha = rows(page).filter({ hasText: nick });
  await expect(linha).toContainText("1.200.000");
  await expect(linha).toContainText("Em análise");
  // AC#2: a fila diz que foi a staff quem abriu, quem foi e por quê.
  await expect(linha).toContainText("Aberto pela staff");
  await expect(linha).toContainText("pediu no chat da guilda");
  await snap(page, "fila-com-saque-aberto-pela-staff");
});

test("valor acima do disponível é recusado pela mesma conta do saque normal (AC#3)", async ({ page }) => {
  const nick = await memberWithSilver(page, "603", "500000");
  // O próprio membro já reservou 400k: sobram 100k para a staff abrir.
  const pedido = await page.request.post("/api/me/withdrawals", { data: { amount: "400000" }, headers: { Origin: ORIGIN } });
  expect(pedido.status()).toBe(201);

  await login(page, "604", "tesoureiro-083b", { roles: ["staff"] });
  await page.goto("/staff/saques");
  await page.getByRole("button", { name: "Abrir saque por um membro" }).click();
  await page.getByLabel("Buscar membro").fill(nick);
  await page.getByRole("button", { name: new RegExp(nick) }).click();

  // O diálogo já mostra o disponível com o reservado descontado.
  await expect(page.getByText("100.000 disponível")).toBeVisible();
  await page.getByRole("textbox", { name: "Valor" }).fill("200000");
  await page.getByLabel(/Motivo/).fill("pediu no jogo");
  await page.getByRole("button", { name: "Abrir saque" }).click();
  await expect(page.getByRole("alert")).toContainText("100.000");
});

test("na lista de jogadores a ação mora no menu e o atalho 'já paguei no jogo' nasce liquidado (AC#4, AC#6)", async ({ page }) => {
  const nick = await memberWithSilver(page, "605", "800000");
  await login(page, "606", "admin-083", { roles: ["admin"] });

  await page.goto("/admin/membros");
  await page.getByLabel("Buscar por nick ou usuário do Discord").fill(nick);
  const linha = page.getByRole("row").filter({ hasText: nick });
  await expect(linha).toBeVisible();

  // SS6: a ação não é mais um botão solto na linha — está dentro do menu.
  await linha.getByRole("button", { name: `Ações de ${nick}` }).click();
  await snap(page, "menu-de-acoes-da-linha");
  await page.getByRole("menuitem", { name: "Abrir saque por ele" }).click();

  await page.getByRole("textbox", { name: "Valor" }).fill("800000");
  await page.getByLabel(/Motivo/).fill("entreguei em Martlock na hora do split");
  await page.getByRole("checkbox", { name: /Já paguei no jogo/ }).check();
  await page.getByRole("button", { name: "Registrar saque pago" }).click();
  await expect(page.getByText("Saque registrado como pago")).toBeVisible();

  // Nasce liquidado: não entra na fila e o débito já saiu do saldo.
  await page.goto("/staff/saques");
  await expect(rows(page).filter({ hasText: nick })).toHaveCount(0);
  await page.getByRole("tab", { name: /Entregues/ }).click();
  const entregue = rows(page).filter({ hasText: nick });
  await expect(entregue).toContainText("800.000");
  await expect(entregue).toContainText("Aberto pela staff");
  await snap(page, "saque-pago-no-jogo-entregue");
});

test("membro comum não vê a ação e a API recusa (AC#5)", async ({ page }) => {
  const alvo = await memberWithSilver(page, "607", "100000");
  const alvoRes = await page.request.get("/api/me/withdrawals");
  expect(alvoRes.status()).toBe(200);

  await login(page, "608", "membro-comum-083", {});
  await page.goto("/staff/saques");
  await expect(page.getByRole("button", { name: "Abrir saque por um membro" })).toHaveCount(0);

  const res = await page.request.post("/api/withdrawals", {
    data: { userId: "00000000-0000-4000-8000-000000000000", amount: "1000", reason: "quero" },
    headers: { Origin: ORIGIN },
  });
  expect(res.status()).toBe(403);
  expect(alvo).toBeTruthy();
});
