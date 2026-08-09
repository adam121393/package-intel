/**
 * Per-call usage log.
 *
 * The service had no way to answer "has anyone ever used this?" — which made
 * every distribution decision a guess. Every request reaching the Worker is
 * recorded here: free ones served at the edge and paid ones on their way to the
 * origin, so one query covers both tiers.
 *
 * Writes are deliberately best-effort and off the response path (see
 * `recordCall`): analytics must never be able to fail a request or slow it down.
 */

export interface D1Like {
  prepare(query: string): {
    bind(...values: unknown[]): {
      run(): Promise<unknown>;
      all(): Promise<{ results?: unknown[] }>;
    };
    all(): Promise<{ results?: unknown[] }>;
  };
}

export interface CallRecord {
  route: string;
  ecosystem: string | null;
  packageName: string | null;
  tier: "free" | "paid" | "other";
  status: number;
  servedBy: "edge" | "origin";
  durationMs: number;
  country: string | null;
  userAgent: string | null;
  /** True only when a paid route actually returned data, not when it 402'd. */
  paid: boolean;
}

/**
 * Classifies a request path into the fields worth aggregating. Package names are
 * recorded because "which packages do agents ask about" is the most actionable
 * signal here; nothing about the caller beyond country and user-agent is kept.
 */
export function describeRequest(pathname: string): {
  route: string;
  ecosystem: string | null;
  packageName: string | null;
} {
  const segments = pathname.split("/").filter(Boolean);
  if (segments[0] !== "v1") return { route: pathname, ecosystem: null, packageName: null };

  const endpoint = segments[1] ?? "";
  if (endpoint === "batch") return { route: "/v1/batch", ecosystem: null, packageName: null };

  return {
    route: `/v1/${endpoint}`,
    ecosystem: segments[2] ?? null,
    // Scoped npm names arrive as two segments (@scope/name).
    packageName: segments.slice(3).join("/") || null,
  };
}

const INSERT =
  "INSERT INTO calls (ts, route, ecosystem, package, tier, status, served_by, duration_ms, country, user_agent, paid) VALUES (?,?,?,?,?,?,?,?,?,?,?)";

/**
 * Fire-and-forget insert. Returns the promise so a caller can hand it to
 * `ctx.waitUntil`, which lets the write finish after the response is already on
 * its way to the client. Failures are swallowed: a broken analytics table must
 * never turn a working API call into an error.
 */
export function recordCall(db: D1Like | undefined, record: CallRecord): Promise<void> {
  if (!db) return Promise.resolve();
  return db
    .prepare(INSERT)
    .bind(
      Date.now(),
      record.route,
      record.ecosystem,
      record.packageName,
      record.tier,
      record.status,
      record.servedBy,
      record.durationMs,
      record.country,
      record.userAgent?.slice(0, 200) ?? null,
      record.paid ? 1 : 0,
    )
    .run()
    .then(() => undefined)
    .catch((err) => {
      console.error("call log write failed:", err instanceof Error ? err.message : String(err));
    });
}

export interface StatsSummary {
  totals: {
    calls: number;
    paidCalls: number;
    free: number;
    errors: number;
    /** 402s: a paid route reached but not paid for. Demand, not breakage. */
    unpaidChallenges: number;
  };
  since: string | null;
  byRoute: unknown[];
  byEcosystem: unknown[];
  topPackages: unknown[];
  daily: unknown[];
  recent: unknown[];
}

export async function readStats(db: D1Like, days = 30): Promise<StatsSummary> {
  const since = Date.now() - days * 24 * 60 * 60 * 1000;
  const q = (sql: string) => db.prepare(sql).bind(since).all();

  const [totals, byRoute, byEcosystem, topPackages, daily, recent] = await Promise.all([
    q(
      // 402 is excluded from `errors` on purpose: it is the correct response to
      // an unpaid request, not a fault. Counted as errors it would make normal
      // unconverted traffic look like the service is breaking.
      "SELECT COUNT(*) AS calls, SUM(paid) AS paidCalls, SUM(CASE WHEN tier='free' THEN 1 ELSE 0 END) AS free, SUM(CASE WHEN status>=400 AND status<>402 THEN 1 ELSE 0 END) AS errors, SUM(CASE WHEN status=402 THEN 1 ELSE 0 END) AS unpaidChallenges, MIN(ts) AS firstTs FROM calls WHERE ts>=?",
    ),
    q(
      "SELECT route, COUNT(*) AS calls, SUM(paid) AS paid FROM calls WHERE ts>=? GROUP BY route ORDER BY calls DESC",
    ),
    q(
      "SELECT ecosystem, COUNT(*) AS calls FROM calls WHERE ts>=? AND ecosystem IS NOT NULL GROUP BY ecosystem ORDER BY calls DESC",
    ),
    q(
      "SELECT ecosystem, package, COUNT(*) AS calls FROM calls WHERE ts>=? AND package IS NOT NULL GROUP BY ecosystem, package ORDER BY calls DESC LIMIT 20",
    ),
    q(
      "SELECT date(ts/1000,'unixepoch') AS day, COUNT(*) AS calls, SUM(paid) AS paid FROM calls WHERE ts>=? GROUP BY day ORDER BY day DESC LIMIT 30",
    ),
    q(
      "SELECT ts, route, ecosystem, package, status, served_by, duration_ms, country FROM calls WHERE ts>=? ORDER BY ts DESC LIMIT 25",
    ),
  ]);

  const t = (totals.results?.[0] ?? {}) as Record<string, number | null>;
  return {
    totals: {
      calls: Number(t.calls ?? 0),
      paidCalls: Number(t.paidCalls ?? 0),
      free: Number(t.free ?? 0),
      errors: Number(t.errors ?? 0),
      unpaidChallenges: Number(t.unpaidChallenges ?? 0),
    },
    since: t.firstTs ? new Date(Number(t.firstTs)).toISOString() : null,
    byRoute: byRoute.results ?? [],
    byEcosystem: byEcosystem.results ?? [],
    topPackages: topPackages.results ?? [],
    daily: daily.results ?? [],
    recent: recent.results ?? [],
  };
}
