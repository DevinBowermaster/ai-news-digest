import { describe, expect, it, vi } from "vitest";
import { sendEmail } from "../src/deliver/email.js";
import { createHttp } from "../src/http.js";
import { assertNoActiveHtml, renderHtml, subjectFor } from "../src/render/html.js";
import { link, md, renderMarkdown, vendorProduct, type DigestInput } from "../src/render/markdown.js";
import type { KevItem } from "../src/types.js";
import { item } from "./helpers.js";

const kev = (n: number, priority: KevItem["priority"]): KevItem => ({
  id: `kev:CVE-2099-000${n}`,
  cve: `CVE-2099-000${n}`,
  vendor: "Acme",
  product: `Widget ${n}`,
  name: `Acme Widget ${n} bug`,
  dateAdded: "2026-11-03",
  requiredAction: "Apply updates.",
  ransomware: false,
  epss: null,
  onStack: priority === "P0",
  remoteAccessTool: false,
  priority,
  url: `https://nvd.nist.gov/vuln/detail/CVE-2099-000${n}`,
});

const input = (over: Partial<DigestInput> = {}): DigestInput => ({
  date: "2026-11-04",
  title: "AI & IT digest",
  kev: [],
  eol: [],
  entries: [],
  heldBack: [],
  health: { feedsChecked: 2, errors: [], model: "claude-sonnet-5-5", calls: 0, runCostUsd: 0, monthSpentUsd: 0, monthlyBudgetUsd: 5, skipped: 0, deferred: 0, problems: [] },
  ...over,
});

describe("markdown", () => {
  it("escapes untrusted text and only links https", () => {
    expect(md("a [b](c) <x> *y*")).toBe("a \\[b\\](c) \\<x> \\*y\\*");
    expect(link("t", "javascript:alert(1)")).toBe("t");
    expect(link("t", "http://x.example.com")).toBe("t");
    expect(link("t", "https://x.example.com/a(b)")).toBe("[t](https://x.example.com/a%28b%29)");
  });

  it("drops the vendor name when the product already starts with it", () => {
    expect(vendorProduct({ vendor: "Keystone", product: "Keystone Agent" })).toBe("Keystone Agent");
    expect(vendorProduct({ vendor: "Acme", product: "Widget" })).toBe("Acme Widget");
  });

  it("lists at most 5 urgent KEV entries in full and sums up the rest", () => {
    const out = renderMarkdown(input({ kev: [1, 2, 3, 4, 5, 6].map((n) => kev(n, "P0")).concat(kev(7, "P2")) }));
    expect(out.match(/^### P0/gm)).toHaveLength(5);
    expect(out).toContain("Also new in KEV, lower priority: CVE-2099-0006 (Acme Widget 6), CVE-2099-0007 (Acme Widget 7).");
  });

  it("says when nothing is urgent and omits empty sections", () => {
    const out = renderMarkdown(input());
    expect(out).toContain("Nothing urgent in this edition.");
    expect(out).not.toContain("## Act on");
    expect(out).not.toContain("## Security to act on");
    expect(out).toContain("## Run health");
  });

  it("renders entries with their source link and trust label", () => {
    const out = renderMarkdown(
      input({
        entries: [{ item: item(), kind: "change", headline: "H", summary: "S.", whyItMatters: "W.", availability: "announced", trust: "official source" }],
      }),
    );
    expect(out).toContain("## Changes clients will notice\n\n- **H** S. W. [Vendor blog](https://vendor.example.com/posts/sso), official source.");
  });
});

describe("html", () => {
  it("escapes raw HTML, drops images and non-https links, and shows link hosts", () => {
    const html = renderHtml(
      "# T\n\n<script>alert(1)</script>\n\nText <b>bold</b> ![x](https://t.example.com/p.gif) [a](http://plain.example.com) [b](https://ok.example.com/p)",
    );
    expect(html).not.toMatch(/<script|<img/);
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain('href="http://');
    expect(html).toContain('href="https://ok.example.com/p"');
    expect(html).toContain("(ok.example.com)");
    expect(() => assertNoActiveHtml(html)).not.toThrow();
  });

  it("refuses active HTML", () => {
    expect(() => assertNoActiveHtml('<p onclick="x()">')).toThrow();
    expect(() => assertNoActiveHtml('<a href="javascript:x">')).toThrow();
    expect(() => assertNoActiveHtml("<iframe src=x>")).toThrow();
  });

  it("builds the subject from the title and the top item", () => {
    expect(subjectFor("# AI & IT digest: 2026-11-04\n\nTop:\n- Patch: Keystone Agent \\(x\\)\n")).toBe(
      "AI & IT digest: 2026-11-04 | Patch: Keystone Agent (x)",
    );
  });
});

describe("sendEmail", () => {
  it("posts to Resend with an idempotency key", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ id: "msg_1" }));
    const body = await sendEmail(createHttp({ fetch, retries: 0 }), "re_key", {
      from: "Digest <d@example.com>",
      to: "team@example.com",
      subject: "S",
      html: "<p>hi</p>",
      text: "hi",
      idempotencyKey: "digest-2026-11-04",
    });
    expect(body).toContain("msg_1");
    const [url, init] = fetch.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer re_key");
    expect(headers["idempotency-key"]).toBe("digest-2026-11-04");
    expect(JSON.parse(String(init.body))).toMatchObject({ to: ["team@example.com"], subject: "S" });
  });

  it("refuses to send active HTML and reports provider errors", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("bad", { status: 422 }));
    const http = createHttp({ fetch, retries: 0 });
    const msg = { from: "f", to: "t", subject: "s", text: "t", idempotencyKey: "k" };
    await expect(sendEmail(http, "k", { ...msg, html: "<script>x</script>" })).rejects.toThrow("active HTML");
    expect(fetch).not.toHaveBeenCalled();
    await expect(sendEmail(http, "k", { ...msg, html: "<p>x</p>" })).rejects.toThrow("422");
  });
});
