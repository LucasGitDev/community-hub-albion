import { Moon, Sun } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { parseTheme, THEME_STORAGE_KEY, type Theme } from "@/lib/theme";

/**
 * Tema claro/escuro (TASK-036). Escuro é o padrão. O index.html aplica a classe `dark` antes do
 * primeiro paint (sem flash); aqui só lemos o estado inicial dela e persistimos a troca.
 */

interface ThemeContextValue {
  theme: Theme;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => (document.documentElement.classList.contains("dark") ? "dark" : "light"));

  const toggle = useCallback(() => {
    setTheme((current) => {
      const next = parseTheme(current === "dark" ? "light" : "dark");
      document.documentElement.classList.toggle("dark", next === "dark");
      try {
        localStorage.setItem(THEME_STORAGE_KEY, next);
      } catch {
        /* storage bloqueado: vale só nesta aba */
      }
      return next;
    });
  }, []);

  const value = useMemo(() => ({ theme, toggle }), [theme, toggle]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme fora de ThemeProvider");
  return ctx;
}

/** Botão de tema. Troca instantânea: ação repetível, sem animação (gate de frequência do `animate`). */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggle } = useTheme();
  const dark = theme === "dark";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? "Usar tema claro" : "Usar tema escuro"}
      title={dark ? "Usar tema claro" : "Usar tema escuro"}
      className={cn("press grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground", className)}
    >
      {dark ? <Sun className="size-4" aria-hidden /> : <Moon className="size-4" aria-hidden />}
    </button>
  );
}
