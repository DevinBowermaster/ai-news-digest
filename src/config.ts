import { readFileSync } from "node:fs";
import { z } from "zod";
import { PRICES_PER_MTOK } from "./budget.js";

const Tier = z.enum(["T1", "T2", "T3", "T4"]);
const Topic = z.enum(["security", "microsoft", "google", "ai", "platforms", "compliance"]);

export const SourcesSchema = z.object({
  /** Who reads the digest. Goes into the system prompt so the model knows what matters. */
  audience: z.string().min(10),
  feeds: z.array(
    z.object({
      name: z.string().min(1),
      url: z.url({ protocol: /^https$/ }),
      tier: Tier,
      topic: Topic,
      /** Optional case-insensitive regex; entries that do not match title or text are skipped. */
      keywords: z.string().optional(),
      maxItems: z.number().int().positive().optional(),
    }),
  ),
  kev: z
    .object({
      url: z.url({ protocol: /^https$/ }),
      epssUrl: z.url({ protocol: /^https$/ }).optional(),
      /** Vendors and products the team supports. A KEV entry that matches is P0. */
      stack: z.array(z.string().min(2)),
      /** Remote-access and RMM tools: one bug there reaches every client, so always P0. */
      remoteAccessTools: z.array(z.string().min(2)),
      epssP1: z.number().min(0).max(1).default(0.1),
    })
    .optional(),
  endOfLife: z
    .object({
      api: z.url({ protocol: /^https$/ }),
      products: z.array(z.string().regex(/^[a-z0-9-]+$/)),
      horizonDays: z.number().int().positive().default(120),
    })
    .optional(),
});
export type Sources = z.infer<typeof SourcesSchema>;

export function loadSources(path: string): Sources {
  return SourcesSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

export interface Settings {
  model: string;
  monthlyBudgetUsd: number;
  maxItemsPerRun: number;
  batchSize: number;
  anthropicApiKey?: string;
  resendApiKey?: string;
  digestTo?: string;
  digestFrom: string;
}

/** Secrets pasted into a CI secret store sometimes carry a BOM or a trailing newline; either breaks a header. */
function secret(value: string | undefined): string | undefined {
  const v = value?.replace(/^﻿/, "").trim();
  return v ? v : undefined;
}

function positive(name: string, raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} must be a positive number, got "${raw}"`);
  return n;
}

/**
 * Reads settings from the environment and fails at startup, not halfway
 * through a run, when something required is missing.
 */
export function loadSettings(env: NodeJS.ProcessEnv, mode: "digest" | "send" | "demo" = "digest"): Settings {
  // `||` not `??`: an unset GitHub Actions variable arrives as an empty string.
  const model = env.CLAUDE_MODEL || "claude-sonnet-5-5";
  if (!PRICES_PER_MTOK[model]) {
    throw new Error(`No price configured for model "${model}". Add it to PRICES_PER_MTOK so the budget cap works.`);
  }
  const settings: Settings = {
    model,
    monthlyBudgetUsd: positive("MONTHLY_BUDGET_USD", env.MONTHLY_BUDGET_USD, 5),
    maxItemsPerRun: Math.floor(positive("MAX_ITEMS_PER_RUN", env.MAX_ITEMS_PER_RUN, 60)),
    batchSize: Math.floor(positive("BATCH_SIZE", env.BATCH_SIZE, 15)),
    anthropicApiKey: secret(env.ANTHROPIC_API_KEY),
    resendApiKey: secret(env.RESEND_API_KEY),
    digestTo: secret(env.DIGEST_TO),
    digestFrom: env.DIGEST_FROM || "AI & IT Digest <onboarding@resend.dev>",
  };
  // Each job gets only the secret it needs: the digest job the model key, the send job the mail key.
  if (mode === "demo") return settings;
  if (mode === "digest" && !settings.anthropicApiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  if (mode === "send" && (!settings.resendApiKey || !settings.digestTo)) {
    throw new Error("sending needs RESEND_API_KEY and DIGEST_TO");
  }
  return settings;
}
