import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BudgetGuard, MemoryBudgetStore } from "../src/budget.js";
import { loadSettings, loadSources } from "../src/config.js";
import { fixtureHttp, scriptedClient, type CannedEntry } from "../src/demo.js";
import { Ledger } from "../src/ledger.js";
import type { PipelineDeps } from "../src/pipeline.js";
import type { NewsItem } from "../src/types.js";

export const FIXTURES = join(import.meta.dirname, "..", "fixtures");
export const NOW = new Date("2026-11-04T12:00:00Z");

export function item(overrides: Partial<NewsItem> = {}): NewsItem {
  return {
    id: "feed:0000000000000001",
    feedUrl: "https://vendor.example.com/feed.xml",
    source: "Vendor blog",
    tier: "T1",
    topic: "platforms",
    title: "Vendor Suite 4.2 adds SSO for 3 apps",
    url: "https://vendor.example.com/posts/sso",
    published: "2026-11-03T10:00:00.000Z",
    text: "Version 4.2 adds single sign-on for 3 apps. Generally available on the Pro plan at $8 per user.",
    ...overrides,
  };
}

export const routes = (): Record<string, string> =>
  JSON.parse(readFileSync(join(FIXTURES, "routes.json"), "utf8")) as Record<string, string>;

export const canned = (): Record<string, CannedEntry> =>
  JSON.parse(readFileSync(join(FIXTURES, "model-output.json"), "utf8")) as Record<string, CannedEntry>;

/** Everything the pipeline needs, on fixture data, with overridable parts. */
export function fixtureDeps(overrides: Partial<PipelineDeps> & { calls?: string[] } = {}): PipelineDeps {
  const settings = loadSettings({}, "demo");
  return {
    sources: loadSources(join(FIXTURES, "sources.json")),
    settings,
    http: fixtureHttp(FIXTURES, routes()),
    client: scriptedClient(canned(), overrides.calls),
    ledger: new Ledger(),
    budget: new BudgetGuard(settings.monthlyBudgetUsd, new MemoryBudgetStore(), () => NOW),
    now: NOW,
    ...overrides,
  };
}
