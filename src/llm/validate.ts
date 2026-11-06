import type { NewsItem, Tier } from "../types.js";
import type { Entry } from "./schema.js";

export type Kind = "action" | "change" | "opportunity" | "fyi";

export interface DigestEntry {
  item: NewsItem;
  kind: Kind;
  headline: string;
  summary: string;
  whyItMatters: string;
  availability: Entry["availability"];
  /** Set in code from the source's tier, never by the model. */
  trust: string;
  /** Why the entry was moved to a lower section, if it was. */
  note?: string;
}

export interface HeldBack {
  item: NewsItem;
  reason: string;
}

export interface ValidationResult {
  entries: DigestEntry[];
  heldBack: HeldBack[];
  skipped: number;
  problems: string[];
}

export const TRUST: Record<Tier, string> = {
  T1: "official source",
  T2: "vendor-reported",
  T3: "independent report",
  T4: "unconfirmed",
};

/**
 * Model text goes into markdown that becomes an email. Remove anything that
 * could become a link, an image, HTML or document structure: links come only
 * from the fetched item.
 */
export function cleanText(s: string): string {
  return s
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\bwww\.\S+/gi, "")
    .replace(/[<>[\]`*\\]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^[#>\-+=\s]+/, "")
    .trim();
}

/** Numbers that carry facts: versions, prices, percentages, dates, counts. Single digits are wording. */
export function factNumbers(s: string): string[] {
  const found = s.replace(/,(?=\d{3})/g, "").match(/\$?\d[\d.:/-]*\d%?|\$\d|\d+%/g) ?? [];
  return [...new Set(found.map((n) => n.replace(/[.:/-]+$/, "")).filter((n) => n.replace(/\D/g, "").length > 1))];
}

/** Every fact-bearing number in the model's text must appear in the item it summarizes. */
export function inventedNumbers(entry: Pick<Entry, "headline" | "summary" | "whyItMatters">, item: NewsItem): string[] {
  const source = `${item.title}\n${item.text}`.replace(/,(?=\d{3})/g, "");
  return factNumbers(`${entry.headline} ${entry.summary} ${entry.whyItMatters}`).filter(
    (n) => !source.includes(n.replace(/^\$/, "")),
  );
}

/**
 * Checks the model's entries against the items it was given. The model can
 * reword and classify; it cannot cite an item it was not shown, add a number
 * the source does not contain, or pitch a preview as an opportunity.
 */
export function validateEntries(entries: Entry[], items: NewsItem[]): ValidationResult {
  const byId = new Map(items.map((i) => [i.id, i]));
  const used = new Set<string>();
  const result: ValidationResult = { entries: [], heldBack: [], skipped: 0, problems: [] };

  for (const e of entries) {
    const item = byId.get(e.itemId);
    if (!item) {
      result.problems.push(`entry for unknown item "${cleanText(e.itemId).slice(0, 40)}" dropped`);
      continue;
    }
    if (used.has(item.id)) {
      result.problems.push(`second entry for "${item.title}" dropped`);
      continue;
    }
    used.add(item.id);
    if (e.kind === "skip") {
      result.skipped++;
      continue;
    }

    const invented = inventedNumbers(e, item);
    if (invented.length) {
      result.heldBack.push({ item, reason: `summary had numbers not in the source (${invented.join(", ")})` });
      continue;
    }

    let kind: Kind = e.kind;
    let note: string | undefined;
    if (kind === "opportunity" && e.availability !== "generally-available") {
      kind = "fyi";
      note = "not generally available yet";
    } else if (kind === "opportunity" && item.tier !== "T1") {
      kind = "fyi";
      note = "needs an official source before it is pitched";
    } else if ((kind === "action" || kind === "change") && (item.tier === "T3" || item.tier === "T4")) {
      kind = "fyi";
      note = "not confirmed by the vendor yet";
    }

    const headline = cleanText(e.headline);
    const summary = cleanText(e.summary);
    if (!headline || !summary) {
      result.heldBack.push({ item, reason: "empty summary" });
      continue;
    }
    result.entries.push({
      item,
      kind,
      headline,
      summary,
      whyItMatters: cleanText(e.whyItMatters),
      availability: e.availability,
      trust: TRUST[item.tier],
      ...(note ? { note } : {}),
    });
  }

  for (const item of items) {
    if (!used.has(item.id)) result.heldBack.push({ item, reason: "no summary returned" });
  }
  return result;
}
