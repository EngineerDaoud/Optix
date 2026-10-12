import { FormEvent, useState } from "react";
import { Trash2 } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../context/Auth";
import { useSite } from "../context/Site";
import { ErrorNote, PageHeader, Spinner } from "../components/ui";

export default function SettingsPage() {
  const { session } = useAuth();
  const { sites, add, remove } = useSite();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await add(url);
      setUrl("");
    } catch (err) {
      setError(
        err instanceof TypeError
          ? "That doesn't look like a valid website address."
          : (err as Error).message,
      );
    }
    setBusy(false);
  };

  return (
    <>
      <PageHeader title="Settings" />
      <ErrorNote message={error} />
      <div className="space-y-6">
        <div className="card">
          <h2 className="mb-3 font-semibold">Websites</h2>
          <ul className="mb-4 divide-y divide-slate-100 dark:divide-slate-800">
            {sites.map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between py-2 text-sm"
              >
                <span>{s.url}</span>
                <button
                  className="btn-ghost !px-2 !py-1"
                  aria-label={`Remove ${s.url}`}
                  onClick={() =>
                    confirm(`Remove ${s.url} and all its data?`) &&
                    remove(s.id).catch((e) => setError(e.message))
                  }
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
            {!sites.length && (
              <li className="py-2 text-sm text-slate-500">No websites yet.</li>
            )}
          </ul>
          <form onSubmit={submit} className="flex gap-2">
            <input
              className="input"
              placeholder="newsite.com"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              required
              aria-label="Website address"
            />
            <button className="btn whitespace-nowrap" disabled={busy}>
              {busy && <Spinner />} Add website
            </button>
          </form>
        </div>
        <div className="card">
          <h2 className="mb-1 font-semibold">Account</h2>
          <p className="mb-3 text-sm text-slate-500">{session?.user.email}</p>
          <button className="btn-ghost" onClick={() => supabase.auth.signOut()}>
            Sign out
          </button>
        </div>
      </div>
    </>
  );
}
