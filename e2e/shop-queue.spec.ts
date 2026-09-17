import { expect, test, type Page } from "@playwright/test";
import { discordId, login, ORIGIN, snap } from "./session";

/**
 * Fila de pedidos da loja (TASK-060) contra a API real: a staff pega o pedido, devolve à fila, entrega com
 * nota (e o débito aparece no extrato do membro), recusa com motivo, e o comprador desiste enquanto
 * ninguém pegou.
 *
 * **A fila é global**, como a de saques: desktop e mobile rodam em paralelo contra o mesmo banco. Por isso
 * todo item e todo nick carregam um sufixo único e todo locator é escopado na linha daquele pedido —
 * senão a spec afirmaria coisas sobre o pedido de outro teste.
 */
const RUN = String(Date.now());
const tag = (name: string) => `${name} ${RUN}${test.info().project.name === "mobile" ? "m" : "d"}`;

/** A lista de pedidos da staff, e não qualquer `li`: os toasts do sonner também são itens de lista. */
const rows = (page: Page) => page.getByRole("list", { name: "Pedidos da loja" }).getByRole("listitem");
const rowOf = (page: Page, item: string) => rows(page).filter({ hasText: item });
const myOrder = (page: Page, item: string) => page.getByRole("list", { name: "Meus pedidos" }).getByRole("listitem").filter({ hasText: item });

/**
 * Prepara um pedido `reserved`: a staff publica o item, o membro compra pela API, e a função devolve o
 * nome do item (único) e o nick do comprador (também único, para a fila global não confundir os dois).
 */
async function ordered(page: Page, index: { staff: string; buyer: string }, name: string, price = "300", stock: number | null = 2) {
  const item = tag(name);
  await login(page, index.staff, `loja-fila-staff-${index.staff}`, { roles: ["member", "staff"] });
  const created = await page.request.post("/api/shop/items", { data: { name: item, price, stock }, headers: { Origin: ORIGIN } });
  expect(created.status()).toBe(201);
  const { id } = (await created.json()) as { id: string };

  const nick = `comprador-${discordId(index.buyer).slice(-8)}`;
  await login(page, index.buyer, nick, { roles: ["member"], ledger: [{ amount: "2000", currency: "buffunfa", kind: "split_payout", memo: "Presença na call" }] });
  const bought = await page.request.post("/api/shop/orders", { data: { itemId: id }, headers: { Origin: ORIGIN } });
  expect(bought.status()).toBe(201);
  return { item, nick, itemId: id };
}

test("staff pega o pedido, devolve à fila e entrega com nota; o débito entra no extrato (AC#1, AC#3, AC#4, AC#5)", async ({ page }) => {
  const pedido = await ordered(page, { staff: "401", buyer: "402" }, "Bolsa T8");
  await login(page, "403", "entregador", { roles: ["member", "staff"] });

  await page.goto("/staff/pedidos");
  await expect(page.getByRole("heading", { name: "Fila de pedidos" })).toBeVisible();

  // O contexto de quem entrega: item, para quem, e o preço em Buffunfa cheia (F6-5).
  const linha = rowOf(page, pedido.item);
  await expect(linha).toContainText(pedido.nick);
  await expect(linha).toContainText("300 BUF");
  await expect(linha).toContainText("aguardando entrega");
  // O contador do menu lê a mesma fila da API (o banco é compartilhado: só se exige que conte).
  await expect(page.getByRole("link", { name: /Fila de pedidos/ }).first()).toContainText(/\d/);
  await snap(page, "fila-pedidos-na-fila");

  // Pegar: o pedido passa a ter dono, e o resto da staff vê quem é (F6-22).
  await linha.getByRole("button", { name: "Pegar pra entregar" }).click();
  await expect(page.getByText("Pedido é seu")).toBeVisible();
  await page.getByRole("tab", { name: /Em entrega/ }).click();
  const emEntrega = rowOf(page, pedido.item);
  await expect(emEntrega).toContainText("em entrega");
  await expect(emEntrega).toContainText("entregador");
  await snap(page, "fila-pedidos-em-entrega");

  // Devolver à fila: o membro não fica preso a um staff que sumiu (AC#3).
  await emEntrega.getByRole("button", { name: "Devolver à fila" }).click();
  await expect(page.getByText("Pedido de volta na fila")).toBeVisible();
  await page.getByRole("tab", { name: /Na fila/ }).click();
  await expect(rowOf(page, pedido.item)).toContainText("aguardando entrega");

  // Pegar de novo e entregar: a nota é obrigatória, então o botão só habilita depois de escrita (AC#4).
  await rowOf(page, pedido.item).getByRole("button", { name: "Pegar pra entregar" }).click();
  await page.getByRole("tab", { name: /Em entrega/ }).click();
  const paraEntregar = rowOf(page, pedido.item);
  const entregar = paraEntregar.getByRole("button", { name: "Marcar como entregue" });
  await expect(entregar).toBeDisabled();
  await paraEntregar.getByLabel(`Nota da entrega do pedido de ${pedido.nick}`).fill("banco de Martlock, para o próprio");
  await entregar.click();
  await expect(page.getByText("Pedido entregue")).toBeVisible();

  await page.getByRole("tab", { name: /Entregues/ }).click();
  const entregue = rowOf(page, pedido.item);
  await expect(entregue).toContainText("entregue");
  await expect(entregue).toContainText("banco de Martlock, para o próprio");
  await snap(page, "fila-pedidos-entregue");

  // O débito só existe agora (AC#5): o extrato do comprador ganhou a linha da compra.
  await login(page, "402", pedido.nick, { roles: ["member"] });
  await page.goto("/carteira");
  // A pílula de origem e o texto da linha dizem a mesma coisa: basta uma das duas aparecer.
  await expect(page.getByText("Compra na loja").first()).toBeVisible();
  await page.goto("/loja");
  await expect(myOrder(page, pedido.item)).toContainText("entregue");
  // O saldo caiu os 300: o que era reserva virou débito, uma vez só.
  await expect(page.getByRole("region", { name: "Sua Buffunfa" })).toContainText("1.700 BUF");
});

