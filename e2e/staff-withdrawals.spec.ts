import { expect, test, type Page } from "@playwright/test";
import { discordId, login, ORIGIN, snap } from "./session";

/**
 * Fila de saques da staff contra a API real (TASK-032, Q10/Q11/Q25): filtrar por estado, aprovar,
 * recusar com motivo e marcar a entrega com nota. Sem dados de demonstração — `apps/web/src/mock/`
 * deixou de existir nesta task.
 *
 * Ids novos a cada rodada (ver `./session`): a prata vive num ledger append-only.
 */

/** A lista de pedidos, e não qualquer `li` da página: os toasts do sonner também são itens de lista. */
const rows = (page: Page) => page.getByRole("list", { name: "Pedidos de saque" }).getByRole("listitem");

/**
 * Cria um membro com saldo e já pede um saque pela API.
 *
 * O nick leva o sufixo do id da rodada porque a fila da staff é **global**: desktop e mobile rodam em
 * paralelo contra o mesmo banco e, com o nick repetido, a linha de um projeto apareceria na busca do
 * outro. Devolve o nick já sufixado.
 */
async function memberWithPending(page: Page, index: string, base: string, silver: string, amount: string) {
  const nick = `${base}-${discordId(index).slice(-8)}`;
  await login(page, index, nick, { silver: [{ amount: silver, kind: "split_payout", memo: "Loot split" }] });
  const res = await page.request.post("/api/me/withdrawals", { data: { amount }, headers: { Origin: ORIGIN } });
  expect(res.status()).toBe(201);
  const { withdrawals } = (await res.json()) as { withdrawals: { id: string }[] };
  return { nick, id: withdrawals[0]!.id };
}

test("fila mostra quem pediu, quanto e o saldo do membro; staff aprova e marca a entrega (AC#1, AC#2)", async ({ page }) => {
  const membro = await memberWithPending(page, "101", "sacador", "2000000", "750000");
  await login(page, "102", "tesoureiro", { roles: ["staff"] });

  await page.goto("/staff/saques");
  await expect(page.getByRole("heading", { name: "Fila de saques" })).toBeVisible();

  // Contexto da decisão: nick, valor e o saldo do membro naquele momento (AC#2 da task).
  const linha = rows(page).filter({ hasText: membro.nick });
  await expect(linha).toContainText("750.000");
  await expect(linha).toContainText("Saldo");
  await expect(linha).toContainText("2.000.000");
  // O contador do menu lê a mesma fila da API (o banco é compartilhado, então só se exige que conte).
  await expect(page.getByRole("link", { name: /Fila de saques/ }).first()).toContainText(/\d/);
  await snap(page, "fila-staff-pendentes");

  await linha.getByRole("button", { name: "Aprovar saque" }).click();
  await expect(page.getByText("Saque aprovado")).toBeVisible();

  // Aprovado sai de "Em análise" e entra em "A entregar" (Q25: o débito já foi ao ledger).
  await page.getByRole("tab", { name: /A entregar/ }).click();
  const aEntregar = rows(page).filter({ hasText: membro.nick });
  await expect(aEntregar).toContainText("Aprovado, aguardando entrega");

  // Q11: a entrega exige a nota — o botão só habilita depois de escrever.
  const entregar = aEntregar.getByRole("button", { name: "Marcar como entregue" });
  await expect(entregar).toBeDisabled();
  await aEntregar.getByLabel(`Nota da entrega do saque de ${membro.nick}`).fill("Transferi no banco de Martlock");
  await entregar.click();
  await expect(page.getByText("Marcado como entregue")).toBeVisible();

  await page.getByRole("tab", { name: /Entregues/ }).click();
  const entregue = rows(page).filter({ hasText: membro.nick });
  await expect(entregue).toContainText("Entregue");
  await expect(entregue).toContainText("Transferi no banco de Martlock");
  await snap(page, "fila-staff-entregue");
});

test("recusa exige motivo e o motivo fica registrado (AC#2)", async ({ page }) => {
  const membro = await memberWithPending(page, "103", "recusado", "1000000", "400000");
  await login(page, "104", "tesoureira", { roles: ["staff"] });
  await page.goto("/staff/saques");

  const linha = rows(page).filter({ hasText: membro.nick });
  await linha.getByRole("button", { name: "Recusar" }).click();
  const confirmar = linha.getByRole("button", { name: "Confirmar recusa" });
  await expect(confirmar).toBeDisabled();
  await linha.getByLabel(`Motivo da recusa do saque de ${membro.nick}`).fill("Pedido duplicado, já te paguei ontem");
  await snap(page, "fila-staff-recusa");
  await confirmar.click();
  await expect(page.getByText("Saque recusado")).toBeVisible();

  await page.getByRole("tab", { name: /Recusados/ }).click();
  const recusado = rows(page).filter({ hasText: membro.nick });
  await expect(recusado).toContainText("Motivo:");
  await expect(recusado).toContainText("Pedido duplicado, já te paguei ontem");

  // A reserva voltou pro membro: o disponível é o saldo cheio de novo (Q25).
  await login(page, "103", membro.nick);
  await page.goto("/carteira");
  await expect(page.getByText("1.000.000").first()).toBeVisible();
});

