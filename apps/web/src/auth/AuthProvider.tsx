import { defineAbilityFor, type AppAbility } from "@albion-hub/shared";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { fetchMe, logoutRequest, type Me } from "./api";

export interface CurrentUser {
  id: string;
  discordId: string;
  nick: string;
  initials: string;
  roles: Me["roles"];
}

type AuthState =
  | { status: "loading" }
  | { status: "anonymous" }
  | { status: "error"; message: string }
  | { status: "authenticated"; user: CurrentUser; ability: AppAbility };

interface AuthContextValue {
  state: AuthState;
  logout: () => Promise<void>;
  reload: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function toCurrentUser(me: Me): CurrentUser {
  const nick = me.user.displayName || me.user.username;
  return { id: me.user.id, discordId: me.user.discordId, nick, initials: nick.slice(0, 2).toUpperCase(), roles: me.roles };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetchMe(controller.signal)
      .then((me) => {
        if (!me) return setState({ status: "anonymous" });
        const user = toCurrentUser(me);
        // Mesmas regras CASL da API (packages/shared). A API continua sendo a autoridade.
        setState({ status: "authenticated", user, ability: defineAbilityFor({ id: user.id, roles: user.roles }) });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({ status: "error", message: error instanceof Error ? error.message : "Erro ao carregar sessão" });
      });
    return () => controller.abort();
  }, [version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  const logout = useCallback(async () => {
    await logoutRequest();
    setState({ status: "anonymous" });
  }, []);

  const value = useMemo(() => ({ state, logout, reload }), [state, logout, reload]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth fora de AuthProvider");
  return ctx;
}

/** Usuário logado; só usar dentro de rotas protegidas por RequireAuth. */
export function useCurrentUser(): { user: CurrentUser; ability: AppAbility } {
  const { state } = useAuth();
  if (state.status !== "authenticated") throw new Error("useCurrentUser sem sessão");
  return { user: state.user, ability: state.ability };
}
