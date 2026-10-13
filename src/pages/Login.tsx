import { FormEvent, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowLeft, Check, Eye, EyeOff, Lock, Mail, Plug } from "lucide-react";
import { BRAND, COMING_SOON_MESSAGE, SANOMADS_URL } from "../lib/brand";
import { supabase } from "../lib/supabase";
import { ErrorNote, Spinner } from "../components/ui";
import { useAuth } from "../context/Auth";

const perks = [
  "Speed and SEO check in about a minute",
  "Keyword research and rank tracking",
  "Scheduled PDF reports",
];

/* small SEO preview card that fills the purple panel */
function SeoPreview() {
  const r = 22;
  const c = 2 * Math.PI * r;
  return (
    <div
      aria-hidden="true"
      className="rounded-2xl bg-white/15 p-4 ring-1 ring-white/25 backdrop-blur [@media(max-height:700px)]:hidden"
    >
      <div className="flex items-center gap-3">
        <div className="relative h-14 w-14 shrink-0">
          <svg viewBox="0 0 60 60" className="h-full w-full -rotate-90">
            <circle cx="30" cy="30" r={r} fill="none" stroke="rgba(255,255,255,.25)" strokeWidth="6" />
            <circle cx="30" cy="30" r={r} fill="none" stroke="#fff" strokeWidth="6" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - 0.86)} />
          </svg>
          <span className="num absolute inset-0 grid place-items-center text-lg font-medium">86</span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-white/70">SEO health</p>
          <p className="text-sm font-semibold">Looking good</p>
        </div>
        <span className="rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-medium">Sample data</span>
      </div>
      <svg viewBox="0 0 300 60" preserveAspectRatio="none" className="mt-3 h-12 w-full">
        <defs>
          <linearGradient id="lgSpark" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#fff" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d="M0,48 C30,44 50,38 80,34 C110,30 130,34 160,24 C190,14 220,18 250,9 C270,4 285,3 300,2 L300,60 L0,60 Z" fill="url(#lgSpark)" />
        <path d="M0,48 C30,44 50,38 80,34 C110,30 130,34 160,24 C190,14 220,18 250,9 C270,4 285,3 300,2" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-medium">
        <span className="rounded-full bg-white/20 px-2.5 py-1">▲ Keyword 14 → 6</span>
        <span className="rounded-full bg-white/20 px-2.5 py-1">Organic +18%</span>
      </div>
    </div>
  );
}

