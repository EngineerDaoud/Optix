import { FormEvent, useCallback, useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Trash2 } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useSite } from "../context/Site";
import {
  Badge,
  ErrorNote,
  PageHeader,
  priorityTone,
  Spinner,
} from "../components/ui";

const COLS = [
  ["todo", "To do"],
  ["doing", "In progress"],
  ["done", "Done"],
] as const;

export default function Tasks() {
  const { current } = useSite();
  const [tasks, setTasks] = useState<any[]>([]);
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!current) return;
    const { data } = await supabase
      .from("tasks")
      .select("*")
      .eq("website_id", current.id)
      .order("created_at", { ascending: false });
    setTasks(data ?? []);
    setLoading(false);
  }, [current]);
  useEffect(() => {
    load();
  }, [load]);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!current || !title.trim()) return;
    const { error } = await supabase
      .from("tasks")
      .insert({ website_id: current.id, title: title.trim() });
    if (error) setError(error.message);
    else {
      setTitle("");
      load();
    }
  };
  const move = async (t: any, dir: -1 | 1) => {
    const order = COLS.map(([k]) => k as string);
    const next = order[order.indexOf(t.status) + dir];
    if (!next) return;
    setTasks((all) =>
      all.map((x) => (x.id === t.id ? { ...x, status: next } : x)),
    );
    await supabase.from("tasks").update({ status: next }).eq("id", t.id);
  };
  const del = async (id: string) => {
    setTasks((a) => a.filter((x) => x.id !== id));
    await supabase.from("tasks").delete().eq("id", id);
  };

  return (
    <>
      <PageHeader
        title="Tasks"
        sub="Fixes found by audits and insights, plus your own."
      />
      <ErrorNote message={error} />
      <form onSubmit={add} className="mb-6 flex gap-2">
        <input
          className="input"
          placeholder="Add a task, for example “Rewrite the homepage title”"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          aria-label="New task"
        />
        <button className="btn whitespace-nowrap">Add task</button>
      </form>
      {loading ? (
        <Spinner />
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          {COLS.map(([key, name]) => {
            const list = tasks.filter((t) => t.status === key);
            return (
              <section
                key={key}
                className="rounded-xl bg-slate-100 p-3 dark:bg-slate-900/60"
              >
                <h2 className="mb-3 px-1 text-sm font-semibold">
                  {name}{" "}
                  <span className="font-normal text-slate-500">
                    ({list.length})
                  </span>
                </h2>
                <ul className="space-y-2">
                  {list.map((t) => (
                    <li key={t.id} className="card !p-3">
                      <div className="mb-1 flex items-center gap-2">
                        <Badge tone={priorityTone(t.priority) as any}>
                          {t.priority}
                        </Badge>
                        <Badge>{t.source}</Badge>
                      </div>
                      <p className="text-sm font-medium">{t.title}</p>
                      {t.description && (
                        <p className="mt-1 line-clamp-3 whitespace-pre-line text-xs text-slate-500">
                          {t.description}
                        </p>
                      )}
                      <div className="mt-2 flex items-center justify-between">
                        <div className="flex gap-1">
                          <button
                            className="btn-ghost !px-2 !py-1"
                            disabled={key === "todo"}
                            onClick={() => move(t, -1)}
                            aria-label="Move back"
                          >
                            <ArrowLeft className="h-3.5 w-3.5" />
                          </button>
                          <button
                            className="btn-ghost !px-2 !py-1"
                            disabled={key === "done"}
                            onClick={() => move(t, 1)}
                            aria-label="Move forward"
                          >
                            <ArrowRight className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <button
                          className="btn-ghost !px-2 !py-1"
                          onClick={() => del(t.id)}
                          aria-label="Delete task"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </li>
                  ))}
                  {!list.length && (
                    <li className="px-1 py-4 text-xs text-slate-500">
                      Nothing here.
                    </li>
                  )}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
