import { describe, expect, it, vi } from "vitest";
import { createHttp, redact } from "../src/http.js";

const noSleep = async () => {};

describe("createHttp", () => {
  it("retries 5xx and 429, then succeeds", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(new Response("slow down", { status: 429 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    const http = createHttp({ fetch, sleep: noSleep, retries: 2 });
    await expect(http.getText("https://a.example.com/")).resolves.toBe("ok");
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("does not retry a 404", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("nope", { status: 404 }));
    const http = createHttp({ fetch, sleep: noSleep });
    await expect(http.getText("https://a.example.com/x")).rejects.toThrow("-> 404");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("retries network errors and reports the last one without the credential", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    const http = createHttp({ fetch, sleep: noSleep, retries: 1 });
    const err = await http.getText("https://a.example.com/?api_key=supersecret").catch((e: Error) => e);
    expect(String(err)).toContain("ECONNRESET");
    expect(String(err)).not.toContain("supersecret");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("sends a user agent and parses JSON", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ a: 1 }));
    const http = createHttp({ fetch, sleep: noSleep });
    await expect(http.getJson("https://a.example.com/j")).resolves.toEqual({ a: 1 });
    const init = fetch.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>)["user-agent"]).toMatch(/ai-news-digest/);
    expect(init.signal).toBeDefined();
  });
});

describe("redact", () => {
  it("hides credentials in query strings", () => {
    expect(redact("https://x.example.com/?key=abc&q=1&token=def")).toBe(
      "https://x.example.com/?key=REDACTED&q=1&token=REDACTED",
    );
  });
});
