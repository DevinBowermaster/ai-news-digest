/**
 * How much a source can be trusted for its own facts.
 * T1: the vendor or agency the item is about (changelog, advisory, regulator).
 * T2: vendor staff and vendor-sponsored material.
 * T3: independent writing that links its sources.
 * T4: aggregators, newsletters, forums.
 */
export type Tier = "T1" | "T2" | "T3" | "T4";

export type Topic = "security" | "microsoft" | "google" | "ai" | "platforms" | "compliance";

/** One feed entry after fetching, normalized and deduplicated. Everything in it is untrusted text. */
export interface NewsItem {
  id: string;
  /** The feed it came from, so a deferred item can hold back that feed's watermark. */
  feedUrl: string;
  source: string;
  tier: Tier;
  topic: Topic;
  title: string;
  url: string;
  published: string | null;
  text: string;
}

export type Priority = "P0" | "P1" | "P2";

/** A newly added entry in the CISA Known Exploited Vulnerabilities catalog, ranked for a small IT team. */
export interface KevItem {
  id: string;
  cve: string;
  vendor: string;
  product: string;
  name: string;
  dateAdded: string;
  requiredAction: string;
  ransomware: boolean;
  epss: number | null;
  onStack: boolean;
  remoteAccessTool: boolean;
  priority: Priority;
  url: string;
}

/** A support or security-update end date coming up for a product the team manages. */
export interface EolItem {
  id: string;
  product: string;
  release: string;
  ends: string;
  date: string;
  url: string;
}

/**
 * What a source step proposes to record in the ledger. Nothing is written until the
 * digest has been produced, so a failed run leaves every item eligible for the next one.
 */
export interface LedgerChanges {
  seen: Record<string, { source: string; title: string }>;
  watermarks: Record<string, string>;
}

export interface SourceError {
  source: string;
  error: string;
}
