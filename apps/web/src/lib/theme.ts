/** TASK-036: tema do painel. Mesma chave usada pelo script inline do index.html. */
export const THEME_STORAGE_KEY = "albion-hub:theme";
export type Theme = "light" | "dark";

/** Só "light" explícito vira claro; qualquer outra coisa (ausente, inválido) cai no padrão escuro. */
export function parseTheme(raw: string | null | undefined): Theme {
  return raw === "light" ? "light" : "dark";
}
