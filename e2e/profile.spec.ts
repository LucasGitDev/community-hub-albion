import { expect, test } from "@playwright/test";
import { login, snap } from "./session";

/**
 * Perfil do membro (TASK-041): identidade (nick, conta do Discord, papéis) + o mesmo registro e troca de
 * nick de antes (TASK-012, Q14/Q31). Usa o login compartilhado: id novo a cada rodada, então reexecutar
 * no mesmo banco não herda nick pendente da execução anterior.
 */

test("membro novo registra nick pela carteira e corrige a pendente (AC#1, AC#2)", async ({ page }) => {
  await login(page, "201", "novato");
  await page.goto("/carteira");
  await page.getByRole("link", { name: "Registrar nick" }).click();
  await expect(page).toHaveURL(/\/perfil$/);
  await expect(page.getByRole("heading", { name: "Meu perfil" })).toBeVisible();
  await expect(page.getByText("Sem nick registrado")).toBeVisible();
  await snap(page, "perfil-sem-nick");

  const input = page.getByLabel("Nick do personagem");
  await input.fill("Novato Um");
  await page.getByRole("button", { name: "Enviar para aprovação" }).click();
  await expect(page.getByText("Use só letras e números")).toBeVisible();
  await snap(page, "perfil-nick-erro");

  await input.fill("NovatoUm");
  await page.getByRole("button", { name: "Enviar para aprovação" }).click();
  await expect(page.getByText("Aguardando aprovação da staff")).toBeVisible();
  await expect(page.getByText("NovatoUm", { exact: true })).toBeVisible();
  await snap(page, "perfil-nick-pendente");

  await page.getByRole("button", { name: "Corrigir nick enviado" }).click();
  await page.getByLabel("Nick do personagem").fill("NovatoDois");
  await page.getByRole("button", { name: "Atualizar solicitação" }).click();
  await expect(page.getByText("NovatoDois", { exact: true })).toBeVisible();
  await expect(page.getByText("Aguardando aprovação da staff")).toHaveCount(1);

  await page.reload();
  await expect(page.getByText("NovatoDois", { exact: true })).toBeVisible();
  await page.goto("/carteira");
  await expect(page.getByText("Nick aguardando a staff")).toBeVisible();
});

test("membro aprovado pede troca e mantém nick e acesso (AC#3)", async ({ page }) => {
  await login(page, "202", "veterano", { gameNick: "Veterano" });
  await page.goto("/perfil");
  await expect(page.getByText("Nick aprovado")).toBeVisible();
  await expect(page.getByText("Aprovado pela staff")).toBeVisible();
  await expect(page.getByText("Veterano", { exact: true })).toBeVisible();
  await snap(page, "perfil-nick-aprovado");

  await page.getByRole("button", { name: "Pedir troca de nick" }).click();
  await expect(page.getByText("Seu nick atual e seu acesso continuam valendo até a staff aprovar o novo.")).toBeVisible();
  await page.getByLabel("Nick do personagem").fill("VeteranoII");
  await page.getByRole("button", { name: "Pedir troca" }).click();
  await expect(page.getByText("Aguardando aprovação da staff")).toBeVisible();
  await expect(page.getByText("Veterano", { exact: true })).toBeVisible();
  await expect(page.getByText("Até lá, você continua como Veterano, com o mesmo acesso.")).toBeVisible();
  await snap(page, "perfil-nick-troca-pendente");

  await page.goto("/carteira");
  await expect(page.getByText("Disponível pra saque")).toBeVisible();
});

test("perfil mostra conta do Discord e papéis, e /nick redireciona pra /perfil (AC#1, AC#3)", async ({ page }) => {
  await login(page, "203", "perfilado", { gameNick: "Perfilado" });

  // AC#3: link antigo continua funcionando e troca a URL pela nova.
  await page.goto("/nick");
  await expect(page).toHaveURL(/\/perfil$/);

  // AC#1: nick, conta do Discord e papéis na mesma tela.
  await expect(page.getByRole("heading", { name: "Meu perfil" })).toBeVisible();
  await expect(page.getByText("Perfilado", { exact: true })).toBeVisible();
  const discord = page.getByRole("region", { name: "Conta do Discord" });
  await expect(discord.getByText("@perfilado")).toBeVisible();
  await expect(page.getByRole("region", { name: "Seus papéis" }).getByText("Membro")).toBeVisible();
  await expect(page.getByText("Disponível pra saque")).toBeVisible();
  await snap(page, "perfil-completo");

  // AC#3: navegação usa o nome novo.
  await page.goto("/carteira");
  await page.getByRole("link", { name: "Meu perfil" }).first().click();
  await expect(page).toHaveURL(/\/perfil$/);
});
