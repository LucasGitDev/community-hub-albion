import { expect, test, type Page } from "@playwright/test";
import { login, ORIGIN, snap } from "./session";

/**
 * Banimento de jogador no painel (TASK-050).
 *
 * O que cada teste prova é o que um banimento malfeito custaria: acesso que continua valendo, prata que
 * escapa, alguém se banindo sem perceber e um banido que volta sozinho. O bot está desligado no e2e, então
 * a remoção do cargo Membro no Discord não acontece aqui — ela é coberta nos testes do serviço.
 */

/**
 * Nome de usuário único por rodada e por projeto. O banco do e2e não é limpo entre execuções e a busca
 * da tela é pelo usuário do Discord: sem isso, a segunda rodada acharia as linhas da primeira, e desktop
 * e mobile (que rodam em paralelo no mesmo banco) achariam as linhas um do outro.
 */
const RUN = String(Date.now()).slice(-7);
const u = (name: string) => `${name}-${RUN}${test.info().project.name === "mobile" ? "m" : "d"}`;

/** Volta a sessão para outro usuário: o dev-login troca o cookie da página. */
const como = (page: Page, index: string, username: string, roles: ("member" | "caller" | "staff" | "admin")[] = []) => login(page, index, username, { roles });

test("admin bane com motivo, a linha fica marcada e o acesso do banido cai na hora (AC#1, AC#5, AC#11)", async ({ page }) => {
  const erros: string[] = [];
  page.on("console", (m) => m.type() === "error" && !m.text().includes("Failed to load resource") && erros.push(m.text()));

  const alvo = await como(page, "01", u("ban-alvo"));
  // A sessão do alvo existe agora; o banimento tem que matá-la sem esperar o próximo login.
  expect((await page.request.get("/api/auth/me")).status()).toBe(200);

  await como(page, "02", u("ban-chefe"), ["admin"]);
  await page.goto("/admin/membros");
  await expect(page.getByRole("heading", { name: "Membros", exact: true })).toBeVisible();
  await page.getByLabel("Buscar por nick ou usuário do Discord").fill(u("ban-alvo"));

  const row = page.getByRole("row").filter({ hasText: `@${u("ban-alvo")}` });
  await expect(row).toBeVisible();
  await snap(page, "ban-lista-antes");

  await row.getByRole("button", { name: /^Banir / }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: /^Banir / })).toBeVisible();

  // A janela diz o que acontece e o que NÃO acontece: é a parte que impede o clique errado.
  await expect(dialog.getByText("Corta o acesso ao painel na hora e bloqueia novo login.")).toBeVisible();
  await expect(dialog.getByText("Remove o cargo Membro no Discord.")).toBeVisible();
  await expect(dialog.getByText("Congela o saldo: sem pedir saque e sem aprovar saque pendente.")).toBeVisible();
  await expect(dialog.getByText("Não expulsa nem bane do servidor do Discord", { exact: false })).toBeVisible();
  await expect(dialog.getByText("Não apaga o saldo nem mexe no extrato", { exact: false })).toBeVisible();
  await snap(page, "ban-dialogo");

  // Sem motivo digitado o botão não liga: o motivo É a confirmação.
  const confirmar = dialog.getByRole("button", { name: /^Banir / });
  await expect(confirmar).toBeDisabled();
  await dialog.getByLabel("Motivo do banimento").fill("x");
  await expect(dialog.getByText(/pelo menos/)).toBeVisible();
  await expect(confirmar).toBeDisabled();
  await snap(page, "ban-dialogo-motivo-curto");

  await dialog.getByLabel("Motivo do banimento").fill("roubou o loot do split de 12/09");
  await expect(confirmar).toBeEnabled();
  await confirmar.click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("foi banido", { exact: false })).toBeVisible();

  // A conta continua na lista, marcada, com motivo e autor — não sumiu.
  const banida = page.getByRole("row").filter({ hasText: `@${u("ban-alvo")}` });
  await expect(banida.getByText("Banido", { exact: true })).toBeVisible();
  await expect(banida.getByText("roubou o loot do split de 12/09")).toBeVisible();
  await expect(banida.getByText(u("ban-chefe"), { exact: false })).toBeVisible();
  await snap(page, "ban-lista-depois");

  // O filtro "Banidos" acha quem foi banido.
  await page.getByRole("button", { name: /^Banidos/ }).click();
  await expect(page.getByRole("row").filter({ hasText: `@${u("ban-alvo")}` })).toBeVisible();
  await snap(page, "ban-filtro-banidos");

  // A tabela não estoura a largura da tela nem no celular de 400px.
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  expect(erros).toEqual([]);
  expect(alvo).toBeTruthy();
});

