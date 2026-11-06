import { describe, expect, it } from "vitest";
import type { Entry } from "../src/llm/schema.js";
import { cleanText, factNumbers, inventedNumbers, validateEntries } from "../src/llm/validate.js";
import { item } from "./helpers.js";

const entry = (over: Partial<Entry> = {}): Entry => ({
  itemId: "feed:0000000000000001",
  kind: "opportunity",
  headline: "Vendor Suite 4.2 adds SSO",
  summary: "Single sign-on for 3 apps on the Pro plan at $8 per user.",
  whyItMatters: "Easy upsell.",
  availability: "generally-available",
  ...over,
});

describe("factNumbers", () => {
  it("finds versions, prices, percentages and years, but not single digits", () => {
    expect(factNumbers("Version 6.2.1 costs $14.00, 50% off until 2027, for 3 users")).toEqual(["6.2.1", "$14.00", "50%", "2027"]);
  });

  it("ignores thousands separators", () => {
    expect(factNumbers("1,000 seats")).toEqual(["1000"]);
  });
});

describe("inventedNumbers", () => {
  it("passes numbers that appear in the source", () => {
    expect(inventedNumbers(entry(), item())).toEqual([]);
  });

  it("flags numbers that the source does not contain", () => {
    expect(inventedNumbers(entry({ summary: "Now $12 per user for 500 users." }), item())).toEqual(["$12", "500"]);
  });
});

describe("cleanText", () => {
  it("removes links, HTML and markdown structure from model text", () => {
    expect(cleanText("See [this](https://evil.example/x) <img src=x> **now** www.evil.example")).toBe("See this img src=x now");
    expect(cleanText("Go to https://evil.example/login now")).toBe("Go to now");
    expect(cleanText("# Heading\n\nnext line")).toBe("Heading next line");
  });
});

describe("validateEntries", () => {
  it("keeps a valid entry and sets the trust label from the source tier", () => {
    const r = validateEntries([entry()], [item()]);
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0]).toMatchObject({ kind: "opportunity", trust: "official source" });
    expect(r.heldBack).toEqual([]);
  });

  it("drops entries for items the model was not shown, and duplicates", () => {
    const r = validateEntries([entry({ itemId: "feed:ffffffffffffffff" }), entry(), entry()], [item()]);
    expect(r.entries).toHaveLength(1);
    expect(r.problems).toEqual([expect.stringContaining("unknown item"), expect.stringContaining("second entry")]);
  });

  it("holds back an entry with an invented number, keeping the original link", () => {
    const r = validateEntries([entry({ summary: "Free for 90 days." })], [item()]);
    expect(r.entries).toEqual([]);
    expect(r.heldBack[0]!.reason).toContain("90");
    expect(r.heldBack[0]!.item.url).toBe("https://vendor.example.com/posts/sso");
  });

  it("never pitches a preview, or an opportunity without an official source", () => {
    const preview = validateEntries([entry({ availability: "preview" })], [item()]);
    expect(preview.entries[0]).toMatchObject({ kind: "fyi", note: "not generally available yet" });
    const blog = validateEntries([entry()], [item({ tier: "T3" })]);
    expect(blog.entries[0]).toMatchObject({ kind: "fyi", trust: "independent report" });
  });

  it("does not let an unconfirmed report become an action item", () => {
    const r = validateEntries([entry({ kind: "action" })], [item({ tier: "T4" })]);
    expect(r.entries[0]).toMatchObject({ kind: "fyi", trust: "unconfirmed", note: "not confirmed by the vendor yet" });
  });

  it("counts skips and lists items the model ignored", () => {
    const second = item({ id: "feed:0000000000000002", title: "Other" });
    const r = validateEntries([entry({ kind: "skip" })], [item(), second]);
    expect(r.skipped).toBe(1);
    expect(r.heldBack).toEqual([{ item: second, reason: "no summary returned" }]);
  });
});
