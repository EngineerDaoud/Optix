import { useEffect, useState } from "react";
import { fn } from "./supabase";

export type OrgCompetitor = {
  domain: string;
  common: number;
  level: number;
  seKeywords: number;
  avgPosition: number;
};
export type MapPoint = {
  domain: string;
  site: boolean;
  keywords: number;
  traffic: number;
  coverage: number;
};
export type OrgData = {
  total: number;
  keywords: number;
  competitors: OrgCompetitor[];
  map: MapPoint[];
};

// Two cards (competitor table + positioning map) need the same answer: ask once, share it for a few minutes.
const TTL = 5 * 60_000;
const cache = new Map<string, { t: number; p: Promise<OrgData> }>();

export function useOrgCompetitors(
  url: string,
  country: string,
  keywords: string[],
) {
  const [data, setData] = useState<OrgData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const kwKey = keywords.slice(0, 60).join("|");

  useEffect(() => {
    let live = true;
    const key = `${url}|${country}|${kwKey}`;
    let hit = cache.get(key);
    if (!hit || Date.now() - hit.t > TTL) {
      const p = fn<OrgData>("orgcompetitors", {
        url,
        country,
        keywords: kwKey ? kwKey.split("|") : [],
      });
      p.catch(() => cache.delete(key));
      hit = { t: Date.now(), p };
      cache.set(key, hit);
    }
    setLoading(true);
    setError(null);
    hit.p
      .then((r) => live && setData({ ...r, map: r.map ?? [] }))
      .catch((e) => live && setError((e as Error).message))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [url, country, kwKey]);

  return { data, loading, error };
}