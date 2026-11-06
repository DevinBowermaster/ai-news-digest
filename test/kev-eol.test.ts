import { describe, expect, it } from "vitest";
import { createHttp } from "../src/http.js";
import { Ledger } from "../src/ledger.js";
import { fixtureHttp } from "../src/demo.js";
import { fetchEol } from "../src/sources/eol.js";
import { fetchKev, rankKev, sortKev } from "../src/sources/kev.js";
import { FIXTURES, NOW, routes } from "./helpers.js";

const cfg = { url: "https://k.example.gov/kev.json", stack: ["Keystone", "Orbit"], remoteAccessTools: ["Relay Remote"], epssP1: 0.1 };
const entry = (over: object = {}) => ({
  cveID: "CVE-2099-0001",
  vendorProject: "Acme",
  product: "Widget",
  vulnerabilityName: "Acme Widget Bug",
  dateAdded: "2026-11-03",
  requiredAction: "Apply updates.",
  knownRansomwareCampaignUse: "Unknown",
  ...over,
});

describe("rankKev", () => {
  it("ranks the team's stack and remote-access tools as P0", () => {
    expect(rankKev(entry({ vendorProject: "Keystone", product: "Agent" }), null, cfg)).toMatchObject({ priority: "P0", onStack: true });
    expect(rankKev(entry({ product: "Relay Remote Server" }), null, cfg)).toMatchObject({ priority: "P0", remoteAccessTool: true });
  });

  it("ranks ransomware use or a high EPSS as P1, the rest as P2", () => {
    expect(rankKev(entry({ knownRansomwareCampaignUse: "Known" }), null, cfg).priority).toBe("P1");
    expect(rankKev(entry(), 0.1, cfg).priority).toBe("P1");
    expect(rankKev(entry(), 0.09, cfg).priority).toBe("P2");
  });

  it("matches whole words only, so a short name does not match inside another", () => {
    expect(rankKev(entry({ vendorProject: "Orbital Labs" }), null, cfg).onStack).toBe(false);
  });

  it("sorts by priority, then EPSS", () => {
    const items = [rankKev(entry({ cveID: "CVE-2099-0002" }), 0.05, cfg), rankKev(entry({ cveID: "CVE-2099-0003" }), 0.08, cfg), rankKev(entry({ cveID: "CVE-2099-0004", knownRansomwareCampaignUse: "Known" }), 0, cfg)];
    expect(sortKev(items).map((i) => i.cve)).toEqual(["CVE-2099-0004", "CVE-2099-0003", "CVE-2099-0002"]);
  });
});

describe("fetchKev", () => {
  const sources = { ...cfg, url: "https://kev.example.gov/known_exploited_vulnerabilities.json", epssUrl: "https://epss.example.org/data/v1/epss" };

  it("returns new entries in the window with EPSS scores, ranked", async () => {
    const r = await fetchKev(sources, new Ledger(), fixtureHttp(FIXTURES, routes()), NOW);
    expect(r.items.map((i) => [i.cve, i.priority])).toEqual([
      ["CVE-2099-10001", "P0"],
      ["CVE-2099-10002", "P0"],
      ["CVE-2099-10003", "P1"],
      ["CVE-2099-10004", "P2"],
    ]);
    expect(r.items[0]!.epss).toBe(0.712);
    expect(r.changes.watermarks.kev).toBe("2026-11-03");
  });

  it("does not report an entry twice", async () => {
    const ledger = new Ledger();
    ledger.apply({ seen: { "kev:CVE-2099-10001": { source: "CISA KEV", title: "x" } }, watermarks: {} }, "2026-11-04");
    const r = await fetchKev(sources, ledger, fixtureHttp(FIXTURES, routes()), NOW);
    expect(r.items.map((i) => i.cve)).not.toContain("CVE-2099-10001");
  });

  it("still ranks entries when EPSS is down", async () => {
    const r = await fetchKev({ ...sources, epssUrl: "https://down.example.org/epss" }, new Ledger(), fixtureHttp(FIXTURES, routes()), NOW);
    expect(r.items).toHaveLength(4);
    expect(r.items.every((i) => i.epss === null)).toBe(true);
  });

  it("rejects a catalog that does not match the expected shape", async () => {
    const http = createHttp({ retries: 0, fetch: async () => Response.json({ vulnerabilities: [{ cveID: "nope" }] }) });
    await expect(fetchKev(sources, new Ledger(), http, NOW)).rejects.toThrow();
  });
});

describe("fetchEol", () => {
  const eolCfg = { api: "https://eol.example.org/api/v1/products", products: ["orbit-server", "tessera-os", "missing"], horizonDays: 120 };

  it("reports dates inside the horizon, soonest first, and records errors per product", async () => {
    const r = await fetchEol(eolCfg, new Ledger(), fixtureHttp(FIXTURES, routes()), NOW);
    expect(r.items.map((i) => `${i.product} ${i.release} ${i.ends} ${i.date}`)).toEqual([
      "Tessera OS 4.x end of extended support 2026-11-30",
      "Orbit Server 2019 end of support 2027-01-12",
    ]);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]!.source).toBe("endoflife.date/missing");
  });

  it("reports a date again only once it has passed", async () => {
    const first = await fetchEol(eolCfg, new Ledger(), fixtureHttp(FIXTURES, routes()), NOW);
    const ledger = new Ledger();
    ledger.apply(first.changes, "2026-11-04");
    const again = await fetchEol(eolCfg, ledger, fixtureHttp(FIXTURES, routes()), NOW);
    expect(again.items).toEqual([]);
    const later = await fetchEol(eolCfg, ledger, fixtureHttp(FIXTURES, routes()), new Date("2026-12-02T12:00:00Z"));
    expect(later.items.map((i) => i.id)).toEqual(["eol:tessera-os:4:eoesFrom:passed"]);
  });
});
