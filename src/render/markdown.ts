import type { DigestEntry, HeldBack, Kind } from "../llm/validate.js";
import type { EolItem, KevItem, SourceError } from "../types.js";

export interface DigestInput {
  date: string;
  title: string;
  kev: KevItem[];
  eol: EolItem[];
  entries: DigestEntry[];
  heldBack: HeldBack[];
  health: {
    feedsChecked: number;
    errors: SourceError[];
    model: string;
    calls: number;
    runCostUsd: number;
    monthSpentUsd: number;
    monthlyBudgetUsd: number;
    skipped: number;
    deferred: number;
    problems: string[];
  };
}

/** Backslash-escapes characters that would turn untrusted text into markdown structure. */
export function md(s: string): string {
  return s.replace(/[\\`*_[\]<#|]/g, (c) => `\\${c}`).replace(/\s+/g, " ").trim();
}

/** A markdown link to an https URL, or plain text when the URL is unusable. */
export function link(label: string, url: string): string {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return md(label);
    return `[${md(label)}](${u.href.replace(/\(/g, "%28").replace(/\)/g, "%29").replace(/ /g, "%20")})`;
  } catch {
    return md(label);
  }
}

const SECTIONS: { kind: Kind; heading: string }[] = [
  { kind: "action", heading: "Act on" },
  { kind: "change", heading: "Changes clients will notice" },
  { kind: "opportunity", heading: "Worth offering" },
  { kind: "fyi", heading: "Good to know" },
];

const MAX_KEV_IN_FULL = 5;

/** "Keystone Keystone Agent" reads badly; drop the vendor when the product already starts with it. */
export function vendorProduct(k: Pick<KevItem, "vendor" | "product">): string {
  return k.product.toLowerCase().startsWith(k.vendor.toLowerCase()) ? k.product : `${k.vendor} ${k.product}`;
}

function kevReason(k: KevItem): string {
  const reasons: string[] = [];
  if (k.onStack) reasons.push("on your stack");
  if (k.remoteAccessTool) reasons.push("remote-access or RMM tool");
  if (k.ransomware) reasons.push("known ransomware use");
  if (k.epss !== null) reasons.push(`EPSS ${k.epss.toFixed(2)}`);
  return reasons.join(", ") || "new in KEV";
}

function entryLine(e: DigestEntry): string {
  const why = e.whyItMatters ? ` ${md(e.whyItMatters)}` : "";
  const note = e.note ? ` (moved here: ${e.note})` : "";
  return `- **${md(e.headline)}** ${md(e.summary)}${why} ${link(e.item.source, e.item.url)}, ${e.trust}.${note}`;
}

export function topItems(input: DigestInput): string[] {
  const top: string[] = [];
  for (const k of input.kev.filter((k) => k.priority === "P0")) top.push(`Patch: ${vendorProduct(k)} (${k.cve})`);
  for (const kind of ["action", "change", "opportunity"] as const) {
    for (const e of input.entries.filter((x) => x.kind === kind)) top.push(e.headline);
  }
  return top.slice(0, 3);
}

export function renderMarkdown(input: DigestInput): string {
  const out: string[] = [`# ${input.title}: ${input.date}`, ""];

  const top = topItems(input);
  if (top.length) {
    out.push("Top of this edition:", ...top.map((t) => `- ${md(t)}`), "");
  } else {
    out.push("Nothing urgent in this edition.", "");
  }

  const urgent = input.kev.filter((k) => k.priority !== "P2");
  if (input.kev.length || input.eol.length) {
    out.push("## Security to act on", "");
    for (const k of urgent.slice(0, MAX_KEV_IN_FULL)) {
      out.push(
        `### ${k.priority}: ${md(vendorProduct(k))} (${k.cve})`,
        `- ${md(k.name)}. Ranked ${k.priority} because: ${kevReason(k)}.`,
        `- Required action, from CISA: ${md(k.requiredAction)}`,
        `- Added to the Known Exploited Vulnerabilities catalog on ${k.dateAdded}. ${link("NVD entry", k.url)}`,
        "",
      );
    }
    const rest = [...urgent.slice(MAX_KEV_IN_FULL), ...input.kev.filter((k) => k.priority === "P2")];
    if (rest.length) {
      out.push(`Also new in KEV, lower priority: ${rest.map((k) => `${k.cve} (${md(vendorProduct(k))})`).join(", ")}.`, "");
    }
    if (input.eol.length) {
      out.push("### Support ending soon", "");
      for (const e of input.eol) {
        out.push(`- ${md(e.product)} ${md(e.release)}: ${e.ends} on ${e.date}. ${link("lifecycle page", e.url)}`);
      }
      out.push("");
    }
  }

  for (const s of SECTIONS) {
    const entries = input.entries.filter((e) => e.kind === s.kind);
    if (!entries.length) continue;
    out.push(`## ${s.heading}`, "", ...entries.map(entryLine), "");
  }

  if (input.heldBack.length) {
    out.push(
      "## Held back for review",
      "",
      "These items were fetched but their summaries failed a check, so only the original link is shown.",
      "",
      ...input.heldBack.map((h) => `- ${link(h.item.title, h.item.url)} (${md(h.item.source)}): ${md(h.reason)}`),
      "",
    );
  }

  const h = input.health;
  out.push(
    "## Run health",
    "",
    `- Sources: ${h.feedsChecked} feeds checked, ${h.errors.length} failed.`,
    ...h.errors.map((e) => `  - ${md(e.source)}: ${md(e.error)}`),
    `- Model: ${h.model}, ${h.calls} ${h.calls === 1 ? "call" : "calls"}, $${h.runCostUsd.toFixed(4)} this run, $${h.monthSpentUsd.toFixed(2)} of $${h.monthlyBudgetUsd.toFixed(2)} this month.`,
    `- Skipped as not relevant: ${h.skipped}. Waiting for the next run: ${h.deferred}.`,
    ...h.problems.map((p) => `- ${md(p)}`),
    "",
  );
  return out.join("\n");
}
