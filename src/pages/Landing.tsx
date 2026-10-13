import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  BarChart3,
  Briefcase,
  Check,
  ChevronDown,
  FileText,
  Megaphone,
  Menu,
  Plug,
  Search,
  Sparkles,
  Store,
  X,
} from "lucide-react";
import { BRAND, SANOMADS_URL } from "../lib/brand";

/* ------------------------------------------------------------------ */
/* Theme + content                                                     */
/* ------------------------------------------------------------------ */

const BTN_PRIMARY =
  "inline-flex items-center justify-center gap-2 rounded-full bg-[#6c47ff] px-6 py-3 text-sm font-semibold text-white shadow-[0_8px_20px_-6px_rgba(108,71,255,0.6)] transition hover:bg-[#5b38ee]";
const BTN_LIGHT =
  "inline-flex items-center justify-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-semibold text-[#14112b] ring-1 ring-black/10 transition hover:bg-slate-50";
const BTN_DARK =
  "inline-flex items-center justify-center gap-2 rounded-full bg-[#14112b] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-black";

const navLinks = [
  { href: "#home", label: "Home" },
  { href: "#features", label: "Features" },
  { href: "#why", label: "Why choose us" },
  { href: "#how-it-works", label: "How it works" },
  { href: "#faq", label: "FAQ" },
];


const audiences = [
  { icon: Store, title: "Store owners", text: "Find out why your shop is not getting found and fix the biggest problems first, no SEO background needed." },
  { icon: Briefcase, title: "Agencies & freelancers", text: "Track many client sites and send clean, scheduled PDF reports every week or month." },
  { icon: Megaphone, title: "Marketers & bloggers", text: "Find keywords you can actually win, then watch rankings and traffic move." },
];

const faqs = [
  { q: `What is ${BRAND.name}?`, a: `${BRAND.name} is a website SEO tool. It audits your site's speed and SEO, researches keywords, tracks traffic and rankings, compares competitors and creates PDF reports.` },
  { q: "Do I need technical skills?", a: "No. Paste your website address and the dashboard shows what to fix first in plain language." },
  { q: "Can I connect Google Search Console and Analytics?", a: "Yes. Connect your Google account to bring in real search, traffic and ranking data next to the audit results." },
  { q: "Which reports can I get?", a: "You can save SEO reports as PDF and schedule them daily, weekly, every 15 days or monthly." },
  { q: "Are the keyword and traffic numbers exact?", a: "Rankings come from real Google results. Search volume and visit numbers are estimates and are labelled as estimates in the app." },
];

const faqJsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "FAQPage",
      mainEntity: faqs.map((f) => ({
        "@type": "Question",
        name: f.q,
        acceptedAnswer: { "@type": "Answer", text: f.a },
      })),
    },
  ],
};

/* ------------------------------------------------------------------ */
/* Small visual pieces                                                 */
/* ------------------------------------------------------------------ */

function Logo({ light = false }: { light?: boolean }) {
  return (
    <Link
      to="/"
      aria-label={`${BRAND.name} home`}
      className={`flex items-center gap-2 text-lg font-bold tracking-tight ${light ? "text-white" : "text-[#14112b]"}`}
    >
      <img src="/logo.png" alt="" aria-hidden="true" className="h-8 w-8 object-contain" />
      {BRAND.name}
    </Link>
  );
}

const LINE_YOU = "M0,130 C40,125 70,110 110,100 C150,90 180,95 220,70 C260,45 300,50 340,28 C365,15 385,12 400,8";
const LINE_COMP = "M0,120 C50,118 90,112 130,108 C170,104 210,100 250,92 C290,84 330,80 400,70";

function TrafficChart({ id, compare = false }: { id: string; compare?: boolean }) {
  return (
    <svg viewBox="0 0 400 160" preserveAspectRatio="none" className="h-full w-full" role="img" aria-label="Traffic trend chart (illustration)">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#6c47ff" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#6c47ff" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[30, 70, 110].map((y) => (
        <line key={y} x1="0" x2="400" y1={y} y2={y} stroke="#ece9f7" strokeDasharray="4 4" />
      ))}
      <path d={`${LINE_YOU} L400,160 L0,160 Z`} fill={`url(#${id})`} />
      {compare && <path d={LINE_COMP} fill="none" stroke="#f59e0b" strokeWidth="3" strokeLinecap="round" vectorEffect="non-scaling-stroke" />}
      <path d={LINE_YOU} fill="none" stroke="#6c47ff" strokeWidth="3" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

