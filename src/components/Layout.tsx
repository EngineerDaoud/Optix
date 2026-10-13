import { BRAND, SANOMADS_URL } from "../lib/brand";
import { NavLink, Navigate, Outlet, useLocation } from "react-router-dom";
import {
  Activity,
  BarChart3,
  ChevronDown,
  Database,
  FileText,
  Globe,
  KanbanSquare,
  LayoutGrid,
  LogOut,
  Moon,
  Plug,
  Settings,
  ShieldCheck,
  Sun,
  Users,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../context/Auth";
import { useSite } from "../context/Site";
import { Spinner } from "./ui";
import Select from "./Select";

export const nav = [
  {
    to: "/dashboard",
    label: "Dashboard",
    desc: "Run a full website check",
    icon: BarChart3,
  },
  {
    to: "/traffic",
    label: "Traffic",
    desc: "Visits and organic trend",
    icon: Activity,
  },
  {
    to: "/competitors",
    label: "Competitor traffic",
    desc: "Compare with other sites",
    icon: Users,
  },
  { to: "/domains", label: "Domains", desc: "Your saved domains", icon: Globe },
  {
    to: "/keywords",
    label: "Keyword Lab",
    desc: "Research keywords",
    icon: Database,
  },
  {
    to: "/reports",
    label: "Reports",
    desc: "Saved SEO reports",
    icon: FileText,
  },
  {
    to: "/tasks",
    label: "Tasks",
    desc: "Your SEO to-do board",
    icon: KanbanSquare,
  },
  {
    to: "/integrations",
    label: "Integrations",
    desc: "Connect Google accounts",
    icon: Plug,
  },
  {
    to: "/settings",
    label: "Settings",
    desc: "Account and preferences",
    icon: Settings,
  },
];

const Logo = () => (
  <span className="flex items-center gap-1" aria-label={BRAND.name}>
    <span className="text-xl font-bold tracking-tight text-[#14112b] dark:text-white">
      {BRAND.name}
    </span>
  </span>
);

export default function Layout() {
  const { sites, current, select, loaded } = useSite();
  const { session, isAdmin } = useAuth();
  const { pathname } = useLocation();
  const [dark, setDark] = useState(
    document.documentElement.classList.contains("dark"),
  );
  const [menu, setMenu] = useState(false);
  const closeTimer = useRef<number>();
  const wrap = useRef<HTMLDivElement>(null);

  // the same website can be saved more than once; the switcher lists each address once
  const siteKey = (u: string) =>
    u.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "");
  const uniqueSites = useMemo(() => {
    const seen = new Map<string, (typeof sites)[number]>();
    for (const s of sites) if (!seen.has(siteKey(s.url))) seen.set(siteKey(s.url), s);
    return [...seen.values()];
  }, [sites]);
  const currentRep = current
    ? (uniqueSites.find((s) => siteKey(s.url) === siteKey(current.url)) ?? current)
    : null;

  // hover opens, leaving closes after a short delay (so the cursor can travel into the panel); tap/click also toggles for touch screens
  const openMenu = () => {
    window.clearTimeout(closeTimer.current);
    setMenu(true);
  };
  const closeMenu = () => {
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setMenu(false), 160);
  };

  useEffect(() => setMenu(false), [pathname]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    const onDown = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node))
        setMenu(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
      window.clearTimeout(closeTimer.current);
    };
  }, []);

  const toggleTheme = () => {
    const next = !dark;
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
    setDark(next);
  };

  if (!loaded)
    return (
      <div className="grid h-screen place-items-center">
        <Spinner className="h-6 w-6" />
      </div>
    );
  // Reports, Tasks and Integrations need a saved website. Until there is one, everything starts from the dashboard.
  if (
    !sites.length &&
    pathname !== "/dashboard" &&
    pathname !== "/settings" &&
    pathname !== "/domains" &&
    pathname !== "/keywords" &&
    pathname !== "/competitors"
  )
    return <Navigate to="/dashboard" replace />;

  const active =
    nav.find((n) => pathname === n.to || pathname.startsWith(n.to + "/")) ??
    nav[0];
  const initial = (session?.user?.email ?? "U").slice(0, 1).toUpperCase();

  return (
    <div className="min-h-screen">
      <header
        className="sticky top-0 z-40 border-b border-brand-100/80 bg-white/80 backdrop-blur-xl dark:border-slate-800 dark:bg-slate-900/95"
        style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
      >
        <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-2 px-3 sm:gap-3 sm:px-5">
          <NavLink to="/dashboard" className="shrink-0">
            <Logo />
          </NavLink>

          {/* the one menu button: hover (or tap) shows every page */}
          <div
            ref={wrap}
            className="relative"
            onMouseEnter={openMenu}
            onMouseLeave={closeMenu}
          >
            <button
              type="button"
              aria-haspopup="true"
              aria-expanded={menu}
              aria-controls="pages-menu"
              onClick={() => setMenu((v) => !v)}
              onFocus={openMenu}
              className={`flex h-9 items-center gap-2 rounded-full px-4 text-sm font-semibold transition ${menu ? "bg-brand-600 text-white shadow-md" : "bg-brand-50 text-brand-700 hover:bg-brand-100 dark:bg-brand-900/40 dark:text-brand-200"}`}
            >
              <LayoutGrid className="h-4 w-4" />
              <span className="max-w-[110px] truncate sm:max-w-none">
                {active.label}
              </span>
              <ChevronDown
                className={`h-4 w-4 transition-transform ${menu ? "rotate-180" : ""}`}
              />
            </button>

            {menu && (
              <div
                id="pages-menu"
                role="menu"
                className="menu-in fixed inset-x-2 top-[calc(3.5rem+env(safe-area-inset-top,0px))] z-50 lg:absolute lg:inset-x-auto lg:left-0 lg:top-full lg:w-[560px]"
              >
                {/* invisible bridge so the dropdown does not close while the cursor moves down */}
                <div className="hidden h-5 lg:block" />
                <div className="max-h-[calc(100vh-5rem)] overflow-auto rounded-2xl border border-brand-100 bg-white p-2.5 shadow-pop ring-1 ring-black/5 dark:border-slate-700 dark:bg-slate-900">
                  <div className="flex items-center justify-between px-3 pb-1 pt-2 text-xs font-medium text-slate-400 lg:hidden">
                    Pages{" "}
                    <button
                      aria-label="Close menu"
                      onClick={() => setMenu(false)}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="grid gap-1 sm:grid-cols-2">
                    {nav.map(({ to, label, desc, icon: Icon }) => (
                      <NavLink
                        key={to}
                        to={to}
                        role="menuitem"
                        className={({ isActive }) =>
                          `flex items-center gap-3 rounded-xl px-3 py-2.5 transition ${isActive ? "bg-gradient-to-r from-brand-600 to-brand-500 text-white shadow" : "hover:bg-brand-50 dark:hover:bg-slate-800"}`
                        }
                      >
                        {({ isActive }) => (
                          <>
                            <span
                              className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${isActive ? "bg-white/20" : "bg-brand-50 text-brand-600 dark:bg-slate-800 dark:text-brand-300"}`}
                            >
                              <Icon className="h-[18px] w-[18px]" />
                            </span>
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-medium">
                                {label}
                              </span>
                              <span
                                className={`block truncate text-xs ${isActive ? "text-white/80" : "text-slate-500 dark:text-slate-400"}`}
                              >
                                {desc}
                              </span>
                            </span>
                          </>
                        )}
                      </NavLink>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="ml-auto flex min-w-0 items-center gap-1.5 sm:gap-2">
            {sites.length > 0 && (
              <Select
                aria-label="Website"
                icon={
                  <Globe
                    className="h-4 w-4 shrink-0 text-brand-600 dark:text-brand-300"
                    aria-hidden="true"
                  />
                }
                panelWidth={280}
                searchable={uniqueSites.length > 8}
                className="h-9 w-full min-w-0 max-w-[160px] cursor-pointer rounded-full border border-brand-100 bg-brand-50/70 px-3 text-sm font-medium text-slate-700 outline-none transition hover:bg-brand-100 focus:border-brand-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 sm:max-w-[260px]"
                value={currentRep?.id}
                onChange={(e) => select(e.target.value)}
              >
                {uniqueSites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {(s.name || s.url).replace(/^https?:\/\//, "")}
                  </option>
                ))}
              </Select>
            )}
            {isAdmin && (
              <NavLink
                to="/admin"
                title="Admin: see who used the app and what they ran"
                className={({ isActive }) =>
                  `flex h-9 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-sm font-semibold transition sm:px-3.5 ${isActive ? "bg-brand-600 text-white shadow-md" : "bg-brand-50 text-brand-700 hover:bg-brand-100 dark:bg-brand-900/40 dark:text-brand-200"}`
                }
              >
                <ShieldCheck className="h-4 w-4" />
                <span className="hidden sm:inline">Admin</span>
              </NavLink>
            )}
            <button
              onClick={toggleTheme}
              aria-label="Toggle dark mode"
              title={dark ? "Light mode" : "Dark mode"}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-slate-500 transition hover:bg-brand-50 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              {dark ? (
                <Sun className="h-[18px] w-[18px]" />
              ) : (
                <Moon className="h-[18px] w-[18px]" />
              )}
            </button>
            <button
              onClick={() => supabase.auth.signOut()}
              aria-label="Sign out"
              title="Sign out"
              className="flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-2.5 text-sm font-medium text-red-600 transition hover:bg-red-100 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-950/70 sm:px-3.5"
            >
              
              <span className="hidden sm:inline">Sign out</span>
            </button>
            <span
              title={session?.user?.email ?? ""}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-sm font-medium text-white shadow"
            >
              {initial}
            </span>
          </div>
        </div>
      </header>

      <main
        className="mx-auto w-full max-w-[1600px] px-3 py-4 sm:px-5 sm:py-6"
        style={{
          paddingBottom: "max(1.5rem, env(safe-area-inset-bottom, 0px))",
        }}
      >
        <Outlet />
      </main>

      <footer
        className="mx-auto w-full max-w-[1600px] px-3 sm:px-5"
        style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom, 0px))" }}
      >
        <div className="mt-2 flex flex-col items-center justify-between gap-3 rounded-2xl border border-brand-100/80 bg-white/70 px-4 py-3 text-xs text-slate-500 backdrop-blur dark:border-slate-800 dark:bg-slate-900/70 dark:text-slate-400 sm:flex-row">
          <span className="flex items-center gap-2">
            <b className="font-semibold text-slate-700 dark:text-slate-200">
              {BRAND.name}
            </b>
            <span className="hidden sm:inline">· {BRAND.tagline}</span>
          </span>
          <nav aria-label="Footer" className="flex items-center gap-4">
            {[
              ["/dashboard", "Dashboard"],
              ["/reports", "Reports"],
              ["/settings", "Settings"],
            ].map(([to, label]) => (
              <NavLink key={to} to={to} className="transition hover:text-brand-600">
                {label}
              </NavLink>
            ))}
          </nav>
          <span>
            © {new Date().getFullYear()} {BRAND.name} · Powered by{" "}
            <a
              href={SANOMADS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold transition hover:text-brand-600"
            >
              Sanomads
            </a>
          </span>
        </div>
      </footer>
    </div>
  );
}