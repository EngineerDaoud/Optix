import { HttpError } from "./utils.ts";

// "Managed" Google Analytics: YOUR Google Analytics account owns one GA4 property per website that a user adds to SEOPilot.
// Nobody has to sign in with Google. The user only pastes one small code snippet into their website, and visits then
// flow into the property that SEOPilot created for it. SEOPilot reads the numbers back with the same service account.
//
// A plain Google "API key" cannot do this (API keys cannot touch Analytics). It needs a SERVICE ACCOUNT (free):
//   1. Google Cloud > enable "Google Analytics Admin API" and "Google Analytics Data API"
//   2. IAM & Admin > Service Accounts > create one > Keys > Add key > JSON (downloads a .json file)
//   3. analytics.google.com > Admin > Account access management > add the service account's email as EDITOR
//   4. put the JSON in the secret GA_SERVICE_ACCOUNT (raw JSON, or base64 of the file, see README)

const ADMIN = "https://analyticsadmin.googleapis.com/v1beta";
const DATA = "https://analyticsdata.googleapis.com/v1beta";
const SCOPES =
  "https://www.googleapis.com/auth/analytics.edit https://www.googleapis.com/auth/analytics.readonly";

type ServiceKey = { client_email: string; private_key: string };

function loadKey(): ServiceKey {
  const raw = (Deno.env.get("GA_SERVICE_ACCOUNT") ?? "").trim();
  if (!raw)
    throw new HttpError(
      503,
      "Automatic Analytics is not set up yet (secret GA_SERVICE_ACCOUNT is missing).",
    );
  let j: ServiceKey;
  try {
    j = JSON.parse(raw.startsWith("{") ? raw : atob(raw));
  } catch {
    throw new HttpError(
      503,
      "GA_SERVICE_ACCOUNT is not valid JSON (or base64 of the JSON file).",
    );
  }
  if (!j.client_email || !j.private_key)
    throw new HttpError(
      503,
      "GA_SERVICE_ACCOUNT has no client_email / private_key.",
    );
  return {
    client_email: j.client_email,
    private_key: j.private_key.replace(/\\n/g, "\n"),
  };
}

const b64url = (data: string | Uint8Array) => {
  const bytes =
    typeof data === "string" ? new TextEncoder().encode(data) : data;
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

let cached: { token: string; exp: number } | null = null;

/** Access token of the service account (cached for ~55 minutes). */
export async function serviceToken(): Promise<string> {
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;
  const key = loadKey();
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(
    JSON.stringify({
      iss: key.client_email,
      scope: SCOPES,
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  );
  const der = Uint8Array.from(
    atob(key.private_key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "")),
    (c) => c.charCodeAt(0),
  );
  const pk = await crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      pk,
      new TextEncoder().encode(`${head}.${claim}`),
    ),
  );
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${head}.${claim}.${b64url(sig)}`,
    }),
  });
  const j = await r.json();
  if (!r.ok)
    throw new HttpError(
      502,
      `Google service account sign-in failed: ${j.error_description ?? j.error}`,
    );
  cached = {
    token: j.access_token as string,
    exp: Date.now() + (Number(j.expires_in) || 3600) * 1000,
  };
  return cached.token;
}

async function call(method: string, url: string, body?: unknown) {
  const r = await fetch(url, {
    method,
    signal: AbortSignal.timeout(25000),
    headers: {
      Authorization: `Bearer ${await serviceToken()}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = j?.error?.message ?? `Google error ${r.status}`;
    if (r.status === 403)
      throw new HttpError(
        502,
        `Google refused: ${msg}. Check that the service account email is an EDITOR in your Analytics account and both Analytics APIs are enabled.`,
      );
    if (r.status === 429)
      throw new HttpError(
        429,
        "Google Analytics is busy (rate limit). Try again in a minute.",
      );
    throw new HttpError(502, msg);
  }
  return j;
}

/** The Analytics account that will own all properties: GA_ACCOUNT_ID, or the first account the service account can see. */
async function accountId(): Promise<string> {
  const set = (Deno.env.get("GA_ACCOUNT_ID") ?? "").replace(/\D/g, "");
  if (set) return set;
  const j = await call("GET", `${ADMIN}/accountSummaries?pageSize=50`);
  const first = (j.accountSummaries ?? [])[0]?.account as string | undefined; // "accounts/123456"
  if (!first)
    throw new HttpError(
      502,
      "The service account cannot see any Analytics account. Add its email as Editor in Analytics > Admin > Account access management.",
    );
  return first.replace("accounts/", "");
}

export type ManagedProperty = {
  propertyId: string;
  streamId: string;
  measurementId: string;
};

export async function createManagedProperty(
  siteUrl: string,
  name: string,
): Promise<ManagedProperty> {
  const account = await accountId();
  const host = (() => {
    try {
      return new URL(siteUrl).hostname;
    } catch {
      return name;
    }
  })();
  const prop = await call("POST", `${ADMIN}/properties`, {
    parent: `accounts/${account}`,
    displayName: `SEOPilot: ${host}`.slice(0, 100),
    timeZone: Deno.env.get("GA_TIMEZONE") ?? "Europe/London", // day boundary for reports; set GA_TIMEZONE to change it
    currencyCode: Deno.env.get("GA_CURRENCY") ?? "USD",
  });
  const propertyId = String(prop.name).replace("properties/", "");
  try {
    const stream = await call(
      "POST",
      `${ADMIN}/properties/${propertyId}/dataStreams`,
      {
        type: "WEB_DATA_STREAM",
        displayName: host.slice(0, 100),
        webStreamData: { defaultUri: siteUrl },
      },
    );
    const measurementId = stream?.webStreamData?.measurementId as
      string | undefined;
    if (!measurementId)
      throw new HttpError(
        502,
        "Google created the property but returned no Measurement ID.",
      );
    return {
      propertyId,
      streamId: String(stream.name).split("/").pop()!,
      measurementId,
    };
  } catch (e) {
    await deleteManagedProperty(propertyId).catch(() => {}); // do not leave an empty property behind
    throw e;
  }
}

/** Google keeps a deleted property for about 35 days and then removes it for good. */
export async function deleteManagedProperty(propertyId: string) {
  await call("DELETE", `${ADMIN}/properties/${propertyId}`);
}

/** Visitors on the site right now (Analytics realtime). null = could not be read. */
export async function realtimeUsers(
  propertyId: string,
): Promise<number | null> {
  try {
    const j = await call(
      "POST",
      `${DATA}/properties/${propertyId}:runRealtimeReport`,
      { metrics: [{ name: "activeUsers" }] },
    );
    return Number(j?.rows?.[0]?.metricValues?.[0]?.value ?? 0) || 0;
  } catch {
    return null;
  }
}

/** The code the user pastes just before </head> on every page. */
export const snippet = (measurementId: string) =>
  `<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=${measurementId}"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', '${measurementId}');
</script>`;
