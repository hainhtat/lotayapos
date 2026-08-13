import { NavLink, Outlet } from "react-router-dom";
import {
  BarChart3,
  Bell,
  ChevronRight,
  Layers,
  LayoutDashboard,
  LogOut,
  Moon,
  Package,
  Settings,
  Sun,
  WalletCards,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/app/auth";
import { useTheme } from "@/app/theme";

const links = [
  { to: "/", label: "home", icon: LayoutDashboard },
  { to: "/operations/batches", label: "allBatches", icon: Layers },
  { to: "/operations/dispatch", label: "dispatchQueue", icon: Package },
  { to: "/finance", label: "finance", icon: WalletCards },
  { to: "/reports", label: "reports", icon: BarChart3 },
];
const mobileLinks = [
  ...links,
  { to: "/settings", label: "settings", icon: Settings },
  { to: "/profile", label: "profile", icon: ChevronRight },
];
const navClass = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold ${isActive ? "bg-[#eaf6ff] text-[#0787df] dark:bg-[#133044]" : "text-slate-500 hover:bg-slate-50 dark:hover:bg-white/5"}`;

function MobileNav() {
  const { t } = useTranslation();
  return (
    <nav
      aria-label={t("mobileNavigation")}
      className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-7 border-t bg-white dark:border-white/10 dark:bg-[#181a1d] lg:hidden"
    >
      {mobileLinks.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          end={to === "/"}
          aria-label={t(label)}
          className={({ isActive }) => `grid min-h-14 place-items-center ${isActive ? "text-[#0787df]" : "text-slate-500"}`}
        >
          <Icon size={19} />
          <span className="sr-only">{t(label)}</span>
        </NavLink>
      ))}
    </nav>
  );
}

export function AppShell() {
  const { t, i18n } = useTranslation();
  const { user, logout } = useAuth();
  const { mode, toggle } = useTheme();
  const canSeeAlerts = ["SUPERADMIN", "OPERATIONS_MANAGER"].includes(user?.role ?? "");
  return (
    <div className="min-h-screen bg-[#f6f7f9] text-[#101318] dark:bg-[#111315] dark:text-white">
      <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col border-r border-black/5 bg-white px-5 py-6 dark:border-white/10 dark:bg-[#181a1d] lg:flex">
        <div className="flex items-center gap-3 px-2">
          <div className="grid h-10 w-10 place-items-center rounded-2xl bg-[#1598ef] text-xl font-bold text-white">✦</div>
          <span className="font-display text-2xl font-bold tracking-tight">LOTAYA</span>
        </div>
        <nav aria-label={t("primaryNavigation")} className="mt-12 flex flex-1 flex-col gap-2">
          {links.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} end={to === "/"} className={navClass}>
              <Icon size={19} />
              {t(label)}
            </NavLink>
          ))}
          <div className="mt-auto">
            <NavLink to="/settings" className={navClass}>
              <Settings size={19} />
              {t("settings")}
            </NavLink>
          </div>
        </nav>
        <div className="mt-5 flex items-center gap-3 border-t border-black/5 pt-5 dark:border-white/10">
          <NavLink to="/profile" className="min-w-0 flex-1 rounded-lg p-1 focus:outline-none focus:ring-2 focus:ring-[#1598ef]">
            <p className="truncate text-sm font-semibold">{user?.name}</p>
            <p className="text-xs text-slate-400">{user?.role.replaceAll("_", " ")}</p>
          </NavLink>
          <button onClick={() => void logout()} aria-label={t("logout")}>
            <LogOut size={16} className="text-slate-400" />
          </button>
        </div>
      </aside>
      <MobileNav />
      <main className="lg:pl-64">
        <header className="flex h-20 items-center justify-between border-b border-black/5 bg-white/80 px-6 backdrop-blur dark:border-white/10 dark:bg-[#181a1d]/80 lg:px-10">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[.18em] text-[#1598ef]">LOTAYA ERP</p>
            <p className="font-display text-lg font-bold">{t("today")}</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => void i18n.changeLanguage(i18n.language === "en" ? "my" : "en")}
              aria-label={t("language")}
              className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-500"
            >
              {i18n.language === "en" ? "မြန်မာ" : "English"}
            </button>
            <button
              onClick={toggle}
              aria-label={t("theme")}
              className="grid h-10 w-10 place-items-center rounded-xl bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-white"
            >
              {mode === "dark" ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            {canSeeAlerts && (
            <NavLink
              to="/operations/batches#alerts"
              aria-label={t("notifications")}
              className="grid h-10 w-10 place-items-center rounded-xl bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-white"
            >
              <Bell size={18} />
            </NavLink>
            )}
            <NavLink
              to="/profile"
              className="hidden items-center gap-2 border-l border-black/10 pl-4 dark:border-white/10 sm:flex"
            >
              <span className="text-sm font-semibold">{user?.name}</span>
              <ChevronRight size={15} />
            </NavLink>
          </div>
        </header>
        <div className="p-6 lg:p-10">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
