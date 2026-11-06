import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BudgetGuard, MemoryBudgetStore } from "../src/budget.js";
import { Ledger } from "../src/ledger.js";
import { holdWatermarks, prioritize, runDigest } from "../src/pipeline.js";
import { fixtureDeps, item, NOW } from "./helpers.js";

describe("runDigest on fixture data", () => {
  it("produces the committed sample digest exactly", async () => {
    const r = await runDigest(fixtureDeps());
    const sample = readFileSync(join(import.meta.dirname, "..", "examples", "sample-digest.md"), "utf8");
    expect(r.markdown).toBe(sample.replace(/\r\n/g, "\n"));
  });

  it("puts each kind of item in the right place", async () => {
    const { markdown, stats } = await runDigest(fixtureDeps());
    expect(stats).toMatchObject({ items: 11, entries: 8, heldBack: 1, kev: 4, deferred: 0 });
    expect(markdown).toMatch(/## Act on\n\n- \*\*Update Keystone Agent/);
    expect(markdown).toContain("summary had numbers not in the source (500)");
    expect(markdown).toContain("Harbor Backup blog: GET https://harbor-backup.example.com/blog/rss.xml -> 500");
    expect(markdown).toContain("unconfirmed. (moved here: not confirmed by the vendor yet)");
  });

  it("never carries the injected instructions or link into the digest", async () => {
    const calls: string[] = [];
    const { markdown, html } = await runDigest(fixtureDeps({ calls }));
    expect(calls.join()).toContain("Ignore all previous instructions");
    expect(markdown).not.toMatch(/multi-factor|evil\.example/i);
    expect(html).not.toContain("evil.example");
  });

  it("reports nothing twice once the ledger is updated", async () => {
    const ledger = new Ledger();
    const first = await runDigest(fixtureDeps({ ledger }));
    ledger.apply(first.changes, first.date);
    const calls: string[] = [];
    const second = await runDigest(fixtureDeps({ ledger, calls }));
    expect(calls).toEqual([]);
    expect(second.stats).toMatchObject({ items: 0, entries: 0, kev: 0 });
    expect(second.markdown).toContain("Nothing urgent in this edition.");
  });

  it("does not mark items seen, or move watermarks past them, when the budget runs out", async () => {
    const ledger = new Ledger();
    const budget = new BudgetGuard(0.0001, new MemoryBudgetStore(), () => NOW);
    const r = await runDigest(fixtureDeps({ ledger, budget }));
    expect(r.stats.deferred).toBe(11);
    expect(r.markdown).toContain("monthly budget reached");
    // KEV and end-of-life entries need no model, so they are still reported.
    expect(r.stats.kev).toBe(4);
    ledger.apply(r.changes, r.date);
    const retry = await runDigest(fixtureDeps({ ledger }));
    expect(retry.stats.items).toBe(11);
    expect(retry.stats.kev).toBe(0);
  });

  it("caps items per run, keeping official sources first", async () => {
    const deps = fixtureDeps();
    const r = await runDigest({ ...deps, settings: { ...deps.settings, maxItemsPerRun: 3 } });
    expect(r.stats.deferred).toBe(8);
    expect(r.markdown).toContain("8 items over the per-run cap wait for the next run");
  });
});

describe("helpers", () => {
  it("orders by tier, then newest", () => {
    const a = item({ id: "a", tier: "T3", published: "2026-11-04T00:00:00Z" });
    const b = item({ id: "b", tier: "T1", published: "2026-11-01T00:00:00Z" });
    const c = item({ id: "c", tier: "T1", published: "2026-11-03T00:00:00Z" });
    expect(prioritize([a, b, c]).map((i) => i.id)).toEqual(["c", "b", "a"]);
  });

  it("holds a watermark just below the oldest deferred item, but never below the old one", () => {
    const changes = { seen: {}, watermarks: { "feed:https://vendor.example.com/feed.xml": "2026-11-04T00:00:00.000Z" } };
    holdWatermarks(changes, [item({ published: "2026-11-03T10:00:00.000Z" })], new Ledger());
    expect(changes.watermarks["feed:https://vendor.example.com/feed.xml"]).toBe("2026-11-03T09:59:59.999Z");

    const ledger = new Ledger();
    ledger.apply({ seen: {}, watermarks: { "feed:https://vendor.example.com/feed.xml": "2026-11-03T11:00:00.000Z" } }, "2026-11-04");
    const again = { seen: {}, watermarks: { "feed:https://vendor.example.com/feed.xml": "2026-11-04T00:00:00.000Z" } };
    holdWatermarks(again, [item({ published: "2026-11-03T10:00:00.000Z" })], ledger);
    expect(again.watermarks["feed:https://vendor.example.com/feed.xml"]).toBe("2026-11-03T11:00:00.000Z");
  });
});
