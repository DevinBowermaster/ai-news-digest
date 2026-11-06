import Anthropic from "@anthropic-ai/sdk";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BudgetGuard, FileBudgetStore, MemoryBudgetStore } from "./budget.js";
import { loadSettings, loadSources } from "./config.js";
import { fixtureHttp, scriptedClient, type CannedEntry } from "./demo.js";
import { sendEmail } from "./deliver/email.js";
import { createHttp } from "./http.js";
import { Ledger } from "./ledger.js";
import { runDigest } from "./pipeline.js";
import { renderHtml, subjectFor } from "./render/html.js";

/**
 * npm run digest            fetch, summarize and write digests/<date>.md (needs ANTHROPIC_API_KEY)
 * npm run demo              same pipeline on fixture data with a scripted model; writes examples/
 * npm run digest -- send F  email an existing digest file (needs RESEND_API_KEY and DIGEST_TO)
 */
const root = process.cwd();
const args = process.argv.slice(2);

async function demo(): Promise<void> {
  const dir = join(root, "fixtures");
  const now = new Date("2026-11-04T12:00:00Z");
  const settings = loadSettings({}, "demo");
  const routes = JSON.parse(readFileSync(join(dir, "routes.json"), "utf8")) as Record<string, string>;
  const canned = JSON.parse(readFileSync(join(dir, "model-output.json"), "utf8")) as Record<string, CannedEntry>;
  const result = await runDigest({
    sources: loadSources(join(dir, "sources.json")),
    settings,
    http: fixtureHttp(dir, routes),
    client: scriptedClient(canned),
    ledger: new Ledger(),
    budget: new BudgetGuard(settings.monthlyBudgetUsd, new MemoryBudgetStore(), () => now),
    now,
  });
  mkdirSync(join(root, "examples"), { recursive: true });
  writeFileSync(join(root, "examples", "sample-digest.md"), result.markdown);
  writeFileSync(join(root, "examples", "sample-digest.html"), result.html);
  console.log(`[demo] ${result.subject}`);
  console.log(`[demo] wrote examples/sample-digest.md and .html (${JSON.stringify(result.stats)})`);
}

async function digest(): Promise<void> {
  const settings = loadSettings(process.env);
  const now = new Date();
  const ledgerPath = join(root, "state", "ledger.json");
  const ledger = Ledger.load(ledgerPath);
  const result = await runDigest({
    sources: loadSources(join(root, "config", "sources.json")),
    settings,
    http: createHttp(),
    client: new Anthropic({ apiKey: settings.anthropicApiKey }),
    ledger,
    budget: new BudgetGuard(settings.monthlyBudgetUsd, new FileBudgetStore(join(root, "state", "budget.json"))),
    now,
  });

  const path = join(root, "digests", `${result.date}.md`);
  mkdirSync(join(root, "digests"), { recursive: true });
  writeFileSync(path, result.markdown);
  // Only now, with the digest on disk, do the fetched items count as seen.
  ledger.apply(result.changes, result.date);
  ledger.prune(result.date, 180);
  ledger.save(ledgerPath);
  console.log(`[digest] wrote digests/${result.date}.md: ${JSON.stringify(result.stats)}`);
}

async function send(file: string | undefined): Promise<void> {
  if (!file) throw new Error("usage: send <digest.md>");
  const settings = loadSettings(process.env, "send");
  const markdown = readFileSync(file, "utf8");
  const name = file.replace(/\\/g, "/").split("/").pop()!.replace(/\.md$/, "");
  const id = await sendEmail(createHttp(), settings.resendApiKey!, {
    from: settings.digestFrom,
    to: settings.digestTo!,
    subject: subjectFor(markdown),
    html: renderHtml(markdown),
    text: markdown,
    idempotencyKey: `digest-${name}`,
  });
  console.log(`[send] sent ${name}: ${id}`);
}

try {
  if (args[0] === "--demo") await demo();
  else if (args[0] === "send") await send(args[1]);
  else await digest();
} catch (err) {
  console.error(`[error] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
