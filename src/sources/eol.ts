import { z } from "zod";
import type { Sources } from "../config.js";
import type { Http } from "../http.js";
import type { Ledger } from "../ledger.js";
import { addDays, isoDay } from "../text.js";
import type { EolItem, LedgerChanges, SourceError } from "../types.js";

/** The subset of the endoflife.date v1 product response this uses. */
const ProductResponse = z.object({
  result: z.object({
    label: z.string(),
    links: z.object({ html: z.string().optional() }).partial().optional(),
    releases: z.array(
      z.object({
        name: z.string(),
        label: z.string().optional(),
        eolFrom: z.string().nullish(),
        eoesFrom: z.string().nullish(),
      }),
    ),
  }),
});

type EolConfig = NonNullable<Sources["endOfLife"]>;

const FIELDS = [
  ["eolFrom", "end of support"],
  ["eoesFrom", "end of extended support"],
] as const;

/**
 * Support end dates inside the horizon, reported twice at most: once when the
 * date first comes into view, and once in the week it passes.
 */
export async function fetchEol(
  cfg: EolConfig,
  ledger: Ledger,
  http: Http,
  now: Date,
): Promise<{ items: EolItem[]; changes: LedgerChanges; errors: SourceError[] }> {
  const today = isoDay(now);
  const from = addDays(today, -7);
  const to = addDays(today, cfg.horizonDays);
  const items: EolItem[] = [];
  const errors: SourceError[] = [];
  const changes: LedgerChanges = { seen: {}, watermarks: {} };

  for (const product of cfg.products) {
    try {
      const { result } = ProductResponse.parse(await http.getJson(`${cfg.api}/${product}`));
      for (const r of result.releases) {
        for (const [field, ends] of FIELDS) {
          const date = r[field];
          if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date < from || date > to) continue;
          const id = `eol:${product}:${r.name}:${field}:${date < today ? "passed" : "soon"}`;
          if (ledger.has(id)) continue;
          changes.seen[id] = { source: "endoflife.date", title: `${result.label} ${r.name}` };
          items.push({
            id,
            product: result.label,
            release: r.label ?? r.name,
            ends,
            date,
            url: result.links?.html ?? `https://endoflife.date/${product}`,
          });
        }
      }
    } catch (err) {
      errors.push({ source: `endoflife.date/${product}`, error: err instanceof Error ? err.message : String(err) });
    }
  }
  items.sort((a, b) => a.date.localeCompare(b.date) || a.product.localeCompare(b.product));
  return { items, changes, errors };
}