test("o comprador cancela enquanto ninguém pegou; depois de pego o botão não existe (AC#6, AC#7, F6-24)", async ({ page }) => {
  const pedido = await ordered(page, { staff: "404", buyer: "405" }, "Criação de evento");

  // O comprador vê o próprio pedido esperando entrega, com o botão de desistir.
  await page.goto("/loja");
  const meu = myOrder(page, pedido.item);
  await expect(meu).toContainText("aguardando entrega");
  await snap(page, "loja-pedido-cancelavel");
  await meu.getByRole("button", { name: `Cancelar pedido de ${pedido.item}` }).click();
  await expect(page.getByText("Pedido cancelado")).toBeVisible();
  await expect(myOrder(page, pedido.item)).toContainText("cancelado");
  // Devolveu Buffunfa **e** estoque na mesma transação (AC#7): saldo cheio e o item comprável de novo.
  await expect(page.getByRole("region", { name: "Sua Buffunfa" })).toContainText("2.000 BUF");
  await expect(page.getByRole("list", { name: "Catálogo" }).getByRole("listitem").filter({ hasText: pedido.item })).toContainText("2 unidades");

  // Segundo pedido, este a staff pega: aí o comprador já não desiste mais.
  const outro = await ordered(page, { staff: "406", buyer: "407" }, "Set de trilha");
  await login(page, "408", "pegador", { roles: ["member", "staff"] });
  await page.goto("/staff/pedidos");
  await rowOf(page, outro.item).getByRole("button", { name: "Pegar pra entregar" }).click();
  await expect(page.getByText("Pedido é seu")).toBeVisible();

  await login(page, "407", outro.nick, { roles: ["member"] });
  await page.goto("/loja");
  const pego = myOrder(page, outro.item);
  await expect(pego).toContainText("em entrega");
  await expect(pego.getByRole("button", { name: `Cancelar pedido de ${outro.item}` })).toHaveCount(0);
});

test("a staff recusa com motivo, devolvendo Buffunfa e estoque (AC#7)", async ({ page }) => {
  const pedido = await ordered(page, { staff: "409", buyer: "410" }, "Ping de evento", "300", 1);
  await login(page, "411", "recusador", { roles: ["member", "staff"] });
  await page.goto("/staff/pedidos");

  const linha = rowOf(page, pedido.item);
  await linha.getByRole("button", { name: "Recusar" }).click();
  const confirmar = linha.getByRole("button", { name: "Confirmar recusa" });
  await expect(confirmar).toBeDisabled();
  await linha.getByLabel(`Motivo da recusa do pedido de ${pedido.nick}`).fill("esse item saiu do jogo");
  await confirmar.click();
  await expect(page.getByText("Pedido recusado")).toBeVisible();

  await page.getByRole("tab", { name: /Recusados/ }).click();
  await expect(rowOf(page, pedido.item)).toContainText("esse item saiu do jogo");
  await snap(page, "fila-pedidos-recusado");

  // O membro lê o motivo e recuperou a Buffunfa; o item voltou ao estoque, esgotado deixa de estar.
  await login(page, "410", pedido.nick, { roles: ["member"] });
  await page.goto("/loja");
  await expect(myOrder(page, pedido.item)).toContainText("recusado");
  await expect(myOrder(page, pedido.item)).toContainText("esse item saiu do jogo");
  await expect(page.getByRole("region", { name: "Sua Buffunfa" })).toContainText("2.000 BUF");
  await expect(page.getByRole("list", { name: "Catálogo" }).getByRole("listitem").filter({ hasText: pedido.item }).getByRole("button", { name: "Comprar" })).toBeEnabled();
});

test("sem shop:fulfill a fila não existe: nem no menu, nem na rota (AC#8, F6-25)", async ({ page }) => {
  await login(page, "412", "membro-comum", { roles: ["member"] });
  await page.goto("/loja");
  await expect(page.getByRole("link", { name: /Fila de pedidos/ })).toHaveCount(0);
  await page.goto("/staff/pedidos");
  await expect(page.getByRole("heading", { name: "Fila de pedidos" })).toHaveCount(0);
});