test("banido perde o acesso ao painel, a evento e a saque, e o saldo continua lá (AC#5, AC#6, AC#8, AC#9, AC#10)", async ({ page }) => {
  await como(page, "10", u("ban2-chefe"), ["admin"]);
  const alvoId = await login(page, "11", u("ban2-alvo"), { silver: [{ amount: "1000000", kind: "adjustment", memo: "saldo de teste" }] });

  // Como o próprio alvo: pede um saque enquanto ainda pode.
  const pedido = await page.request.post("/api/me/withdrawals", { data: { amount: "400000" }, headers: { Origin: ORIGIN } });
  expect(pedido.status()).toBe(201);
  const saqueId = (await pedido.json()).withdrawals[0].id as string;
  const saldoAntes = (await (await page.request.get("/api/me/withdrawals")).json()).balance;

  // Volta a ser admin e bane pela tela.
  await como(page, "10", u("ban2-chefe"), ["admin"]);
  await page.goto("/admin/membros");
  await page.getByLabel("Buscar por nick ou usuário do Discord").fill(u("ban2-alvo"));
  const row = page.getByRole("row").filter({ hasText: `@${u("ban2-alvo")}` });
  await row.getByRole("button", { name: /^Banir / }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Motivo do banimento").fill("vendeu prata da tesouraria fora do jogo");
  await dialog.getByRole("button", { name: /^Banir / }).click();
  await expect(dialog).toBeHidden();

  // Saque pendente do banido não pode ser aprovado enquanto durar o banimento.
  const aprovar = await page.request.post(`/api/withdrawals/${saqueId}/approve`, { data: {}, headers: { Origin: ORIGIN } });
  expect(aprovar.status()).toBe(409);
  expect(await aprovar.text()).toContain("congelado");

  // O saldo continua o mesmo: nenhum estorno, nenhum lançamento novo.
  const saque = await (await page.request.get(`/api/withdrawals/${saqueId}`)).json();
  expect(saque.status).toBe("pending");

  // Do lado do banido: a sessão dele morreu, e a conta não volta a logar pelo dev-login.
  const recusado = await page.request.post("/api/auth/dev-login", { data: { discordId: alvoId, username: u("ban2-alvo"), roles: [] }, headers: { Origin: ORIGIN } });
  expect(recusado.status()).toBe(403);
  expect(await recusado.text()).toContain("banida");

  // Desbanido: a aprovação volta a funcionar e o saldo é o mesmo de antes.
  await como(page, "10", u("ban2-chefe"), ["admin"]);
  await page.goto("/admin/membros");
  await page.getByLabel("Buscar por nick ou usuário do Discord").fill(u("ban2-alvo"));
  const banida = page.getByRole("row").filter({ hasText: `@${u("ban2-alvo")}` });
  await expect(banida.getByText("Banido", { exact: true })).toBeVisible();
  await banida.getByRole("button", { name: /^Desbanir / }).click();
  await expect(dialog.getByRole("heading", { name: /^Desbanir / })).toBeVisible();
  await expect(dialog.getByText("vendeu prata da tesouraria fora do jogo")).toBeVisible();
  await snap(page, "ban-desbanir-dialogo");
  await dialog.getByRole("button", { name: /^Desbanir / }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("foi desbanido", { exact: false })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: `@${u("ban2-alvo")}` }).getByText("Banido", { exact: true })).toHaveCount(0);
  await snap(page, "ban-lista-desbanido");

  expect((await page.request.post(`/api/withdrawals/${saqueId}/approve`, { data: {}, headers: { Origin: ORIGIN } })).status()).toBe(200);
  expect(saldoAntes).toBeTruthy();
});

