import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHttp, type Http } from "./http.js";
import type { MessagesClient } from "./llm/summarize.js";
import type { Entry } from "./llm/schema.js";

/**
 * Offline stand-ins for the network and the model, used by `npm run demo` and
 * the tests. The pipeline code that runs against them is the same code that
 * runs in production.
 */

/** Serves fixture files by URL; anything not in the map is a 404. */
export function fixtureHttp(dir: string, routes: Record<string, string>): Http {
  return createHttp({
    retries: 0,
    fetch: async (url) => {
      const file = routes[url.split("?")[0]!];
      if (!file) return new Response("not found", { status: 404 });
      if (file === "!500") return new Response("upstream error", { status: 500 });
      const type = file.endsWith(".json") ? "application/json" : "application/xml";
      return new Response(readFileSync(join(dir, file), "utf8"), { status: 200, headers: { "content-type": type } });
    },
  });
}

const unescapeXml = (s: string) =>
  s.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

export type CannedEntry = Omit<Entry, "itemId">;

/**
 * A fake Claude client that answers from canned entries keyed by item title.
 * Items without a canned entry are skipped, as the real model would for
 * anything irrelevant. Reports token usage so the budget code is exercised.
 */
export function scriptedClient(canned: Record<string, CannedEntry>, calls: string[] = []): MessagesClient {
  const parse = async (req: { messages: { content: unknown }[] }) => {
    const content = String(req.messages[0]?.content ?? "");
    calls.push(content);
    const items = [...content.matchAll(/<item id="([^"]+)"[^>]*>\n<title>([^<]*)<\/title>/g)];
    const entries: Entry[] = items.map(([, id, title]) => {
      const c = canned[unescapeXml(title!)];
      return c
        ? { itemId: unescapeXml(id!), ...c }
        : { itemId: unescapeXml(id!), kind: "skip", headline: "-", summary: "-", whyItMatters: "", availability: "not-applicable" };
    });
    return {
      stop_reason: "end_turn",
      usage: { input_tokens: Math.ceil(content.length / 4) + 600, output_tokens: 90 * entries.length },
      parsed_output: { entries },
    };
  };
  return { messages: { parse } } as unknown as MessagesClient;
}
