import { z } from "zod";
import type { Sources } from "../config.js";
import type { Http } from "../http.js";
import type { Ledger } from "../ledger.js";
import { isoDay } from "../text.js";
import type { KevItem, LedgerChanges, Priority } from "../types.js";

const KevCatalog = z.object({
  vulnerabilities: z.array(
    z.object({
      cveID: z.string().regex(/^CVE-\d{4}-\d{4,}$/),
      vendorProject: z.string(),
      product: z.string(),
      vulnerabilityName: z.string(),
      dateAdded: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      requiredAction: z.string(),
      knownRansomwareCampaignUse: z.string().optional(),
    }),
  ),
});
type KevEntry = z.infer<typeof KevCatalog>["vulnerabilities"][number];

const EpssResponse = z.object({
  data: z.array(z.object({ cve: z.string(), epss: z.coerce.number() })).default([]),
});

type KevConfig = NonNullable<Sources["kev"]>;

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const anyOf = (words: string[]) => new RegExp(`\\b(${words.map(escapeRegex).join("|")})\\b`, "i");

/**
 * Ranks one KEV entry for a team that supports many small clients.
 * P0: on the team's stack, or a remote-access/RMM tool (one bug there reaches every client).
 * P1: known ransomware use, or an EPSS exploitation probability at or above the threshold.
 * P2: everything else that is new in KEV.
 */
export function rankKev(entry: KevEntry, epss: number | null, cfg: KevConfig): KevItem {
  const target = `${entry.vendorProject} ${entry.product}`;
  const onStack = cfg.stack.length > 0 && anyOf(cfg.stack).test(target);
  const remoteAccessTool = cfg.remoteAccessTools.length > 0 && anyOf(cfg.remoteAccessTools).test(target);
  const ransomware = entry.knownRansomwareCampaignUse === "Known";
  const priority: Priority =
    onStack || remoteAccessTool ? "P0" : ransomware || (epss !== null && epss >= cfg.epssP1) ? "P1" : "P2";
  return {
    id: `kev:${entry.cveID}`,
    cve: entry.cveID,
    vendor: entry.vendorProject,
    product: entry.product,
    name: entry.vulnerabilityName,
    dateAdded: entry.dateAdded,
    requiredAction: entry.requiredAction,
    ransomware,
    epss,
    onStack,
    remoteAccessTool,
    priority,
    url: `https://nvd.nist.gov/vuln/detail/${entry.cveID}`,
  };
}

export function sortKev(items: KevItem[]): KevItem[] {
  return [...items].sort(
    (a, b) => a.priority.localeCompare(b.priority) || (b.epss ?? 0) - (a.epss ?? 0) || a.cve.localeCompare(b.cve),
  );
}

/**
 * KEV entries added since the watermark and not yet reported, with EPSS scores.
 * The ranking is deterministic code: the model never decides what is urgent.
 */
export async function fetchKev(
  cfg: KevConfig,
  ledger: Ledger,
  http: Http,
  now: Date,
): Promise<{ items: KevItem[]; changes: LedgerChanges }> {
  const key = "kev";
  const since = ledger.watermark(key) ?? isoDay(new Date(now.getTime() - 7 * 86_400_000));
  const catalog = KevCatalog.parse(await http.getJson(cfg.url));
  // >= plus the ledger: CISA can add more entries later on the same day.
  const fresh = catalog.vulnerabilities.filter((v) => v.dateAdded >= since && !ledger.has(`kev:${v.cveID}`));

  const scores = new Map<string, number>();
  if (cfg.epssUrl && fresh.length) {
    for (let i = 0; i < fresh.length; i += 50) {
      const batch = fresh.slice(i, i + 50).map((v) => v.cveID);
      try {
        const res = EpssResponse.parse(await http.getJson(`${cfg.epssUrl}?cve=${batch.join(",")}`));
        for (const r of res.data) scores.set(r.cve, r.epss);
      } catch {
        // EPSS only refines P1/P2. Without it, entries rank on stack and ransomware alone.
      }
    }
  }

  const items = sortKev(fresh.map((v) => rankKev(v, scores.get(v.cveID) ?? null, cfg)));
  const changes: LedgerChanges = { seen: {}, watermarks: {} };
  for (const item of items) changes.seen[item.id] = { source: "CISA KEV", title: `${item.cve} ${item.name}` };
  const newest = fresh.map((v) => v.dateAdded).sort().pop();
  if (newest) changes.watermarks[key] = newest;
  return { items, changes };
}
