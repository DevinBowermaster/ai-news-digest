import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BudgetGuard, FileBudgetStore, MemoryBudgetStore, costUsd, worstCaseUsd } from "../src/budget.js";
import { loadSettings, loadSources, SourcesSchema } from "../src/config.js";
import { Ledger, mergeChanges } from "../src/ledger.js";

describe("Ledger", () => {
  it("records seen items once, keeping the first-seen date", () => {
    const l = new Ledger();
    l.apply({ seen: { a: { source: "s", title: "A" } }, watermarks: {} }, "2026-11-01");
    l.apply({ seen: { a: { source: "s", title: "A again" } }, watermarks: {} }, "2026-11-04");
    expect(l.toJSON().items.a).toEqual({ source: "s", title: "A", firstSeen: "2026-11-01" });
  });

  it("only moves watermarks forward", () => {
    const l = new Ledger();
    l.apply({ seen: {}, watermarks: { k: "2026-11-03" } }, "2026-11-04");
    l.apply({ seen: {}, watermarks: { k: "2026-10-01" } }, "2026-11-04");
    expect(l.watermark("k")).toBe("2026-11-03");
  });

  it("prunes old items and round-trips through a sorted file", () => {
    const l = new Ledger();
    l.apply({ seen: { b: { source: "s", title: "B" } }, watermarks: {} }, "2026-01-01");
    l.apply({ seen: { a: { source: "s", title: "A" } }, watermarks: {} }, "2026-11-01");
    expect(l.prune("2026-11-04", 180)).toBe(1);
    const path = join(mkdtempSync(join(tmpdir(), "ledger-")), "state", "ledger.json");
    l.save(path);
    expect(Ledger.load(path).has("a")).toBe(true);
    expect(Ledger.load(join(tmpdir(), "does-not-exist.json")).size).toBe(0);
  });

  it("merges changes from several sources", () => {
    expect(mergeChanges({ seen: { a: { source: "s", title: "A" } }, watermarks: { x: "1" } }, { seen: {}, watermarks: { y: "2" } })).toEqual({
      seen: { a: { source: "s", title: "A" } },
      watermarks: { x: "1", y: "2" },
    });
  });
});

describe("budget", () => {
  it("prices usage per model and refuses unknown models", () => {
    expect(costUsd("claude-sonnet-5-5", { input_tokens: 1_000_000, output_tokens: 100_000 })).toBeCloseTo(3);
    expect(() => costUsd("gpt-imaginary", { input_tokens: 1, output_tokens: 1 })).toThrow("No price");
  });

  it("estimates a worst case from prompt size and the output cap", () => {
    expect(worstCaseUsd("claude-sonnet-5-5", 30_000, 8000)).toBeCloseTo((10_000 * 2 + 8000 * 10) / 1e6);
  });

  it("blocks a call whose worst case would cross the cap", () => {
    const guard = new BudgetGuard(1, new MemoryBudgetStore({ month: "2026-11", spentUsd: 0.95 }), () => new Date("2026-11-04"));
    expect(guard.canAfford(0.04)).toBe(true);
    expect(guard.canAfford(0.06)).toBe(false);
  });

  it("starts a new month at zero and persists to a file", () => {
    const path = join(mkdtempSync(join(tmpdir(), "budget-")), "budget.json");
    const store = new FileBudgetStore(path);
    store.save({ month: "2026-10", spentUsd: 4.99 });
    const guard = new BudgetGuard(5, store, () => new Date("2026-11-01T00:00:00Z"));
    expect(guard.spentThisMonth()).toBe(0);
    guard.record("claude-sonnet-5-5", { input_tokens: 1000, output_tokens: 1000 });
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ month: "2026-11", spentUsd: 0.012 });
  });
});

describe("config", () => {
  it("loads the shipped sources file", () => {
    const s = loadSources(join(import.meta.dirname, "..", "config", "sources.json"));
    expect(s.feeds.length).toBeGreaterThan(3);
    expect(s.kev?.stack.length).toBeGreaterThan(0);
  });

  it("rejects non-https feeds and unknown tiers", () => {
    const base = { audience: "A small IT team at an MSP.", feeds: [] };
    expect(() => SourcesSchema.parse({ ...base, feeds: [{ name: "x", url: "http://x.example.com/", tier: "T1", topic: "ai" }] })).toThrow();
    expect(() => SourcesSchema.parse({ ...base, feeds: [{ name: "x", url: "https://x.example.com/", tier: "T9", topic: "ai" }] })).toThrow();
  });

  it("defaults to claude-sonnet-5-5 and a $5 monthly cap", () => {
    const s = loadSettings({ ANTHROPIC_API_KEY: "﻿k-test\n", CLAUDE_MODEL: "" });
    expect(s).toMatchObject({ model: "claude-sonnet-5-5", monthlyBudgetUsd: 5, anthropicApiKey: "k-test" });
  });

  it("fails at startup on a missing key, an unpriced model or a bad number", () => {
    expect(() => loadSettings({})).toThrow("ANTHROPIC_API_KEY");
    expect(() => loadSettings({ ANTHROPIC_API_KEY: "k", CLAUDE_MODEL: "claude-unknown" })).toThrow("No price");
    expect(() => loadSettings({ ANTHROPIC_API_KEY: "k", MONTHLY_BUDGET_USD: "-1" })).toThrow("positive");
    expect(() => loadSettings({}, "send")).toThrow("RESEND_API_KEY");
  });

  it("does not need the model key to send, or any key for the demo", () => {
    expect(loadSettings({ RESEND_API_KEY: "r", DIGEST_TO: "team@example.com" }, "send").digestTo).toBe("team@example.com");
    expect(() => loadSettings({}, "demo")).not.toThrow();
  });
});