type Tone = "green" | "amber" | "purple" | "red";
function Chip({ children, tone = "green" }: { children: React.ReactNode; tone?: Tone }) {
  const t: Record<Tone, string> = {
    green: "bg-green-50 text-green-700",
    amber: "bg-amber-50 text-amber-700",
    purple: "bg-[#efeaff] text-[#5b38ee]",
    red: "bg-red-50 text-red-700",
  };
  return <span className={`inline-flex whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-semibold ${t[tone]}`}>{children}</span>;
}

function RolePill({ label, dot, className }: { label: string; dot: string; className: string }) {
  return (
    <span className={`absolute z-10 items-center gap-1.5 rounded-full bg-white px-3 py-1 text-[11px] font-medium text-slate-700 shadow-md ring-1 ring-black/5 ${className}`}>
      <span className={`h-2 w-2 rounded-full ${dot}`} />
      {label}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Hero dashboard (cropped at the bottom, like the reference)          */
/* ------------------------------------------------------------------ */

function HeroDashboard() {
  const kpis = [
    ["Organic traffic", "24,860", "+18%"],
    ["Keywords", "1,284", "+96"],
    ["SEO score", "86", "+4"],
    ["Backlinks", "3.4k", "+212"],
  ];
  const fixes: [string, string, Tone][] = [
    ["Compress large images", "High", "red"],
    ["Add 6 meta descriptions", "Medium", "amber"],
    ["Fix 2 broken links", "Medium", "amber"],
    ["Improve mobile speed", "High", "red"],
  ];
  return (
    <div className="relative mx-auto mt-14 w-full max-w-4xl px-2 md:px-0">
      <RolePill label="SEO Analyst" dot="bg-sky-500" className="-top-4 left-[4%] hidden md:flex" />
      <RolePill label="Marketer" dot="bg-fuchsia-500" className="-top-4 right-[4%] hidden md:flex" />
      <RolePill label="Store Owner" dot="bg-amber-500" className="left-[-4%] top-[42%] hidden lg:flex" />
      <RolePill label="Agency" dot="bg-green-500" className="right-[-4%] top-[42%] hidden lg:flex" />

      <div className="overflow-hidden rounded-t-2xl border border-white bg-white shadow-[0_30px_80px_-20px_rgba(76,45,200,0.4)]">
        {/* app top bar */}
        <div className="flex items-center justify-between gap-4 border-b border-slate-100 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-bold text-[#14112b]">
            <img src="/logo.png" alt="" aria-hidden="true" className="h-6 w-6 object-contain" />
            {BRAND.name}
          </div>
          <div className="hidden gap-5 text-[11px] text-slate-500 sm:flex" aria-hidden="true">
            <span className="border-b-2 border-[#6c47ff] pb-0.5 font-semibold text-[#14112b]">Dashboard</span>
            <span>Traffic</span>
            <span>Competitors</span>
            <span>Keyword Lab</span>
            <span>Reports</span>
          </div>
          <div className="h-6 w-6 rounded-full bg-gradient-to-br from-[#6c47ff] to-fuchsia-400" aria-hidden="true" />
        </div>

        <div className="h-[330px] overflow-hidden bg-[#fafaff] p-4 text-left sm:h-[360px]">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-bold text-[#14112b]">Website overview</p>
              <p className="text-[11px] text-slate-500">example.com · Last 30 days</p>
            </div>
            <span className="rounded-md bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 ring-1 ring-slate-200">Sample data</span>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
            {kpis.map(([l, n, d]) => (
              <div key={l} className="rounded-xl bg-white p-3 ring-1 ring-slate-100">
                <p className="text-[11px] text-slate-500">{l}</p>
                <div className="mt-1 flex items-end justify-between">
                  <span className="num text-xl font-medium text-[#14112b]">{n}</span>
                  <Chip>{d}</Chip>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <div className="rounded-xl bg-white p-3 ring-1 ring-slate-100 md:col-span-2">
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-semibold text-[#14112b]">Organic traffic vs competitor</span>
                <span className="flex items-center gap-3 text-slate-500">
                  <span className="flex items-center gap-1"><i className="h-1.5 w-1.5 rounded-full bg-[#6c47ff]" /> You</span>
                  <span className="flex items-center gap-1"><i className="h-1.5 w-1.5 rounded-full bg-amber-500" /> Rival</span>
                </span>
              </div>
              <div className="mt-2 h-28"><TrafficChart id="gHero" compare /></div>
            </div>
            <div className="rounded-xl bg-white p-3 ring-1 ring-slate-100">
              <p className="text-[11px] font-semibold text-[#14112b]">Top fixes</p>
              <ul className="mt-2 space-y-2">
                {fixes.map(([t, s, tone]) => (
                  <li key={t} className="flex items-center justify-between gap-2 text-[11px] text-slate-600">
                    <span className="truncate">{t}</span>
                    <Chip tone={tone}>{s}</Chip>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Bento feature cards                                                 */
/* ------------------------------------------------------------------ */

function Bento({ title, text, children, className = "", grad = false }: { title: string; text: string; children: React.ReactNode; className?: string; grad?: boolean }) {
  return (
    <div className={`flex flex-col overflow-hidden rounded-2xl p-5 ${grad ? "bg-gradient-to-b from-[#f4f1ff] to-[#e4dcff]" : "bg-[#f4f4f8]"} ${className}`}>
      <h3 className="text-base font-semibold text-[#14112b]">{title}</h3>
      <p className="mt-1.5 text-xs leading-relaxed text-slate-500">{text}</p>
      <div className="mt-5 flex-1">{children}</div>
    </div>
  );
}

function FeaturesBento() {
  return (
    <div className="mt-12 grid gap-4 lg:grid-cols-3">
      {/* Audit */}
      <Bento title="Speed & SEO audit" text="Crawl your pages, measure mobile and desktop speed and see what to fix first.">
        <div className="rounded-xl bg-white p-4 shadow-sm">
          <p className="text-[11px] text-slate-500">Pages crawled</p>
          <p className="num text-2xl font-medium text-[#14112b]">105 pages</p>
          <div className="mt-3 flex h-2 overflow-hidden rounded-full" aria-hidden="true">
            <i className="bg-green-500" style={{ width: "65%" }} />
            <i className="bg-amber-400" style={{ width: "23%" }} />
            <i className="bg-red-400" style={{ width: "12%" }} />
          </div>
          <ul className="mt-3 space-y-1.5 text-[11px] text-slate-600">
            {[["bg-green-500", "Passed", "68"], ["bg-amber-400", "Warnings", "24"], ["bg-red-400", "Errors", "13"]].map(([c, l, n]) => (
              <li key={l} className="flex items-center justify-between">
                <span className="flex items-center gap-2"><i className={`h-2 w-2 rounded-full ${c}`} />{l}</span>
                <span className="font-medium">{n} pages</span>
              </li>
            ))}
          </ul>
        </div>
      </Bento>

      {/* Keywords */}
      <Bento title="Keyword Lab" text="Estimated searches, difficulty, intent and an opportunity tag for every keyword.">
        <div className="space-y-2.5 rounded-xl bg-white p-4 shadow-sm">
          {([
            ["best running shoes", 62, "Push up", "purple"],
            ["trail shoes beginners", 28, "Quick win", "green"],
            ["how to clean sneakers", 35, "New content", "amber"],
          ] as [string, number, string, Tone][]).map(([k, d, a, tone]) => (
            <div key={k} className="rounded-lg border border-slate-100 p-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[11px] font-semibold text-[#14112b]">{k}</span>
                <Chip tone={tone}>{a}</Chip>
              </div>
              <div className="mt-2 flex items-center gap-2 text-[10px] text-slate-500">
                Difficulty
                <div className="h-1.5 flex-1 rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-[#6c47ff]" style={{ width: `${d}%` }} />
                </div>
                {d}
              </div>
            </div>
          ))}
        </div>
      </Bento>

      {/* Tasks + reports (tall) */}
      <Bento title="AI insights, tasks & reports" text="Turn findings into a to-do list and send a PDF report on a schedule." grad className="lg:row-span-2">
        <div className="rounded-xl bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold text-[#14112b]">This week&apos;s tasks</p>
          <ul className="mt-3 space-y-3">
            {[["Compress hero image", true], ["Add meta descriptions", true], ["Fix 2 broken links", false], ["Write 'trail shoes' guide", false], ["Improve mobile speed", false]].map(([t, done]) => (
              <li key={t as string} className="flex items-center gap-2.5 text-[11px] text-slate-600">
                <span className={`grid h-4 w-4 place-items-center rounded-full ${done ? "bg-[#6c47ff] text-white" : "ring-1 ring-slate-300"}`}>
                  {done && <Check className="h-2.5 w-2.5" aria-hidden="true" />}
                </span>
                <span className={done ? "text-slate-400 line-through" : ""}>{t}</span>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex flex-wrap gap-1.5 border-t border-slate-100 pt-3">
            {["Daily", "Weekly", "15 days", "Monthly"].map((s, i) => (
              <span key={s} className={`rounded-full px-2.5 py-1 text-[10px] font-medium ${i === 1 ? "bg-[#6c47ff] text-white" : "bg-slate-100 text-slate-600"}`}>{s}</span>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2 rounded-lg bg-[#f4f1ff] px-3 py-2 text-[11px] font-medium text-[#5b38ee]">
            <FileText className="h-4 w-4" aria-hidden="true" /> weekly-seo-report.pdf
          </div>
        </div>
      </Bento>

      {/* Traffic wide */}
      <Bento title="Traffic & rankings tracking" text="Follow visits, organic trend and Google positions, and see which keywords moved." className="lg:col-span-2">
        <div className="grid gap-3 rounded-xl bg-white p-4 shadow-sm sm:grid-cols-5">
          <div className="sm:col-span-3">
            <p className="text-[11px] text-slate-500">Organic visits</p>
            <p className="num text-xl font-medium text-[#14112b]">24,860</p>
            <div className="mt-2 h-24"><TrafficChart id="gBento" /></div>
          </div>
          <ul className="space-y-2 sm:col-span-2">
            <li className="text-[11px] font-semibold text-[#14112b]">Top movers</li>
            {[["running shoes", "14 → 6"], ["trail shoes", "22 → 11"], ["sneaker care", "31 → 18"]].map(([k, p]) => (
              <li key={k} className="flex items-center justify-between rounded-lg border border-slate-100 px-2.5 py-2 text-[11px]">
                <span className="text-slate-600">{k}</span>
                <span className="font-semibold text-green-600">▲ {p}</span>
              </li>
            ))}
          </ul>
        </div>
      </Bento>
    </div>
  );
}


/* ------------------------------------------------------------------ */
/* "Why choose us" cards, each with a small visual                     */
/* ------------------------------------------------------------------ */

function StatCard({ n, text, grad, children }: { n: string; text: string; grad: boolean; children: React.ReactNode }) {
  return (
    <li className={`group flex min-h-[320px] flex-col rounded-2xl border p-5 transition hover:-translate-y-1 hover:shadow-pop ${grad ? "border-[#e6e0fb] bg-gradient-to-b from-[#e9e2ff] via-[#f6f3ff] to-white" : "border-slate-200 bg-[#f4f4f8]"}`}>
      <div className="flex items-start justify-between">
        <span className="num text-5xl font-medium leading-none text-[#14112b]">{n}</span>
        <span className="grid h-6 w-6 place-items-center rounded-full bg-[#6c47ff] shadow-[0_4px_10px_-2px_rgba(108,71,255,0.6)]">
          <i className="h-2 w-2 rounded-full bg-white" />
        </span>
      </div>
      <div className="my-5 flex flex-1 items-center" aria-hidden="true">
        <div className="w-full">{children}</div>
      </div>
      <p className="text-sm leading-relaxed text-slate-600">{text}</p>
    </li>
  );
}

function StatCards() {
  const box = "rounded-xl bg-white p-3 shadow-sm ring-1 ring-[#e6e0fb]";
  return (
    <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard n="1 min" grad text="To your first speed and SEO check after adding a site.">
        <div className={box}>
          <ul className="space-y-2 text-[11px] text-slate-600">
            {["Adding your website", "Crawling your pages", "Testing speed", "Checking SEO basics"].map((t) => (
              <li key={t} className="flex items-center gap-2">
                <span className="grid h-4 w-4 place-items-center rounded-full bg-green-500 text-white"><Check className="h-2.5 w-2.5" /></span>
                {t}
              </li>
            ))}
          </ul>
          <div className="mt-3 h-1.5 rounded-full bg-slate-100">
            <div className="h-full w-full rounded-full bg-gradient-to-r from-[#6c47ff] to-[#a08bff]" />
          </div>
        </div>
      </StatCard>

      <StatCard n="6" grad={false} text="Google markets checked for keyword positions in worldwide mode.">
        <div className="grid grid-cols-3 gap-2">
          {["Home", "+1", "+2", "+3", "+4", "+5"].map((l, i) => (
            <span key={l} className={`grid h-12 place-items-center rounded-xl text-[11px] font-semibold ${i === 0 ? "bg-[#6c47ff] text-white shadow-md" : "bg-white text-[#5b38ee] ring-1 ring-[#e6e0fb]"}`}>
              {l}
            </span>
          ))}
        </div>
      </StatCard>

      <StatCard n="4" grad text="Report schedules: daily, weekly, every 15 days or monthly.">
        <div className={`${box} space-y-2`}>
          {["Daily", "Weekly", "Every 15 days", "Monthly"].map((l, i) => (
            <div key={l} className="flex items-center justify-between text-[11px] text-slate-600">
              <span className="flex items-center gap-2"><FileText className="h-3.5 w-3.5 text-[#6c47ff]" />{l}</span>
              <span className={`relative h-4 w-7 rounded-full ${i === 1 ? "bg-[#6c47ff]" : "bg-slate-200"}`}>
                <i className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow ${i === 1 ? "right-0.5" : "left-0.5"}`} />
              </span>
            </div>
          ))}
        </div>
      </StatCard>

      <StatCard n="2" grad={false} text="Google tools you can connect: Search Console and Analytics 4.">
        <div className="space-y-2.5">
          {[[Search, "Search Console"], [BarChart3, "Analytics 4"]].map(([Icon, l]) => {
            const I = Icon as typeof Search;
            return (
              <div key={l as string} className={`${box} flex items-center gap-3`}>
                <span className="grid h-9 w-9 place-items-center rounded-lg bg-[#efeaff] text-[#6c47ff]"><I className="h-4 w-4" /></span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-[#14112b]">{l as string}</p>
                  <p className="text-[10px] text-slate-500">One-click connect</p>
                </div>
                <Chip tone="green">Ready</Chip>
              </div>
            );
          })}
        </div>
      </StatCard>
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/* CTA form                                                            */
/* ------------------------------------------------------------------ */

function SiteForm({ id }: { id: string }) {
  const nav = useNavigate();
  const [url, setUrl] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    try {
      sessionStorage.setItem("rv_site", url.trim());
    } catch {
      /* storage can be blocked, ignore */
    }
    nav("/login?mode=signup");
  };
  return (
    <form onSubmit={submit} className="flex w-full max-w-xl flex-col gap-2 rounded-3xl bg-white/15 p-2 ring-1 ring-white/30 sm:flex-row sm:rounded-full">
      <label htmlFor={id} className="sr-only">Website address</label>
      <div className="flex flex-1 items-center gap-2 px-4">
        <Search className="h-4 w-4 shrink-0 text-white/70" aria-hidden="true" />
        <input
          id={id}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          required
          placeholder="Enter your website, e.g. yourstore.com"
          className="w-full bg-transparent py-3 text-sm text-white outline-none placeholder:text-white/60"
        />
      </div>
      <button className="inline-flex items-center justify-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-semibold text-[#5b38ee] transition hover:bg-slate-100">
        Check my website <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </button>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function Landing() {
  const [open, setOpen] = useState(false);

  // The landing page is always light. Restore dark mode when leaving.
  useEffect(() => {
    const root = document.documentElement;
    const wasDark = root.classList.contains("dark");
    root.classList.remove("dark");
    const prev = root.style.scrollBehavior;
    root.style.scrollBehavior = "smooth";
    return () => {
      root.style.scrollBehavior = prev;
      if (wasDark) root.classList.add("dark");
    };
  }, []);

  const steps = [
    { title: "Simple and fast setup", text: "Create your account and paste your website address." },
    { title: "Get your checks", text: "We crawl pages, test speed and review SEO basics in about a minute." },
    { title: "Fix and track progress", text: "Work through the task list and watch traffic and rankings improve." },
  ];

  return (
    <div className="min-h-screen bg-white text-slate-700">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />

      {/* ============ Hero panel ============ */}
      <div className="p-2 sm:p-4">
        <section
          id="home"
          aria-labelledby="hero-title"
          className="relative overflow-hidden rounded-3xl"
          style={{ background: "radial-gradient(70% 45% at 50% 0%, #ffffff 0%, rgba(255,255,255,0) 70%), linear-gradient(180deg,#cdbfff 0%, #e3dbff 50%, #f3efff 100%)" }}
        >
          {/* clouds */}
          <div aria-hidden="true" className="pointer-events-none absolute -left-16 top-[42%] h-44 w-80 rounded-full bg-white/90 blur-2xl" />
          <div aria-hidden="true" className="pointer-events-none absolute -right-16 top-[36%] h-48 w-96 rounded-full bg-white/90 blur-2xl" />
          <div aria-hidden="true" className="pointer-events-none absolute left-1/3 top-[55%] h-32 w-72 rounded-full bg-white/70 blur-2xl" />

          {/* nav */}
          <header className="relative z-20">
            <div className="mx-auto flex h-20 max-w-6xl items-center justify-between px-5">
              <Logo />
              <nav aria-label="Main" className="hidden items-center gap-8 lg:flex">
                {navLinks.map((l, i) => (
                  <a key={l.href} href={l.href} className={`text-sm transition hover:text-[#6c47ff] ${i === 0 ? "font-semibold text-[#14112b]" : "text-slate-600"}`}>{l.label}</a>
                ))}
              </nav>
              <div className="hidden items-center gap-4 lg:flex">
                <Link to="/login" className="text-sm font-medium text-[#14112b] hover:text-[#6c47ff]">Log in</Link>
                <Link to="/login?mode=signup" className={BTN_DARK}>Sign up free</Link>
              </div>
              <button
                type="button"
                className="grid h-10 w-10 place-items-center rounded-full bg-white/80 ring-1 ring-black/10 lg:hidden"
                aria-label={open ? "Close menu" : "Open menu"}
                aria-expanded={open}
                aria-controls="mobile-menu"
                onClick={() => setOpen((o) => !o)}
              >
                {open ? <X className="h-5 w-5" aria-hidden="true" /> : <Menu className="h-5 w-5" aria-hidden="true" />}
              </button>
            </div>
            {open && (
              <div id="mobile-menu" className="menu-in mx-4 rounded-2xl bg-white p-4 shadow-pop lg:hidden">
                <nav aria-label="Mobile" className="flex flex-col">
                  {navLinks.map((l) => (
                    <a key={l.href} href={l.href} onClick={() => setOpen(false)} className="py-2.5 text-sm font-medium">{l.label}</a>
                  ))}
                </nav>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <Link to="/login" className={BTN_LIGHT}>Log in</Link>
                  <Link to="/login?mode=signup" className={BTN_PRIMARY}>Sign up</Link>
                </div>
              </div>
            )}
          </header>

          {/* headline */}
          <div className="relative z-10 mx-auto max-w-3xl px-5 pt-10 text-center md:pt-14">
            <h1 id="hero-title" className="text-4xl font-semibold leading-[1.12] tracking-tight text-[#14112b] md:text-6xl">
              Simplify SEO.<br />Boost your search traffic.
            </h1>
            <p className="mx-auto mt-5 max-w-xl text-sm text-slate-600 md:text-base">
              {BRAND.name} audits your site, researches keywords, tracks rankings and traffic, and sends clear PDF reports, from start to finish.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link to="/login?mode=signup" className={BTN_PRIMARY}>Get started free</Link>
              <a href="#how-it-works" className={BTN_LIGHT}>See how it works</a>
            </div>
          </div>

          <HeroDashboard />
        </section>
      </div>

      <main>
        {/* ============ Works with ============ */}
        <section aria-label="Data sources" className="mx-auto max-w-6xl px-5 py-12">
          <div className="flex flex-col items-center gap-6 md:flex-row">
            <p className="max-w-[180px] text-center text-xs text-slate-500 md:border-r md:border-slate-200 md:pr-6 md:text-left">
              Connects with the Google tools you already use.
            </p>
            <ul className="grid flex-1 grid-cols-1 gap-3 sm:grid-cols-3">
              {["Google Search Console", "Google Analytics 4", "PageSpeed Insights"].map((n) => (
                <li key={n} className="flex items-center justify-center gap-2 rounded-full border border-[#d9d0ff] bg-[#faf8ff] px-4 py-3 text-sm font-semibold text-[#5b38ee]">
                  <Plug className="h-4 w-4" aria-hidden="true" /> {n}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ============ Features ============ */}
        <section id="features" aria-labelledby="features-title" className="mx-auto max-w-6xl scroll-mt-6 px-5 py-14 md:py-20">
          <div className="mx-auto max-w-2xl text-center">
            <h2 id="features-title" className="text-3xl font-semibold tracking-tight text-[#14112b] md:text-4xl">
              Unlock powerful SEO tools,<br />all in one place.
            </h2>
            <p className="mt-3 text-sm text-slate-500">Audit, keywords, traffic, competitors and reports. Screens below show sample data.</p>
          </div>
          <FeaturesBento />
        </section>

        {/* ============ Why ============ */}
        <section id="why" aria-labelledby="why-title" className="mx-auto max-w-6xl scroll-mt-6 px-5 py-14 md:py-20">
          <div className="mx-auto max-w-2xl text-center">
            <h2 id="why-title" className="text-3xl font-semibold tracking-tight text-[#14112b] md:text-4xl">Why people choose {BRAND.name}</h2>
            <p className="mt-3 text-sm text-slate-500">Made to save you time and show you what to do next.</p>
          </div>
          <StatCards />
          <div className="mt-10 text-center">
            <Link to="/login?mode=signup" className={BTN_PRIMARY}>
              Try it free <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        </section>

        {/* ============ Steps ============ */}
        <section id="how-it-works" aria-labelledby="how-title" className="mx-auto max-w-6xl scroll-mt-6 px-5 py-14 md:py-20">
          <div className="mx-auto max-w-2xl text-center">
            <h2 id="how-title" className="text-3xl font-semibold tracking-tight text-[#14112b] md:text-4xl">Get started in just 3 easy steps</h2>
            <p className="mt-3 text-sm text-slate-500">A guided start designed for speed and simplicity.</p>
          </div>

          <div className="mt-12 grid gap-4 lg:grid-cols-2">
            {/* left visual */}
            <div className="rounded-2xl bg-gradient-to-br from-[#7c5cff] via-[#b9a6ff] to-[#ece7ff] p-6 pb-0 sm:p-8 sm:pb-0">
              <div className="overflow-hidden rounded-t-xl bg-white shadow-pop">
                <div className="flex items-center gap-1.5 border-b border-slate-100 px-3 py-2">
                  <i className="h-2 w-2 rounded-full bg-red-300" /><i className="h-2 w-2 rounded-full bg-amber-300" /><i className="h-2 w-2 rounded-full bg-green-300" />
                </div>
                <div className="grid grid-cols-[120px_1fr]">
                  <ul className="space-y-1 border-r border-slate-100 p-3 text-[11px] text-slate-500" aria-hidden="true">
                    <li className="mb-2 flex items-center gap-1.5 font-bold text-[#14112b]"><img src="/logo.png" alt="" aria-hidden="true" className="h-4 w-4 object-contain" />{BRAND.name}</li>
                    {["Dashboard", "Traffic", "Competitors", "Domains", "Keyword Lab", "Reports", "Tasks"].map((n, i) => (
                      <li key={n} className={`rounded-md px-2 py-1.5 ${i === 0 ? "bg-[#efeaff] font-semibold text-[#5b38ee]" : ""}`}>{n}</li>
                    ))}
                  </ul>
                  <div className="space-y-3 p-4">
                    <p className="text-sm font-bold text-[#14112b]">Add your website</p>
                    <div className="rounded-lg border border-slate-200 px-3 py-2 text-[11px] text-slate-400">yourstore.com</div>
                    <ul className="space-y-2 text-[11px] text-slate-600">
                      {["Adding your website", "Crawling your pages", "Measuring speed", "Checking SEO basics"].map((s, i) => (
                        <li key={s} className="flex items-center gap-2">
                          <span className={`grid h-4 w-4 place-items-center rounded-full text-white ${i < 3 ? "bg-green-500" : "bg-[#6c47ff]"}`}>
                            <Check className="h-2.5 w-2.5" aria-hidden="true" />
                          </span>
                          {s}
                        </li>
                      ))}
                    </ul>
                    <div className="h-16" />
                  </div>
                </div>
              </div>
            </div>

            {/* right steps */}
            <ol className="flex flex-col gap-4">
              {steps.map((s, i) => (
                <li key={s.title} className={`rounded-2xl border p-5 ${i === 0 ? "border-[#e1d9ff] bg-gradient-to-b from-[#e9e2ff] to-white" : "border-slate-200 bg-white"}`}>
                  <div className="flex items-center gap-3">
                    <span className="grid h-7 w-7 place-items-center rounded-full bg-[#6c47ff] text-xs font-semibold text-white">0{i + 1}</span>
                    <h3 className="text-base font-semibold text-[#14112b]">{s.title}</h3>
                  </div>
                  <p className="mt-2 pl-10 text-sm text-slate-500">{s.text}</p>
                  {i === 0 && (
                    <div className="mt-4 ml-10 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-100" aria-hidden="true">
                      <p className="text-xs font-semibold text-[#14112b]">Create your account</p>
                      <div className="mt-3 space-y-2">
                        <div className="rounded-md border border-slate-200 px-3 py-2 text-[11px] text-slate-400">Email</div>
                        <div className="rounded-md border border-slate-200 px-3 py-2 text-[11px] text-slate-400">Password</div>
                        <div className="rounded-full bg-[#6c47ff] py-2 text-center text-[11px] font-semibold text-white">Create account</div>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ============ Audiences ============ */}
        <section aria-labelledby="who-title" className="mx-auto max-w-6xl px-5 py-14 md:py-20">
          <div className="mx-auto max-w-2xl text-center">
            <h2 id="who-title" className="text-3xl font-semibold tracking-tight text-[#14112b] md:text-4xl">Made for your whole team</h2>
            <p className="mt-3 text-sm text-slate-500">Whether you run one site or fifty.</p>
          </div>
          <ul className="mt-12 grid gap-4 md:grid-cols-3">
            {audiences.map(({ icon: Icon, title, text }) => (
              <li key={title} className="rounded-2xl bg-[#f4f4f8] p-6">
                <span className="grid h-11 w-11 place-items-center rounded-xl bg-[#6c47ff] text-white"><Icon className="h-5 w-5" aria-hidden="true" /></span>
                <h3 className="mt-5 text-base font-semibold text-[#14112b]">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-500">{text}</p>
              </li>
            ))}
          </ul>
        </section>

        {/* ============ FAQ ============ */}
        <section id="faq" aria-labelledby="faq-title" className="mx-auto max-w-3xl scroll-mt-6 px-5 py-14 md:py-20">
          <h2 id="faq-title" className="text-center text-3xl font-semibold tracking-tight text-[#14112b] md:text-4xl">Frequently asked questions</h2>
          <div className="mt-10 space-y-3">
            {faqs.map((f) => (
              <details key={f.q} className="group rounded-2xl border border-slate-200 bg-white px-5 py-4 [&_summary::-webkit-details-marker]:hidden">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-semibold text-[#14112b]">
                  {f.q}
                  <ChevronDown className="h-5 w-5 shrink-0 text-[#6c47ff] transition group-open:rotate-180" aria-hidden="true" />
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-slate-500">{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* ============ CTA ============ */}
        <section aria-labelledby="cta-title" className="px-2 pb-4 sm:px-4">
          <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#5b38ee] via-[#6c47ff] to-[#9b82ff] px-5 py-16 text-center text-white md:py-20">
            <div aria-hidden="true" className="pointer-events-none absolute -left-10 -top-10 h-56 w-80 rounded-full bg-white/20 blur-3xl" />
            <div aria-hidden="true" className="pointer-events-none absolute -bottom-16 -right-10 h-56 w-96 rounded-full bg-white/20 blur-3xl" />
            <div className="relative mx-auto flex max-w-2xl flex-col items-center">
              <Sparkles className="h-7 w-7 text-white/80" aria-hidden="true" />
              <h2 id="cta-title" className="mt-4 text-3xl font-semibold tracking-tight md:text-5xl">Ready to see how your website is doing?</h2>
              <p className="mt-4 text-base text-white/80">Enter your website and get your first check today.</p>
              <div className="mt-8 flex w-full justify-center"><SiteForm id="cta-site" /></div>
              <p className="mt-4 text-sm text-white/80">
                Already have an account? <Link to="/login" className="font-semibold text-white underline underline-offset-2">Log in</Link>
              </p>
            </div>
          </div>
        </section>
      </main>

      {/* ============ Footer ============ */}
      <footer className="mx-auto max-w-6xl px-5 pt-12">
        <div className="grid gap-10 md:grid-cols-4">
          <div className="md:col-span-2">
            <Logo />
            <p className="mt-4 max-w-sm text-sm text-slate-500">
              {BRAND.tagline}. Audit your site, research keywords, track traffic and send reports, all in one place.
            </p>
          </div>
          <nav aria-label="Footer product">
            <h2 className="text-sm font-semibold text-[#14112b]">Product</h2>
            <ul className="mt-4 space-y-2.5 text-sm text-slate-500">
              {navLinks.slice(1).map((l) => (
                <li key={l.href}><a href={l.href} className="transition hover:text-[#6c47ff]">{l.label}</a></li>
              ))}
            </ul>
          </nav>
          <nav aria-label="Footer account">
            <h2 className="text-sm font-semibold text-[#14112b]">Account</h2>
            <ul className="mt-4 space-y-2.5 text-sm text-slate-500">
              <li><Link to="/login" className="transition hover:text-[#6c47ff]">Log in</Link></li>
              <li><Link to="/login?mode=signup" className="transition hover:text-[#6c47ff]">Sign up</Link></li>
            </ul>
          </nav>
        </div>
        <div className="mt-10 border-t border-slate-200 py-6 text-center text-xs text-slate-500">
          © {new Date().getFullYear()} {BRAND.name}. All rights reserved. Powered by{" "}
          <a href={SANOMADS_URL} target="_blank" rel="noopener noreferrer" className="font-semibold transition hover:text-[#6c47ff]">
            Sanomads
          </a>
        </div>
      </footer>
    </div>
  );
}