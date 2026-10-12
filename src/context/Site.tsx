import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from "react";
import { fn, supabase } from "../lib/supabase";
import { useAuth } from "./Auth";

export type Website = {
  id: string;
  url: string;
  name: string | null;
  last_synced_at: string | null;
};
type Ctx = {
  sites: Website[];
  current: Website | null;
  loaded: boolean;
  select: (id: string) => void;
  add: (url: string) => Promise<Website>;
  remove: (id: string) => Promise<void>;
  reload: () => Promise<void>;
};
const SiteCtx = createContext<Ctx>(null as unknown as Ctx);
export const useSite = () => useContext(SiteCtx);

export function normalizeUrl(input: string) {
  const v = input.trim();
  const u = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`);
  return u.origin;
}

export function SiteProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const [sites, setSites] = useState<Website[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(
    localStorage.getItem("site"),
  );
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    if (!session) {
      setSites([]);
      setLoaded(true);
      return;
    }
    const { data } = await supabase
      .from("websites")
      .select("id,url,name,last_synced_at")
      .order("created_at");
    setSites((data ?? []) as Website[]);
    setLoaded(true);
  }, [session]);

  useEffect(() => {
    reload();
  }, [reload]);

  const current = sites.find((s) => s.id === currentId) ?? sites[0] ?? null;

  const select = (id: string) => {
    localStorage.setItem("site", id);
    setCurrentId(id);
  };

  const add = async (url: string) => {
    const clean = normalizeUrl(url);
    // adding a website that is already saved just opens it, instead of creating a duplicate
    const key = (u: string) =>
      u.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "");
    const dup = sites.find((s) => key(s.url) === key(clean));
    if (dup) {
      select(dup.id);
      return dup;
    }
    const { data, error } = await supabase
      .from("websites")
      .insert({ url: clean, name: new URL(clean).hostname })
      .select()
      .single();
    if (error) throw new Error(error.message);
    await reload();
    select(data.id);
    // Automatic Google Analytics: create the tracking property for this site in the background.
    // If it is not set up (or fails) the site is still added; the Integrations page has a button to retry.
    fn("gaprovision", { action: "create", website_id: data.id }).catch(
      () => {},
    );
    return data as Website;
  };

  const remove = async (id: string) => {
    try {
      await fn("gaprovision", { action: "remove", website_id: id });
    } catch {
      /* nothing to remove, or not set up */
    }
    const { error } = await supabase.from("websites").delete().eq("id", id);
    if (error) throw new Error(error.message);
    if (currentId === id) {
      localStorage.removeItem("site");
      setCurrentId(null);
    }
    await reload();
  };

  return (
    <SiteCtx.Provider
      value={{ sites, current, loaded, select, add, remove, reload }}
    >
      {children}
    </SiteCtx.Provider>
  );
}