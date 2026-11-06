import { z } from "zod";

/**
 * What the model returns for each item. It never returns URLs, sources or
 * trust labels: those come from the fetched item in code, so the model cannot
 * invent a link or upgrade a rumor to "official".
 */
export const EntrySchema = z.object({
  itemId: z.string().describe("The id attribute of the <item> this entry is about, copied exactly."),
  kind: z
    .enum(["action", "change", "opportunity", "fyi", "skip"])
    .describe(
      "action: the team must do something (patch, reconfigure). change: something clients will notice (price, retirement, new default). opportunity: a generally available feature worth offering clients. fyi: useful background. skip: not relevant, marketing, or a duplicate.",
    ),
  headline: z.string().describe("One plain sentence, at most 15 words. No hype words."),
  summary: z
    .string()
    .describe("One or two sentences, using only facts stated in the item. Copy versions, prices and dates exactly."),
  whyItMatters: z.string().describe("One sentence on what it means for the reader. Empty string for skip."),
  availability: z
    .enum(["generally-available", "preview", "announced", "not-applicable"])
    .describe("Release stage as stated in the item. Use announced when the item does not say."),
});
export type Entry = z.infer<typeof EntrySchema>;

export const BatchSchema = z.object({ entries: z.array(EntrySchema) });
export type Batch = z.infer<typeof BatchSchema>;
