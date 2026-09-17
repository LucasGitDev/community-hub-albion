import { expect, test, type Page } from "@playwright/test";
import { login, snap, ORIGIN } from "./session";

/**
 * Loja (TASK-059) contra a API real: a staff cadastra, o membro vê preço e saldo, item esgotado aparece
 * cinza e não clicável (F6-18), e a compra reserva a Buffunfa sem lançar nada no extrato (AC#5).
 *
 * A Buffunfa é semeada no ledger pelo dev-login, como na carteira — nada de dados de demonstração.
 *
 * **O catálogo é global**, não por usuário: o item de uma rodada continua na loja na rodada seguinte, e
 * desktop e mobile rodam em paralelo contra o mesmo banco. Por isso todo nome de item carrega um sufixo
 * único (`tag`) e todo locator é escopado no card daquele item — senão a spec afirmaria coisas sobre o
 * item de outro teste.
 */
const RUN = String(Date.now());
const tag = (name: string) => `${name} ${RUN}${test.info().project.name === "mobile" ? "m" : "d"}`;

/** Cadastra um item pela API, como a staff faria pela tela; devolve o nome completo. */
async function publish(page: Page, item: { name: string; description?: string; price: string; stock?: number | null }): Promise<string> {
  const name = tag(item.name);
  const res = await page.request.post("/api/shop/items", { data: { ...item, name }, headers: { Origin: ORIGIN } });
  expect(res.status()).toBe(201);
  return name;
}

/**
 * O card daquele item, e só dele — escopado no catálogo. Sem o escopo, `getByRole("listitem")` pegaria
 * também a linha de "Meus pedidos" e o toast do Sonner, que também são itens de lista.
 */
const cardOf = (page: Page, name: string) => page.getByRole("list", { name: "Catálogo" }).getByRole("listitem").filter({ hasText: name });
const orderOf = (page: Page, name: string) => page.getByRole("list", { name: "Meus pedidos" }).getByRole("listitem").filter({ hasText: name });

test("staff cadastra, reprecifica e despublica item pela tela (AC#1)", async ({ page }) => {
  await login(page, "301", "loja-staff", { roles: ["member", "staff"] });
  await page.goto("/loja");

  await expect(page.getByRole("heading", { name: "Loja" })).toBeVisible();
  const name = tag("Ping de evento");
  await page.getByRole("button", { name: "Novo item" }).click();
  await page.getByLabel("Nome").fill(name);
  await page.getByLabel("Descrição (opcional)").fill("A staff pinga a guilda no canal de eventos.");
  await page.getByLabel("Preço").fill("340");
  await page.getByLabel("Estoque").fill("3");
  await page.getByRole("button", { name: "Publicar item" }).click();

  const card = cardOf(page, name);
  await expect(card).toBeVisible();
  // Buffunfa nunca abrevia (F6-5).
  await expect(card).toContainText("340 BUF");
  // O preço carrega o ícone da moeda, como todo valor em Buffunfa do painel (TASK-071, AC#1).
  await expect(card.locator('img[src*="buffunfa"]').first()).toBeVisible();
  await expect(card).toContainText("3 unidades");
  await snap(page, "loja-staff-cadastro");

  // Editar o preço e despublicar são o mesmo caminho: o item nunca é apagado.
  await card.getByRole("button", { name: `Editar ${name}` }).click();
  await page.getByLabel("Preço").fill("400");
  await page.getByRole("button", { name: "Salvar" }).click();
  await expect(card).toContainText("400 BUF");

  await card.getByRole("button", { name: `Despublicar ${name}` }).click();
  await expect(card).toContainText("fora da loja");
});

test("membro vê catálogo, preços e o próprio saldo de Buffunfa (AC#2)", async ({ page }) => {
  await login(page, "302", "loja-catalogo", { roles: ["member", "staff"] });
  const bolsa = await publish(page, { name: "Bolsa T8", description: "Entregue no banco de Martlock.", price: "300" });
  const fora = await publish(page, { name: "Item guardado", price: "10", stock: null });
  await page.request.patch(`/api/shop/items/${await idOf(page, fora)}`, { data: { published: false }, headers: { Origin: ORIGIN } });

  // Segundo usuário, só membro, com Buffunfa no ledger: é ele quem compra.
  await login(page, "303", "loja-membro", { roles: ["member"], ledger: [{ amount: "500", currency: "buffunfa", kind: "split_payout", memo: "Presença na call" }] });
  await page.goto("/loja");

  await expect(page.getByRole("region", { name: "Sua Buffunfa" })).toContainText("500 BUF");
  await expect(cardOf(page, bolsa)).toContainText("300 BUF");
  await expect(cardOf(page, bolsa)).toContainText("Entregue no banco de Martlock.");
  // Despublicado não aparece para o membro; a staff continua vendo (o teste acima cobre esse lado).
  await expect(cardOf(page, fora)).toHaveCount(0);
  // Sem shop:manage não há botão de cadastro nem de edição.
  await expect(page.getByRole("button", { name: "Novo item" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: `Editar ${bolsa}` })).toHaveCount(0);
  await snap(page, "loja-membro-catalogo");
});

