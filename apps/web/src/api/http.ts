/**
 * Chamada à API do painel. A mensagem PT-BR que a API devolve é o texto que vai pro toast: quem
 * escreve o erro é quem conhece a regra, e a tela não inventa uma explicação paralela.
 */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "same-origin",
    ...init,
    headers: { Accept: "application/json", "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: unknown } | null;
    throw new Error(typeof body?.message === "string" ? body.message : `Falha na requisição (HTTP ${res.status})`);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

/** Texto de erro pro toast, com uma saída quando a exceção não é `Error`. */
export const errorText = (e: unknown, fallback: string): string => (e instanceof Error ? e.message : fallback);
