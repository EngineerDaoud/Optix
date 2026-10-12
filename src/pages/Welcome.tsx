import { FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fn } from "../lib/supabase";
import { useSite } from "../context/Site";
import { ErrorNote, Spinner } from "../components/ui";

const steps = [
  "Adding your website",
  "Crawling your pages",
  "Measuring speed on mobile and desktop",
  "Checking SEO basics",
];

export default function Welcome() {
  const { add } = useSite();
  const nav = useNavigate();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!busy) return;
    const t = setInterval(
      () => setStep((s) => Math.min(s + 1, steps.length - 1)),
      6000,
    );
    return () => clearInterval(t);
  }, [busy]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    setStep(0);
    try {
      const site = await add(url);
      setStep(1);
      await fn("audit", { website_id: site.id });
      nav("/audit");
    } catch (err) {
      setError(
        err instanceof TypeError
          ? "That doesn't look like a valid website address."
          : (err as Error).message,
      );
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl py-10 md:py-20">
      <h1 className="text-3xl font-bold tracking-tight md:text-4xl">
        Paste your website. See what to fix first.
      </h1>
      <p className="mt-3 text-slate-500 dark:text-slate-400">
        We check speed and SEO straight away. Connect Google afterwards to bring
        in traffic, rankings and sales.
      </p>
      <form onSubmit={submit} className="mt-8 flex flex-col gap-3 sm:flex-row">
        <input
          className="input !py-3 text-base"
          placeholder="yourstore.com"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          required
          disabled={busy}
          aria-label="Website address"
        />
        <button className="btn !py-3 whitespace-nowrap" disabled={busy}>
          {busy && <Spinner />} Check my website
        </button>
      </form>
      <div className="mt-4">
        <ErrorNote message={error} />
      </div>
      {busy && (
        <ul className="mt-6 space-y-2 text-sm">
          {steps.map((s, i) => (
            <li
              key={s}
              className={`flex items-center gap-2 ${i <= step ? "" : "text-slate-400"}`}
            >
              {i < step ? (
                <span className="text-green-600">✓</span>
              ) : i === step ? (
                <Spinner />
              ) : (
                <span className="w-4" />
              )}{" "}
              {s}
            </li>
          ))}
          <li className="pt-2 text-xs text-slate-500">
            This takes up to a minute.
          </li>
        </ul>
      )}
    </div>
  );
}
