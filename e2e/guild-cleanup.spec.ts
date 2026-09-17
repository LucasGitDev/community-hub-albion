import { expect, test } from "@playwright/test";
import { login, snap } from "./session";

/**
 * Marca de inatividade na lista de membros (TASK-049, AC#2).
 *
 * A limpeza em si não roda no e2e — ela depende do bot, que está desligado aqui, e é coberta por testes
 * contra Postgres de verdade. O que este teste prova é o que só a tela prova: quem saiu aparece marcado,
 * com data e autoria, sem virar "banido"; e quem continua no servidor não ganha selo nenhum.
 */
const RUN = String(Date.now()).slice(-7);
const u = (name: string) => `${name}-${RUN}${test.info().project.name === "mobile" ? "m" : "d"}`;

test("quem saiu do servidor aparece marcado na lista, sem se confundir com banimento", async ({ page }) => {
  const erros: string[] = [];
  page.on("console", (m) => m.type() === "error" && !m.text().includes("Failed to load resource") && erros.push(m.text()));

  await login(page, "41", u("saiu"), { leftGuild: true });
  await login(page, "42", u("ficou"));
  await login(page, "43", u("chefe"), { roles: ["admin"] });

  await page.goto("/admin/membros");
  await expect(page.getByRole("heading", { name: "Membros", exact: true })).toBeVisible();

  await page.getByLabel("Buscar por nick ou usuário do Discord").fill(u("saiu"));
  const inativo = page.getByRole("row").filter({ hasText: `@${u("saiu")}` });
  await expect(inativo).toBeVisible();
  await expect(inativo.getByText("Saiu do servidor")).toBeVisible();
  await expect(inativo.getByText("limpeza automática")).toBeVisible();
  // Saída não é banimento: nenhuma das duas marcas encosta na outra (TASK-050).
  await expect(inativo.getByText("Banido")).toHaveCount(0);
  await snap(page, "limpeza-lista-inativo");

  await page.getByLabel("Buscar por nick ou usuário do Discord").fill(u("ficou"));
  const ativo = page.getByRole("row").filter({ hasText: `@${u("ficou")}` });
  await expect(ativo).toBeVisible();
  await expect(ativo.getByText("Saiu do servidor")).toHaveCount(0);
  await snap(page, "limpeza-lista-ativo");

  expect(erros).toEqual([]);
});
