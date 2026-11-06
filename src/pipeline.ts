import type { BudgetGuard } from "./budget.js";
import type { Settings, Sources } from "./config.js";
import type { Http } from "./http.js";
import { mergeChanges, type Ledger } from "./ledger.js";
import { buildSystemPrompt, summarizeAll, type MessagesClient } from "./llm/summarize.js";
import { validateEntries } from "./llm/validate.js";
import { renderHtml, subjectFor } from "./render/html.js";
import { renderMarkdown } from "./render/markdown.js";
import { fetchEol } from "./sources/eol.js";
import { fetchFeeds } from "./sources/feeds.js";
import { fetchKev } from "./sources/kev.js";
import { isoDay } from "./text.js";
import type { EolItem, KevItem, LedgerChanges, NewsItem, SourceError } from "./types.js";

export interface PipelineDeps {
  sources: Sources;
  settings: Settings;
  http: Http;
  client: MessagesClient;
  ledger: Ledger;
  budget: BudgetGuard;
  now: Date;
  title?: string;
}

export interface PipelineResult {
  date: string;
  markdown: string;
  html: string;
  subject: string;
  /** Apply to the ledger only after the digest has been saved. */
  changes: LedgerChanges;
  stats: { items: number; entries: number; heldBack: number; deferred: number; kev: number; costUsd: number };
}

const TIER_ORDER = { T1: 0, T2: 1, T3: 2, T4: 3 } as const;

/** Official sources first, then newest, so a cap or a budget cut drops the least reliable items. */
export function prioritize(items: NewsItem[]): NewsItem[] {
  return [...items].sort(
    (a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier] || (b.published ?? "").localeCompare(a.published ?? ""),
  );
}

/**
 * Lowers each feed's proposed watermark below its oldest deferred item, so
 * items that wait for the next run are still "new" when that run comes.
 */
export function holdWatermarks(changes: LedgerChanges, deferred: NewsItem[], ledger: Ledger): void {
  for (const item of deferred) {
    if (!item.published) continue;
    const key = `feed:${item.feedUrl}`;
    const justBefore = new Date(Date.parse(item.published) - 1).toISOString();
    const proposed = changes.watermarks[key];
    if (proposed && justBefore < proposed) {
      const old = ledger.watermark(key);
      changes.watermarks[key] = old && old > justBefore ? old : justBefore;
    }
  }
}

export async function runDigest(deps: PipelineDeps): Promise<PipelineResult> {
  const { sources, settings, http, client, ledger, budget, now } = deps;
  const date = isoDay(now);
  const errors: SourceError[] = [];

  const feeds = await fetchFeeds(sources.feeds, ledger, http, now);
  errors.push(...feeds.errors);

  let kev: KevItem[] = [];
  let kevChanges: LedgerChanges = { seen: {}, watermarks: {} };
  if (sources.kev) {
    try {
      const r = await fetchKev(sources.kev, ledger, http, now);
      kev = r.items;
      kevChanges = r.changes;
    } catch (err) {
      errors.push({ source: "CISA KEV", error: err instanceof Error ? err.message : String(err) });
    }
  }

  let eol: EolItem[] = [];
  let eolChanges: LedgerChanges = { seen: {}, watermarks: {} };
  if (sources.endOfLife) {
    const r = await fetchEol(sources.endOfLife, ledger, http, now);
    eol = r.items;
    eolChanges = r.changes;
    errors.push(...r.errors);
  }

  const ordered = prioritize(feeds.items);
  const toSummarize = ordered.slice(0, settings.maxItemsPerRun);
  const overCap = ordered.slice(settings.maxItemsPerRun);

  const summary = await summarizeAll(
    client,
    settings.model,
    buildSystemPrompt(sources.audience, date),
    toSummarize,
    budget,
    settings.batchSize,
  );
  const checked = validateEntries(summary.entries, summary.processed);
  const deferred = [...overCap, ...summary.deferred];

  const changes = mergeChanges(feeds.changes, kevChanges, eolChanges);
  for (const item of [...summary.processed, ...summary.refused]) {
    changes.seen[item.id] = { source: item.source, title: item.title };
  }
  holdWatermarks(changes, deferred, ledger);

  const problems = [...summary.problems, ...checked.problems];
  if (overCap.length) problems.push(`${overCap.length} items over the per-run cap wait for the next run`);

  const markdown = renderMarkdown({
    date,
    title: deps.title ?? "AI & IT digest",
    kev,
    eol,
    entries: checked.entries,
    heldBack: [...checked.heldBack, ...summary.refused.map((item) => ({ item, reason: "the model declined to summarize it" }))],
    health: {
      feedsChecked: sources.feeds.length,
      errors,
      model: settings.model,
      calls: summary.calls,
      runCostUsd: summary.costUsd,
      monthSpentUsd: budget.spentThisMonth(),
      monthlyBudgetUsd: settings.monthlyBudgetUsd,
      skipped: checked.skipped,
      deferred: deferred.length,
      problems,
    },
  });

  return {
    date,
    markdown,
    html: renderHtml(markdown),
    subject: subjectFor(markdown),
    changes,
    stats: {
      items: feeds.items.length,
      entries: checked.entries.length,
      heldBack: checked.heldBack.length + summary.refused.length,
      deferred: deferred.length,
      kev: kev.length,
      costUsd: summary.costUsd,
    },
  };
}
