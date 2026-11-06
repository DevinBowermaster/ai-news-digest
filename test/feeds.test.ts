import { describe, expect, it } from "vitest";
import { createHttp } from "../src/http.js";
import { Ledger } from "../src/ledger.js";
import { fetchFeeds, parseFeed } from "../src/sources/feeds.js";
import { NOW } from "./helpers.js";

const rss = (items: string) =>
  `<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>${items}</channel></rss>`;
const rssItem = (n: number, date: string | null, extra = "") =>
  `<item><title>Post ${n}${extra}</title><link>https://v.example.com/${n}</link><guid>g${n}</guid>${
    date ? `<pubDate>${date}</pubDate>` : ""
  }<description>Body ${n}</description></item>`;

const httpFor = (body: string) => createHttp({ retries: 0, fetch: async () => new Response(body) });
const feed = (extra: object = {}) => ({
  name: "Vendor",
  url: "https://v.example.com/feed.xml",
  tier: "T1" as const,
  topic: "platforms" as const,
  ...extra,
});

describe("parseFeed", () => {
  it("reads RSS with CDATA HTML and converts dates to ISO", () => {
    const [e] = parseFeed(
      rss(
        `<item><title>A &amp; B</title><link>https://v.example.com/a</link><guid>a</guid><pubDate>Mon, 02 Nov 2026 17:00:00 GMT</pubDate><description><![CDATA[<p>Hello <b>there</b></p>]]></description></item>`,
      ),
    );
    expect(e).toEqual({
      guid: "a",
      title: "A & B",
      link: "https://v.example.com/a",
      date: "2026-11-02T17:00:00.000Z",
      summary: "Hello there",
    });
  });

  it("reads Atom with the alternate link", () => {
    const entries = parseFeed(
      `<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>x</id><title>T</title><link rel="self" href="https://v.example.com/self"/><link rel="alternate" href="https://v.example.com/post"/><updated>2026-11-01T00:00:00Z</updated><summary>S</summary></entry></feed>`,
    );
    expect(entries[0]).toMatchObject({ guid: "x", link: "https://v.example.com/post", summary: "S" });
  });

  it("treats a single item as a list and a bad date as unknown", () => {
    expect(parseFeed(rss(rssItem(1, "not a date")))).toHaveLength(1);
    expect(parseFeed(rss(rssItem(1, "not a date")))[0]!.date).toBeNull();
  });

  it("rejects anything that is not a feed", () => {
    expect(() => parseFeed("<html><body>hi</body></html>")).toThrow("not an RSS or Atom feed");
  });
});

describe("fetchFeeds", () => {
  it("takes only entries from the first-run window and moves the watermark to the newest", async () => {
    const body = rss(rssItem(1, "Tue, 03 Nov 2026 10:00:00 GMT") + rssItem(2, "Thu, 01 Oct 2026 10:00:00 GMT"));
    const r = await fetchFeeds([feed()], new Ledger(), httpFor(body), NOW);
    expect(r.items.map((i) => i.title)).toEqual(["Post 1"]);
    expect(r.changes.watermarks["feed:https://v.example.com/feed.xml"]).toBe("2026-11-03T10:00:00.000Z");
    expect(r.items[0]).toMatchObject({ tier: "T1", topic: "platforms", feedUrl: "https://v.example.com/feed.xml" });
  });

  it("skips entries already in the ledger and entries older than the watermark", async () => {
    const body = rss(rssItem(1, "Tue, 03 Nov 2026 10:00:00 GMT") + rssItem(2, "Wed, 04 Nov 2026 08:00:00 GMT"));
    const first = await fetchFeeds([feed()], new Ledger(), httpFor(body), NOW);
    const ledger = new Ledger();
    ledger.apply({ seen: { [first.items[1]!.id]: { source: "Vendor", title: "Post 2" } }, watermarks: { "feed:https://v.example.com/feed.xml": "2026-11-03T12:00:00.000Z" } }, "2026-11-04");
    const second = await fetchFeeds([feed()], ledger, httpFor(body), NOW);
    expect(second.items).toEqual([]);
  });

  it("filters by keywords and records non-matching entries as seen", async () => {
    const body = rss(rssItem(1, "Tue, 03 Nov 2026 10:00:00 GMT", " Copilot") + rssItem(2, "Tue, 03 Nov 2026 11:00:00 GMT"));
    const r = await fetchFeeds([feed({ keywords: "copilot" })], new Ledger(), httpFor(body), NOW);
    expect(r.items.map((i) => i.title)).toEqual(["Post 1 Copilot"]);
    expect(Object.values(r.changes.seen).map((s) => s.title)).toEqual(["Post 2"]);
  });

  it("caps entries per feed and keeps the watermark below the ones it left out", async () => {
    const body = rss(
      rssItem(1, "Tue, 03 Nov 2026 12:00:00 GMT") +
        rssItem(2, "Tue, 03 Nov 2026 11:00:00 GMT") +
        rssItem(3, "Tue, 03 Nov 2026 10:00:00 GMT"),
    );
    const r = await fetchFeeds([feed({ maxItems: 2 })], new Ledger(), httpFor(body), NOW);
    expect(r.items).toHaveLength(2);
    expect(r.changes.watermarks["feed:https://v.example.com/feed.xml"]).toBe("2026-11-03T09:59:59.999Z");
  });

  it("drops entries whose link is not https", async () => {
    const body = rss(
      `<item><title>Bad</title><link>javascript:alert(1)</link><guid>b</guid><pubDate>Tue, 03 Nov 2026 10:00:00 GMT</pubDate></item>` +
        `<item><title>Plain</title><link>http://v.example.com/p</link><guid>p</guid><pubDate>Tue, 03 Nov 2026 10:00:00 GMT</pubDate></item>`,
    );
    const r = await fetchFeeds([feed()], new Ledger(), httpFor(body), NOW);
    expect(r.items).toEqual([]);
  });

  it("keeps going when one feed fails", async () => {
    const http = createHttp({
      retries: 0,
      fetch: async (url) =>
        url.includes("broken") ? new Response("x", { status: 500 }) : new Response(rss(rssItem(1, "Tue, 03 Nov 2026 10:00:00 GMT"))),
    });
    const r = await fetchFeeds(
      [feed({ name: "Broken", url: "https://broken.example.com/feed" }), feed()],
      new Ledger(),
      http,
      NOW,
    );
    expect(r.items).toHaveLength(1);
    expect(r.errors).toEqual([{ source: "Broken", error: expect.stringContaining("500") }]);
    expect(r.changes.watermarks["feed:https://broken.example.com/feed"]).toBeUndefined();
  });

  it("gives the same entry the same id on every run", async () => {
    const body = rss(rssItem(1, "Tue, 03 Nov 2026 10:00:00 GMT"));
    const a = await fetchFeeds([feed()], new Ledger(), httpFor(body), NOW);
    const b = await fetchFeeds([feed()], new Ledger(), httpFor(body), NOW);
    expect(a.items[0]!.id).toBe(b.items[0]!.id);
    expect(a.items[0]!.id).toMatch(/^feed:[0-9a-f]{16}$/);
  });
});
