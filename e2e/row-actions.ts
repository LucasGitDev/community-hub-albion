import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Menu de ações da linha (TASK-083, SS6): desde a convenção nova, as ações de uma linha da lista de
 * jogadores não são mais botões de ícone soltos — moram num popup. As specs abrem o menu por aqui para
 * não repetir o passo em cada teste e para o dia em que o gatilho mudar ter um lugar só para mudar.
 */
export const actionsTrigger = (row: Locator): Locator => row.getByRole("button", { name: /^Ações de / });

/** Abre o menu da linha e clica no item pelo nome. */
export async function rowAction(page: Page, row: Locator, name: string | RegExp): Promise<void> {
  await actionsTrigger(row).click();
  await page.getByRole("menuitem", { name }).click();
}

/** Abre o menu e afirma quantas vezes um item aparece (0 = a pessoa não pode aquilo). */
export async function expectRowActionCount(page: Page, row: Locator, name: string | RegExp, count: number): Promise<void> {
  await actionsTrigger(row).click();
  await expect(page.getByRole("menuitem", { name })).toHaveCount(count);
  await page.keyboard.press("Escape");
}
