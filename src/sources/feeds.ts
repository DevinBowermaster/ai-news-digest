import { XMLParser } from "fast-xml-parser";
import type { Http } from "../http.js";
import type { Ledger } from "../ledger.js";
import { htmlToText, sha16, truncate } from "../text.js";
import type { LedgerChanges, NewsItem, SourceError } from "../types.js";
import type { Sources } from "../config.js";

export interface FeedEntry {
  guid: string;
  title: string;
  link: string;
  date: string | null;
  summary: string;
}

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  // Feeds are untrusted: no entity expansion beyond the XML built-ins.
  processEntities: true,
  htmlEntities: false,
});

type Node = Record<string, unknown>;
const text = (v: unknown): string =>
  v == null ? "" : typeof v === "object" ? String((v as Node)["#text"] ?? "") : String(v);
const list = <T>(v: T | T[] | undefined): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);

function toIso(raw: string): string | null {
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/** RSS 2.0 and Atom entries, normalized. Throws on anything else. */
export function parseFeed(body: string): FeedEntry[] {
  const doc = xml.parse(body) as Node;
  const rss = doc.rss as Node | undefined;
  if (rss) {
    const channel = rss.channel as Node | undefined;
    return list(channel?.item as Node | Node[] | undefined).map((i) => ({
      guid: text(i.guid) || text(i.link) || text(i.title),
      title: htmlToText(text(i.title)),
      link: text(i.link).trim(),
      date: toIso(text(i.pubDate)),
      summary: htmlToText(text(i["content:encoded"]) || text(i.description)),
    }));
  }
  const feed = doc.feed as Node | undefined;
  if (feed) {
    return list(feed.entry as Node | Node[] | undefined).map((e) => {
      const links = list(e.link as Node | Node[] | undefined);
      const link = links.find((l) => !l["@rel"] || l["@rel"] === "alternate") ?? links[0];
      const href = String(link?.["@href"] ?? "").trim();
      return {
        guid: text(e.id) || href || text(e.title),
        title: htmlToText(text(e.title)),
        link: href,
        date: toIso(text(e.updated) || text(e.published)),
        summary: htmlToText(text(e.content) || text(e.summary)),
      };
    });
  }
  throw new Error("not an RSS or Atom feed");
}

export interface FeedResult {
  items: NewsItem[];
  changes: LedgerChanges;
  errors: SourceError[];
}

const isHttps = (url: string): boolean => {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
};

/**
 * New entries from every configured feed: newer than the feed's watermark, not
 * already in the ledger, matching its keywords, capped per feed. On the first run
 * of a feed only the last `firstRunDays` days count, so adding a feed does not
 * dump its whole archive into one digest. Entries over the cap wait for the next run. One failing feed never stops the others.
 */
export async function fetchFeeds(
  feeds: Sources["feeds"],
  ledger: Ledger,
  http: Http,
  now: Date,
  { firstRunDays = 7, defaultMax = 10 } = {},
): Promise<FeedResult> {
  const items: NewsItem[] = [];
  const errors: SourceError[] = [];
  const changes: LedgerChanges = { seen: {}, watermarks: {} };

  for (const feed of feeds) {
    const key = `feed:${feed.url}`;
    const since = ledger.watermark(key) ?? new Date(now.getTime() - firstRunDays * 86_400_000).toISOString();
    try {
      const entries = parseFeed(await http.getText(feed.url));
      const keywords = feed.keywords ? new RegExp(feed.keywords, "i") : null;
      let newest = since;
      let taken = 0;
      // Entries over the cap stay unseen; the watermark must stay below them so the next run gets them.
      let oldestCapped: string | null = null;
      for (const e of entries) {
        const id = `feed:${sha16(`${feed.url}\n${e.guid}`)}`;
        // Undated entries rely on the ledger alone.
        if (e.date && e.date <= since) continue;
        if (e.date && e.date > newest) newest = e.date;
        if (ledger.has(id) || id in changes.seen) continue;
        // Links are rendered into an email: only https survives.
        if (!isHttps(e.link)) continue;
        if (keywords && !keywords.test(`${e.title}\n${e.summary.slice(0, 2000)}`)) {
          changes.seen[id] = { source: feed.name, title: e.title };
          continue;
        }
        if (taken >= (feed.maxItems ?? defaultMax)) {
          if (e.date && (!oldestCapped || e.date < oldestCapped)) oldestCapped = e.date;
          continue;
        }
        taken++;
        items.push({
          id,
          feedUrl: feed.url,
          source: feed.name,
          tier: feed.tier,
          topic: feed.topic,
          title: truncate(e.title, 200),
          url: e.link,
          published: e.date,
          text: truncate(e.summary, 1500),
        });
      }
      if (oldestCapped) {
        const justBefore = new Date(Date.parse(oldestCapped) - 1).toISOString();
        changes.watermarks[key] = justBefore > since ? justBefore : since;
      } else {
        changes.watermarks[key] = newest;
      }
    } catch (err) {
      errors.push({ source: feed.name, error: truncate(err instanceof Error ? err.message : String(err), 300) });
    }
  }
  return { items, changes, errors };
}