test("item sem estoque aparece esgotado e não clicável, sem sair da lista (AC#3, F6-18)", async ({ page }) => {
  await login(page, "304", "loja-esgotado-staff", { roles: ["member", "staff"] });
  const esgotadoNome = await publish(page, { name: "Set de trilha", price: "80", stock: 0 });
  const disponivel = await publish(page, { name: "Criação de evento", price: "120" });
  await login(page, "305", "loja-esgotado", { roles: ["member"], ledger: [{ amount: "1000", currency: "buffunfa", kind: "split_payout" }] });
  await page.goto("/loja");

  const esgotado = cardOf(page, esgotadoNome);
  // Continua na lista, marcado, e o botão de comprar nem existe.
  await expect(esgotado).toBeVisible();
  await expect(esgotado).toContainText("esgotado");
  await expect(esgotado.getByRole("button", { name: `${esgotadoNome} esgotado` })).toBeDisabled();
  await expect(esgotado.getByRole("button", { name: "Comprar" })).toHaveCount(0);
  // O item disponível ao lado continua comprável: o cinza é do item, não da tela.
  await expect(cardOf(page, disponivel).getByRole("button", { name: "Comprar" })).toBeEnabled();
  await snap(page, "loja-esgotado");
});

test("compra reserva a Buffunfa, não entra no extrato, e a segunda é recusada por saldo (AC#4, AC#5)", async ({ page }) => {
  await login(page, "306", "loja-compra-staff", { roles: ["member", "staff"] });
  const nome = await publish(page, { name: "Criação de evento", price: "300", stock: 2 });
  await login(page, "307", "loja-compra", { roles: ["member"], ledger: [{ amount: "500", currency: "buffunfa", kind: "split_payout", memo: "Presença na call" }] });
  await page.goto("/loja");

  const card = cardOf(page, nome);
  await card.getByRole("button", { name: "Comprar" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Sobra pra gastar");
  await expect(dialog).toContainText("200 BUF");
  await dialog.getByRole("button", { name: "Confirmar compra" }).click();

  // Reserva: o disponível cai, o pedido aparece aguardando entrega, o estoque cai.
  const saldo = page.getByRole("region", { name: "Sua Buffunfa" });
  await expect(saldo).toContainText("200 BUF");
  await expect(saldo).toContainText("300 BUF em pedidos aguardando entrega");
  await expect(orderOf(page, nome)).toContainText("aguardando entrega");
  await expect(card).toContainText("1 unidade");
  await snap(page, "loja-compra-reservada");

  // Não cabe outra: o botão já vem desabilitado e o card diz quanto falta (AC#4).
  await expect(card.getByRole("button", { name: "Comprar" })).toBeDisabled();
  await expect(card).toContainText("Faltam");

  // O extrato não mudou: a compra reserva, o débito é da entrega (AC#5).
  await page.goto("/carteira");
  await expect(page.getByRole("heading", { name: "Extrato" })).toBeVisible();
  await expect(page.getByText("Compra na loja")).toHaveCount(0);
  await expect(page.getByText("Presença na call")).toBeVisible();
  // O chip do header segue mostrando o saldo do ledger, que a reserva não toca (F6-26).
  await expect(page.getByRole("link", { name: "Meus saldos" })).toContainText("500 BUF");
});

/** Id do item pelo nome, via catálogo da staff. */
async function idOf(page: Page, name: string): Promise<string> {
  const res = await page.request.get("/api/shop");
  const body = (await res.json()) as { items: { id: string; name: string }[] };
  const found = body.items.find((i) => i.name === name);
  expect(found, `item ${name} não está no catálogo`).toBeTruthy();
  return found!.id;
}