export default function Login() {
  const [params] = useSearchParams();
  const [mode, setMode] = useState<"in" | "up">(
    params.get("mode") === "signup" ? "up" : "in",
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const isUp = mode === "up";
  const { denied, clearDenied } = useAuth();

  // This page is always light (like the landing page). Restore dark mode when leaving.
  useEffect(() => {
    const root = document.documentElement;
    const wasDark = root.classList.contains("dark");
    root.classList.remove("dark");
    return () => {
      if (wasDark) root.classList.add("dark");
    };
  }, []);

  const swap = () => {
    setMode(isUp ? "in" : "up");
    setError(null);
    setInfo(null);
  };

  // On success Supabase sets the session and App sends the user straight to the dashboard.
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);
    clearDenied();
    try {
      const { data, error } = isUp
        ? await supabase.auth.signUp({ email: email.trim().toLowerCase(), password })
        : await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
      if (error) {
        // the database refuses accounts for emails that are not on the approved list
        setError(
          /database error|not approved/i.test(error.message)
            ? COMING_SOON_MESSAGE
            : error.message,
        );
        return;
      }
      if (isUp && !data.session)
        setInfo("Account created. Check your email to confirm it, then sign in.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false); // spinner can never get stuck again
    }
  };

  return (
    <div
      className="flex min-h-screen flex-col px-4 py-4 md:h-[100dvh] md:overflow-hidden"
      style={{
        background:
          "radial-gradient(60% 40% at 50% 0%, #ffffff 0%, rgba(255,255,255,0) 70%), linear-gradient(180deg,#cdbfff 0%, #e3dbff 55%, #f3efff 100%)",
      }}
    >
      <div className="mx-auto flex w-full max-w-4xl items-center justify-between">
        <Link
          to="/"
          aria-label={`${BRAND.name} home`}
          className="flex items-center gap-2 text-lg font-bold tracking-tight text-[#14112b]"
        >
          <img src="/logo.png" alt="" aria-hidden="true" className="h-8 w-8 object-contain" />
          {BRAND.name}
        </Link>
        <Link
          to="/"
          className="group inline-flex items-center gap-2 rounded-full bg-white/80 py-2 pl-2.5 pr-4 text-sm font-semibold text-[#14112b] shadow-sm ring-1 ring-[#6c47ff]/15 backdrop-blur transition hover:bg-white hover:text-[#6c47ff] hover:shadow-md"
        >
          <span className="grid h-6 w-6 place-items-center rounded-full bg-[#efeaff] text-[#6c47ff] transition group-hover:-translate-x-0.5 group-hover:bg-[#6c47ff] group-hover:text-white">
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
          Back to home
        </Link>
      </div>

      <div className="mx-auto mt-4 flex w-full max-w-4xl items-center md:min-h-0 md:flex-1 md:pb-2">
        <div className="relative w-full overflow-hidden rounded-3xl bg-white shadow-[0_30px_80px_-20px_rgba(76,45,200,0.4)] md:h-full md:max-h-[580px]">
          {/* ---------- form panel (slides left/right) ---------- */}
          <div
            className={`flex flex-col justify-center overflow-y-auto p-7 transition-transform duration-500 ease-in-out md:absolute md:inset-y-0 md:left-0 md:w-1/2 md:p-10 ${
              isUp ? "md:translate-x-full" : "md:translate-x-0"
            }`}
          >
            <form onSubmit={submit} className="w-full">
              <h1 className="text-3xl font-semibold tracking-tight text-[#14112b]">
                {isUp ? "Create your account" : "Welcome back"}
              </h1>
              <p className="mt-2 text-sm text-slate-500">
                {isUp
                  ? "Create an account to start tracking your websites."
                  : "Sign in to see how your websites are doing."}
              </p>

              <div className="mt-5">
                <ErrorNote message={error ?? denied} />
                {info && (
                  <div role="status" className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
                    {info}
                  </div>
                )}
              </div>

              <div className="space-y-4">
                <div>
                  <label htmlFor="email" className="text-sm font-medium text-[#14112b]">Email</label>
                  <div className="mt-1.5 flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 focus-within:border-[#6c47ff] focus-within:ring-4 focus-within:ring-[#6c47ff]/15">
                    <Mail className="h-4 w-4 text-slate-400" aria-hidden="true" />
                    <input
                      id="email"
                      type="email"
                      required
                      autoComplete="email"
                      placeholder="you@example.com"
                      className="w-full bg-transparent py-2.5 text-sm text-[#14112b] outline-none placeholder:text-slate-400"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="password" className="text-sm font-medium text-[#14112b]">Password</label>
                  <div className="mt-1.5 flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 focus-within:border-[#6c47ff] focus-within:ring-4 focus-within:ring-[#6c47ff]/15">
                    <Lock className="h-4 w-4 text-slate-400" aria-hidden="true" />
                    <input
                      id="password"
                      type={show ? "text" : "password"}
                      required
                      minLength={6}
                      autoComplete={isUp ? "new-password" : "current-password"}
                      placeholder={isUp ? "At least 6 characters" : "Your password"}
                      className="w-full bg-transparent py-2.5 text-sm text-[#14112b] outline-none placeholder:text-slate-400"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                    <button
                      type="button"
                      onClick={() => setShow((s) => !s)}
                      aria-label={show ? "Hide password" : "Show password"}
                      className="text-slate-400 hover:text-[#6c47ff]"
                    >
                      {show ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
                    </button>
                  </div>
                </div>
              </div>

              <button
                disabled={busy}
                className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#6c47ff] py-3 text-sm font-semibold text-white shadow-[0_8px_20px_-6px_rgba(108,71,255,0.6)] transition hover:bg-[#5b38ee] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy && <Spinner />}
                {isUp ? "Create account" : "Sign in"}
              </button>

              <p className="mt-5 text-center text-sm text-slate-500 md:hidden">
                {isUp ? "Already have an account?" : "New here?"}{" "}
                <button type="button" onClick={swap} className="font-semibold text-[#6c47ff] hover:underline">
                  {isUp ? "Sign in" : "Create an account"}
                </button>
              </p>

              <p className="mt-5 flex items-center justify-center gap-1.5 text-xs text-slate-400 [@media(max-height:640px)]:hidden">
                <Plug className="h-3.5 w-3.5" aria-hidden="true" />
                Works with Google Search Console and Analytics 4
              </p>
            </form>
          </div>

          {/* ---------- swap panel (desktop only) ---------- */}
          <aside
            aria-label={isUp ? "Already registered" : `New to ${BRAND.name}`}
            className={`relative hidden flex-col justify-between gap-4 overflow-hidden bg-gradient-to-br from-[#5b38ee] via-[#6c47ff] to-[#a08bff] p-10 text-white transition-transform duration-500 ease-in-out md:absolute md:inset-y-0 md:left-0 md:flex md:w-1/2 ${
              isUp ? "md:translate-x-0" : "md:translate-x-full"
            }`}
          >
            <div aria-hidden="true" className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/20 blur-3xl" />
            <div aria-hidden="true" className="pointer-events-none absolute -bottom-20 -left-10 h-56 w-72 rounded-full bg-white/20 blur-3xl" />

            <div className="relative">
              <h2 className="text-2xl font-semibold leading-tight tracking-tight">
                {isUp ? "Already have an account?" : "Start tracking your websites"}
              </h2>
              <p className="mt-2 text-sm text-white/80">
                {isUp
                  ? "Sign in to pick up where you left off."
                  : "Create a free account and run your first check today."}
              </p>
            </div>

            <div className="relative space-y-4">
              <SeoPreview />
              <ul className="space-y-2.5 text-sm">
                {perks.map((p) => (
                  <li key={p} className="flex items-center gap-2.5">
                    <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-white/25">
                      <Check className="h-3 w-3" aria-hidden="true" />
                    </span>
                    {p}
                  </li>
                ))}
              </ul>
            </div>

            <button
              type="button"
              onClick={swap}
              className="relative w-full rounded-full border border-white/60 py-3 text-sm font-semibold text-white transition hover:bg-white hover:text-[#5b38ee]"
            >
              {isUp ? "Sign in" : "Create an account"}
            </button>
          </aside>
        </div>
      </div>

      <p className="mt-2 text-center text-xs text-slate-500">
        Powered by{" "}
        <a
          href={SANOMADS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold text-[#6c47ff] hover:underline"
        >
          Sanomads
        </a>
      </p>
    </div>
  );
}