test("ninguém bane a si mesmo: a ação não aparece na própria linha e a API recusa (AC#3)", async ({ page }) => {
  await como(page, "20", u("ban-eu"), ["admin"]);
  const eu = await (await page.request.get("/api/auth/me")).json();
  await page.goto("/admin/membros");
  await page.getByLabel("Buscar por nick ou usuário do Discord").fill(u("ban-eu"));
  const row = page.getByRole("row").filter({ hasText: `@${u("ban-eu")}` });
  await expect(row).toBeVisible();
  await expect(row.getByRole("button", { name: /^Banir / })).toHaveCount(0);
  await snap(page, "ban-propria-linha-sem-acao");

  const res = await page.request.post(`/api/admin/members/${eu.user.id}/ban`, { data: { reason: "engano de clique" }, headers: { Origin: ORIGIN } });
  expect(res.status()).toBe(400);
  expect(await res.text()).toContain("si mesmo");
});

test("staff bane pela mesma tela, sem ganhar as ações de admin (AC#1, AC#2)", async ({ page }) => {
  await como(page, "30", u("ban-staff-alvo"));
  await como(page, "31", u("ban-staffer"), ["staff"]);
  // A staff chega pelo menu: sem entrada na navegação, ela poderia banir mas não acharia a tela.
  await page.goto("/carteira");
  await page.getByRole("link", { name: "Membros do painel" }).first().click();
  await expect(page.getByRole("heading", { name: "Membros", exact: true })).toBeVisible();
  // Staff não importa membro do Discord: essa ação continua sendo de admin (`manage`/`all`).
  await expect(page.getByRole("button", { name: "Importar membros do Discord" })).toHaveCount(0);
  await page.getByLabel("Buscar por nick ou usuário do Discord").fill(u("ban-staff-alvo"));
  const row = page.getByRole("row").filter({ hasText: `@${u("ban-staff-alvo")}` });
  // Gerenciar a ficha do membro passou a ser da staff na TASK-047 (G3); o que continua fora é papel.
  await expect(row.getByRole("button", { name: /^Gerenciar / })).toHaveCount(1);
  await expect(page.getByRole("link", { name: "Papéis", exact: true })).toHaveCount(0);
  // E a staff não vê a ação em quem ela não pode banir: outro staff ou um admin.
  await page.getByLabel("Buscar por nick ou usuário do Discord").fill(u("ban-staffer"));
  await expect(page.getByRole("row").filter({ hasText: `@${u("ban-staffer")}` }).getByRole("button", { name: /^Banir / })).toHaveCount(0);
  await page.getByLabel("Buscar por nick ou usuário do Discord").fill(u("ban-staff-alvo"));
  await snap(page, "ban-visao-staff");

  await row.getByRole("button", { name: /^Banir / }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Motivo do banimento").fill("não apareceu em três eventos seguidos");
  await dialog.getByRole("button", { name: /^Banir / }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("row").filter({ hasText: `@${u("ban-staff-alvo")}` }).getByText("Banido", { exact: true })).toBeVisible();
});

test("member e caller não veem a tela nem passam pela API (AC#2)", async ({ page }) => {
  await como(page, "40", u("ban-curioso"), ["caller"]);
  await page.goto("/admin/membros");
  await expect(page.getByRole("heading", { name: "Acesso negado" })).toBeVisible();
  const alvo = "00000000-0000-4000-8000-000000000000";
  expect((await page.request.get("/api/admin/members")).status()).toBe(403);
  expect((await page.request.post(`/api/admin/members/${alvo}/ban`, { data: { reason: "quero banir" }, headers: { Origin: ORIGIN } })).status()).toBe(403);
  expect((await page.request.delete(`/api/admin/members/${alvo}/ban`, { headers: { Origin: ORIGIN } })).status()).toBe(403);
});

test("a janela de banimento é navegável por teclado e fecha com Esc (AC#13)", async ({ page }) => {
  await como(page, "50", u("ban-teclado-alvo"));
  await como(page, "51", u("ban-teclado"), ["admin"]);
  await page.goto("/admin/membros");
  await page.getByLabel("Buscar por nick ou usuário do Discord").fill(u("ban-teclado-alvo"));
  await page.getByRole("row").filter({ hasText: `@${u("ban-teclado-alvo")}` }).getByRole("button", { name: /^Banir / }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(dialog.locator(":focus")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  // Fechar sem confirmar não bane ninguém.
  await expect(page.getByRole("row").filter({ hasText: `@${u("ban-teclado-alvo")}` }).getByText("Banido", { exact: true })).toHaveCount(0);
});
