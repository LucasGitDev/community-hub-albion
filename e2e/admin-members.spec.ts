import { expect, test, type Page } from "@playwright/test";
import { ORIGIN } from "./session";

/**
 * Lista de membros do admin (TASK-043). Discord IDs por projeto: desktop e mobile rodam em paralelo no mesmo banco.
 * O bot está desligado no e2e (DISCORD_BOT_ENABLED=false), então o import responde 503 com texto claro — é isso que
 * a tela precisa mostrar. Nenhuma chamada real ao Discord ou ao Albion acontece aqui.
 */

async function login(page: Page, base: string, username: string, roles: string[] = []) {
  const suffix = test.info().project.name === "mobile" ? "9" : "8";
  const res = await page.request.post("/api/auth/dev-login", {
    data: { discordId: `${base}${suffix}`, username: `${username}${suffix}`, roles },
    headers: { Origin: ORIGIN },
  });
  expect(res.status()).toBe(204);
  return `${username}${suffix}`;
}

async function snap(page: Page, name: string) {
  await test.info().attach(name, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
}

test("admin vê a lista, busca e filtra por sem nick (AC#1, AC#2, AC#4)", async ({ page }) => {
  const semNick = await login(page, "77000000000000001", "adm-semnick");
  const admin = await login(page, "77000000000000101", "adm-chefe", ["admin"]);

  await page.goto("/admin/membros");
  await expect(page.getByRole("heading", { name: "Membros", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Importar membros do Discord" })).toBeVisible();

  // A própria conta do admin e a do membro aparecem na lista, com o status do Albion de quem nunca foi conferido.
  const row = page.getByRole("row").filter({ hasText: `@${semNick}` });
  await expect(row).toBeVisible();
  await expect(row.getByText("Não conferido")).toBeVisible();
  await snap(page, "admin-membros-lista");

  // Busca pelo usuário do Discord reduz a lista a uma linha.
  await page.getByLabel("Buscar por nick ou usuário do Discord").fill(semNick);
  await expect(page.getByRole("row").filter({ hasText: `@${admin}` })).toHaveCount(0);
  await expect(row).toBeVisible();

  // Filtro "sem nick" mantém quem não registrou nick; "não encontrados" esvazia (ninguém foi conferido no e2e).
  await page.getByRole("button", { name: /^Sem nick/ }).click();
  await expect(row).toBeVisible();
  await page.getByRole("button", { name: /^Não encontrados no Albion/ }).click();
  await expect(page.getByText("Nenhum membro com esse filtro.")).toBeVisible();
  await snap(page, "admin-membros-filtro-vazio");
  await page.getByRole("button", { name: "Limpar filtros" }).click();
  await expect(page.getByRole("row").filter({ hasText: `@${admin}` })).toBeVisible();
});

test("import sem bot explica o motivo em PT-BR sem quebrar a tela", async ({ page }) => {
  await login(page, "77000000000000102", "adm-import", ["admin"]);
  await page.goto("/admin/membros");
  await page.getByRole("button", { name: "Importar membros do Discord" }).click();
  await expect(page.getByText("O bot do Discord está desligado neste servidor", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Importar membros do Discord" })).toBeEnabled();
  await snap(page, "admin-membros-import-sem-bot");
});

test("membro sem permissão não abre a tela nem a API (AC#5)", async ({ page }) => {
  await login(page, "77000000000000003", "adm-curioso");
  await page.goto("/admin/membros");
  await expect(page.getByRole("heading", { name: "Acesso negado" })).toBeVisible();
  expect((await page.request.get("/api/admin/members")).status()).toBe(403);
  const imported = await page.request.post("/api/admin/members/import", { headers: { Origin: ORIGIN } });
  expect(imported.status()).toBe(403);
});

test("admin confere o nick no Albion, edita o membro e escreve nota (AC#1, AC#2, AC#3)", async ({ page }) => {
  // Console limpo é parte do resultado: erro de React ou requisição quebrada não pode passar despercebido.
  const erros: string[] = [];
  page.on("console", (m) => m.type() === "error" && !m.text().includes("Failed to load resource") && erros.push(m.text()));
  const admin = await login(page, "77000000000000201", "adm-gestao", ["admin"]);
  // Nick é único entre membros e os dois projetos rodam no mesmo banco: cada um edita para o seu próprio nick.
  const nick = test.info().project.name === "mobile" ? "NickEditadoM" : "NickEditadoD";
  await page.goto("/admin/membros");
  // A lista pagina em 25 e o banco do e2e acumula usuários entre execuções: busca primeiro, age depois.
  await page.getByLabel("Buscar por nick ou usuário do Discord").fill(admin);

  const row = page.getByRole("row").filter({ hasText: `@${admin}` });
  await expect(row).toBeVisible();

  // AC#2: editar nick e tag muda a linha na hora, sem recarregar a página.
  await row.getByRole("button", { name: /^Gerenciar / }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("tab", { name: "Editar" })).toBeVisible();
  await snap(page, "admin-membros-editar");
  await dialog.getByLabel("Nick no Albion").fill(nick);
  await dialog.getByLabel("Tag da guilda").fill("GENEI");
  await dialog.getByRole("button", { name: "Salvar" }).click();
  await expect(dialog).toBeHidden();

  const edited = page.getByRole("row").filter({ hasText: `@${admin}` });
  await expect(edited.getByText(nick)).toBeVisible();
  await expect(edited.getByText("[GENEI]").filter({ visible: true }).first()).toBeVisible();
  await snap(page, "admin-membros-linha-editada");

  // AC#3: a edição vira nota de sistema com autor e data, e a nota escrita à mão entra depois dela.
  await edited.getByRole("button", { name: /^Gerenciar / }).click();
  await dialog.getByRole("tab", { name: /Notas/ }).click();
  await expect(dialog.getByText(new RegExp(`Editou nick .+ → ${nick}`))).toBeVisible();
  // Corpo único por execução: o banco do e2e não é limpo entre rodadas e a nota nunca é apagada.
  const nota = `avisei no privado sobre o nick ${Date.now()}`;
  const antes = await dialog.getByRole("listitem").count();
  await dialog.getByLabel(/Nova nota/).fill(nota);
  await dialog.getByRole("button", { name: "Adicionar nota" }).click();
  await expect(dialog.getByRole("listitem")).toHaveCount(antes + 1);
  const itens = dialog.getByRole("listitem");
  // Append-only e cronológico: o registro da edição abre a lista e a nota nova entra no fim, sem mexer nas outras.
  await expect(itens.first()).toContainText("Editou nick");
  await expect(itens.last()).toContainText(nota);
  // Autor da nota é quem escreveu, pelo nick vigente (o admin acabou de editar o próprio).
  await expect(itens.last()).toContainText(nick);

  // Append-only na interface: nada de editar nem apagar nota.
  await expect(dialog.getByRole("button", { name: /Apagar|Excluir|Editar nota/ })).toHaveCount(0);
  await snap(page, "admin-membros-notas");

  // AC#1: a conferência está desligada no e2e (sem ALBION_REGION) e a tela diz isso em PT-BR, sem quebrar.
  await page.getByRole("button", { name: "Fechar" }).first().click();
  await expect(dialog).toBeHidden();
  await edited.getByRole("button", { name: /^Conferir / }).click();
  await expect(page.getByText("Conferência no Albion desligada", { exact: false })).toBeVisible();
  await expect(edited.getByRole("button", { name: /^Conferir / })).toBeEnabled();
  await snap(page, "admin-membros-conferir-desligado");

  // A coluna de ações não pode empurrar a tabela para fora da tela, nem no celular de 400px.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
  expect(erros).toEqual([]);
});

test("a janela de gestão é navegável por teclado e fecha com Esc (AC#2, AC#3)", async ({ page }) => {
  const teclado = await login(page, "77000000000000205", "adm-teclado", ["admin"]);
  await page.goto("/admin/membros");
  await page.getByLabel("Buscar por nick ou usuário do Discord").fill(teclado);
  const row = page.getByRole("row").filter({ hasText: `@${teclado}` });
  await row.getByRole("button", { name: /^Gerenciar / }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  // O foco entra no diálogo, e Tab anda pelos controles dele sem escapar para a lista atrás do overlay.
  await page.keyboard.press("Tab");
  await expect(dialog.locator(":focus")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("membro sem permissão não usa edição, notas nem conferência (AC#4)", async ({ page }) => {
  await login(page, "77000000000000203", "adm-sem-acesso");
  await page.goto("/admin/membros");
  await expect(page.getByRole("heading", { name: "Acesso negado" })).toBeVisible();
  // Nem o botão existe na tela, nem a API responde.
  await expect(page.getByRole("button", { name: /Gerenciar/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Conferir/ })).toHaveCount(0);

  // O guard decide antes de olhar se o usuário existe: qualquer id devolve 403 para quem não tem permissão.
  const alvo = "00000000-0000-4000-8000-000000000000";
  expect((await page.request.get(`/api/admin/members/${alvo}/notes`)).status()).toBe(403);
  expect((await page.request.post(`/api/admin/members/${alvo}/notes`, { data: { body: "oi" }, headers: { Origin: ORIGIN } })).status()).toBe(403);
  expect((await page.request.post(`/api/admin/members/${alvo}/albion-check`, { headers: { Origin: ORIGIN } })).status()).toBe(403);
  expect((await page.request.patch(`/api/admin/members/${alvo}`, { data: { nick: "Invadido" }, headers: { Origin: ORIGIN } })).status()).toBe(403);
});
