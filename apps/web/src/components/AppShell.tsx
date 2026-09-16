import { ROLE_LABELS, type Action, type SubjectType } from "@albion-hub/shared";
import { NavLink, Outlet, useLocation } from "react-router";
import { CalendarPlus, CalendarRange, Coins, LayoutTemplate, HandCoins, KeyRound, LogOut, ScrollText, Shield, Swords, UserPen, Users, UsersRound, Vault } from "lucide-react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useAuth, useCurrentUser } from "@/auth/AuthProvider";
import { Silver } from "@/components/display";
import { useStore } from "@/mock/store";
import { ThemeToggle } from "@/theme/theme";

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  /** Item só aparece se o papel permitir (mesmas regras CASL da API). */
  can?: [Action, SubjectType];
  /** Contador ao lado do item (ex.: fila pendente). */
  count?: number;
}

export function AppShell() {
  const { user, ability } = useCurrentUser();
  const { logout } = useAuth();
  const { balanceFor, withdrawalsFor, allWithdrawals } = useStore();
  const { pathname } = useLocation();
  const allowed = (item: NavItem) => !item.can || ability.can(item.can[0], item.can[1]);

  const { available } = balanceFor(user.discordId);
  const myOpen = withdrawalsFor(user.discordId).filter((w) => w.status === "pending" || w.status === "approved").length;
  const queue = allWithdrawals.filter((w) => w.status === "pending").length;

  const personal: NavItem[] = [
    { to: "/carteira", label: "Carteira", icon: <Coins /> },
    { to: "/eventos", label: "Eventos", icon: <CalendarRange /> },
    { to: "/saques", label: "Meus saques", icon: <HandCoins />, count: myOpen },
    { to: "/nick", label: "Meu nick", icon: <UserPen /> },
  ];
  const management = (
    [
      { to: "/staff/saques", label: "Fila de saques", icon: <Vault />, can: ["approve", "Withdrawal"], count: queue },
      { to: "/staff/eventos", label: "Central de eventos", icon: <CalendarPlus />, can: ["create", "Event"] },
      { to: "/staff/templates", label: "Templates", icon: <LayoutTemplate />, can: ["update", "EventTemplate"] },
      { to: "/staff/roles", label: "Roles", icon: <Shield />, can: ["update", "EventTemplate"] },
      { to: "/staff/membros", label: "Membros", icon: <Users />, can: ["approve", "MemberRequest"] },
      { to: "/staff/splits", label: "Loot splits", icon: <ScrollText />, can: ["update", "LootSplit"] },
      { to: "/admin/membros", label: "Membros do painel", icon: <UsersRound />, can: ["read", "UserRole"] },
      { to: "/admin/papeis", label: "Papéis", icon: <KeyRound />, can: ["read", "UserRole"] },
    ] satisfies NavItem[]
  ).filter(allowed);
  const current = [...personal, ...management].find((i) => pathname.startsWith(i.to));
  const section = management.some((i) => i === current) ? "Gestão" : "Pessoal";
  const roleLabel = user.roles.filter((r) => r !== "member").map((r) => ROLE_LABELS[r]).join(", ") || ROLE_LABELS.member;
  const onLogout = () => {
    logout().catch(() => toast.error("Não foi possível sair. Tente de novo."));
  };

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[15rem_1fr]">
      <aside className="hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:sticky md:top-0 md:flex md:h-dvh md:flex-col">
        <Brand className="h-14 border-b border-sidebar-border px-4" />
        <nav className="flex-1 overflow-y-auto px-2 py-3" aria-label="Principal">
          <NavGroup title="Pessoal" items={personal} />
          {management.length > 0 && <NavGroup title="Gestão" items={management} className="mt-5" />}
        </nav>
        <div className="flex items-center gap-3 border-t border-sidebar-border p-3">
          <Initials value={user.initials} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{user.nick}</p>
            <p className="truncate text-xs text-muted-foreground">{roleLabel}</p>
          </div>
          <button onClick={onLogout} className="press rounded-md p-2 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground" aria-label="Sair">
            <LogOut className="size-4" />
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        {/* Barra de contexto: onde estou + saldo sempre à vista (âncora da carteira em qualquer tela). */}
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b bg-background/85 px-4 backdrop-blur-md md:px-6">
          <Brand className="md:hidden" />
          <p className="hidden min-w-0 items-center gap-2 text-sm md:flex">
            <span className="text-muted-foreground">{section}</span>
            <span className="text-muted-foreground">/</span>
            <span className="truncate font-medium">{current?.label ?? "Painel"}</span>
          </p>
          <div className="flex items-center gap-2">
            <NavLink
              to="/carteira"
              className="press flex h-8 items-center gap-2 rounded-full border bg-card px-3 text-sm hover:bg-accent"
              aria-label="Saldo disponível"
            >
              <Coins className="size-4 text-brand" aria-hidden />
              <Silver value={available} className="font-semibold" />
            </NavLink>
            <ThemeToggle />
            <button onClick={onLogout} className="press rounded-md p-2 text-muted-foreground hover:bg-accent md:hidden" aria-label="Sair">
              <LogOut className="size-4" />
            </button>
          </div>
        </header>

        {/* mobile: toda área de gestão acessível (barra inferior só cabe os itens pessoais) */}
        {management.length > 0 && (
          <nav aria-label="Gestão" className="flex gap-2 overflow-x-auto border-b px-4 py-2 [scrollbar-width:none] md:hidden">
            {management.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    "press flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-medium [&_svg]:size-3.5",
                    isActive ? "border-foreground bg-foreground text-background" : "text-muted-foreground",
                  )
                }
              >
                {item.icon}
                {item.label}
                {!!item.count && <span className="num">{item.count}</span>}
              </NavLink>
            ))}
          </nav>
        )}

        <main className="w-full max-w-7xl flex-1 px-4 pt-5 pb-28 md:px-6 md:pt-6 md:pb-12">
          <Outlet />
        </main>
      </div>

      <nav
        aria-label="Principal"
        className="fixed inset-x-0 bottom-0 z-20 flex border-t bg-background/90 backdrop-blur-md md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {personal.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              cn(
                "relative flex flex-1 flex-col items-center gap-1 py-2.5 text-xs [&_svg]:size-5",
                isActive ? "font-medium text-foreground" : "text-muted-foreground",
              )
            }
          >
            {item.icon}
            {item.label}
            {!!item.count && (
              <span className="num absolute top-1.5 left-1/2 ml-2 grid h-4 min-w-4 place-items-center rounded-full bg-foreground px-1 text-[0.625rem] leading-none font-semibold text-background">
                {item.count}
              </span>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

function Brand({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <span className="grid size-7 place-items-center rounded-md bg-foreground text-background">
        <Swords className="size-4" aria-hidden />
      </span>
      <span className="text-lg font-semibold tracking-tight whitespace-nowrap">albion-hub</span>
    </div>
  );
}

function NavGroup({ title, items, className }: { title: string; items: NavItem[]; className?: string }) {
  return (
    <div className={className}>
      <p className="px-2 pb-1 text-xs font-medium text-muted-foreground">{title}</p>
      <ul className="space-y-0.5">
        {items.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              className={({ isActive }) =>
                cn(
                  "flex h-9 items-center gap-2.5 rounded-md px-2 text-sm transition-colors duration-150 [&_svg]:size-4",
                  isActive
                    ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground [&_svg]:text-brand"
                    : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
                )
              }
            >
              {item.icon}
              <span className="flex-1">{item.label}</span>
              {!!item.count && (
                <span className="num grid h-5 min-w-5 place-items-center rounded-full bg-muted px-1.5 text-xs font-semibold text-foreground">
                  {item.count}
                </span>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Initials({ value }: { value: string }) {
  return (
    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground" aria-hidden>
      {value}
    </span>
  );
}
