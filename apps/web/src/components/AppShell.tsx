import { NavLink, Outlet } from "react-router";
import { CalendarRange, Coins, HandCoins, LogOut, ScrollText, Users, Vault } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/format";
import { canManageWithdrawals, isStaffArea, useStore, useUser } from "@/mock/store";

const roleLabel = { member: "Membro", caller: "Caller", staff: "Staff", admin: "Admin" } as const;

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
}

export function AppShell() {
  const user = useUser();
  const { logout } = useStore();

  const personal: NavItem[] = [
    { to: "/carteira", label: "Carteira", icon: <Coins className="size-4" /> },
    { to: "/saques", label: "Meus saques", icon: <HandCoins className="size-4" /> },
  ];
  const management: NavItem[] = [
    ...(canManageWithdrawals(user.role) ? [{ to: "/staff/saques", label: "Fila de saques", icon: <Vault className="size-4" /> }] : []),
    { to: "/staff/eventos", label: "Eventos", icon: <CalendarRange className="size-4" /> },
    { to: "/staff/membros", label: "Membros", icon: <Users className="size-4" /> },
    { to: "/staff/splits", label: "Loot splits", icon: <ScrollText className="size-4" /> },
  ];

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[15rem_1fr]">
      <aside className="hidden border-r border-rule bg-stone md:sticky md:top-0 md:flex md:h-dvh md:flex-col">
        <div className="px-6 pt-7 pb-8">
          <span className="font-display text-xl font-semibold text-parchment">albion-hub</span>
        </div>
        <nav className="flex-1 px-3" aria-label="Principal">
          <NavGroup items={personal} />
          {isStaffArea(user.role) && (
            <>
              <p className="mt-8 mb-2 px-3 text-xs text-faint">Gestão</p>
              <NavGroup items={management} />
            </>
          )}
        </nav>
        <div className="flex items-center gap-3 border-t border-rule px-4 py-4">
          <Avatar initials={user.initials} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{user.nick}</p>
            <p className="truncate text-xs text-muted">{roleLabel[user.role]}</p>
          </div>
          <button onClick={logout} className="press rounded-md p-2 text-muted hover:text-parchment" aria-label="Sair">
            <LogOut className="size-4" />
          </button>
        </div>
      </aside>

      {/* mobile: topo compacto + barra inferior */}
      <header className="flex items-center justify-between border-b border-rule bg-stone px-4 py-3 md:hidden">
        <span className="font-display text-lg font-semibold">albion-hub</span>
        <div className="flex items-center gap-2">
          <Avatar initials={user.initials} />
          <button onClick={logout} className="press rounded-md p-2 text-muted" aria-label="Sair">
            <LogOut className="size-4" />
          </button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl px-4 pt-8 pb-28 md:px-10 md:pt-12 md:pb-16">
        <Outlet />
      </main>

      <nav
        aria-label="Principal"
        className="fixed inset-x-0 bottom-0 z-10 flex border-t border-rule bg-stone/95 backdrop-blur md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {[...personal, ...(isStaffArea(user.role) ? management.slice(0, 2) : [])].map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              cn("flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px]", isActive ? "text-brass" : "text-muted")
            }
          >
            {item.icon}
            {item.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

function NavGroup({ items }: { items: NavItem[] }) {
  return (
    <ul className="space-y-0.5">
      {items.map((item) => (
        <li key={item.to}>
          <NavLink
            to={item.to}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors duration-150",
                isActive ? "bg-stone-raised text-parchment shadow-[inset_2px_0_0_var(--color-brass)]" : "text-muted hover:text-parchment",
              )
            }
          >
            {item.icon}
            {item.label}
          </NavLink>
        </li>
      ))}
    </ul>
  );
}

function Avatar({ initials }: { initials: string }) {
  return (
    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-rule text-xs font-semibold text-silver">
      {initials}
    </span>
  );
}