test("outro staff já decidiu: a tela mostra o erro da API e recarrega, não finge sucesso", async ({ page, playwright }) => {
  const membro = await memberWithPending(page, "105", "disputado", "600000", "600000");
  await login(page, "106", "staff-a", { roles: ["staff"] });
  await page.goto("/staff/saques");
  const linha = rows(page).filter({ hasText: membro.nick });
  await expect(linha).toContainText("600.000");

  // Outra pessoa da staff, em outra sessão, aprova o mesmo pedido enquanto esta tela mostra "pendente".
  const outroStaff = await playwright.request.newContext({ baseURL: ORIGIN });
  await outroStaff.post("/api/auth/dev-login", { data: { discordId: discordId("111"), username: "staff-b", roles: ["staff"] }, headers: { Origin: ORIGIN } });
  expect((await outroStaff.post(`/api/withdrawals/${membro.id}/approve`, { data: {}, headers: { Origin: ORIGIN } })).status()).toBe(200);
  await outroStaff.dispose();

  await linha.getByRole("button", { name: "Recusar" }).click();
  await linha.getByLabel(`Motivo da recusa do saque de ${membro.nick}`).fill("cheguei depois");
  await linha.getByRole("button", { name: "Confirmar recusa" }).click();

  await expect(page.getByText("Nada mudou neste saque")).toBeVisible();
  await expect(page.getByText(/não pode ir para/i)).toBeVisible();
  await snap(page, "fila-staff-conflito");

  // A lista recarregou: o pedido saiu de "Em análise" e está em "A entregar", como o outro staff deixou.
  await expect(rows(page).filter({ hasText: membro.nick })).toHaveCount(0);
  await page.getByRole("tab", { name: /A entregar/ }).click();
  await expect(rows(page).filter({ hasText: membro.nick })).toContainText("Aprovado, aguardando entrega");
});

/**
 * Vazio, carregando e erro. A fila é global e o banco é compartilhado entre os testes, então estes
 * estados são forçados na própria resposta da API: é o único jeito determinístico de vê-los.
 */
test("fila vazia explica o que aparece em cada aba, e a falha da API oferece tentar de novo (AC#1)", async ({ page }) => {
  await login(page, "107", "staff-estados", { roles: ["staff"] });

  await page.route("**/api/withdrawals", (route) => route.fulfill({ status: 200, json: { withdrawals: [], balances: {} } }));
  await page.goto("/staff/saques");
  await expect(page.getByText("Nenhum pedido esperando decisão.")).toBeVisible();
  await page.getByRole("tab", { name: /Recusados/ }).click();
  await expect(page.getByText("Quando a staff recusa um pedido, o motivo escrito fica registrado aqui.")).toBeVisible();
  await snap(page, "fila-staff-vazia");

  await page.unroute("**/api/withdrawals");
  await page.route("**/api/withdrawals", (route) => route.fulfill({ status: 500, json: { message: "A fila de saques está fora do ar." } }));
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("A fila de saques está fora do ar.");
  await expect(page.getByRole("button", { name: "Tentar de novo" })).toBeVisible();
  await snap(page, "fila-staff-erro");
});

test("membro comum não vê a fila nem age em saque alheio (AC#3)", async ({ page }) => {
  const membro = await memberWithPending(page, "108", "alvo", "800000", "800000");
  await login(page, "109", "curioso", { silver: [{ amount: "10000", kind: "split_payout" }] });

  // A UI não oferece o caminho: nem link no menu, nem a tela.
  await page.goto("/staff/saques");
  await expect(page.getByRole("heading", { name: "Fila de saques" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Fila de saques/ })).toHaveCount(0);
  await snap(page, "fila-staff-sem-permissao");

  // E a API é a autoridade: aprovar, recusar e liquidar são 403 para membro comum.
  for (const action of ["approve", "reject", "settle"]) {
    const res = await page.request.post(`/api/withdrawals/${membro.id}/${action}`, { data: { note: "libera" }, headers: { Origin: ORIGIN } });
    expect(res.status()).toBe(403);
  }
  // A lista só devolve os próprios saques, e o saldo só o próprio.
  const fila = await page.request.get("/api/withdrawals");
  expect(fila.status()).toBe(200);
  const body = (await fila.json()) as { withdrawals: { id: string }[]; balances: Record<string, unknown> };
  expect(body.withdrawals.map((w) => w.id)).not.toContain(membro.id);
  expect(Object.keys(body.balances).length).toBeLessThanOrEqual(1);

  // O pedido do outro continua pendente: nada do que o curioso fez pegou.
  await login(page, "110", "auditor", { roles: ["staff"] });
  const detalhe = await page.request.get(`/api/withdrawals/${membro.id}`);
  expect(((await detalhe.json()) as { status: string }).status).toBe("pending");
});
